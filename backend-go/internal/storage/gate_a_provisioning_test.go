package storage_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
)

func TestGateAProvisioningRealPostgresRollsBackEveryMaterialFailure(t *testing.T) {
	fx := newRLSFixture(t)
	handler, token := gateAProvisioningHTTP(t, fx)
	steps := []struct {
		name      string
		table     string
		timing    string
		condition string
	}{
		{name: "entitlements", table: "organization_entitlements", timing: "BEFORE INSERT OR UPDATE", condition: "NEW.organization_id"},
		{name: "settings", table: "workshop_settings", timing: "BEFORE INSERT OR UPDATE", condition: "NEW.organization_id"},
		{name: "bootstrap_membership", table: "memberships", timing: "BEFORE INSERT", condition: "NEW.organization_id"},
		{name: "catalog_clone", table: "modules", timing: "BEFORE INSERT", condition: "NEW.organization_id"},
		{name: "provisioning_started_audit", table: "security_audit_events", timing: "BEFORE INSERT", condition: "CASE WHEN NEW.event_type='organization_provisioning_started' THEN NEW.organization_id END"},
		{name: "activation", table: "organizations", timing: "BEFORE UPDATE", condition: "CASE WHEN NEW.status='active' THEN NEW.id END"},
		{name: "provisioning_completed_audit", table: "security_audit_events", timing: "BEFORE INSERT", condition: "CASE WHEN NEW.event_type='organization_provisioning_completed' THEN NEW.organization_id END"},
	}

	for index, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			slug := fmt.Sprintf("gate-a-failure-%02d", index)
			functionName := fmt.Sprintf("gate_a_fail_%02d", index)
			triggerName := functionName + "_trigger"
			_, err := fx.admin.Exec(t.Context(), fmt.Sprintf(`
				CREATE FUNCTION %s() RETURNS TRIGGER LANGUAGE plpgsql AS $$
				BEGIN
					IF EXISTS (SELECT 1 FROM organizations WHERE id=(%s) AND slug=%s) THEN
						RAISE EXCEPTION 'injected Gate A provisioning failure';
					END IF;
					RETURN NEW;
				END $$;
				CREATE TRIGGER %s %s ON %s FOR EACH ROW EXECUTE FUNCTION %s()
			`, functionName, step.condition, quoteLiteral(slug), triggerName, step.timing, step.table, functionName))
			if err != nil {
				t.Fatal(err)
			}

			body := gateAProvisioningBody(slug, "Gate A failure "+step.name)
			failed := gateAProvisioningRequest(t, handler, token, "gate-a-failure-key-"+fmt.Sprint(index), body)
			if failed.Code != http.StatusInternalServerError {
				t.Fatalf("status=%d body=%s", failed.Code, failed.Body.String())
			}
			assertNoProvisioningRows(t, fx, slug)

			if _, err := fx.admin.Exec(t.Context(), fmt.Sprintf("DROP TRIGGER %s ON %s; DROP FUNCTION %s()", triggerName, step.table, functionName)); err != nil {
				t.Fatal(err)
			}
			retried := gateAProvisioningRequest(t, handler, token, "gate-a-failure-key-"+fmt.Sprint(index), body)
			if retried.Code != http.StatusCreated {
				t.Fatalf("safe retry status=%d body=%s", retried.Code, retried.Body.String())
			}
			assertProvisioningReadyAndAudited(t, fx, slug)
		})
	}
}

func TestGateAProvisioningSameKeyDifferentPayloadConflictsInPostgres(t *testing.T) {
	fx := newRLSFixture(t)
	handler, token := gateAProvisioningHTTP(t, fx)
	const key = "gate-a-idempotency-mismatch"
	first := gateAProvisioningRequest(t, handler, token, key, gateAProvisioningBody("gate-a-idem-one", "Gate A idem one"))
	if first.Code != http.StatusCreated {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}
	second := gateAProvisioningRequest(t, handler, token, key, gateAProvisioningBody("gate-a-idem-two", "Gate A idem two"))
	if second.Code != http.StatusConflict || !strings.Contains(second.Body.String(), "IDEMPOTENCY_CONFLICT") {
		t.Fatalf("mismatch status=%d body=%s", second.Code, second.Body.String())
	}
	var organizations int
	if err := fx.admin.QueryRow(t.Context(), `SELECT count(*) FROM organizations WHERE slug IN ('gate-a-idem-one','gate-a-idem-two')`).Scan(&organizations); err != nil {
		t.Fatal(err)
	}
	if organizations != 1 {
		t.Fatalf("idempotency mismatch organizations=%d want=1", organizations)
	}
}

func TestGateAProvisioningConcurrentSlugCollisionIsDeterministic(t *testing.T) {
	fx := newRLSFixture(t)
	handler, token := gateAProvisioningHTTP(t, fx)
	const slug = "gate-a-concurrent-slug"
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for index := 0; index < 2; index++ {
		index := index
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- gateAProvisioningRequest(t, handler, token, fmt.Sprintf("gate-a-concurrent-key-%d", index),
				gateAProvisioningBody(slug, fmt.Sprintf("Gate A concurrent %d", index)))
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	statuses := make([]int, 0, 2)
	for result := range results {
		statuses = append(statuses, result.Code)
		if result.Code == http.StatusConflict && !strings.Contains(result.Body.String(), "ORGANIZATION_SLUG_CONFLICT") {
			t.Fatalf("typed conflict body=%s", result.Body.String())
		}
	}
	sort.Ints(statuses)
	if statuses[0] != http.StatusCreated || statuses[1] != http.StatusConflict {
		t.Fatalf("statuses=%v want=[201 409]", statuses)
	}
	assertProvisioningReadyAndAudited(t, fx, slug)
}

func gateAProvisioningHTTP(t *testing.T, fx *rlsFixture) (http.Handler, string) {
	t.Helper()
	const (
		secret         = "gate-a-provisioning-http-secret-minimum"
		platformUserID = "c9000000-0000-0000-0000-000000000001"
		platformEmail  = "gate-a-platform@example.test"
	)
	if _, err := fx.admin.Exec(t.Context(), `
		INSERT INTO users (id,email,normalized_email,password_hash,name,account_status,platform_admin)
		VALUES ($1,$2::text,normalize_identity_email($2::text),'x','Gate A Platform','active',TRUE)
		ON CONFLICT (id) DO NOTHING`, platformUserID, platformEmail); err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateLegacyWebToken(platformUserID, platformEmail, auth.TokenContext{
		PlatformAdmin: true,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	return api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 1000, 1000)), token
}

func gateAProvisioningBody(slug, name string) map[string]any {
	return map[string]any{
		"name": name, "slug": slug, "type": "store", "license_plan": "trial",
		"bootstrap_admin_user_id": rlsUserA, "clone_catalog_from": rlsOrgA,
	}
}

func gateAProvisioningRequest(t *testing.T, handler http.Handler, token, key string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/organizations", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func assertNoProvisioningRows(t *testing.T, fx *rlsFixture, slug string) {
	t.Helper()
	var organizations, audits int
	if err := fx.admin.QueryRow(t.Context(), `SELECT count(*) FROM organizations WHERE slug=$1`, slug).Scan(&organizations); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(t.Context(), `SELECT count(*) FROM security_audit_events WHERE details->>'request_id' <> '' AND organization_id IN (SELECT id FROM organizations WHERE slug=$1)`, slug).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if organizations != 0 || audits != 0 {
		t.Fatalf("partial provisioning leaked organizations=%d audits=%d", organizations, audits)
	}
}

func assertProvisioningReadyAndAudited(t *testing.T, fx *rlsFixture, slug string) {
	t.Helper()
	var organizationID, status string
	if err := fx.admin.QueryRow(t.Context(), `SELECT id::text,status FROM organizations WHERE slug=$1`, slug).Scan(&organizationID, &status); err != nil {
		t.Fatal(err)
	}
	if status != "active" {
		t.Fatalf("status=%s want=active", status)
	}
	var entitlements, settings, admins, modules, audits int
	queries := []struct {
		destination *int
		query       string
	}{
		{&entitlements, `SELECT count(*) FROM organization_entitlements WHERE organization_id=$1`},
		{&settings, `SELECT count(*) FROM workshop_settings WHERE organization_id=$1`},
		{&admins, `SELECT count(*) FROM memberships WHERE organization_id=$1 AND status='active' AND 'admin'=ANY(roles)`},
		{&modules, `SELECT count(*) FROM modules WHERE organization_id=$1`},
		{&audits, `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type IN ('organization_provisioning_started','organization_provisioning_completed')`},
	}
	for _, query := range queries {
		if err := fx.admin.QueryRow(t.Context(), query.query, organizationID).Scan(query.destination); err != nil {
			t.Fatal(err)
		}
	}
	if entitlements != 1 || settings != 1 || admins != 1 || modules == 0 || audits != 2 {
		t.Fatalf("ready rows entitlements=%d settings=%d admins=%d modules=%d audits=%d", entitlements, settings, admins, modules, audits)
	}
}

func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
