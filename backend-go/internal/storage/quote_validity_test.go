package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1648 (part 2) — quote validity on real PostgreSQL under the runtime role:
//   - publishing freezes valid_until = CURRENT_DATE + workshop quote_validity_days,
//     in the same statement as the transition, and it is immutable afterwards
//     (trigger);
//   - a draft has no validity; the list read exposes it;
//   - accepting an expired quote without acknowledgement fails typed and
//     writes nothing; with acknowledgement it is accepted and the audit
//     records the acknowledgement;
//   - a revision published before #1648 (valid_until NULL) accepts as before.
func TestQuoteValidity_FrozenAtPublish_ExpiredAcceptNeedsAcknowledgement(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	ctx := context.Background()

	// Factory default: 10 days.
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		ws, err := fx.store.GetWorkshopSettings(ctx)
		if err != nil {
			return err
		}
		ws.QuoteValidityDays = 10
		ws.TimeZone = "America/Montevideo"
		saved, err := fx.store.UpsertWorkshopSettings(ctx, ws)
		if err != nil {
			return err
		}
		if saved.QuoteValidityDays != 10 || saved.TimeZone != "America/Montevideo" {
			t.Fatalf("saved settings = %d %q, want 10 America/Montevideo", saved.QuoteValidityDays, saved.TimeZone)
		}
		// An unknown zone never reaches the SQL: it falls back to the default.
		bad := ws
		bad.TimeZone = "Mars/Olympus"
		normalized, err := fx.store.UpsertWorkshopSettings(ctx, bad)
		if err != nil {
			return err
		}
		if normalized.TimeZone != domain.DefaultWorkshopTimeZone {
			t.Fatalf("invalid zone normalized to %q", normalized.TimeZone)
		}
		ws.TimeZone = "America/Montevideo"
		_, err = fx.store.UpsertWorkshopSettings(ctx, ws)
		return err
	}); err != nil {
		t.Fatalf("settings: %v", err)
	}

	revisionID := createInitialRevision(t, fx).Revision.ID
	for _, d := range listRevisions(t, fx) {
		if d.ID == revisionID && d.ValidUntil != nil {
			t.Fatalf("a draft must not carry validity, got %s", *d.ValidUntil)
		}
	}

	published := publishRevision(t, fx, revisionID)
	var want string
	// The factory's calendar day, never the UTC day of the database clock.
	if err := fx.admin.QueryRow(ctx, `SELECT to_char((NOW() AT TIME ZONE 'America/Montevideo')::date + 10, 'YYYY-MM-DD')`).Scan(&want); err != nil {
		t.Fatal(err)
	}
	if published.ValidUntil == nil || *published.ValidUntil != want {
		t.Fatalf("published valid_until = %v, want %s", published.ValidUntil, want)
	}
	found := false
	for _, d := range listRevisions(t, fx) {
		if d.ID == revisionID {
			found = true
			if d.ValidUntil == nil || *d.ValidUntil != want {
				t.Fatalf("list valid_until = %v, want %s", d.ValidUntil, want)
			}
		}
	}
	if !found {
		t.Fatalf("revision not listed")
	}
	var auditValid string
	if err := fx.admin.QueryRow(ctx, `
		SELECT details->>'valid_until' FROM security_audit_events
		WHERE event_type = 'quote_revision_published' AND details->>'quote_revision_id' = $1`, revisionID).Scan(&auditValid); err != nil {
		t.Fatalf("publish audit: %v", err)
	}
	if auditValid != want {
		t.Fatalf("publish audit valid_until = %q, want %q", auditValid, want)
	}

	// Immutable: even the table owner cannot move it after publication.
	if _, err := fx.admin.Exec(ctx, `UPDATE quote_revisions SET valid_until = valid_until + 30 WHERE id = $1`, revisionID); err == nil {
		t.Fatalf("valid_until must be immutable after publication")
	}

	// Simulate the passage of time: the immutability trigger forbids moving
	// valid_until, so this single fixture write runs with user triggers
	// disabled (admin connection, disposable test database only).
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE quote_revisions DISABLE TRIGGER USER`); err != nil {
		t.Fatalf("disable trigger: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `UPDATE quote_revisions SET valid_until = (NOW() AT TIME ZONE 'America/Montevideo')::date - 1 WHERE id = $1`, revisionID); err != nil {
		t.Fatalf("expire fixture: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `ALTER TABLE quote_revisions ENABLE TRIGGER USER`); err != nil {
		t.Fatalf("enable trigger: %v", err)
	}

	accept := func(ack bool) (*storage.AcceptQuoteRevisionResult, error) {
		var result *storage.AcceptQuoteRevisionResult
		err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			var txErr error
			result, txErr = fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
				ProjectID:          fx.projectID,
				QuoteRevisionID:    revisionID,
				ActorUserID:        rlsUserA,
				RequestID:          "quote-validity-test",
				AcknowledgeExpired: ack,
			})
			return txErr
		})
		return result, err
	}

	if _, err := accept(false); !errors.Is(err, domain.ErrQuoteRevisionExpired) {
		t.Fatalf("expired accept without acknowledgement must fail typed, got %v", err)
	}
	if status := revisionStatus(t, fx, revisionID); status != "published" {
		t.Fatalf("refused accept must write nothing, status = %s", status)
	}
	if n := countAuditEvents(t, fx, "quote_revision_accepted", revisionID); n != 0 {
		t.Fatalf("refused accept must not audit, got %d", n)
	}

	result, err := accept(true)
	if err != nil {
		t.Fatalf("acknowledged expired accept: %v", err)
	}
	if result.Revision.Status != "accepted" {
		t.Fatalf("status = %s, want accepted", result.Revision.Status)
	}
	var acceptedExpired, acknowledged string
	if err := fx.admin.QueryRow(ctx, `
		SELECT details->>'accepted_expired', details->>'expired_acknowledged' FROM security_audit_events
		WHERE event_type = 'quote_revision_accepted' AND details->>'quote_revision_id' = $1`, revisionID).Scan(&acceptedExpired, &acknowledged); err != nil {
		t.Fatalf("accept audit: %v", err)
	}
	if acceptedExpired != "true" || acknowledged != "true" {
		t.Fatalf("accept audit = accepted_expired %s, expired_acknowledged %s; want true/true", acceptedExpired, acknowledged)
	}
}

func TestQuoteValidity_LegacyPublishedWithoutValidityAcceptsAsBefore(t *testing.T) {
	fx := setupQuoteLifecycleFixture(t)
	ctx := context.Background()
	revisionID := createInitialRevision(t, fx).Revision.ID
	// A pre-#1648 publication: the transition without validity.
	if _, err := fx.admin.Exec(ctx, `
		UPDATE quote_revisions SET status = 'published', published_at = NOW() WHERE id = $1`, revisionID); err != nil {
		t.Fatalf("legacy publish: %v", err)
	}
	result := acceptRevision(t, fx, revisionID)
	if result.Revision.Status != "accepted" || result.Revision.ValidUntil != nil {
		t.Fatalf("legacy accept = %+v", result.Revision)
	}
}
