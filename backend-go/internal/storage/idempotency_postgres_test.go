package storage_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func idempotencyStores(t *testing.T) (*storage.PostgresStore, *storage.PostgresStore) {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable"
	}
	one, err := storage.NewPostgresStore(url)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	t.Cleanup(one.Close)
	if err := one.RunMigrations(context.Background()); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	two, err := storage.NewPostgresStore(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(two.Close)
	return one, two
}

func TestPostgresIdempotencyRestartMultiReplicaCrashAndRetention(t *testing.T) {
	one, two := idempotencyStores(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	scope := "contract-448-" + suffix
	event := "idempotency_crash_" + suffix
	t.Cleanup(func() {
		_, _ = one.Pool.Exec(ctx, `DELETE FROM api_idempotency_receipts WHERE scope_key LIKE $1`, scope+"%")
		_, _ = one.Pool.Exec(ctx, `DELETE FROM security_audit_events WHERE event_type = $1`, event)
	})
	request := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "fingerprint-a"}
	calls := 0
	execute := func(context.Context) (storage.IdempotencyResponse, error) {
		calls++
		return storage.IdempotencyResponse{Status: http.StatusCreated, Header: http.Header{"Etag": {`"v1"`}}, Body: []byte(`{"created":true}`)}, nil
	}
	first, replayed, err := one.ExecuteIdempotent(ctx, request, execute)
	if err != nil || replayed {
		t.Fatalf("first: replay=%v err=%v", replayed, err)
	}
	// A separate pool models another replica and process restart.
	second, replayed, err := two.ExecuteIdempotent(ctx, request, execute)
	if err != nil || !replayed || calls != 1 || string(first.Body) != string(second.Body) || second.Header.Get("ETag") != `"v1"` {
		t.Fatalf("replay: replay=%v calls=%d err=%v first=%s second=%s", replayed, calls, err, first.Body, second.Body)
	}
	if _, _, err := two.ExecuteIdempotent(ctx, storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "fingerprint-b"}, execute); !errors.Is(err, storage.ErrIdempotencyConflict) {
		t.Fatalf("mismatch err=%v", err)
	}
	var retained bool
	if err := one.Pool.QueryRow(ctx, `SELECT expires_at >= created_at + interval '24 hours' FROM api_idempotency_receipts WHERE scope_key=$1`, scope).Scan(&retained); err != nil || !retained {
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
		response, replayed, err := one.ExecuteIdempotent(ctx, concurrentRequest, func(context.Context) (storage.IdempotencyResponse, error) {
			concurrentCalls++
			close(started)
			<-release
			return storage.IdempotencyResponse{Status: http.StatusCreated, Header: http.Header{}, Body: []byte(`{"once":true}`)}, nil
		})
		results <- result{response, replayed, err}
	}()
	<-started
	go func() {
		response, replayed, err := two.ExecuteIdempotent(ctx, concurrentRequest, func(context.Context) (storage.IdempotencyResponse, error) {
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
	_, _, err = one.ExecuteIdempotent(ctx, crashRequest, func(txCtx context.Context) (storage.IdempotencyResponse, error) {
		if err := one.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{EventType: event}); err != nil {
			return storage.IdempotencyResponse{}, err
		}
		return storage.IdempotencyResponse{Status: http.StatusCreated}, errors.New("injected crash before commit")
	})
	if err == nil {
		t.Fatal("crash injection unexpectedly committed")
	}
	var eventCount, receiptCount int
	_ = one.Pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type=$1`, event).Scan(&eventCount)
	_ = one.Pool.QueryRow(ctx, `SELECT count(*) FROM api_idempotency_receipts WHERE scope_key=$1`, crashRequest.ScopeKey).Scan(&receiptCount)
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
	seed := &domain.Organization{Name: "Idempotency conflict seed", Slug: conflictSlug, Type: domain.OrganizationTypeFactory, Active: false}
	if err := one.CreateOrganization(ctx, seed); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = one.Pool.Exec(ctx, `DELETE FROM api_idempotency_receipts WHERE scope_key = $1`, scope)
		_, _ = one.Pool.Exec(ctx, `DELETE FROM security_audit_events WHERE event_type = $1`, event)
		_, _ = one.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, seed.ID)
	})

	request := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "fingerprint-409"}
	calls := 0
	execute := func(txCtx context.Context) (storage.IdempotencyResponse, error) {
		calls++
		if err := one.InsertSecurityAuditEvent(txCtx, storage.SecurityAuditEvent{EventType: event}); err != nil {
			return storage.IdempotencyResponse{}, err
		}
		// Model a handler that catches a constraint/query error and maps it to a
		// typed conflict response. PostgreSQL has aborted the transaction here.
		if err := one.CreateOrganization(txCtx, &domain.Organization{
			Name: "Duplicate slug", Slug: conflictSlug, Type: domain.OrganizationTypeFactory, Active: false,
		}); err == nil {
			return storage.IdempotencyResponse{}, errors.New("expected SQL error")
		}
		return storage.IdempotencyResponse{
			Status: http.StatusConflict,
			Header: http.Header{"Content-Type": {"application/json"}},
			Body:   []byte(`{"code":"CONFLICT"}`),
		}, nil
	}

	first, replayed, err := one.ExecuteIdempotent(ctx, request, execute)
	if err != nil || replayed || first.Status != http.StatusConflict {
		t.Fatalf("first status=%d replay=%v err=%v", first.Status, replayed, err)
	}
	second, replayed, err := two.ExecuteIdempotent(ctx, request, execute)
	if err != nil || !replayed || second.Status != http.StatusConflict || string(second.Body) != string(first.Body) || calls != 1 {
		t.Fatalf("replay status=%d replay=%v calls=%d err=%v", second.Status, replayed, calls, err)
	}
	var eventCount int
	if err := one.Pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type=$1`, event).Scan(&eventCount); err != nil {
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
	t.Cleanup(func() {
		_, _ = one.Pool.Exec(ctx, `DELETE FROM api_idempotency_receipts WHERE scope_key = $1`, scope)
		_, _ = one.Pool.Exec(ctx, `DELETE FROM organizations WHERE slug = $1`, slug)
	})

	_, _, err := one.ExecuteIdempotent(ctx,
		storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "factory-atomic"},
		func(txCtx context.Context) (storage.IdempotencyResponse, error) {
			organization := &domain.Organization{Name: "Atomic factory child", Slug: slug, Type: domain.OrganizationTypeStore, Active: true}
			if err := one.CreateOrganization(txCtx, organization); err != nil {
				return storage.IdempotencyResponse{}, err
			}
			// The generated factory command grants membership after clone. A
			// missing actor models a provisioning failure after organization
			// creation and must roll the entire command back.
			if err := one.EnsureMembership(txCtx, organization.ID, "00000000-0000-0000-0000-000000000000", []domain.UserRole{domain.RoleAdmin}); err == nil {
				return storage.IdempotencyResponse{}, errors.New("expected membership FK failure")
			}
			return storage.IdempotencyResponse{Status: http.StatusInternalServerError}, nil
		})
	if err == nil {
		t.Fatal("failed provisioning unexpectedly committed")
	}
	var organizations, receipts int
	_ = one.Pool.QueryRow(ctx, `SELECT count(*) FROM organizations WHERE slug=$1`, slug).Scan(&organizations)
	_ = one.Pool.QueryRow(ctx, `SELECT count(*) FROM api_idempotency_receipts WHERE scope_key=$1`, scope).Scan(&receipts)
	if organizations != 0 || receipts != 0 {
		t.Fatalf("partial provisioning leaked organizations=%d receipts=%d", organizations, receipts)
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
	first, replayed, err := one.ExecuteIdempotent(ctx, req, func(context.Context) (storage.IdempotencyResponse, error) {
		return storage.IdempotencyResponse{Status: http.StatusCreated, Body: plain}, nil
	})
	if err != nil || replayed || string(first.Body) != string(plain) {
		t.Fatalf("first=%s replay=%v err=%v", first.Body, replayed, err)
	}
	var persisted []byte
	if err := one.Pool.QueryRow(ctx, `SELECT body FROM api_idempotency_receipts WHERE scope_key=$1`, scope).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(persisted, []byte("raw-token-must-not-persist")) {
		t.Fatal("raw token persisted in receipt")
	}
	second, replayed, err := two.ExecuteIdempotent(ctx, req, func(context.Context) (storage.IdempotencyResponse, error) {
		t.Fatal("replay executed mutation")
		return storage.IdempotencyResponse{}, nil
	})
	if err != nil || !replayed || string(second.Body) != string(plain) {
		t.Fatalf("replay=%v body=%s err=%v", replayed, second.Body, err)
	}
	_, _ = one.Pool.Exec(ctx, `DELETE FROM api_idempotency_receipts WHERE scope_key=$1`, scope)
}
