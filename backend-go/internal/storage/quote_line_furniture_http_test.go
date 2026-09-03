package storage_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestQuoteLineMaterializeHTTP_Postgres exercises the generated-contract HTTP
// surface of #386 against real PostgreSQL under the app role: retry-safe
// materialization (same Idempotency-Key replays the same state; a different
// key converges without duplicating units), the relation list endpoint,
// accepted-quote immutability (typed 409), random-line 404 and the
// non-owner-org 403.
func TestQuoteLineMaterializeHTTP_Postgres(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	const secret = "quote-line-furniture-http-test-secret"
	mint := func(orgID, userID string) string {
		t.Helper()
		var membershipID string
		var membershipCredentialVersion, organizationCredentialVersion int64
		if err := fx.admin.QueryRow(ctx, `
			SELECT membership.id, membership.credential_version, organization.credential_version
			FROM memberships membership
			JOIN organizations organization ON organization.id=membership.organization_id
			WHERE membership.organization_id=$1 AND membership.user_id=$2`, orgID, userID).
			Scan(&membershipID, &membershipCredentialVersion, &organizationCredentialVersion); err != nil {
			t.Fatal(err)
		}
		token, err := auth.GenerateLegacyWebToken(userID, userID+"@example.test", auth.TokenContext{
			Roles: []string{string(domain.RoleAdmin)}, OrgID: orgID, MembershipID: membershipID,
			MembershipCredentialVersion:   membershipCredentialVersion,
			OrganizationCredentialVersion: organizationCredentialVersion,
		}, secret)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	tokenA := mint(rlsOrgA, rlsUserA)
	tokenB := mint(rlsOrgB, rlsUserB)
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))

	seedQuoteLines(t, fx, fiSharedProject, map[string]int{qlfiLineQty3: 3})

	request := func(method, path, token, key string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, bytes.NewReader(nil))
		req.Header.Set("Authorization", "Bearer "+token)
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}

	materializePath := "/api/projects/" + fiSharedProject + "/quote-lines/" + qlfiLineQty3 + ":materialize"
	listPath := "/api/projects/" + fiSharedProject + "/quote-lines/" + qlfiLineQty3 + "/furniture-instances"

	// qty 3 over HTTP: exactly three unique physical identities.
	first := request(http.MethodPost, materializePath, tokenA, "dt2-materialize-key-0001")
	if first.Code != http.StatusOK {
		t.Fatalf("materialize status=%d body=%s", first.Code, first.Body.String())
	}
	var result struct {
		ProjectID   string `json:"project_id"`
		QuoteLineID string `json:"quote_line_id"`
		Quantity    int    `json:"quantity"`
		Instances   []struct {
			ID                  string `json:"id"`
			QuoteLineID         string `json:"quote_line_id"`
			FurnitureInstanceID string `json:"furniture_instance_id"`
			FurnitureInstance   struct {
				ID        string `json:"id"`
				Origin    string `json:"origin"`
				Lifecycle string `json:"lifecycle_status"`
			} `json:"furniture_instance"`
		} `json:"instances"`
		CreatedIDs []string `json:"created_furniture_instance_ids"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Quantity != 3 || len(result.Instances) != 3 || len(result.CreatedIDs) != 3 {
		t.Fatalf("materialize body: quantity=%d instances=%d created=%d", result.Quantity, len(result.Instances), len(result.CreatedIDs))
	}
	unique := map[string]bool{}
	for _, instance := range result.Instances {
		if instance.QuoteLineID != qlfiLineQty3 || instance.FurnitureInstance.ID != instance.FurnitureInstanceID {
			t.Fatalf("link DTO shape: %+v", instance)
		}
		if instance.FurnitureInstance.Origin != "quote" || instance.FurnitureInstance.Lifecycle != "active" {
			t.Fatalf("materialized instance DTO: %+v", instance.FurnitureInstance)
		}
		unique[instance.FurnitureInstanceID] = true
	}
	if len(unique) != 3 {
		t.Fatalf("HTTP materialization collapsed identities: %v", unique)
	}

	// Network retry with the SAME Idempotency-Key: replayed response, still
	// exactly 3 units in the database.
	retry := request(http.MethodPost, materializePath, tokenA, "dt2-materialize-key-0001")
	if retry.Code != http.StatusOK || retry.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("retry status=%d replayed=%q body=%s",
			retry.Code, retry.Header().Get("Idempotency-Replayed"), retry.Body.String())
	}
	// A DIFFERENT key is a new command, but convergence must not duplicate
	// units: exactly 3 identities remain.
	other := request(http.MethodPost, materializePath, tokenA, "dt2-materialize-key-0002")
	if other.Code != http.StatusOK {
		t.Fatalf("second key status=%d body=%s", other.Code, other.Body.String())
	}
	var otherResult struct {
		Created   []string `json:"created_furniture_instance_ids"`
		Instances []struct {
			ID string `json:"furniture_instance_id"`
		} `json:"instances"`
	}
	if err := json.Unmarshal(other.Body.Bytes(), &otherResult); err != nil {
		t.Fatal(err)
	}
	if len(otherResult.Created) != 0 || len(otherResult.Instances) != 3 {
		t.Fatalf("different-key run must be a no-op: created=%v instances=%d", otherResult.Created, len(otherResult.Instances))
	}
	var count int
	if err := fx.admin.QueryRow(ctx,
		`SELECT count(*) FROM furniture_instances WHERE project_id=$1`, fiSharedProject,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("after retries the project has %d units, want exactly 3", count)
	}

	// The relation list endpoint answers which units the line represents.
	list := request(http.MethodGet, listPath, tokenA, "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	var links []map[string]any
	if err := json.Unmarshal(list.Body.Bytes(), &links); err != nil {
		t.Fatal(err)
	}
	if len(links) != 3 {
		t.Fatalf("list got %d links, want 3", len(links))
	}

	// Random quote line → 404 under the caller's scope.
	random := request(http.MethodPost,
		"/api/projects/"+fiSharedProject+"/quote-lines/6ffffff1-0000-0000-0000-0000000000f1:materialize",
		tokenA, "dt2-materialize-key-0003")
	if random.Code != http.StatusNotFound {
		t.Fatalf("random line status=%d body=%s", random.Code, random.Body.String())
	}

	// Non-owner organization (manufacturing counterpart of the shared
	// project): reads the relation, cannot materialize.
	listB := request(http.MethodGet, listPath, tokenB, "")
	if listB.Code != http.StatusOK {
		t.Fatalf("manufacturing org list status=%d body=%s", listB.Code, listB.Body.String())
	}
	materializeB := request(http.MethodPost, materializePath, tokenB, "dt2-materialize-key-0004")
	if materializeB.Code != http.StatusForbidden {
		t.Fatalf("non-owner materialize status=%d body=%s", materializeB.Code, materializeB.Body.String())
	}

	// Accepted quote immutability over HTTP: typed 409 CONFLICT, never a
	// silent mutation of the accepted materialization.
	if _, err := fx.admin.Exec(ctx, `UPDATE projects SET status='accepted' WHERE id=$1`, fiSharedProject); err != nil {
		t.Fatal(err)
	}
	accepted := request(http.MethodPost, materializePath, tokenA, "dt2-materialize-key-0005")
	if accepted.Code != http.StatusConflict {
		t.Fatalf("accepted materialize status=%d body=%s", accepted.Code, accepted.Body.String())
	}
	if !strings.Contains(accepted.Body.String(), "CONFLICT") {
		t.Fatalf("accepted materialize must return the typed code, got %s", accepted.Body.String())
	}
	var afterAccepted int
	if err := fx.admin.QueryRow(ctx,
		`SELECT count(*) FROM quote_line_furniture_instances WHERE quote_line_id=$1`, qlfiLineQty3,
	).Scan(&afterAccepted); err != nil {
		t.Fatal(err)
	}
	if afterAccepted != 3 {
		t.Fatalf("accepted materialization mutated: %d links, want 3 intact", afterAccepted)
	}
}
