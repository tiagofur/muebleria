package storage_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestProjectInlineCustomerUpdateHTTP_Postgres exercises the #714 inline
// customer UPDATE over the full real stack (auth middleware tenant
// transaction + durable idempotency receipts + handler + storage) against
// real PostgreSQL under the app role with RLS enforced: atomic happy path,
// lost-response retry replaying the committed receipt, manual retry with a
// new key converging via the explicit base conflict, the manufacturing
// partner never gaining the commercial capability, and the legacy PUT
// contract unchanged.
func TestProjectInlineCustomerUpdateHTTP_Postgres(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	const secret = "inline-customer-update-http-test-secret"
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

	const projectID = fiSharedProject // owner org A, manufacturing org B, draft
	const baseCustomer = "30000000-0000-0000-0000-00000000000a"

	put := func(token, key, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/api/projects/"+projectID, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}
	inlineBody := func(replaces, expectedUpdatedAt string) string {
		return `{"id":"` + projectID + `","name":"Cocina editada","customer_id":"","inline_customer_name":"Ana López","inline_customer_replaces":"` + replaces + `","expected_project_updated_at":"` + expectedUpdatedAt + `","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	}
	countInline := func() int {
		t.Helper()
		var n int
		if err := fx.admin.QueryRow(ctx,
			`SELECT count(*) FROM customers WHERE name = 'Ana López'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	projectCustomer := func() string {
		t.Helper()
		var ref *string
		if err := fx.admin.QueryRow(ctx,
			`SELECT customer_id FROM projects WHERE id = $1`, projectID).Scan(&ref); err != nil {
			t.Fatal(err)
		}
		if ref == nil {
			return ""
		}
		return *ref
	}
	projectUpdatedAt := func() string {
		t.Helper()
		var updatedAt time.Time
		if err := fx.admin.QueryRow(ctx,
			`SELECT updated_at FROM projects WHERE id = $1`, projectID).Scan(&updatedAt); err != nil {
			t.Fatal(err)
		}
		return updatedAt.Format(time.RFC3339Nano)
	}

	// A non-customer winner that keeps the same assignment must still make a
	// stale inline intention fail with 409. This proves the HTTP surface carries
	// the exact persisted Project version rather than relying on customer_id.
	staleVersion := projectUpdatedAt()
	if _, err := fx.admin.Exec(ctx, `
		UPDATE projects
		SET name='Concurrent winner', notes='B', updated_at=clock_timestamp() + interval '1 second'
		WHERE id=$1`, projectID); err != nil {
		t.Fatal(err)
	}
	staleMetadata := put(tokenA, "inline-update-stale-version", inlineBody(baseCustomer, staleVersion))
	if staleMetadata.Code != http.StatusConflict {
		t.Fatalf("stale version status=%d body=%s, want 409", staleMetadata.Code, staleMetadata.Body.String())
	}
	if got := countInline(); got != 0 {
		t.Fatalf("customers after stale version = %d, want 0", got)
	}
	var winnerName, winnerNotes string
	if err := fx.admin.QueryRow(ctx, `SELECT name, notes FROM projects WHERE id=$1`, projectID).Scan(&winnerName, &winnerNotes); err != nil {
		t.Fatal(err)
	}
	if winnerName != "Concurrent winner" || winnerNotes != "B" {
		t.Fatalf("winner metadata = %q/%q, want Concurrent winner/B", winnerName, winnerNotes)
	}

	// 1. Atomic happy path: one PUT commits customer + repointed project.
	happyBody := inlineBody(baseCustomer, projectUpdatedAt())
	first := put(tokenA, "inline-update-key-0001", happyBody)
	if first.Code != http.StatusOK {
		t.Fatalf("inline update status=%d body=%s", first.Code, first.Body.String())
	}
	var created struct {
		domain.Project
		InlineCustomer *domain.Customer `json:"inline_customer"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode first response: %v", err)
	}
	if created.InlineCustomer == nil || created.InlineCustomer.ID == "" {
		t.Fatalf("inline_customer = %+v, want the server-minted identity", created.InlineCustomer)
	}
	if got := projectCustomer(); got != created.InlineCustomer.ID {
		t.Fatalf("project.customer_id = %q, want the minted %q", got, created.InlineCustomer.ID)
	}
	if got := countInline(); got != 1 {
		t.Fatalf("'Ana López' rows = %d, want exactly 1", got)
	}
	var customerOrg string
	if err := fx.admin.QueryRow(ctx,
		`SELECT organization_id FROM customers WHERE id = $1`, created.InlineCustomer.ID).Scan(&customerOrg); err != nil {
		t.Fatal(err)
	}
	if customerOrg != rlsOrgA {
		t.Fatalf("customer org = %q, want the owning org A", customerOrg)
	}

	// 2. Lost response + retry with the SAME key: the durable receipt replays
	// the exact committed answer; the transition does not execute again.
	second := put(tokenA, "inline-update-key-0001", happyBody)
	if second.Code != http.StatusOK {
		t.Fatalf("retry status=%d body=%s", second.Code, second.Body.String())
	}
	if second.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("Idempotency-Replayed = %q, want 'true'", second.Header().Get("Idempotency-Replayed"))
	}
	if second.Body.String() != first.Body.String() {
		t.Fatalf("replayed body differs from the committed answer")
	}
	if got := countInline(); got != 1 {
		t.Fatalf("'Ana López' rows after replay = %d, want 1 (no duplicate customer)", got)
	}
	if got := projectCustomer(); got != created.InlineCustomer.ID {
		t.Fatalf("project.customer_id after replay = %q, want convergence on %q", got, created.InlineCustomer.ID)
	}

	// 3. Manual retry with a NEW key still carrying the stale base view: the
	// base check refuses with an explicit 409 — the user converges by
	// refreshing, and no second customer is ever minted.
	stale := put(tokenA, "inline-update-key-0002", happyBody)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale-base retry status=%d body=%s, want the explicit 409", stale.Code, stale.Body.String())
	}
	if got := countInline(); got != 1 {
		t.Fatalf("'Ana López' rows after stale retry = %d, want 1 (no orphan from convergence)", got)
	}

	// 4. The manufacturing partner (org B, admin on the shared project) never
	// gains the commercial capability — not even with a correct base view.
	cross := put(tokenB, "inline-update-key-0003", inlineBody(created.InlineCustomer.ID, created.UpdatedAt.Format(time.RFC3339Nano)))
	if cross.Code != http.StatusForbidden {
		t.Fatalf("partner inline update status=%d body=%s, want 403", cross.Code, cross.Body.String())
	}
	if got := countInline(); got != 1 {
		t.Fatalf("'Ana López' rows after partner attempt = %d, want 1", got)
	}
	if got := projectCustomer(); got != created.InlineCustomer.ID {
		t.Fatalf("project.customer_id after partner attempt = %q, want it unchanged", got)
	}

	// 5. The inline capability requires the idempotency key — 400 before
	// anything persists.
	noKey := put(tokenA, "", inlineBody(created.InlineCustomer.ID, created.UpdatedAt.Format(time.RFC3339Nano)))
	if noKey.Code != http.StatusBadRequest {
		t.Fatalf("missing key status=%d body=%s, want 400", noKey.Code, noKey.Body.String())
	}

	// 6. Legacy PUT contract unchanged: no inline fields, no key required.
	legacy := put(tokenA, "", `{"id":"`+projectID+`","name":"Edición normal","customer_id":"`+created.InlineCustomer.ID+`","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`)
	if legacy.Code != http.StatusOK {
		t.Fatalf("legacy PUT status=%d body=%s", legacy.Code, legacy.Body.String())
	}
	if got := countInline(); got != 1 {
		t.Fatalf("'Ana López' rows after legacy PUT = %d, want 1 (never creates customers)", got)
	}
	if got := projectCustomer(); got != created.InlineCustomer.ID {
		t.Fatalf("project.customer_id after legacy PUT = %q, want the selected customer", got)
	}
}
