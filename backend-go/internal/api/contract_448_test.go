package api

import (
	"bytes"
	"context"
	"encoding/json"
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

func TestIdempotencyReplayMismatchAndRetention(t *testing.T) {
	store := NewIdempotencyStore()
	now := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	server := &Server{idempotency: store}
	calls := 0
	handler := server.RequireIdempotency("test.command", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		respondWithJSON(w, http.StatusCreated, map[string]int{"call": calls})
	}))
	do := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/command", bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", "contract-key-448")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	first, second := do(`{"value":1}`), do(`{"value":1}`)
	if calls != 1 || second.Header().Get("Idempotency-Replayed") != "true" || first.Body.String() != second.Body.String() {
		t.Fatalf("replay calls=%d first=%s second=%s", calls, first.Body.String(), second.Body.String())
	}
	mismatch := do(`{"value":2}`)
	if mismatch.Code != http.StatusConflict || calls != 1 {
		t.Fatalf("mismatch status=%d calls=%d", mismatch.Code, calls)
	}
	var apiErr openapi.ApiError
	_ = json.Unmarshal(mismatch.Body.Bytes(), &apiErr)
	if apiErr.Code != openapi.ApiErrorCodeIdempotencyConflict {
		t.Fatalf("code=%s", apiErr.Code)
	}
	now = now.Add(IdempotencyRetention + time.Second)
	expired := do(`{"value":2}`)
	if expired.Code != http.StatusCreated || calls != 2 {
		t.Fatalf("expired status=%d calls=%d", expired.Code, calls)
	}
}

func TestIdempotencyConcurrentDuplicateExecutesOnce(t *testing.T) {
	server := &Server{idempotency: NewIdempotencyStore()}
	started, release := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	calls := 0
	handler := server.RequireIdempotency("test.concurrent", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		close(started)
		<-release
		respondWithJSON(w, http.StatusCreated, map[string]bool{"created": true})
	}))
	do := func(done chan<- *httptest.ResponseRecorder) {
		req := httptest.NewRequest(http.MethodPost, "/command", bytes.NewBufferString(`{"value":1}`))
		req.Header.Set("Idempotency-Key", "concurrent-key-448")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		done <- rec
	}
	done := make(chan *httptest.ResponseRecorder, 2)
	go do(done)
	<-started
	go do(done)
	close(release)
	first, second := <-done, <-done
	mu.Lock()
	gotCalls := calls
	mu.Unlock()
	if gotCalls != 1 || first.Body.String() != second.Body.String() {
		t.Fatalf("calls=%d first=%s second=%s", gotCalls, first.Body.String(), second.Body.String())
	}
	if first.Header().Get("Idempotency-Replayed") != "true" && second.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatal("concurrent duplicate was not marked as replayed")
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
