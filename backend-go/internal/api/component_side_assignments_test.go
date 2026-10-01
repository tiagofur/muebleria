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

// #915 backend: side assignments on a component definition — server-side
// vocabulary enforcement, reference integrity, permission gate, and the
// delete (restore-inheritance) path.

func sideAssignmentRequest(method, target string, body any) (*http.Request, *httptest.ResponseRecorder) {
	var reader *strings.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = strings.NewReader(string(raw))
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	if strings.Contains(target, "/side-assignments") {
		req.SetPathValue("id", "f9150000-0000-0000-0000-00000000com")
		if method == http.MethodDelete {
			req.SetPathValue("side", target[strings.LastIndex(target, "/")+1:])
		}
	}
	if method == http.MethodPut || method == http.MethodDelete {
		req = withOverlayOrgClaims(req, "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")
	}
	rec := httptest.NewRecorder()
	return req, rec
}

func TestHandleComponentSideAssignments(t *testing.T) {
	t.Run("GET lists assignments for the component", func(t *testing.T) {
		store := &stubStore{listComponentSideAssignments: []domain.ComponentSideAssignment{
			{ID: "a1", ComponentID: "c1", Side: "left", ProfileID: "p1"},
		}}
		req, rec := sideAssignmentRequest(http.MethodGet, "/api/catalog/components/c1/side-assignments", nil)
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var listed []domain.ComponentSideAssignment
		if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil || len(listed) != 1 || listed[0].Side != "left" {
			t.Fatalf("listed = %s err=%v", rec.Body.String(), err)
		}
	})

	t.Run("PUT sets an assignment and returns it", func(t *testing.T) {
		store := &stubStore{}
		req, rec := sideAssignmentRequest(http.MethodPut, "/api/catalog/components/c1/side-assignments",
			map[string]any{"side": "left", "profileId": "p1"})
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		set := store.setComponentSideAssignment
		if set == nil || set.Side != "left" || set.ProfileID != "p1" {
			t.Fatalf("stored assignment = %+v", set)
		}
	})

	t.Run("PUT rejects an unknown side with the contract issue", func(t *testing.T) {
		store := &stubStore{}
		req, rec := sideAssignmentRequest(http.MethodPut, "/api/catalog/components/c1/side-assignments",
			map[string]any{"side": "L1", "profileId": "p1"})
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "ASSIGNMENT_INVALID") {
			t.Fatalf("body = %s", rec.Body.String())
		}
	})

	t.Run("PUT maps a broken reference to 422 without leaking the other tenant", func(t *testing.T) {
		store := &stubStore{setComponentSideAssignmentErr: storage.ErrAssignmentReferenceInvalid}
		req, rec := sideAssignmentRequest(http.MethodPut, "/api/catalog/components/c1/side-assignments",
			map[string]any{"side": "left", "profileId": "p-other-org"})
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("PUT without permission is 403 and never reaches the store", func(t *testing.T) {
		store := &stubStore{}
		raw := []byte(`{"side":"left","profileId":"p1"}`)
		req := httptest.NewRequest(http.MethodPut, "/api/catalog/components/c1/side-assignments", strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.SetPathValue("id", "c1")
		rec := httptest.NewRecorder()
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
		if store.setComponentSideAssignment != nil {
			t.Fatalf("unauthorized write reached the store")
		}
	})

	t.Run("DELETE removes one side and maps unknown to 404", func(t *testing.T) {
		store := &stubStore{}
		req, rec := sideAssignmentRequest(http.MethodDelete, "/api/catalog/components/c1/side-assignments/left", nil)
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusOK || store.removeAssignmentSide != "left" {
			t.Fatalf("status = %d side=%q", rec.Code, store.removeAssignmentSide)
		}

		store = &stubStore{removeAssignmentErr: errors.New("component side assignment not found")}
		req, rec = sideAssignmentRequest(http.MethodDelete, "/api/catalog/components/c1/side-assignments/top", nil)
		(&Server{Store: store}).HandleComponentSideAssignments(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

// --- stubStore implementations (single-use, captured for assertion) ---
func (s *stubStore) ListComponentSideAssignments(context.Context, string) ([]domain.ComponentSideAssignment, error) {
	if s.listComponentSideAssignments != nil {
		return s.listComponentSideAssignments, nil
	}
	return []domain.ComponentSideAssignment{}, nil
}

func (s *stubStore) SetComponentSideAssignment(_ context.Context, a *domain.ComponentSideAssignment) error {
	if s.setComponentSideAssignmentErr != nil {
		return s.setComponentSideAssignmentErr
	}
	a.ID = "f9150000-0000-0000-0000-0000000000a1"
	s.setComponentSideAssignment = a
	return nil
}

func (s *stubStore) RemoveComponentSideAssignment(_ context.Context, componentID, side string) error {
	if s.removeAssignmentErr != nil {
		return s.removeAssignmentErr
	}
	s.removeAssignmentComponentID = componentID
	s.removeAssignmentSide = side
	return nil
}

func (s *stubStore) ListAllComponentSideAssignments(context.Context) ([]domain.ComponentSideAssignment, error) {
	if s.allComponentSideAssignments != nil {
		return s.allComponentSideAssignments, nil
	}
	return []domain.ComponentSideAssignment{}, nil
}
