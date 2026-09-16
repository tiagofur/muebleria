package storage_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #740 PR 1 — durable per-release Engineering state over real PostgreSQL +
// real HTTP: pending → start (idempotent) → complete (final, version-guarded)
// → reload keeps the fact; reads never write; P2 never inherits P1; the
// evidence is owner-org internal with audit + lifecycle events in the same
// transaction as the transition.

type engineeringHttpHarness struct {
	call    func(method, target, credential, body, ifMatch, idemKey string) *httptest.ResponseRecorder
	tokenA  string // org A admin (release permission)
	tokenEng string // org A ingeniero
	tokenSeller string // org A vendedor (no release permission)
	tokenB  string // org B admin (manufacturing partner of the shared project)
}

const engineeringVendedorUserID = "20000000-0000-0000-0000-00000000000e"

func engineeringTestHarness(t *testing.T, fx *releaseFixture) *engineeringHttpHarness {
	t.Helper()
	ctx := context.Background()
	const secret = "engineering-state-http-test-secret-0123456789"
	// A real vendedor membership in org A: the auth middleware re-derives
	// roles from the DB, so the token alone cannot simulate a weaker role.
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin)
		VALUES ('`+engineeringVendedorUserID+`', 'eng-vendedor@example.test', 'eng-vendedor@example.test', 'x', 'Eng Vendedor', 'active', FALSE)
		ON CONFLICT (id) DO NOTHING;
		INSERT INTO memberships (organization_id, user_id, roles)
		VALUES ('`+rlsOrgA+`', '`+engineeringVendedorUserID+`', '{vendedor}')
		ON CONFLICT DO NOTHING;`); err != nil {
		t.Fatal(err)
	}
	mint := func(userID, email string, roles []domain.UserRole) string {
		var membership string
		var memberVersion, orgVersion int64
		orgID := rlsOrgA
		if userID == rlsUserB {
			orgID = rlsOrgB
		}
		if err := fx.admin.QueryRow(ctx, `SELECT m.id,m.credential_version,o.credential_version
 FROM memberships m JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=$1 AND m.user_id=$2`, orgID, userID).Scan(&membership, &memberVersion, &orgVersion); err != nil {
			t.Fatal(err)
		}
		roleStrings := make([]string, 0, len(roles))
		for _, r := range roles {
			roleStrings = append(roleStrings, string(r))
		}
		token, err := auth.GenerateLegacyWebToken(userID, email, auth.TokenContext{
			Roles: roleStrings, OrgID: orgID, MembershipID: membership,
			MembershipCredentialVersion: memberVersion, OrganizationCredentialVersion: orgVersion,
		}, secret)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	call := func(method, target, credential, body, ifMatch, idemKey string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+credential)
		req.Header.Set("Content-Type", "application/json")
		if ifMatch != "" {
			req.Header.Set("If-Match", ifMatch)
		}
		if idemKey != "" {
			req.Header.Set("Idempotency-Key", idemKey)
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	return &engineeringHttpHarness{
		call:        call,
		tokenA:      mint(rlsUserA, "rls-a@example.test", []domain.UserRole{domain.RoleAdmin}),
		tokenEng:    mint(rlsUserA, "rls-a@example.test", []domain.UserRole{domain.RoleIngeniero}),
		tokenSeller: mint(engineeringVendedorUserID, "eng-vendedor@example.test", []domain.UserRole{domain.RoleVendedor}),
		tokenB:      mint(rlsUserB, "rls-b@example.test", []domain.UserRole{domain.RoleAdmin}),
	}
}

func engineeringPath(fx *releaseFixture, releaseID, action string) string {
	base := "/api/projects/" + fx.projectID + "/production-releases/" + releaseID + "/engineering"
	if action != "" {
		return base + ":" + action
	}
	return base
}

func decodeEngineeringState(t *testing.T, rr *httptest.ResponseRecorder) (status string, version int64, completedBy *string) {
	t.Helper()
	var body struct {
		Status      string  `json:"status"`
		Version     int64   `json:"version"`
		CompletedBy *string `json:"completed_by"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode engineering state: %v (%s)", err, rr.Body.String())
	}
	return body.Status, body.Version, body.CompletedBy
}

// Golden lifecycle: pending → start → in_progress → complete → completed,
// durable across reloads, with audit and lifecycle events in the same
// transaction. Reads never create evidence.
func TestReleaseEngineeringLifecycleHttp(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	h := engineeringTestHarness(t, fx)
	ctx := context.Background()

	// Pending: the honest answer for a release without evidence. The GET
	// itself must not create a row (reads never write).
	rr := h.call(http.MethodGet, engineeringPath(fx, p1.Release.ID, ""), h.tokenA, "", "", "")
	if rr.Code != 200 {
		t.Fatalf("initial GET=%d %s", rr.Code, rr.Body.String())
	}
	if status, version, _ := decodeEngineeringState(t, rr); status != "pending" || version != 0 {
		t.Fatalf("initial state must be pending v0, got %s v%d", status, version)
	}
	var rowsAfterGet int
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM production_release_engineering WHERE release_id=$1`, p1.Release.ID).Scan(&rowsAfterGet); err != nil {
		t.Fatal(err)
	}
	if rowsAfterGet != 0 {
		t.Fatal("GET must not create engineering evidence")
	}

	// Vendedor cannot start: release permission is engineering/plant.
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "start"), h.tokenSeller, "", "", "eng-life-seller-key-0001")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor start must be 403, got %d %s", rr.Code, rr.Body.String())
	}

	// Start (idempotent): first call records the fact with the server actor.
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "start"), h.tokenEng, "", "", "eng-life-start-key-0001")
	if rr.Code != 200 {
		t.Fatalf("start=%d %s", rr.Code, rr.Body.String())
	}
	if status, version, _ := decodeEngineeringState(t, rr); status != "in_progress" || version != 1 {
		t.Fatalf("post-start state must be in_progress v1, got %s v%d", status, version)
	}
	// Same Idempotency-Key replays the same response (lost response retry).
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "start"), h.tokenEng, "", "", "eng-life-start-key-0001")
	if rr.Code != 200 {
		t.Fatalf("start replay=%d %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatal("retry with the same key must replay")
	}
	// A DIFFERENT key is an idempotent no-op at command level: the row keeps
	// the original actor/timestamp (first writer wins).
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "start"), h.tokenA, "", "", "eng-life-start-key-0002")
	if rr.Code != 200 {
		t.Fatalf("second start=%d %s", rr.Code, rr.Body.String())
	}
	var startedBy string
	if err := fx.admin.QueryRow(ctx, `SELECT started_by::text FROM production_release_engineering WHERE release_id=$1`, p1.Release.ID).Scan(&startedBy); err != nil {
		t.Fatal(err)
	}
	if startedBy != rlsUserA {
		t.Fatalf("first start actor must win, got %s", startedBy)
	}

	// Reload: the durable state survives.
	rr = h.call(http.MethodGet, engineeringPath(fx, p1.Release.ID, ""), h.tokenA, "", "", "")
	if status, version, _ := decodeEngineeringState(t, rr); status != "in_progress" || version != 1 {
		t.Fatalf("reload must keep in_progress v1, got %s v%d", status, version)
	}

	// Complete requires If-Match (expected version).
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "complete"), h.tokenEng, "", "", "eng-life-complete-key-0001")
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("complete without If-Match must be 428, got %d %s", rr.Code, rr.Body.String())
	}
	// A stale/wrong version is a conflict, never a silent overwrite.
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "complete"), h.tokenEng, "", `"v99"`, "eng-life-complete-key-0002")
	if rr.Code != http.StatusConflict {
		t.Fatalf("complete with wrong version must be 409, got %d %s", rr.Code, rr.Body.String())
	}

	// Complete with the expected version: final, actor + server timestamp.
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "complete"), h.tokenEng, "", `"v1"`, "eng-life-complete-key-0003")
	if rr.Code != 200 {
		t.Fatalf("complete=%d %s", rr.Code, rr.Body.String())
	}
	status, version, completedBy := decodeEngineeringState(t, rr)
	if status != "completed" || version != 2 || completedBy == nil || *completedBy != rlsUserA {
		t.Fatalf("post-complete must be completed v2 by the actor, got %s v%d %v", status, version, completedBy)
	}

	// Reload keeps the completed fact with its original actor.
	rr = h.call(http.MethodGet, engineeringPath(fx, p1.Release.ID, ""), h.tokenA, "", "", "")
	status, version, completedBy = decodeEngineeringState(t, rr)
	if status != "completed" || version != 2 || completedBy == nil || *completedBy != rlsUserA {
		t.Fatalf("reload must keep completed v2, got %s v%d %v", status, version, completedBy)
	}

	// A later completion attempt (different actor + key) is an honest no-op:
	// completion is final and the row keeps the original completer.
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "complete"), h.tokenEng, "", `"v1"`, "eng-life-complete-key-0004")
	if rr.Code != 200 {
		t.Fatalf("already-completed must answer 200 with the durable fact, got %d %s", rr.Code, rr.Body.String())
	}
	_, _, completedBy = decodeEngineeringState(t, rr)
	if completedBy == nil || *completedBy != rlsUserA {
		t.Fatal("already-completed must keep the original completer")
	}

	// Same key + different If-Match: idempotency conflict (middleware).
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "complete"), h.tokenEng, "", `"v2"`, "eng-life-complete-key-0003")
	if rr.Code != http.StatusConflict {
		t.Fatalf("same key different If-Match must be 409, got %d %s", rr.Code, rr.Body.String())
	}

	// Audit + lifecycle events landed for both transitions, release-scoped.
	var auditStarted, auditCompleted int
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM security_audit_events WHERE event_type='engineering_started' AND details->>'production_release_id'=$1`, p1.Release.ID).Scan(&auditStarted); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM security_audit_events WHERE event_type='engineering_completed' AND details->>'production_release_id'=$1`, p1.Release.ID).Scan(&auditCompleted); err != nil {
		t.Fatal(err)
	}
	if auditStarted != 1 || auditCompleted != 1 {
		t.Fatalf("audit rows started=%d completed=%d (want 1/1)", auditStarted, auditCompleted)
	}
	var evStarted, evCompleted int
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM project_events WHERE project_id=$1 AND type='engineering_started' AND payload->>'release_id'=$2`, fx.projectID, p1.Release.ID).Scan(&evStarted); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(ctx, `SELECT COUNT(*) FROM project_events WHERE project_id=$1 AND type='engineering_completed' AND payload->>'release_id'=$2`, fx.projectID, p1.Release.ID).Scan(&evCompleted); err != nil {
		t.Fatal(err)
	}
	if evStarted != 1 || evCompleted != 1 {
		t.Fatalf("lifecycle events started=%d completed=%d (want 1/1)", evStarted, evCompleted)
	}
}

// P1 completed never leaks onto P2: a new release starts genuinely pending,
// and the project read model projects the AUTHORITY release's state only.
func TestReleaseEngineeringP2DoesNotInheritP1(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	h := engineeringTestHarness(t, fx)
	ctx := context.Background()

	// Complete P1.
	if rr := h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "start"), h.tokenA, "", "", "eng-p2-start-key-000001"); rr.Code != 200 {
		t.Fatalf("start P1=%d %s", rr.Code, rr.Body.String())
	}
	if rr := h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "complete"), h.tokenA, "", `"v1"`, "eng-p2-complete-key-0001"); rr.Code != 200 {
		t.Fatalf("complete P1=%d %s", rr.Code, rr.Body.String())
	}

	// Authority change: publish R4, approve it, release P2 (becomes the
	// authority).
	actorA := fiActorA()
	var revR4 string
	if err := releaseTx(t, fx.store, actorA, func(inner context.Context) error {
		rev, err := fx.store.PublishDesignRevision(inner, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceManual,
			ActorUserID:    rlsUserA,
		})
		if err != nil {
			return err
		}
		revR4 = rev.ID
		if _, err := fx.store.ApproveDesignRevision(inner, storage.ApproveDesignRevisionCommand{
			DesignID:         fx.designID,
			DesignRevisionID: rev.ID,
			ActorUserID:      rlsUserA,
		}); err != nil {
			return err
		}
		_, err = fx.store.CreateProductionRelease(inner, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: revR4,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-eng-p2",
		})
		return err
	}); err != nil {
		t.Fatalf("create P2: %v", err)
	}
	var p2ID string
	if err := fx.admin.QueryRow(ctx, `SELECT id::text FROM production_releases WHERE project_id=$1 ORDER BY release_number DESC LIMIT 1`, fx.projectID).Scan(&p2ID); err != nil {
		t.Fatal(err)
	}
	if p2ID == p1.Release.ID {
		t.Fatal("P2 must be a distinct release row")
	}

	// P2 is pending: no start timestamp, no completion, no actor inheritance.
	rr := h.call(http.MethodGet, engineeringPath(fx, p2ID, ""), h.tokenA, "", "", "")
	if status, version, completedBy := decodeEngineeringState(t, rr); status != "pending" || version != 0 || completedBy != nil {
		t.Fatalf("P2 must be pending, got %s v%d %v", status, version, completedBy)
	}
	// P1 keeps its own completed fact — nothing was reset or migrated.
	rr = h.call(http.MethodGet, engineeringPath(fx, p1.Release.ID, ""), h.tokenA, "", "", "")
	if status, _, completedBy := decodeEngineeringState(t, rr); status != "completed" || completedBy == nil || *completedBy != rlsUserA {
		t.Fatalf("P1 must keep its completion, got %s %v", status, completedBy)
	}

	// The read model projects the AUTHORITY's engineering state (P2=pending),
	// never P1's completion — exact-release binding end to end.
	var proj *domain.Project
	if err := fiTx(t, fx.store, actorA, func(inner context.Context) error {
		p, err := fx.store.GetProjectByID(inner, fx.projectID)
		proj = p
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if proj.ResolvedProductionRelease == nil || proj.ResolvedProductionRelease.ReleaseID != p2ID {
		t.Fatalf("authority must be P2, got %+v", proj.ResolvedProductionRelease)
	}
	if proj.ReleaseEngineering != nil {
		t.Fatalf("authority P2 is pending: read model must not project P1 completion, got %+v", proj.ReleaseEngineering)
	}
}

// Isolation and exactness: foreign/missing releases and cross-org callers
// fail closed; the evidence is owner-organization internal.
func TestReleaseEngineeringIsolationAndExactness(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	h := engineeringTestHarness(t, fx)

	// Org B (manufacturing partner, shared reader) never reads or authors
	// org A's engineering evidence: no false "pending", no writes.
	rr := h.call(http.MethodGet, engineeringPath(fx, p1.Release.ID, ""), h.tokenB, "", "", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("cross-org GET must fail closed, got %d %s", rr.Code, rr.Body.String())
	}
	rr = h.call(http.MethodPost, engineeringPath(fx, p1.Release.ID, "start"), h.tokenB, "", "", "eng-iso-start-key-000001")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("cross-org start must fail closed, got %d %s", rr.Code, rr.Body.String())
	}

	// Storage-level cross-org proof under the app role (tenant tx of org B).
	if err := fiTx(t, fx.store, fiActorB(), func(inner context.Context) error {
		if _, err := fx.store.GetReleaseEngineeringState(inner, fx.projectID, p1.Release.ID); err != domain.ErrCrossProjectRelease {
			t.Fatalf("org B read must fail closed with ErrCrossProjectRelease, got %v", err)
		}
		if _, err := fx.store.StartReleaseEngineering(inner, storage.StartReleaseEngineeringCommand{
			ProjectID: fx.projectID, ReleaseID: p1.Release.ID, ActorUserID: rlsUserB,
		}); err != domain.ErrCrossProjectRelease {
			t.Fatalf("org B start must fail closed, got %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	// Missing release / foreign release / missing project: same not-found.
	rr = h.call(http.MethodGet, engineeringPath(fx, "0d2f7d3e-1111-4222-8333-444455556666", ""), h.tokenA, "", "", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("missing release must 404, got %d", rr.Code)
	}
	rr = h.call(http.MethodPost, engineeringPath(fx, "0d2f7d3e-1111-4222-8333-444455556666", "start"), h.tokenA, "", "", "eng-iso-start-key-000002")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("start on missing release must 404, got %d", rr.Code)
	}

	// The start rejection wrote nothing (fail closed without mutations).
	var rows int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM production_release_engineering WHERE release_id=$1`, p1.Release.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("rejected calls must not write evidence rows, got %d", rows)
	}
}
