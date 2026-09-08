package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #499 / DT-SU-1: pairing grant integration tests against real PostgreSQL
// under the app role (no BYPASSRLS): exact org/project/design/base-revision
// pinning, one-time exchange with atomic replay rejection, TTL expiry,
// cancellation, cross-org uniformity and an audit trail that never carries
// the code or its hash.

const (
	pairingTestCode = "ABCDEFGHJKLM"
	pairingTestTTL  = 10 * time.Minute
)

// seedPairingSession inserts a real registry session (web for the creating
// user, sketchup for the exchanging device) and returns its id — both grant
// session FKs attribute to auth_sessions rows, exactly like the sids the
// #460 tokens carry.
func seedPairingSession(t *testing.T, fx *rlsFixture, userID, clientType string) string {
	t.Helper()
	var sessionID string
	err := fx.admin.QueryRow(context.Background(), `
		INSERT INTO auth_sessions (user_id, client_type, absolute_expires_at)
		VALUES ($1, $2, NOW() + interval '30 days')
		RETURNING id::text`, userID, clientType).Scan(&sessionID)
	if err != nil {
		t.Fatalf("seed %s session: %v", clientType, err)
	}
	return sessionID
}

func pairingTestActorSession(t *testing.T, fx *rlsFixture, actor storage.TenantActor) string {
	t.Helper()
	return seedPairingSession(t, fx, actor.UserID, "sketchup")
}

func pairingTestWebSession(t *testing.T, fx *rlsFixture, actor storage.TenantActor) string {
	t.Helper()
	return seedPairingSession(t, fx, actor.UserID, "web")
}

// seedPairingDesign creates one design (owned by actor's org) on the given
// project and returns its id.
func seedPairingDesignOn(t *testing.T, fx *rlsFixture, actor storage.TenantActor, projectID, name string) string {
	t.Helper()
	var designID string
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   projectID,
			Name:        name,
			ActorUserID: actor.UserID,
		})
		if err != nil {
			return err
		}
		designID = design.ID
		return nil
	})
	if err != nil {
		t.Fatalf("seed design %s: %v", name, err)
	}
	return designID
}

func seedPairingDesign(t *testing.T, fx *rlsFixture, actor storage.TenantActor, name string) string {
	t.Helper()
	return seedPairingDesignOn(t, fx, actor, fiSharedProject, name)
}

// seedPairingRevision inserts one published revision directly (admin pool):
// revisions are immutable and their normal producer is the #392 publish
// flow, which this slice does not need end-to-end.
func seedPairingRevision(t *testing.T, fx *rlsFixture, orgID, projectID, designID, revisionID string, number int) {
	t.Helper()
	_, err := fx.admin.Exec(context.Background(), `
		INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status, created_by)
		VALUES ($1, $2, $3, $4, $5, 'sketchup', 'published', NULL)`,
		revisionID, orgID, projectID, designID, number)
	if err != nil {
		t.Fatalf("seed revision %d: %v", number, err)
	}
}

// seedPairingWorkingCopy pins the design's working copy to the given base
// revision (admin pool): the working copy is mutable draft state whose normal
// writers are the #392 sync flow. CreateDesign already seeds the row, so
// this is an upsert on design_id (the table's primary key).
func seedPairingWorkingCopy(t *testing.T, fx *rlsFixture, orgID, projectID, designID string, baseRevisionID *string) {
	t.Helper()
	_, err := fx.admin.Exec(context.Background(), `
		INSERT INTO design_working_copies (organization_id, project_id, design_id, base_revision_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (design_id) DO UPDATE SET base_revision_id = EXCLUDED.base_revision_id`,
		orgID, projectID, designID, baseRevisionID)
	if err != nil {
		t.Fatalf("seed working copy: %v", err)
	}
}

func createPairingGrant(t *testing.T, fx *rlsFixture, actor storage.TenantActor, projectID, designID, baseRevisionID string) *domain.DesignPairingGrant {
	t.Helper()
	webSession := pairingTestWebSession(t, fx, actor)
	var grant *domain.DesignPairingGrant
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var err error
		grant, err = fx.store.CreateDesignPairingGrant(ctx, storage.CreateDesignPairingGrantCommand{
			ProjectID:      projectID,
			DesignID:       designID,
			BaseRevisionID: baseRevisionID,
			Action:         domain.PairingActionOpenDesign,
			Code:           pairingTestCode,
			TTL:            pairingTestTTL,
			ActorUserID:    actor.UserID,
			SessionID:      webSession,
			IP:             "127.0.0.1",
			RequestID:      "test-create",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create pairing grant: %v", err)
	}
	return grant
}

func TestDesignPairingGrants_RLSInventoryAndGrants(t *testing.T) {
	fx := newRLSFixture(t)
	_ = fx
	ctx := context.Background()

	var classification, readScope, writeScope string
	if err := fx.admin.QueryRow(ctx,
		`SELECT classification, read_scope, write_scope FROM rls_policy_inventory WHERE table_name='design_pairing_grants'`,
	).Scan(&classification, &readScope, &writeScope); err != nil {
		t.Fatalf("inventory row: %v", err)
	}
	if classification != "tenant-owned" {
		t.Fatalf("classification = %q, want tenant-owned", classification)
	}

	var rls, forced bool
	if err := fx.admin.QueryRow(ctx,
		`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='design_pairing_grants'`,
	).Scan(&rls, &forced); err != nil {
		t.Fatal(err)
	}
	if !rls || !forced {
		t.Fatalf("RLS enabled=%v forced=%v, want both true", rls, forced)
	}

	privileges := map[string]bool{}
	rows, err := fx.admin.Query(ctx, `
		SELECT privilege_type FROM information_schema.table_privileges
		WHERE table_name='design_pairing_grants' AND grantee='granete_app'`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var privilege string
		if err := rows.Scan(&privilege); err != nil {
			t.Fatal(err)
		}
		privileges[privilege] = true
	}
	rows.Close()
	if !privileges["SELECT"] || !privileges["INSERT"] || !privileges["UPDATE"] {
		t.Fatalf("granete_app privileges = %v, want SELECT+INSERT+UPDATE", privileges)
	}
	if privileges["DELETE"] {
		t.Fatal("granete_app must not hold DELETE on design_pairing_grants")
	}
}

func TestDesignPairingGrants_LifecycleExchangeOnceThenReplayRejected(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing lifecycle")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")
	sessionA := pairingTestActorSession(t, fx, actorA)

	if grant.Status != domain.PairingGrantStatusPending {
		t.Fatalf("created status = %q, want pending", grant.Status)
	}
	if grant.CodeHash == nil || len(grant.CodeHash) != 32 {
		t.Fatalf("code hash must be stored as 32 sha256 bytes, got %v", grant.CodeHash)
	}
	if strings.Contains(string(grant.CodeHash), pairingTestCode) {
		t.Fatal("raw code must never be stored")
	}

	// First exchange consumes the grant and attributes the device session.
	var result *storage.ExchangeDesignPairingGrantResult
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		result, err = fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: sessionA,
			IP:                   "127.0.0.1",
			RequestID:            "test-exchange-1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("first exchange: %v", err)
	}
	exchanged := result.Grant
	if exchanged.Status != domain.PairingGrantStatusExchanged || exchanged.ExchangedAt == nil {
		t.Fatalf("exchange state = %q exchanged_at=%v, want consumed", exchanged.Status, exchanged.ExchangedAt)
	}
	if exchanged.ExchangedBySessionID == nil || *exchanged.ExchangedBySessionID != sessionA {
		t.Fatalf("exchanged_by_session_id = %v, want the device session", exchanged.ExchangedBySessionID)
	}
	if result.BindingContext == nil || result.BindingContext.Design.ID != designID {
		t.Fatalf("binding context = %+v, want the exact design truth", result.BindingContext)
	}

	// Replay loses atomically: same code, second transaction → conflict.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: sessionA,
			IP:                   "127.0.0.1",
			RequestID:            "test-exchange-2",
		})
		return err
	})
	if !errors.Is(err, storage.ErrPairingGrantConflict) {
		t.Fatalf("replay error = %v, want ErrPairingGrantConflict", err)
	}
}

func TestDesignPairingGrants_ExpiredGrantNotExchangeable(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing expired")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")

	// Backdate the expiry while keeping created_at older (the TTL CHECK
	// only forbids expiry before creation).
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE design_pairing_grants
		 SET created_at = NOW() - interval '11 minutes', expires_at = NOW() - interval '1 minute'
		 WHERE id = $1`, grant.ID); err != nil {
		t.Fatal(err)
	}

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: pairingTestActorSession(t, fx, actorA),
			IP:                   "127.0.0.1",
		})
		return err
	})
	if !errors.Is(err, storage.ErrPairingGrantConflict) {
		t.Fatalf("expired exchange error = %v, want ErrPairingGrantConflict", err)
	}

	// Status derivation mirrors the enrollment poll: expired is derived, so
	// a pending-but-past grant reads back as expired without any write.
	var derived string
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		read, err := fx.store.GetDesignPairingGrant(ctx, fiSharedProject, designID, grant.ID)
		if err != nil {
			return err
		}
		derived = domain.DerivedPairingStatus(*read, time.Now())
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if derived != domain.PairingGrantStatusExpired {
		t.Fatalf("derived status = %q, want expired", derived)
	}
}

func TestDesignPairingGrants_CrossOrgCodeIsUniformNotFound(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()
	designID := seedPairingDesign(t, fx, actorA, "Pairing cross-org")
	createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")

	// Org B knows the code but is a different tenant: RLS hides the row, so
	// the answer is indistinguishable from an unknown code.
	err := fiTx(t, fx.store, actorB, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorB.UserID,
			ExchangedBySessionID: pairingTestActorSession(t, fx, actorB),
			IP:                   "127.0.0.1",
		})
		return err
	})
	if !errors.Is(err, storage.ErrPairingGrantNotFound) {
		t.Fatalf("cross-org exchange error = %v, want ErrPairingGrantNotFound", err)
	}

	// The grant is untouched: the org A user can still exchange it.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: pairingTestActorSession(t, fx, actorA),
			IP:                   "127.0.0.1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("legitimate exchange after foreign probe: %v", err)
	}
}

func TestDesignPairingGrants_ExactPairAndRevisionPins(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	actorB := fiActorB()
	// Org B's own project (not part of the base fixture): the wrong-pair
	// negative needs a design that lives OUTSIDE the shared project.
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('`+fiProjectB+`', 'Org B own project', '30000000-0000-0000-0000-00000000000b', 'draft',
			'`+rlsOrgB+`', '`+rlsOrgB+`', '`+rlsOrgB+`')
		ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	designA := seedPairingDesign(t, fx, actorA, "Pairing pin A")
	designB := seedPairingDesignOn(t, fx, actorB, fiProjectB, "Pairing pin B")
	revB := "8f000000-0000-0000-0000-00000000000b"
	seedPairingRevision(t, fx, rlsOrgB, fiProjectB, designB, revB, 1)

	// Wrong design for the project: org B's design does not belong to the
	// org A owned shared project.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateDesignPairingGrant(ctx, storage.CreateDesignPairingGrantCommand{
			ProjectID:   fiSharedProject,
			DesignID:    designB,
			Action:      domain.PairingActionOpenDesign,
			Code:        pairingTestCode,
			TTL:         pairingTestTTL,
			ActorUserID: actorA.UserID,
			SessionID:   pairingTestWebSession(t, fx, actorA),
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("wrong-pair error = %v, want ErrDesignNotFound", err)
	}

	// Foreign revision pin: design A cannot pin design B's revision.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateDesignPairingGrant(ctx, storage.CreateDesignPairingGrantCommand{
			ProjectID:      fiSharedProject,
			DesignID:       designA,
			BaseRevisionID: revB,
			Action:         domain.PairingActionOpenDesign,
			Code:           pairingTestCode,
			TTL:            pairingTestTTL,
			ActorUserID:    actorA.UserID,
			SessionID:      pairingTestWebSession(t, fx, actorA),
		})
		return err
	})
	if !errors.Is(err, domain.ErrDesignRevisionNotFound) {
		t.Fatalf("foreign pin error = %v, want ErrDesignRevisionNotFound", err)
	}

	// Structural backstop: even direct SQL cannot pin a foreign revision —
	// the composite FK ties base_revision_id to THIS design's lineage.
	_, err = fx.admin.Exec(context.Background(), `
		INSERT INTO design_pairing_grants
			(organization_id, project_id, design_id, base_revision_id, action, code_hash, expires_at, created_by)
		VALUES ($1, $2, $3, $4, 'open_design', sha256('x'::bytea), NOW() + interval '1 hour', $5)`,
		rlsOrgA, fiSharedProject, designA, revB, rlsUserA)
	if err == nil {
		t.Fatal("direct SQL foreign pin must violate the composite FK")
	}

	// A pinned revision of the SAME design is accepted and read back.
	revA := "8f000000-0000-0000-0000-00000000000a"
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designA, revA, 1)
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designA, revA)
	if grant.BaseRevisionID == nil || *grant.BaseRevisionID != revA {
		t.Fatalf("pinned base = %v, want %s", grant.BaseRevisionID, revA)
	}
}

func TestDesignPairingGrants_CancelThenExchangeAndNonCreatorDenial(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing cancel")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")

	// Non-creator cannot cancel: the created_by gate answers uniformly, so
	// another actor learns nothing about the grant's existence.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CancelDesignPairingGrant(ctx, storage.CancelDesignPairingGrantCommand{
			ProjectID:   fiSharedProject,
			DesignID:    designID,
			GrantID:     grant.ID,
			ActorUserID: rlsUserB, // not the creator
			IP:          "127.0.0.1",
		})
		return err
	})
	if !errors.Is(err, storage.ErrPairingGrantNotFound) {
		t.Fatalf("non-creator cancel error = %v, want ErrPairingGrantNotFound", err)
	}

	// The creator cancels: pending → cancelled exactly once.
	var cancelled *domain.DesignPairingGrant
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		cancelled, err = fx.store.CancelDesignPairingGrant(ctx, storage.CancelDesignPairingGrantCommand{
			ProjectID:   fiSharedProject,
			DesignID:    designID,
			GrantID:     grant.ID,
			ActorUserID: actorA.UserID,
			IP:          "127.0.0.1",
		})
		return err
	})
	if err != nil || cancelled.Status != domain.PairingGrantStatusCancelled {
		t.Fatalf("creator cancel = %v status %q, want cancelled", err, cancelledStatus(cancelled))
	}

	// Double cancel is a conflict, and a cancelled grant cannot be exchanged.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CancelDesignPairingGrant(ctx, storage.CancelDesignPairingGrantCommand{
			ProjectID:   fiSharedProject,
			DesignID:    designID,
			GrantID:     grant.ID,
			ActorUserID: actorA.UserID,
		})
		return err
	})
	if !errors.Is(err, storage.ErrPairingGrantConflict) {
		t.Fatalf("double cancel = %v, want conflict", err)
	}
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: pairingTestActorSession(t, fx, actorA),
		})
		return err
	})
	if !errors.Is(err, storage.ErrPairingGrantConflict) {
		t.Fatalf("exchange after cancel = %v, want conflict", err)
	}
}

func cancelledStatus(g *domain.DesignPairingGrant) string {
	if g == nil {
		return "<nil>"
	}
	return g.Status
}

func TestDesignPairingGrants_AuditTrailNeverCarriesCode(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing audit")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: pairingTestActorSession(t, fx, actorA),
			IP:                   "127.0.0.1",
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	rows, err := fx.admin.Query(context.Background(), `
		SELECT event_type, details::text FROM security_audit_events
		WHERE details::text LIKE '%`+grant.ID+`%' ORDER BY created_at`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	kinds := map[string]bool{}
	for rows.Next() {
		var eventType, details string
		if err := rows.Scan(&eventType, &details); err != nil {
			t.Fatal(err)
		}
		kinds[eventType] = true
		if strings.Contains(details, pairingTestCode) {
			t.Fatalf("%s details carry the raw code: %s", eventType, details)
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(details), &parsed); err != nil {
			t.Fatalf("details are not JSON: %v", err)
		}
	}
	if !kinds["design_pairing_grant_created"] || !kinds["design_pairing_grant_exchanged"] {
		t.Fatalf("audit kinds = %v, want created+exchanged", kinds)
	}
}

// Revision-drift proof: a grant pinned to R1 keeps validating exactly R1
// after the design publishes R2 and the working copy re-bases onto it. The
// exchange succeeds with the frozen pin intact (never silently R2); the
// authoritative working-copy truth travels separately in the same payload
// so the plugin can derive its own stale_base state (#388 semantics).
func TestDesignPairingGrants_ExactPinnedBaseRevisionSurvivesLaterRevision(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing revision drift")
	revR1 := "8f000000-0000-0000-0000-0000000000a1"
	revR2 := "8f000000-0000-0000-0000-0000000000a2"
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designID, revR1, 1)
	seedPairingWorkingCopy(t, fx, rlsOrgA, fiSharedProject, designID, &revR1)

	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, revR1)
	if grant.BaseRevisionID == nil || *grant.BaseRevisionID != revR1 {
		t.Fatalf("pinned base = %v, want R1", grant.BaseRevisionID)
	}

	// The design advances: R2 is published and becomes the working base.
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designID, revR2, 2)
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE design_working_copies SET base_revision_id = $1 WHERE design_id = $2`, revR2, designID); err != nil {
		t.Fatal(err)
	}

	var result *storage.ExchangeDesignPairingGrantResult
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		result, err = fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: pairingTestActorSession(t, fx, actorA),
			IP:                   "127.0.0.1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("exchange with drifted working base: %v", err)
	}

	// The frozen pin is exactly R1 — never implicitly rebased to R2.
	if result.Grant.BaseRevisionID == nil || *result.Grant.BaseRevisionID != revR1 {
		t.Fatalf("exchanged pin = %v, want exactly R1", result.Grant.BaseRevisionID)
	}
	// The authoritative working-copy truth (R2) still travels so the client
	// derives stale_base; it never replaces the pin.
	if result.BindingContext == nil || result.BindingContext.WorkingCopyBaseRevisionID == nil ||
		*result.BindingContext.WorkingCopyBaseRevisionID != revR2 {
		t.Fatalf("binding context working base = %v, want the authoritative R2 truth",
			result.BindingContext.WorkingCopyBaseRevisionID)
	}
}

// Failed-validation-not-consumed proof: the #388 binding validation runs
// BEFORE the conditional consume inside one transaction, so any failure in
// the coherent exchange leaves the grant pending and retryable. The failure
// is injected by failing the surrounding transaction AFTER a successful
// exchange — the exact atomicity that keeps the grant unconsumed when the
// validation itself fails earlier in the same transaction (data-level
// validation failures are structurally prevented by the composite FKs).
func TestDesignPairingGrants_FailedExchangeRollsBackGrantStaysPending(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing rollback")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")
	sessionA := pairingTestActorSession(t, fx, actorA)

	exchangeCmd := func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: sessionA,
			IP:                   "127.0.0.1",
		})
		return err
	}

	// The exchange itself succeeds, but the surrounding operation fails
	// afterwards: nothing may persist.
	deliberate := errors.New("caller operation failed after exchange")
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if err := exchangeCmd(ctx); err != nil {
			return err
		}
		return deliberate
	})
	if !errors.Is(err, deliberate) {
		t.Fatalf("tx error = %v, want the caller failure", err)
	}

	// The grant survived pending — no consume, no exchange audit.
	var status string
	var exchangedAt *string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT status, exchanged_at::text FROM design_pairing_grants WHERE id = $1`, grant.ID).
		Scan(&status, &exchangedAt); err != nil {
		t.Fatal(err)
	}
	if status != domain.PairingGrantStatusPending || exchangedAt != nil {
		t.Fatalf("grant after rolled-back exchange = %q/%v, want pending/nil", status, exchangedAt)
	}
	var auditCount int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM security_audit_events
		 WHERE event_type = 'design_pairing_grant_exchanged' AND details->>'grant_id' = $1`,
		grant.ID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 0 {
		t.Fatalf("exchange audit rows after rollback = %d, want 0", auditCount)
	}

	// Retry after the cause is gone: the same code now exchanges exactly once.
	err = fiTx(t, fx.store, actorA, exchangeCmd)
	if err != nil {
		t.Fatalf("retry exchange after rollback: %v", err)
	}
}

// Concurrency proof: two exchanges of the same code race in real
// PostgreSQL. The row lock serializes them — exactly one commits the
// pending→exchanged transition, the loser reads the winner's commit and
// answers ErrPairingGrantConflict. One session attributed, one audit row.
func TestDesignPairingGrants_ConcurrentExchangeExactlyOneWinner(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing concurrency")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "")
	session1 := seedPairingSession(t, fx, actorA.UserID, "sketchup")
	session2 := seedPairingSession(t, fx, actorA.UserID, "sketchup")

	type outcome struct {
		err error
	}
	outcomes := make(chan outcome, 2)
	start := make(chan struct{})

	runExchange := func(sessionID string) {
		err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
				Code:                 pairingTestCode,
				ExchangedByUserID:    actorA.UserID,
				ExchangedBySessionID: sessionID,
				IP:                   "127.0.0.1",
			})
			return err
		})
		outcomes <- outcome{err: err}
	}
	go runExchange(session1)
	go runExchange(session2)
	close(start)

	var successes, conflicts int
	for i := 0; i < 2; i++ {
		out := <-outcomes
		switch {
		case out.err == nil:
			successes++
		case errors.Is(out.err, storage.ErrPairingGrantConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent exchange error: %v", out.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent outcomes = %d success / %d conflict, want 1/1", successes, conflicts)
	}

	// Exactly the winner's session is attributed, exactly one audit row.
	var status, attributed string
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT status, exchanged_by_session_id::text FROM design_pairing_grants WHERE id = $1`,
		grant.ID).Scan(&status, &attributed); err != nil {
		t.Fatal(err)
	}
	if status != domain.PairingGrantStatusExchanged {
		t.Fatalf("status after race = %q, want exchanged", status)
	}
	if attributed != session1 && attributed != session2 {
		t.Fatalf("attributed session = %q, want one of the two racers", attributed)
	}
	var auditCount int
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM security_audit_events
		WHERE event_type = 'design_pairing_grant_exchanged' AND details->>'grant_id' = $1`,
		grant.ID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("exchange audit rows after race = %d, want exactly 1", auditCount)
	}
}

// Full provenance correlation: one grant row demonstrates organization +
// initiating user + initiating web session + project + design + pinned base
// revision + exchanging device session — no tokens, no secrets.
func TestDesignPairingGrants_ProvenanceCorrelation(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing provenance")
	revR1 := "8f000000-0000-0000-0000-0000000000b1"
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designID, revR1, 1)

	webSession := pairingTestWebSession(t, fx, actorA)
	var grant *domain.DesignPairingGrant
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		grant, err = fx.store.CreateDesignPairingGrant(ctx, storage.CreateDesignPairingGrantCommand{
			ProjectID:      fiSharedProject,
			DesignID:       designID,
			BaseRevisionID: revR1,
			Action:         domain.PairingActionOpenDesign,
			Code:           pairingTestCode,
			TTL:            pairingTestTTL,
			ActorUserID:    actorA.UserID,
			SessionID:      webSession,
			IP:             "127.0.0.1",
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	deviceSession := pairingTestActorSession(t, fx, actorA)
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actorA.UserID,
			ExchangedBySessionID: deviceSession,
			IP:                   "127.0.0.1",
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	var orgID, createdBy, createdBySession, projectID, designRowID, pinnedBase, exchangedBy string
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT organization_id::text, created_by::text, created_by_session_id::text,
		       project_id::text, design_id::text, COALESCE(base_revision_id::text, ''),
		       exchanged_by_session_id::text
		FROM design_pairing_grants WHERE id = $1`, grant.ID).
		Scan(&orgID, &createdBy, &createdBySession, &projectID, &designRowID, &pinnedBase, &exchangedBy); err != nil {
		t.Fatal(err)
	}
	if orgID != rlsOrgA || createdBy != actorA.UserID || createdBySession != webSession ||
		projectID != fiSharedProject || designRowID != designID || pinnedBase != revR1 ||
		exchangedBy != deviceSession {
		t.Fatalf("provenance mismatch: org=%s user=%s webSession=%s project=%s design=%s pin=%s deviceSession=%s",
			orgID, createdBy, createdBySession, projectID, designRowID, pinnedBase, exchangedBy)
	}
}

// exchangePairingGrant is a helper: consume a freshly created grant under
// the given device session and return the exchange result.
func exchangePairingGrant(t *testing.T, fx *rlsFixture, actor storage.TenantActor, sessionID string) *storage.ExchangeDesignPairingGrantResult {
	t.Helper()
	var result *storage.ExchangeDesignPairingGrantResult
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var err error
		result, err = fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
			Code:                 pairingTestCode,
			ExchangedByUserID:    actor.UserID,
			ExchangedBySessionID: sessionID,
			IP:                   "127.0.0.1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("exchange helper: %v", err)
	}
	return result
}

func confirmPairingGrant(t *testing.T, fx *rlsFixture, actor storage.TenantActor, cmd storage.ConfirmDesignPairingGrantCommand) (*domain.DesignPairingGrant, error) {
	t.Helper()
	var grant *domain.DesignPairingGrant
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var err error
		grant, err = fx.store.ConfirmDesignPairingGrant(ctx, cmd)
		return err
	})
	return grant, err
}

// #499 Slice 3: confirmation proves the exact pinned binding was persisted.
// The exchanging session confirms with the exact identity; wrong base,
// foreign session and replay semantics are all enforced atomically.
func TestDesignPairingGrants_ConfirmExactPinAndSessionSemantics(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing confirm")
	revR1 := "8f000000-0000-0000-0000-0000000000c1"
	revR2 := "8f000000-0000-0000-0000-0000000000c2"
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designID, revR1, 1)
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designID, revR2, 2)
	seedPairingWorkingCopy(t, fx, rlsOrgA, fiSharedProject, designID, &revR2) // working base drifted to R2

	// Grant pinned to R1; the working copy advances to R2 before exchange.
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, revR1)
	sessionA := pairingTestActorSession(t, fx, actorA)
	sessionB := pairingTestActorSession(t, fx, actorA) // another device session
	exchanged := exchangePairingGrant(t, fx, actorA, sessionA)
	if exchanged.Grant.Status != domain.PairingGrantStatusExchanged {
		t.Fatalf("exchange status = %q", exchanged.Grant.Status)
	}

	base := func(cmd storage.ConfirmDesignPairingGrantCommand, persisted string) storage.ConfirmDesignPairingGrantCommand {
		cmd.PersistedBaseRevID = persisted
		return cmd
	}
	mkcmd := func(session string) storage.ConfirmDesignPairingGrantCommand {
		return storage.ConfirmDesignPairingGrantCommand{
			GrantID:              grant.ID,
			PersistedProjectID:   fiSharedProject,
			PersistedDesignID:    designID,
			PersistedBaseRevID:   revR1,
			ConfirmedByUserID:    actorA.UserID,
			ConfirmedBySessionID: session,
		}
	}

	// 1. Confirming R2 against an R1-pinned grant is an identity mismatch.
	if _, err := confirmPairingGrant(t, fx, actorA, base(mkcmd(sessionA), revR2)); !errors.Is(err, storage.ErrPairingGrantMismatch) {
		t.Fatalf("confirm R2 against R1 pin = %v, want ErrPairingGrantMismatch", err)
	}

	// 2. A different device session can never confirm.
	if _, err := confirmPairingGrant(t, fx, actorA, mkcmd(sessionB)); !errors.Is(err, storage.ErrPairingGrantConflict) {
		t.Fatalf("foreign session confirm = %v, want ErrPairingGrantConflict", err)
	}

	// 3. The exchanging session confirms the EXACT pinned R1 — success even
	// though the working copy has drifted to R2 (stale_base is the client's
	// honest state, never a reason to reject confirmation).
	confirmed, err := confirmPairingGrant(t, fx, actorA, mkcmd(sessionA))
	if err != nil || confirmed.Status != domain.PairingGrantStatusConfirmed {
		t.Fatalf("exact confirm = %v status=%q, want confirmed", err, statusOf(confirmed))
	}

	// 4. Same-session replay is an idempotent success.
	if _, err := confirmPairingGrant(t, fx, actorA, mkcmd(sessionA)); err != nil {
		t.Fatalf("idempotent re-confirm = %v, want nil", err)
	}

	// 5. One confirmation audit row, never carrying the code.
	var auditCount int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM security_audit_events
		 WHERE event_type = 'design_pairing_grant_confirmed' AND details->>'grant_id' = $1`,
		grant.ID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("confirm audit rows = %d, want 1", auditCount)
	}
}

func statusOf(g *domain.DesignPairingGrant) string {
	if g == nil {
		return "<nil>"
	}
	return g.Status
}

// Unpinned grants confirm the design's authoritative working base (or
// nothing when no revision was ever published).
func TestDesignPairingGrants_ConfirmUnpinnedFollowsWorkingBase(t *testing.T) {
	fx := newRLSFixture(t)
	actorA := fiActorA()
	designID := seedPairingDesign(t, fx, actorA, "Pairing confirm unpinned")
	grant := createPairingGrant(t, fx, actorA, fiSharedProject, designID, "") // no pin
	sessionA := pairingTestActorSession(t, fx, actorA)
	exchangePairingGrant(t, fx, actorA, sessionA)

	// No revision ever published: the binding carries base=nil and the
	// confirm must accept exactly that.
	confirmed, err := confirmPairingGrant(t, fx, actorA, storage.ConfirmDesignPairingGrantCommand{
		GrantID:              grant.ID,
		PersistedProjectID:   fiSharedProject,
		PersistedDesignID:    designID,
		ConfirmedByUserID:    actorA.UserID,
		ConfirmedBySessionID: sessionA,
	})
	if err != nil || confirmed.Status != domain.PairingGrantStatusConfirmed {
		t.Fatalf("unpinned nil-base confirm = %v status=%q", err, statusOf(confirmed))
	}

	// Wrong project in the payload is an identity mismatch (typed conflict),
	// never a silent accept.
	fx2 := newRLSFixture(t)
	design2 := seedPairingDesign(t, fx2, actorA, "Pairing wrong project")
	grant2 := createPairingGrant(t, fx2, actorA, fiSharedProject, design2, "")
	session2 := pairingTestActorSession(t, fx2, actorA)
	exchangePairingGrant(t, fx2, actorA, session2)
	_, err = confirmPairingGrant(t, fx2, actorA, storage.ConfirmDesignPairingGrantCommand{
		GrantID:              grant2.ID,
		PersistedProjectID:   "41000000-0000-0000-0000-000000000099", // foreign project
		PersistedDesignID:    design2,
		ConfirmedByUserID:    actorA.UserID,
		ConfirmedBySessionID: session2,
	})
	if !errors.Is(err, storage.ErrPairingGrantMismatch) {
		t.Fatalf("wrong-project confirm = %v, want ErrPairingGrantMismatch", err)
	}
}
