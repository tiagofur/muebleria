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

// seedPairingSession inserts a real org-less sketchup registry session for
// the exchanging device's user and returns its id — the exchange FK
// attributes the consumption to an auth_sessions row, exactly like the
// #460 transport token's sid.
func seedPairingSession(t *testing.T, fx *rlsFixture, userID string) string {
	t.Helper()
	var sessionID string
	err := fx.admin.QueryRow(context.Background(), `
		INSERT INTO auth_sessions (user_id, client_type, absolute_expires_at)
		VALUES ($1, 'sketchup', NOW() + interval '30 days')
		RETURNING id::text`, userID).Scan(&sessionID)
	if err != nil {
		t.Fatalf("seed device session: %v", err)
	}
	return sessionID
}

func pairingTestActorSession(t *testing.T, fx *rlsFixture, actor storage.TenantActor) string {
	t.Helper()
	return seedPairingSession(t, fx, actor.UserID)
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
func seedPairingRevision(t *testing.T, fx *rlsFixture, orgID, projectID, designID, revisionID string) {
	t.Helper()
	_, err := fx.admin.Exec(context.Background(), `
		INSERT INTO design_revisions (id, organization_id, project_id, design_id, revision_number, source_type, status, created_by)
		VALUES ($1, $2, $3, $4, 1, 'sketchup', 'published', NULL)`,
		revisionID, orgID, projectID, designID)
	if err != nil {
		t.Fatalf("seed revision: %v", err)
	}
}

func createPairingGrant(t *testing.T, fx *rlsFixture, actor storage.TenantActor, projectID, designID, baseRevisionID string) *domain.DesignPairingGrant {
	t.Helper()
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
	var exchanged *domain.DesignPairingGrant
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		exchanged, err = fx.store.ExchangeDesignPairingGrant(ctx, storage.ExchangeDesignPairingGrantCommand{
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
	if exchanged.Status != domain.PairingGrantStatusExchanged || exchanged.ExchangedAt == nil {
		t.Fatalf("exchange state = %q exchanged_at=%v, want consumed", exchanged.Status, exchanged.ExchangedAt)
	}
	if exchanged.ExchangedBySessionID == nil || *exchanged.ExchangedBySessionID != sessionA {
		t.Fatalf("exchanged_by_session_id = %v, want the device session", exchanged.ExchangedBySessionID)
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
	seedPairingRevision(t, fx, rlsOrgB, fiProjectB, designB, revB)

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
	seedPairingRevision(t, fx, rlsOrgA, fiSharedProject, designA, revA)
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
