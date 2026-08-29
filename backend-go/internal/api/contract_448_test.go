package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestRequestIDMiddlewarePropagatesValidatedIDAndTypedError(t *testing.T) {
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := RequestIDFromContext(r.Context()); got != "request-448-valid" {
			t.Fatalf("context request id=%q", got)
		}
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeIdempotencyConflict, "localized message", nil)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(requestIDHeader, "request-448-valid")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get(requestIDHeader); got != "request-448-valid" {
		t.Fatalf("response request id=%q", got)
	}
	var payload openapi.ApiError
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != openapi.ApiErrorCodeIdempotencyConflict || payload.RequestId != "request-448-valid" {
		t.Fatalf("payload=%+v", payload)
	}
}

func TestRequestIDMiddlewareRejectsUntrustedInboundID(t *testing.T) {
	handler := RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := RequestIDFromContext(r.Context()); got == "bad id" || !validRequestID.MatchString(got) {
			t.Fatalf("untrusted request id was not replaced: %q", got)
		}
		respondWithError(w, http.StatusBadRequest, "invalid")
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(requestIDHeader, "bad id")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get(requestIDHeader); got == "bad id" || !validRequestID.MatchString(got) {
		t.Fatalf("response request id=%q", got)
	}
}

func TestVersionETagContract(t *testing.T) {
	for _, version := range []int64{1, 42, 999999} {
		tag := FormatVersionETag(version)
		got, err := ParseVersionETag(tag)
		if err != nil || got != version {
			t.Fatalf("round trip %d => %q/%d/%v", version, tag, got, err)
		}
	}
	for _, invalid := range []string{"", `W/"v1"`, `"1"`, `"v0"`, `v1`} {
		if _, err := ParseVersionETag(invalid); err == nil {
			t.Fatalf("accepted invalid ETag %q", invalid)
		}
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/", nil)
	if _, ok := RequireIfMatch(rec, req); ok || rec.Code != http.StatusPreconditionRequired {
		t.Fatalf("missing If-Match status=%d ok=%v", rec.Code, ok)
	}
}

type durableReceipt struct {
	fingerprint string
	response    storage.IdempotencyResponse
	expiresAt   time.Time
}

type durableReceiptBackend struct {
	mu       sync.Mutex
	receipts map[string]durableReceipt
	now      func() time.Time
}

type durableTestStore struct {
	stubStore
	backend *durableReceiptBackend
}

func (s *durableTestStore) ExecuteIdempotent(ctx context.Context, req storage.IdempotencyRequest, execute func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error) {
	s.backend.mu.Lock()
	defer s.backend.mu.Unlock()
	now := s.backend.now()
	if receipt, ok := s.backend.receipts[req.ScopeKey]; ok && receipt.expiresAt.After(now) {
		if receipt.fingerprint != req.Fingerprint {
			return storage.IdempotencyResponse{}, false, storage.ErrIdempotencyConflict
		}
		return receipt.response, true, nil
	}
	response, err := execute(ctx)
	if err != nil || response.Status >= 500 {
		return storage.IdempotencyResponse{}, false, storage.ErrIdempotencyRollback
	}
	s.backend.receipts[req.ScopeKey] = durableReceipt{fingerprint: req.Fingerprint, response: response, expiresAt: now.Add(storage.IdempotencyRetention)}
	return response, false, nil
}

func newDurableBackend(now func() time.Time) *durableReceiptBackend {
	return &durableReceiptBackend{receipts: map[string]durableReceipt{}, now: now}
}

func TestIdempotencyReplayMismatchRestartAndRetention(t *testing.T) {
	now := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	backend := newDurableBackend(func() time.Time { return now })
	calls := 0
	makeHandler := func() http.Handler {
		server := NewServer(&durableTestStore{backend: backend}, "secret", nil, 1, 1)
		return server.RequireIdempotency("test.command", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			w.Header().Set("ETag", `"v1"`)
			respondWithJSON(w, http.StatusCreated, map[string]int{"call": calls})
		}))
	}
	do := func(handler http.Handler, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/command", bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", "contract-key-448")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	first := do(makeHandler(), `{"value":1}`)
	// A new Server/store instance models a process restart while sharing PostgreSQL.
	second := do(makeHandler(), `{"value":1}`)
	if calls != 1 || second.Header().Get("Idempotency-Replayed") != "true" || first.Body.String() != second.Body.String() || second.Header().Get("ETag") != `"v1"` {
		t.Fatalf("restart replay calls=%d first=%s second=%s", calls, first.Body.String(), second.Body.String())
	}
	mismatch := do(makeHandler(), `{"value":2}`)
	if mismatch.Code != http.StatusConflict || calls != 1 {
		t.Fatalf("mismatch status=%d calls=%d", mismatch.Code, calls)
	}
	now = now.Add(storage.IdempotencyRetention - time.Second)
	if replay := do(makeHandler(), `{"value":1}`); replay.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatal("receipt was not retained for full 24 hours")
	}
	now = now.Add(2 * time.Second)
	if expired := do(makeHandler(), `{"value":2}`); expired.Code != http.StatusCreated || calls != 2 {
		t.Fatalf("expired status=%d calls=%d", expired.Code, calls)
	}
}

func TestIdempotencyMultiInstanceConcurrentDuplicateExecutesOnce(t *testing.T) {
	backend := newDurableBackend(time.Now)
	var calls int
	handlerFor := func() http.Handler {
		server := NewServer(&durableTestStore{backend: backend}, "secret", nil, 1, 1)
		return server.RequireIdempotency("test.concurrent", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls++
			respondWithJSON(w, http.StatusCreated, map[string]bool{"created": true})
		}))
	}
	done := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func(h http.Handler) {
			req := httptest.NewRequest(http.MethodPost, "/command", bytes.NewBufferString(`{"value":1}`))
			req.Header.Set("Idempotency-Key", "concurrent-key-448")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			done <- rec
		}(handlerFor())
	}
	first, second := <-done, <-done
	if calls != 1 || first.Body.String() != second.Body.String() {
		t.Fatalf("calls=%d first=%s second=%s", calls, first.Body.String(), second.Body.String())
	}
}

func TestIdempotencyCrashDoesNotPublishReceiptOrMutation(t *testing.T) {
	backend := newDurableBackend(time.Now)
	store := &durableTestStore{backend: backend}
	_, _, err := store.ExecuteIdempotent(context.Background(), storage.IdempotencyRequest{ScopeKey: "scope", Fingerprint: "fingerprint"}, func(context.Context) (storage.IdempotencyResponse, error) {
		return storage.IdempotencyResponse{Status: http.StatusInternalServerError}, errors.New("injected crash before atomic commit")
	})
	if err == nil || len(backend.receipts) != 0 {
		t.Fatalf("crash published receipt: err=%v receipts=%d", err, len(backend.receipts))
	}
}

func TestIdempotencyFingerprintIncludesIfMatch(t *testing.T) {
	backend := newDurableBackend(time.Now)
	server := NewServer(&durableTestStore{backend: backend}, "secret", nil, 1, 1)
	calls := 0
	handler := server.RequireIdempotency("test.versioned", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		respondWithJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
	do := func(version string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/versioned/resource", nil)
		req.Header.Set("Idempotency-Key", "versioned-contract-key")
		req.Header.Set("If-Match", version)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	if first := do(`"v1"`); first.Code != http.StatusOK {
		t.Fatalf("first status=%d", first.Code)
	}
	if mismatch := do(`"v2"`); mismatch.Code != http.StatusConflict || calls != 1 {
		t.Fatalf("mismatch status=%d calls=%d", mismatch.Code, calls)
	}
}

type staleInvitationStore struct {
	stubStore
	version int64
	revoked bool
	calls   int
}

func (s *staleInvitationStore) RevokeInvitation(_ context.Context, _, id string, expectedVersion int64) (*storage.Invitation, error) {
	s.calls++
	if expectedVersion != s.version {
		return nil, storage.ErrVersionConflict
	}
	s.version++
	s.revoked = true
	now := time.Now()
	return &storage.Invitation{ID: id, Email: "invite@example.test", Version: s.version, RevokedAt: &now, CreatedAt: now, ExpiresAt: now.Add(time.Hour)}, nil
}

func TestStaleInvitationRevokeReturnsTyped412WithoutOverwrite(t *testing.T) {
	store := &staleInvitationStore{
		stubStore: stubStore{getOrgByID: &domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, Active: true}},
		version:   2,
	}
	server := NewServer(store, "secret", nil, 1, 1)
	req := withOrgClaims(httptest.NewRequest(http.MethodDelete, "/api/org/invitations/inv-1", nil), "actor", "org-1", string(domain.RoleAdmin))
	req.SetPathValue("id", "inv-1")
	req.Header.Set("If-Match", `"v1"`)
	rec := httptest.NewRecorder()
	server.HandleOrgRevokeInvitation(rec, req)
	if rec.Code != http.StatusPreconditionFailed || store.revoked || store.version != 2 {
		t.Fatalf("status=%d revoked=%v version=%d body=%s", rec.Code, store.revoked, store.version, rec.Body.String())
	}
	var payload openapi.ApiError
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	if payload.Code != openapi.ApiErrorCodeVersionConflict {
		t.Fatalf("code=%s", payload.Code)
	}
}

type durableInvitationStore struct {
	staleInvitationStore
	backend *durableReceiptBackend
}

func (s *durableInvitationStore) ExecuteIdempotent(ctx context.Context, req storage.IdempotencyRequest, execute func(context.Context) (storage.IdempotencyResponse, error)) (storage.IdempotencyResponse, bool, error) {
	durable := durableTestStore{backend: s.backend}
	return durable.ExecuteIdempotent(ctx, req, execute)
}

func TestInvitationRevokeReplaysWithoutSecondMutation(t *testing.T) {
	store := &durableInvitationStore{
		staleInvitationStore: staleInvitationStore{
			stubStore: stubStore{getOrgByID: &domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, Active: true}},
			version:   1,
		},
		backend: newDurableBackend(time.Now),
	}
	server := NewServer(store, "secret", nil, 1, 1)
	handler := server.RequireIdempotency("org.revoke-invitation", http.HandlerFunc(server.HandleOrgRevokeInvitation))
	do := func() *httptest.ResponseRecorder {
		req := withOrgClaims(httptest.NewRequest(http.MethodDelete, "/api/org/invitations/inv-1", nil), "actor", "org-1", string(domain.RoleAdmin))
		req.SetPathValue("id", "inv-1")
		req.Header.Set("If-Match", `"v1"`)
		req.Header.Set("Idempotency-Key", "invitation-revoke-key")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	first, replay := do(), do()
	if first.Code != http.StatusOK || replay.Code != http.StatusOK || replay.Header().Get("Idempotency-Replayed") != "true" || replay.Header().Get("ETag") != `"v2"` || store.calls != 1 || store.version != 2 {
		t.Fatalf("first=%d replay=%d replayed=%q etag=%q calls=%d version=%d", first.Code, replay.Code, replay.Header().Get("Idempotency-Replayed"), replay.Header().Get("ETag"), store.calls, store.version)
	}
}

type staleMembershipStore struct {
	stubStore
	mu            sync.Mutex
	mutationCalls int
	version       int64
	roles         []domain.UserRole
}

func (s *staleMembershipStore) UpdateMembershipRolesByOrg(_ context.Context, _, _ string, roles []domain.UserRole, expected int64) (*storage.OrgTeamMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mutationCalls++
	if expected != s.version {
		return nil, storage.ErrVersionConflict
	}
	s.roles = append([]domain.UserRole(nil), roles...)
	s.version++
	return &storage.OrgTeamMember{Roles: s.roles, Version: s.version, Active: true}, nil
}

func TestStaleMembershipWriteReturnsTyped412WithoutOverwrite(t *testing.T) {
	store := &staleMembershipStore{
		stubStore: stubStore{getOrgByID: &domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, Active: true}},
		version:   2, roles: []domain.UserRole{domain.RoleUser},
	}
	server := NewServer(store, "secret", nil, 1, 1)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/org/members/u-1/roles", bytes.NewBufferString(`{"roles":["admin"]}`)), "actor", string(domain.RoleAdmin))
	claims := claimsFromRequest(req)
	claims.OrgID = "org-1"
	req.SetPathValue("userId", "u-1")
	req.Header.Set("If-Match", `"v1"`)
	rec := httptest.NewRecorder()
	server.HandleOrgMemberRoles(rec, req)
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var payload openapi.ApiError
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	if payload.Code != openapi.ApiErrorCodeMembershipVersionConflict {
		t.Fatalf("code=%s", payload.Code)
	}
	if store.mutationCalls != 1 {
		t.Fatalf("mutation calls=%d", store.mutationCalls)
	}
	if store.version != 2 || len(store.roles) != 1 || store.roles[0] != domain.RoleUser {
		t.Fatalf("stale write overwrote state: version=%d roles=%v", store.version, store.roles)
	}
}

type missingCloneSourceStore struct{ stubStore }

func (s *missingCloneSourceStore) GetOrganizationByID(context.Context, string) (*domain.Organization, error) {
	return nil, errors.New("organization not found")
}

func (s *missingCloneSourceStore) GetOrganizationBySlug(context.Context, string) (*domain.Organization, error) {
	return nil, errors.New("organization not found")
}

func TestPlatformOrganizationPrevalidatesCloneSourceBeforeInsert(t *testing.T) {
	store := &missingCloneSourceStore{}
	server := NewServer(store, "secret", nil, 1, 1)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/platform/organizations", bytes.NewBufferString(`{
		"name":"No Partial Org","slug":"no-partial-org","type":"factory","license_plan":"none","clone_catalog_from":"missing-source"
	}`)), "platform-admin", string(domain.RoleAdmin))
	rec := httptest.NewRecorder()
	server.HandlePlatformCreateOrganization(rec, req)
	if rec.Code != http.StatusBadRequest || len(store.createdOrgs) != 0 {
		t.Fatalf("status=%d created=%d body=%s", rec.Code, len(store.createdOrgs), rec.Body.String())
	}
}

type cloneSlugStore struct {
	stubStore
	idLookups int
	cloneSrc  string
}

func (s *cloneSlugStore) GetOrganizationByID(context.Context, string) (*domain.Organization, error) {
	s.idLookups++
	return nil, errors.New("unexpected UUID lookup")
}

func (s *cloneSlugStore) GetOrganizationBySlug(_ context.Context, slug string) (*domain.Organization, error) {
	if slug != "source-factory" {
		return nil, errors.New("organization not found")
	}
	return &domain.Organization{ID: "00000000-0000-0000-0000-000000000123", Slug: slug, Type: domain.OrganizationTypeFactory, Active: true}, nil
}

func (s *cloneSlugStore) CloneCatalog(_ context.Context, source, _ string) error {
	s.cloneSrc = source
	return nil
}

func TestPlatformOrganizationResolvesCloneSlugWithoutAbortingTransaction(t *testing.T) {
	store := &cloneSlugStore{}
	server := NewServer(store, "secret", nil, 1, 1)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/platform/organizations", bytes.NewBufferString(`{
		"name":"Cloned Org","slug":"cloned-org","type":"factory","license_plan":"none","clone_catalog_from":"source-factory"
	}`)), "platform-admin", string(domain.RoleAdmin))
	rec := httptest.NewRecorder()
	server.HandlePlatformCreateOrganization(rec, req)
	if rec.Code != http.StatusCreated || store.idLookups != 0 || store.cloneSrc != "00000000-0000-0000-0000-000000000123" {
		t.Fatalf("status=%d idLookups=%d cloneSrc=%q body=%s", rec.Code, store.idLookups, store.cloneSrc, rec.Body.String())
	}
}

func TestGeneratedRequestBoundaryRejectsUnknownProperty(t *testing.T) {
	store := &stubStore{}
	server := NewServer(store, "secret", nil, 1, 1)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/platform/organizations", bytes.NewBufferString(`{
		"name":"Strict Org","slug":"strict-org","type":"factory","license_plan":"none","unexpected":true
	}`)), "platform-admin", string(domain.RoleAdmin))
	rec := httptest.NewRecorder()
	server.HandlePlatformCreateOrganization(rec, req)
	if rec.Code != http.StatusBadRequest || len(store.createdOrgs) != 0 {
		t.Fatalf("status=%d created=%d body=%s", rec.Code, len(store.createdOrgs), rec.Body.String())
	}
	var payload openapi.ApiError
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil || payload.Code != openapi.ApiErrorCodeBadRequest {
		t.Fatalf("single typed error required: payload=%+v err=%v body=%s", payload, err, rec.Body.String())
	}
}

type strictPlatformUpdateStore struct {
	stubStore
	updateCalls int
}

func (s *strictPlatformUpdateStore) UpdateOrganizationVersion(_ context.Context, _ *domain.Organization, _ int64) error {
	s.updateCalls++
	return nil
}

func TestPlatformOrganizationPatchRejectsUnknownPropertyWithoutMutation(t *testing.T) {
	store := &strictPlatformUpdateStore{stubStore: stubStore{getOrgByID: &domain.Organization{
		ID: "org-1", Name: "Original", Type: domain.OrganizationTypeFactory, Active: true, Version: 2,
	}}}
	server := NewServer(store, "secret", nil, 1, 1)
	req := withClaims(httptest.NewRequest(http.MethodPatch, "/api/platform/organizations/org-1", bytes.NewBufferString(`{"name":"Changed","unexpected":true}`)), "platform-admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "org-1")
	req.Header.Set("If-Match", `"v2"`)
	rec := httptest.NewRecorder()
	server.HandlePlatformUpdateOrganization(rec, req)
	if rec.Code != http.StatusBadRequest || store.updateCalls != 0 || store.getOrgByID.Name != "Original" {
		t.Fatalf("status=%d updates=%d name=%q body=%s", rec.Code, store.updateCalls, store.getOrgByID.Name, rec.Body.String())
	}
	var payload openapi.ApiError
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil || payload.Code != openapi.ApiErrorCodeBadRequest {
		t.Fatalf("single typed error required: payload=%+v err=%v body=%s", payload, err, rec.Body.String())
	}
}

func TestPlatformOrganizationRequiresGeneratedFields(t *testing.T) {
	for name, body := range map[string]string{
		"missing type":         `{"name":"Strict Org","slug":"strict-org","license_plan":"none"}`,
		"missing license plan": `{"name":"Strict Org","slug":"strict-org","type":"factory"}`,
	} {
		t.Run(name, func(t *testing.T) {
			store := &stubStore{}
			server := NewServer(store, "secret", nil, 1, 1)
			req := withClaims(httptest.NewRequest(http.MethodPost, "/api/platform/organizations", bytes.NewBufferString(body)), "platform-admin", string(domain.RoleAdmin))
			rec := httptest.NewRecorder()
			server.HandlePlatformCreateOrganization(rec, req)
			if rec.Code != http.StatusBadRequest || len(store.createdOrgs) != 0 {
				t.Fatalf("status=%d created=%d body=%s", rec.Code, len(store.createdOrgs), rec.Body.String())
			}
			var payload openapi.ApiError
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil || payload.Code != openapi.ApiErrorCodeBadRequest {
				t.Fatalf("single typed error required: payload=%+v err=%v body=%s", payload, err, rec.Body.String())
			}
		})
	}
}
