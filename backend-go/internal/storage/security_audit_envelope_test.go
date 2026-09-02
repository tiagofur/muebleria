package storage_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func securityAuditEnvelopeMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000110_security_audit_envelope." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertSecurityAuditEnvelope(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, column := range []string{"schema_version", "request_id"} {
		var count int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM information_schema.columns
			WHERE table_schema='public' AND table_name='security_audit_events' AND column_name=$1`, column).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("security_audit_events.%s missing", column)
		}
	}

	var policy string
	if err := pool.QueryRow(ctx, `
		SELECT pg_get_expr(polqual, polrelid)
		FROM pg_policy
		WHERE polrelid='security_audit_events'::regclass AND polname='security_audit_read'`).Scan(&policy); err != nil {
		t.Fatal(err)
	}
	if policy == "" {
		t.Fatal("security_audit_read policy is empty")
	}

	for name, statement := range map[string]string{
		"non-positive schema version": `INSERT INTO security_audit_events (event_type, schema_version) VALUES ('invalid_schema_version', 0)`,
		"malformed request id":        `INSERT INTO security_audit_events (event_type, request_id) VALUES ('invalid_request_id', 'bad id')`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := pool.Exec(ctx, statement); err == nil {
				t.Fatal("audit envelope constraint accepted invalid value")
			}
		})
	}
}

func TestSecurityAuditEnvelopeMigrationFreshUpgradeAndDown(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 110)
	assertSecurityAuditEnvelope(t, fresh)
	fresh.Close()

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 109)
	if _, err := upgrade.Exec(ctx, `INSERT INTO security_audit_events (event_type) VALUES ('pre_envelope_event')`); err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade.Exec(ctx, securityAuditEnvelopeMigrationSQL(t, "up")); err != nil {
		t.Fatalf("upgrade apply 000110: %v", err)
	}
	assertSecurityAuditEnvelope(t, upgrade)

	var version int
	var requestID *string
	if err := upgrade.QueryRow(ctx, `
		SELECT schema_version, request_id
		FROM security_audit_events WHERE event_type='pre_envelope_event'`).Scan(&version, &requestID); err != nil {
		t.Fatal(err)
	}
	if version != 1 || requestID != nil {
		t.Fatalf("legacy audit envelope = version %d request_id %v", version, requestID)
	}

	if _, err := upgrade.Exec(ctx, securityAuditEnvelopeMigrationSQL(t, "down")); err != nil {
		t.Fatalf("down 000110: %v", err)
	}
	var columns int
	if err := upgrade.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema='public' AND table_name='security_audit_events'
		  AND column_name IN ('schema_version', 'request_id')`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if columns != 0 {
		t.Fatalf("down migration left %d envelope columns", columns)
	}
}

func TestSecurityAuditEnvelopeOrglessRLSAndStrictPersistence(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO security_audit_events (event_type, actor_user_id) VALUES
		('orgless_a', $1), ('orgless_b', $2), ('orgless_anonymous', NULL)`, rlsUserA, rlsUserB); err != nil {
		t.Fatal(err)
	}

	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		rows, err := tx.Query(ctx, `
			SELECT event_type FROM security_audit_events
			WHERE organization_id IS NULL ORDER BY event_type`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var visible []string
		for rows.Next() {
			var eventType string
			if err := rows.Scan(&eventType); err != nil {
				t.Fatal(err)
			}
			visible = append(visible, eventType)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if len(visible) != 1 || visible[0] != "orgless_b" {
			t.Fatalf("unrelated org-less audit rows visible to ordinary actor: %v", visible)
		}
	})

	withRLSActor(t, fx.app, "", rlsUserA, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO security_audit_events (event_type,actor_user_id,organization_id)
			VALUES ('platform_org_event',$1,$2)`, rlsUserA, rlsOrgB); err != nil {
			t.Fatalf("org-less platform admin must write scoped evidence: %v", err)
		}
	})
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO security_audit_events (event_type,actor_user_id,organization_id)
			VALUES ('cross_org_event',$1,$2)`, rlsUserB, rlsOrgA); err == nil {
			t.Fatal("ordinary actor inserted audit evidence for another organization")
		}
	})

	const requestID = "request-audit-envelope-110"
	if err := fx.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgB, UserID: rlsUserB}, func(txCtx context.Context) error {
		return fx.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType:      "strict_envelope_persisted",
			ActorUserID:    rlsUserB,
			OrganizationID: rlsOrgB,
			Details:        map[string]interface{}{"request_id": requestID, "result": "success"},
		})
	}); err != nil {
		t.Fatal(err)
	}

	var version int
	var storedRequestID string
	if err := fx.admin.QueryRow(ctx, `
		SELECT schema_version, request_id FROM security_audit_events
		WHERE event_type='strict_envelope_persisted'`).Scan(&version, &storedRequestID); err != nil {
		t.Fatal(err)
	}
	if version != 1 || storedRequestID != requestID {
		t.Fatalf("stored envelope = version %d request_id %q", version, storedRequestID)
	}

	err := fx.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgB, UserID: rlsUserB}, func(txCtx context.Context) error {
		return fx.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType:      "unserializable_critical_audit",
			ActorUserID:    rlsUserB,
			OrganizationID: rlsOrgB,
			Details:        map[string]interface{}{"invalid": func() {}},
		})
	})
	if err == nil {
		t.Fatal("unserializable audit details must fail closed")
	}
	var persisted int
	if queryErr := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type='unserializable_critical_audit'`).Scan(&persisted); queryErr != nil {
		t.Fatal(queryErr)
	}
	if persisted != 0 {
		t.Fatalf("unserializable audit persisted %d rows", persisted)
	}

	err = fx.store.WithinTenantTx(ctx, storage.TenantActor{OrganizationID: rlsOrgB, UserID: rlsUserB}, func(txCtx context.Context) error {
		return fx.store.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{
			EventType:      "secret_bearing_critical_audit",
			ActorUserID:    rlsUserB,
			OrganizationID: rlsOrgB,
			Details:        map[string]interface{}{"nested": map[string]interface{}{"refresh_token": "must-not-persist"}},
		})
	})
	if err == nil {
		t.Fatal("secret-bearing audit details must fail closed")
	}
	if queryErr := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type='secret_bearing_critical_audit'`).Scan(&persisted); queryErr != nil {
		t.Fatal(queryErr)
	}
	if persisted != 0 {
		t.Fatalf("secret-bearing audit persisted %d rows", persisted)
	}
}
