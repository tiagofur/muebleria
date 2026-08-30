package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type cliReceiptFake struct {
	mu       sync.Mutex
	receipts map[string]struct {
		fingerprint string
		response    storage.IdempotencyResponse
	}
	audits []storage.SecurityAuditEvent
}

func (f *cliReceiptFake) ExecuteIdempotent(ctx context.Context, request storage.IdempotencyRequest, execute func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if receipt, ok := f.receipts[request.ScopeKey]; ok {
		if receipt.fingerprint != request.Fingerprint {
			return storage.IdempotencyResponse{}, false, storage.ErrIdempotencyConflict
		}
		return receipt.response, true, nil
	}
	response, err := execute(ctx)
	if err != nil {
		return storage.IdempotencyResponse{}, false, err
	}
	if response.Status >= 400 && request.AfterRollback != nil {
		if err := request.AfterRollback(ctx, response); err != nil {
			return storage.IdempotencyResponse{}, false, err
		}
	}
	if response.Status < 500 {
		f.receipts[request.ScopeKey] = struct {
			fingerprint string
			response    storage.IdempotencyResponse
		}{request.Fingerprint, response}
	}
	return response, false, nil
}

func (f *cliReceiptFake) InsertSecurityAuditEvent(_ context.Context, event storage.SecurityAuditEvent) error {
	f.audits = append(f.audits, event)
	return nil
}

func cliProvisionCommand() application.ProvisionOrganizationCommand {
	return application.ProvisionOrganizationCommand{
		ActorUserID: "00000000-0000-0000-0000-000000000001", BootstrapAdminUserID: "00000000-0000-0000-0000-000000000002",
		Name: "CLI Factory", Slug: "cli-factory", Type: domain.OrganizationTypeFactory,
		LicensePlan: domain.LicensePlanPro, AllowEmptyCatalog: true,
	}
}

func TestCLIProvisioningSameKeyExecutesOnceAndReplays(t *testing.T) {
	store := &cliReceiptFake{receipts: map[string]struct {
		fingerprint string
		response    storage.IdempotencyResponse
	}{}}
	calls := 0
	provision := func(_ context.Context, _ application.ProvisionOrganizationCommand) (*application.ProvisionOrganizationResult, error) {
		calls++
		return &application.ProvisionOrganizationResult{Organization: domain.Organization{ID: "00000000-0000-0000-0000-000000000003", Name: "CLI Factory", Slug: "cli-factory", Status: domain.OrganizationStatusActive}}, nil
	}
	type outcome struct {
		replayed bool
		err      error
	}
	outcomes := make(chan outcome, 2)
	for range 2 {
		go func() {
			_, replayed, err := provisionOrganizationWithReceipt(context.Background(), store, cliProvisionCommand(), "cli-same-key-0001", provision)
			outcomes <- outcome{replayed: replayed, err: err}
		}()
	}
	first, second := <-outcomes, <-outcomes
	if first.err != nil || second.err != nil || calls != 1 || first.replayed == second.replayed {
		t.Fatalf("calls=%d first=%+v second=%+v", calls, first, second)
	}
}

func TestCLIProvisioningSameSlugDifferentKeysHasOneTypedConflict(t *testing.T) {
	store := &cliReceiptFake{receipts: map[string]struct {
		fingerprint string
		response    storage.IdempotencyResponse
	}{}}
	var provisionMu sync.Mutex
	created := false
	provision := func(_ context.Context, _ application.ProvisionOrganizationCommand) (*application.ProvisionOrganizationResult, error) {
		provisionMu.Lock()
		defer provisionMu.Unlock()
		if created {
			return nil, &pgconn.PgError{Code: "23505", ConstraintName: "organizations_slug_key"}
		}
		created = true
		return &application.ProvisionOrganizationResult{Organization: domain.Organization{ID: "00000000-0000-0000-0000-000000000003", Slug: "cli-factory", Status: domain.OrganizationStatusActive}}, nil
	}
	errorsOut := make(chan error, 2)
	for _, key := range []string{"cli-slug-key-00001", "cli-slug-key-00002"} {
		go func(key string) {
			_, _, err := provisionOrganizationWithReceipt(context.Background(), store, cliProvisionCommand(), key, provision)
			errorsOut <- err
		}(key)
	}
	one, two := <-errorsOut, <-errorsOut
	if (one == nil) == (two == nil) {
		t.Fatalf("expected one success and one conflict: one=%v two=%v", one, two)
	}
	conflict := one
	if conflict == nil {
		conflict = two
	}
	if !strings.Contains(conflict.Error(), "ORGANIZATION_SLUG_CONFLICT") || len(store.audits) != 1 {
		t.Fatalf("conflict=%v audits=%+v", conflict, store.audits)
	}
	details := store.audits[0].Details
	if details["request_id"] == "" || details["error_code"] != "ORGANIZATION_SLUG_CONFLICT" || details["target_hash"] == "cli-factory" {
		t.Fatalf("failure audit=%+v", store.audits[0])
	}
}

func TestCLIProvisioningRejectsIdempotencyKeyMismatch(t *testing.T) {
	store := &cliReceiptFake{receipts: map[string]struct {
		fingerprint string
		response    storage.IdempotencyResponse
	}{}}
	provision := func(_ context.Context, _ application.ProvisionOrganizationCommand) (*application.ProvisionOrganizationResult, error) {
		return &application.ProvisionOrganizationResult{Organization: domain.Organization{ID: "00000000-0000-0000-0000-000000000003", Status: domain.OrganizationStatusActive}}, nil
	}
	if _, _, err := provisionOrganizationWithReceipt(context.Background(), store, cliProvisionCommand(), "cli-mismatch-key-1", provision); err != nil {
		t.Fatal(err)
	}
	changed := cliProvisionCommand()
	changed.Name = "Changed payload"
	_, _, err := provisionOrganizationWithReceipt(context.Background(), store, changed, "cli-mismatch-key-1", provision)
	if !errors.Is(err, storage.ErrIdempotencyConflict) {
		t.Fatalf("err=%v", err)
	}
}
