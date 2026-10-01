package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// stubStore extensions for the #913 hardware-profile surface. The stubs keep
// the single-use discipline of the existing catalog stubs: nil means the
// zero answer, and every call is captured for assertion.

func (s *stubStore) ListHardwareProfiles(context.Context) ([]domain.HardwareProfile, error) {
	if s.listHardwareProfiles != nil {
		return s.listHardwareProfiles, nil
	}
	return []domain.HardwareProfile{}, nil
}

func (s *stubStore) GetHardwareProfileByID(_ context.Context, id string) (*domain.HardwareProfile, error) {
	if s.hardwareProfileReturnedByID != nil && (s.hardwareProfileGetID == "" || s.hardwareProfileGetID == id) {
		return s.hardwareProfileReturnedByID, nil
	}
	return nil, errors.New("hardware profile not found")
}

func (s *stubStore) CreateHardwareProfile(_ context.Context, p *domain.HardwareProfile) error {
	if s.createHardwareProfileErr != nil {
		return s.createHardwareProfileErr
	}
	p.ID = "f9130000-0000-0000-0000-0000000000c1"
	p.Version = 1
	s.createdHardwareProfile = p
	return nil
}

func (s *stubStore) UpdateHardwareProfile(_ context.Context, id string, expectedVersion int64, p *domain.HardwareProfile) error {
	if s.updateHardwareProfileErr != nil {
		return s.updateHardwareProfileErr
	}
	p.ID = id
	p.Version = expectedVersion + 1
	s.updatedHardwareProfile = p
	s.updatedHardwareProfileExpectedVersion = expectedVersion
	return nil
}

func (s *stubStore) DeactivateHardwareProfile(_ context.Context, id string, expectedVersion int64) error {
	if s.deactivateHardwareProfileErr != nil {
		return s.deactivateHardwareProfileErr
	}
	s.deactivatedHardwareProfileID = id
	s.deactivatedHardwareProfileExpectedVersion = expectedVersion
	return nil
}

func (s *stubStore) ExistingHardwareIDs(_ context.Context, ids []string) (map[string]bool, error) {
	existing := map[string]bool{}
	for _, id := range ids {
		if !strings.HasPrefix(id, "missing-") {
			existing[id] = true
		}
	}
	return existing, nil
}

func hardwareProfileTestServer(store *stubStore) *Server {
	return &Server{Store: store}
}

func hardwareProfileRequest(method, target string, body any, ifMatch string) (*http.Request, *httptest.ResponseRecorder) {
	var reader *strings.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = strings.NewReader(string(raw))
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	if strings.Contains(target, "/hardware-profiles/") {
		req.SetPathValue("id", strings.TrimSuffix(strings.TrimPrefix(target, "/api/catalog/hardware-profiles/"), "/"))
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	// Catalog mutations require authenticated admin claims; reads do not.
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodDelete {
		req = withOverlayOrgClaims(req, "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	}
	return req, httptest.NewRecorder()
}

func TestHandleHardwareProfiles(t *testing.T) {
	validBody := map[string]any{
		"code": "PERF-SPAX-50", "name": "Unión lateral SPAX 4x50", "revision": "rev-1",
		"items":     []map[string]any{{"hardwareId": "hw-spax", "quantity": 2, "applicationRole": "screw"}},
		"recipeRef": map[string]any{"recipeId": "test:synthetic-fixed-shelf", "recipeRevision": "test-1"},
	}

	t.Run("GET lists profiles", func(t *testing.T) {
		store := &stubStore{listHardwareProfiles: []domain.HardwareProfile{{ID: "p1", Code: "PERF-A", Name: "A", Revision: "r1", Items: []domain.HardwareProfileItem{}, Active: true, Version: 1}}}
		req, rec := hardwareProfileRequest(http.MethodGet, "/api/catalog/hardware-profiles", nil, "")
		hardwareProfileTestServer(store).HandleHardwareProfiles(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var listed []domain.HardwareProfile
		if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil || len(listed) != 1 || listed[0].Code != "PERF-A" {
			t.Fatalf("listed = %s err=%v", rec.Body.String(), err)
		}
	})

	t.Run("POST creates with server-owned identity and a strong ETag", func(t *testing.T) {
		store := &stubStore{}
		req, rec := hardwareProfileRequest(http.MethodPost, "/api/catalog/hardware-profiles", validBody, "")
		hardwareProfileTestServer(store).HandleHardwareProfiles(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		if got := rec.Header().Get("ETag"); got != `"v1"` {
			t.Fatalf("ETag = %q, want \"v1\"", got)
		}
		created := store.createdHardwareProfile
		if created == nil || !created.Active || created.ID == "" || created.Version != 1 {
			t.Fatalf("created = %+v", created)
		}
		var responded domain.HardwareProfile
		if err := json.Unmarshal(rec.Body.Bytes(), &responded); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		// The response never carries commercial identity beyond references.
		if responded.Items[0].HardwareID != "hw-spax" || responded.Items[0].Quantity != 2 {
			t.Fatalf("items roundtrip = %+v", responded.Items)
		}
	})

	t.Run("POST rejects server-owned fields in the body", func(t *testing.T) {
		store := &stubStore{}
		body := map[string]any{}
		for k, v := range validBody {
			body[k] = v
		}
		body["version"] = 99
		req, rec := hardwareProfileRequest(http.MethodPost, "/api/catalog/hardware-profiles", body, "")
		hardwareProfileTestServer(store).HandleHardwareProfiles(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST fails closed on unknown hardware references", func(t *testing.T) {
		store := &stubStore{}
		body := map[string]any{}
		for k, v := range validBody {
			body[k] = v
		}
		body["items"] = []map[string]any{{"hardwareId": "missing-hw", "quantity": 1}}
		req, rec := hardwareProfileRequest(http.MethodPost, "/api/catalog/hardware-profiles", body, "")
		hardwareProfileTestServer(store).HandleHardwareProfiles(rec, req)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var envelope struct {
			Code   string                 `json:"code"`
			Issues []domain.ContractIssue `json:"issues"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil || envelope.Code != "HARDWARE_PROFILE_INVALID" {
			t.Fatalf("envelope = %s err=%v", rec.Body.String(), err)
		}
		if len(envelope.Issues) == 0 || envelope.Issues[0].Code != "HARDWARE_REFERENCE_INVALID" {
			t.Fatalf("issues = %+v", envelope.Issues)
		}
	})

	t.Run("POST maps duplicate code to 409", func(t *testing.T) {
		store := &stubStore{createHardwareProfileErr: errors.New(`duplicate key value violates unique constraint "hardware_profiles_org_code_key"`)}
		req, rec := hardwareProfileRequest(http.MethodPost, "/api/catalog/hardware-profiles", validBody, "")
		hardwareProfileTestServer(store).HandleHardwareProfiles(rec, req)
		if rec.Code != http.StatusConflict {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST rejects a request without authenticated catalog-mutation claims", func(t *testing.T) {
		store := &stubStore{}
		raw, _ := json.Marshal(validBody)
		req := httptest.NewRequest(http.MethodPost, "/api/catalog/hardware-profiles", strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		hardwareProfileTestServer(store).HandleHardwareProfiles(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		if store.createdHardwareProfile != nil {
			t.Fatalf("unauthorized write reached the store")
		}
	})
}

func TestHandleHardwareProfileByID(t *testing.T) {
	stored := &domain.HardwareProfile{
		ID: "f9130000-0000-0000-0000-0000000000c1", Code: "PERF-A", Name: "A", Revision: "r1",
		Items: []domain.HardwareProfileItem{{HardwareID: "hw-spax", Quantity: 2}}, Active: true, Version: 3,
	}
	updateBody := map[string]any{
		"code": "PERF-A2", "name": "A v2", "revision": "r2",
		"items": []map[string]any{{"hardwareId": "hw-spax", "quantity": 4}},
	}

	t.Run("GET returns the profile with its version ETag", func(t *testing.T) {
		store := &stubStore{hardwareProfileReturnedByID: stored}
		req, rec := hardwareProfileRequest(http.MethodGet, "/api/catalog/hardware-profiles/"+stored.ID, nil, "")
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusOK || rec.Header().Get("ETag") != `"v3"` {
			t.Fatalf("status = %d etag=%q body=%s", rec.Code, rec.Header().Get("ETag"), rec.Body.String())
		}
	})

	t.Run("GET unknown id is 404", func(t *testing.T) {
		store := &stubStore{}
		req, rec := hardwareProfileRequest(http.MethodGet, "/api/catalog/hardware-profiles/unknown", nil, "")
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("PUT without If-Match is 428 and with a malformed one 400", func(t *testing.T) {
		store := &stubStore{hardwareProfileReturnedByID: stored}
		req, rec := hardwareProfileRequest(http.MethodPut, "/api/catalog/hardware-profiles/"+stored.ID, updateBody, "")
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusPreconditionRequired {
			t.Fatalf("missing If-Match status = %d", rec.Code)
		}
		req, rec = hardwareProfileRequest(http.MethodPut, "/api/catalog/hardware-profiles/"+stored.ID, updateBody, "weak")
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("malformed If-Match status = %d", rec.Code)
		}
	})

	t.Run("PUT with the current version updates and bumps the ETag", func(t *testing.T) {
		store := &stubStore{hardwareProfileReturnedByID: stored}
		req, rec := hardwareProfileRequest(http.MethodPut, "/api/catalog/hardware-profiles/"+stored.ID, updateBody, `"v3"`)
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusOK || rec.Header().Get("ETag") != `"v4"` {
			t.Fatalf("status = %d etag=%q body=%s", rec.Code, rec.Header().Get("ETag"), rec.Body.String())
		}
		if store.updatedHardwareProfileExpectedVersion != 3 {
			t.Fatalf("expected version = %d", store.updatedHardwareProfileExpectedVersion)
		}
		if !store.updatedHardwareProfile.Active {
			t.Fatalf("PUT must preserve the server-owned active flag")
		}
	})

	t.Run("PUT stale version is 412", func(t *testing.T) {
		store := &stubStore{hardwareProfileReturnedByID: stored, updateHardwareProfileErr: storage.ErrVersionConflict}
		req, rec := hardwareProfileRequest(http.MethodPut, "/api/catalog/hardware-profiles/"+stored.ID, updateBody, `"v1"`)
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusPreconditionFailed {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("DELETE deactivates with If-Match and answers the deactivated profile", func(t *testing.T) {
		store := &stubStore{hardwareProfileReturnedByID: stored}
		req, rec := hardwareProfileRequest(http.MethodDelete, "/api/catalog/hardware-profiles/"+stored.ID, nil, `"v3"`)
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		if store.deactivatedHardwareProfileID != stored.ID || store.deactivatedHardwareProfileExpectedVersion != 3 {
			t.Fatalf("deactivate call = %s@%d", store.deactivatedHardwareProfileID, store.deactivatedHardwareProfileExpectedVersion)
		}
	})

	t.Run("DELETE stale version is 412", func(t *testing.T) {
		store := &stubStore{hardwareProfileReturnedByID: stored, deactivateHardwareProfileErr: storage.ErrVersionConflict}
		req, rec := hardwareProfileRequest(http.MethodDelete, "/api/catalog/hardware-profiles/"+stored.ID, nil, `"v1"`)
		hardwareProfileTestServer(store).HandleHardwareProfileByID(rec, req)
		if rec.Code != http.StatusPreconditionFailed {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}
