package storage_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const idempotencyPlatformUser = "92000000-0000-0000-0000-000000000001"

func idempotencyStores(t *testing.T) (*storage.PostgresStore, *storage.PostgresStore) {
	t.Helper()
	migration, err := storage.NewPostgresStore(storage.TestMigrationDatabaseURLForRuntimeDatabase(t))
	if err != nil {
		t.Skipf("no migration db: %v", err)
	}
	t.Cleanup(migration.Close)
	if err := migration.RunMigrations(context.Background()); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	if _, err := migration.Pool.Exec(context.Background(), `
		INSERT INTO users (id, email, normalized_email, password_hash, name, account_status, platform_admin)
		VALUES ($1, 'idempotency-platform@example.test', 'idempotency-platform@example.test', 'x', 'Idempotency platform', 'active', TRUE)
		ON CONFLICT (id) DO UPDATE SET platform_admin=TRUE`, idempotencyPlatformUser); err != nil {
		t.Fatalf("seed platform actor: %v", err)
	}
	one, err := storage.NewPostgresStore(storage.TestDatabaseURL(t))
	if err != nil {
		t.Skipf("no runtime db: %v", err)
	}
	t.Cleanup(one.Close)
	two, err := storage.NewPostgresStore(storage.TestDatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(two.Close)
	return one, two
}

func executeIdempotentAsPlatform(t *testing.T, store *storage.PostgresStore, request storage.IdempotencyRequest, execute func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error) {
	t.Helper()
	request.ActorUserID = idempotencyPlatformUser
	actor := storage.TenantActor{UserID: idempotencyPlatformUser}
	var response storage.IdempotencyResponse
	var replayed bool
	err := store.WithinTenantTx(context.Background(), actor, func(txCtx context.Context) error {
		var err error
		response, replayed, err = store.ExecuteIdempotent(txCtx, request, execute)
		return err
	})
	return response, replayed, err
}

func TestPostgresIdempotencyRestartMultiReplicaCrashAndRetention(t *testing.T) {
	one, two := idempotencyStores(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	scope := "contract-448-" + suffix
	event := "idempotency_crash_" + suffix
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM api_idempotency_receipts WHERE scope_key LIKE $1`, scope+"%")
		cleanupConnectStoreFixture(t, `DELETE FROM security_audit_events WHERE event_type = $1`, event)
	})
	request := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "fingerprint-a"}
	calls := 0
	execute := func(context.Context) (storage.IdempotencyResponse, error) {
		calls++
		return storage.IdempotencyResponse{Status: http.StatusCreated, Header: http.Header{"Etag": {`"v1"`}}, Body: []byte(`{"created":true}`)}, nil
	}
	first, replayed, err := executeIdempotentAsPlatform(t, one, request, execute)
	if err != nil || replayed {
		t.Fatalf("first: replay=%v err=%v", replayed, err)
	}
	// A separate pool models another replica and process restart.
	second, replayed, err := executeIdempotentAsPlatform(t, two, request, execute)
	if err != nil || !replayed || calls != 1 || string(first.Body) != string(second.Body) || second.Header.Get("ETag") != `"v1"` {
		t.Fatalf("replay: replay=%v calls=%d err=%v first=%s second=%s", replayed, calls, err, first.Body, second.Body)
	}
	if _, _, err := executeIdempotentAsPlatform(t, two, storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "fingerprint-b"}, execute); !errors.Is(err, storage.ErrIdempotencyConflict) {
		t.Fatalf("mismatch err=%v", err)
	}
	var retained bool
	if err := runConnectStoreSQL(t, one.Pool, storage.TenantActor{UserID: idempotencyPlatformUser}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT expires_at >= created_at + interval '24 hours' FROM api_idempotency_receipts WHERE scope_key=$1`, scope).Scan(&retained)
	}); err != nil || !retained {
		t.Fatalf("retention not guaranteed: retained=%v err=%v", retained, err)
	}

	concurrentRequest := storage.IdempotencyRequest{ScopeKey: scope + "-concurrent", Fingerprint: "fingerprint-c"}
	started, release := make(chan struct{}), make(chan struct{})
	type result struct {
		response storage.IdempotencyResponse
		replayed bool
		err      error
	}
	results := make(chan result, 2)
	concurrentCalls := 0
	go func() {
		response, replayed, err := executeIdempotentAsPlatform(t, one, concurrentRequest, func(context.Context) (storage.IdempotencyResponse, error) {
			concurrentCalls++
			close(started)
			<-release
			return storage.IdempotencyResponse{Status: http.StatusCreated, Header: http.Header{}, Body: []byte(`{"once":true}`)}, nil
		})
		results <- result{response, replayed, err}
	}()
	<-started
	go func() {
		response, replayed, err := executeIdempotentAsPlatform(t, two, concurrentRequest, func(context.Context) (storage.IdempotencyResponse, error) {
			concurrentCalls++
			return storage.IdempotencyResponse{Status: http.StatusCreated}, nil
		})
		results <- result{response, replayed, err}
	}()
	close(release)
	a, b := <-results, <-results
	if a.err != nil || b.err != nil || concurrentCalls != 1 || a.replayed == b.replayed || string(a.response.Body) != string(b.response.Body) {
		t.Fatalf("multi-replica concurrency calls=%d a=%+v b=%+v", concurrentCalls, a, b)
	}

	crashRequest := storage.IdempotencyRequest{ScopeKey: scope + "-crash", Fingerprint: "fingerprint-crash"}
	_, _, err = executeIdempotentAsPlatform(t, one, crashRequest, func(txCtx context.Context) (storage.IdempotencyResponse, error) {
		if err := one.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{EventType: event, ActorUserID: idempotencyPlatformUser}); err != nil {
			return storage.IdempotencyResponse{}, err
		}
		return storage.IdempotencyResponse{Status: http.StatusCreated}, errors.New("injected crash before commit")
	})
	if err == nil {
		t.Fatal("crash injection unexpectedly committed")
	}
	var eventCount, receiptCount int
	if err := runConnectStoreSQL(t, one.Pool, storage.TenantActor{UserID: idempotencyPlatformUser}, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type=$1`, event).Scan(&eventCount); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(*) FROM api_idempotency_receipts WHERE scope_key=$1`, crashRequest.ScopeKey).Scan(&receiptCount)
	}); err != nil {
		t.Fatal(err)
	}
	if eventCount != 0 || receiptCount != 0 {
		t.Fatalf("crash window leaked business=%d receipt=%d", eventCount, receiptCount)
	}
}

func TestPostgresIdempotencyClientErrorRollsBackMutationAndReplaysAfterSQLError(t *testing.T) {
	one, two := idempotencyStores(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	scope := "contract-448-client-error-" + suffix
	event := "idempotency_client_error_" + suffix
	conflictSlug := "idempotency-conflict-" + suffix
	seed := &domain.Organization{Name: "Idempotency conflict seed", Slug: conflictSlug, Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusProvisioning}
	if err := one.WithinTenantTx(ctx, storage.TenantActor{UserID: idempotencyPlatformUser}, func(txCtx context.Context) error {
		return one.CreateOrganization(txCtx, seed)
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM api_idempotency_receipts WHERE scope_key = $1`, scope)
		cleanupConnectStoreFixture(t, `DELETE FROM security_audit_events WHERE event_type = $1`, event)
		cleanupConnectStoreFixture(t, `DELETE FROM organizations WHERE id = $1`, seed.ID)
	})

	request := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "fingerprint-409"}
	calls := 0
	execute := func(txCtx context.Context) (storage.IdempotencyResponse, error) {
		calls++
		if err := one.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{EventType: event, ActorUserID: idempotencyPlatformUser}); err != nil {
			return storage.IdempotencyResponse{}, err
		}
		// Model a handler that catches a constraint/query error and maps it to a
		// typed conflict response. PostgreSQL has aborted the transaction here.
		if err := one.CreateOrganization(txCtx, &domain.Organization{
			Name: "Duplicate slug", Slug: conflictSlug, Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusProvisioning,
		}); err == nil {
			return storage.IdempotencyResponse{}, errors.New("expected SQL error")
		}
		return storage.IdempotencyResponse{
			Status: http.StatusConflict,
			Header: http.Header{"Content-Type": {"application/json"}},
			Body:   []byte(`{"code":"CONFLICT"}`),
		}, nil
	}

	first, replayed, err := executeIdempotentAsPlatform(t, one, request, execute)
	if err != nil || replayed || first.Status != http.StatusConflict {
		t.Fatalf("first status=%d replay=%v err=%v", first.Status, replayed, err)
	}
	second, replayed, err := executeIdempotentAsPlatform(t, two, request, execute)
	if err != nil || !replayed || second.Status != http.StatusConflict || string(second.Body) != string(first.Body) || calls != 1 {
		t.Fatalf("replay status=%d replay=%v calls=%d err=%v", second.Status, replayed, calls, err)
	}
	var eventCount int
	if err := runConnectStoreSQL(t, one.Pool, storage.TenantActor{UserID: idempotencyPlatformUser}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type=$1`, event).Scan(&eventCount)
	}); err != nil {
		t.Fatal(err)
	}
	if eventCount != 0 {
		t.Fatalf("client error leaked %d business mutations", eventCount)
	}
}

func TestPostgresIdempotencyServerErrorRollsBackFactoryOrganizationProvisioning(t *testing.T) {
	one, _ := idempotencyStores(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	scope := "contract-448-factory-atomic-" + suffix
	slug := "factory-atomic-" + suffix
	failureEvent := "organization_provisioning_failed_" + suffix
	t.Cleanup(func() {
		cleanupConnectStoreFixture(t, `DELETE FROM api_idempotency_receipts WHERE scope_key = $1`, scope)
		cleanupConnectStoreFixture(t, `DELETE FROM security_audit_events WHERE event_type = $1`, failureEvent)
		cleanupConnectStoreFixture(t, `DELETE FROM organizations WHERE slug = $1`, slug)
	})

	calls := 0
	request := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "factory-atomic", AfterRollback: func(txCtx context.Context, _ storage.IdempotencyResponse) error {
		return one.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{EventType: failureEvent, ActorUserID: idempotencyPlatformUser, Details: map[string]interface{}{
			"target_hash": "sanitized-hash", "error_code": "INTERNAL_ERROR", "request_id": "request-atomic-500",
		}})
	}}
	execute := func(txCtx context.Context) (storage.IdempotencyResponse, error) {
		calls++
		organization := &domain.Organization{Name: "Atomic factory child", Slug: slug, Type: domain.OrganizationTypeStore, Status: domain.OrganizationStatusProvisioning}
		if err := one.CreateOrganization(txCtx, organization); err != nil {
			return storage.IdempotencyResponse{}, err
		}
		// The generated factory command grants membership after clone. A
		// missing actor models a provisioning failure after organization
		// creation and must roll the entire command back.
		if err := one.EnsureMembership(txCtx, organization.ID, "00000000-0000-0000-0000-000000000000", []domain.UserRole{domain.RoleAdmin}); err == nil {
			return storage.IdempotencyResponse{}, errors.New("expected membership FK failure")
		}
		return storage.IdempotencyResponse{Status: http.StatusInternalServerError, Header: http.Header{"Content-Type": {"application/json"}}, Body: []byte(`{"code":"INTERNAL_ERROR"}`)}, nil
	}
	for attempt := 1; attempt <= 2; attempt++ {
		response, replayed, err := executeIdempotentAsPlatform(t, one, request, execute)
		if err != nil || replayed || response.Status != http.StatusInternalServerError {
			t.Fatalf("attempt=%d status=%d replay=%v err=%v", attempt, response.Status, replayed, err)
		}
	}
	var organizations, receipts, failureEvents int
	var leakedPII bool
	if err := runConnectStoreSQL(t, one.Pool, storage.TenantActor{UserID: idempotencyPlatformUser}, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM organizations WHERE slug=$1`, slug).Scan(&organizations); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM api_idempotency_receipts WHERE scope_key=$1`, scope).Scan(&receipts); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(*), bool_or(details::text LIKE '%' || $2 || '%') FROM security_audit_events WHERE event_type=$1`, failureEvent, slug).Scan(&failureEvents, &leakedPII)
	}); err != nil {
		t.Fatal(err)
	}
	if organizations != 0 || receipts != 0 || calls != 2 || failureEvents != 2 || leakedPII {
		t.Fatalf("server failure atomicity organizations=%d receipts=%d calls=%d audits=%d leaked_pii=%v", organizations, receipts, calls, failureEvents, leakedPII)
	}
}

func TestPostgresSensitiveIdempotencyReceiptStoresOnlySealedBody(t *testing.T) {
	one, two := idempotencyStores(t)
	ctx := context.Background()
	scope := fmt.Sprintf("sensitive-receipt-%d", time.Now().UnixNano())
	plain := []byte(`{"invitation_token":"raw-token-must-not-persist"}`)
	seal := func(body []byte) ([]byte, error) {
		out := append([]byte("sealed:"), body...)
		for left, right := len("sealed:"), len(out)-1; left < right; left, right = left+1, right-1 {
			out[left], out[right] = out[right], out[left]
		}
		return out, nil
	}
	open := func(body []byte) ([]byte, error) {
		out := append([]byte(nil), body[len("sealed:"):]...)
		for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
			out[left], out[right] = out[right], out[left]
		}
		return out, nil
	}
	req := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "sensitive", SealBody: seal, OpenBody: open}
	first, replayed, err := executeIdempotentAsPlatform(t, one, req, func(context.Context) (storage.IdempotencyResponse, error) {
		return storage.IdempotencyResponse{Status: http.StatusCreated, Body: plain}, nil
	})
	if err != nil || replayed || string(first.Body) != string(plain) {
		t.Fatalf("first=%s replay=%v err=%v", first.Body, replayed, err)
	}
	var persisted []byte
	if err := runConnectStoreSQL(t, one.Pool, storage.TenantActor{UserID: idempotencyPlatformUser}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT body FROM api_idempotency_receipts WHERE scope_key=$1`, scope).Scan(&persisted)
	}); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(persisted, []byte("raw-token-must-not-persist")) {
		t.Fatal("raw token persisted in receipt")
	}
	second, replayed, err := executeIdempotentAsPlatform(t, two, req, func(context.Context) (storage.IdempotencyResponse, error) {
		t.Fatal("replay executed mutation")
		return storage.IdempotencyResponse{}, nil
	})
	if err != nil || !replayed || string(second.Body) != string(plain) {
		t.Fatalf("replay=%v body=%s err=%v", replayed, second.Body, err)
	}
	cleanupConnectStoreFixture(t, `DELETE FROM api_idempotency_receipts WHERE scope_key=$1`, scope)
}
