package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1135 — the authoritative validation endpoint: UI hiding never substitutes
// it; invalid selections answer 422 INVALID_OPENING_CONFIGURATION with
// details.reason; blocked (OQ-3) is a truthful 200 state.

func openingValidateRequest(t *testing.T, srv *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-configuration/validate", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleOpeningConfigurationValidate(rr, req)
	return rr
}

func TestHandleOpeningConfigurationValidateAcceptsValidSelection(t *testing.T) {
	srv := &Server{Store: &stubStore{
		openingCapabilities: &domain.OpeningCapabilities{
			Version: 1,
			Grips: map[string]domain.OpeningGripCapability{
				domain.OpeningGripSystemHandle: {Enabled: true, Default: true},
				domain.OpeningGripSystemGola:   {Enabled: true, Profiles: []string{"profile.gola-l.alu"}},
			},
		},
		openingProfiles: []domain.OpeningProfile{{
			ID: "profile.gola-l.alu", CompatiblePlacements: []string{"top"}, DatasheetStatus: "verified",
		}},
	}}

	rr := openingValidateRequest(t, srv, `{"system":"gola","profileId":"profile.gola-l.alu","furnitureType":"inferior","placements":["top"]}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var got struct {
		Validation struct {
			State  string `json:"state"`
			Reason string `json:"reason"`
		} `json:"validation"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Validation.State != "valid" {
		t.Fatalf("state = %s, want valid", got.Validation.State)
	}
}

func TestHandleOpeningConfigurationValidateRejectsDisabledCapability(t *testing.T) {
	srv := &Server{Store: &stubStore{
		openingCapabilities: &domain.OpeningCapabilities{
			Version: 1,
			Grips: map[string]domain.OpeningGripCapability{
				domain.OpeningGripSystemHandle: {Enabled: true, Default: true},
				domain.OpeningGripSystemGola:   {Enabled: false},
			},
		},
	}}

	rr := openingValidateRequest(t, srv, `{"system":"gola","profileId":"profile.gola-l.alu"}`)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusUnprocessableEntity, rr.Body.String())
	}
	var got struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details struct {
			Reason string `json:"reason"`
		} `json:"details"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Code != "INVALID_OPENING_CONFIGURATION" {
		t.Fatalf("code = %s, want INVALID_OPENING_CONFIGURATION", got.Code)
	}
	if got.Details.Reason != "OPENING_SYSTEM_UNAVAILABLE" {
		t.Fatalf("reason = %s, want OPENING_SYSTEM_UNAVAILABLE", got.Details.Reason)
	}
	if got.Message == "" {
		t.Fatal("the message must carry the workshop-facing text")
	}
}

func TestHandleOpeningConfigurationValidateRejectsIncompatiblePlacement(t *testing.T) {
	srv := &Server{Store: &stubStore{
		openingProfiles: []domain.OpeningProfile{{
			ID: "profile.gola-l.alu", CompatiblePlacements: []string{"top"}, DatasheetStatus: "verified",
		}},
	}}

	rr := openingValidateRequest(t, srv, `{"system":"gola","profileId":"profile.gola-l.alu","placements":["between"]}`)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusUnprocessableEntity, rr.Body.String())
	}
	var got struct {
		Code    string `json:"code"`
		Details struct {
			Reason string `json:"reason"`
		} `json:"details"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Code != "INVALID_OPENING_CONFIGURATION" || got.Details.Reason != "OPENING_PLACEMENT_INCOMPATIBLE" {
		t.Fatalf("unexpected rejection: %s", rr.Body.String())
	}
}

func TestHandleOpeningConfigurationValidateBlockedIsATruthfulState(t *testing.T) {
	// bottom_overhang available: the answer is 200 blocked (OQ-3), never an
	// error and never an invented resolution.
	srv := &Server{Store: &stubStore{}}

	rr := openingValidateRequest(t, srv, `{"system":"bottom_overhang"}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var got struct {
		Validation struct {
			State  string `json:"state"`
			Reason string `json:"reason"`
		} `json:"validation"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Validation.State != "blocked" || got.Validation.Reason != "OPENING_OVERHANG_EVIDENCE_PENDING" {
		t.Fatalf("unexpected blocked payload: %s", rr.Body.String())
	}
}

func TestHandleOpeningConfigurationValidateBrokenOverlayFailsClosed(t *testing.T) {
	// A broken overlay must never validate against silent library defaults.
	srv := &Server{Store: &brokenOpeningCapabilitiesStore{stubStore: &stubStore{}}}

	rr := openingValidateRequest(t, srv, `{"system":"handle"}`)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleOpeningConfigurationValidateRejectsNonPost(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-configuration/validate", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleOpeningConfigurationValidate(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

// brokenOpeningCapabilitiesStore fails ONLY the capabilities read, so the
// fail-closed path is exercised in isolation.
type brokenOpeningCapabilitiesStore struct {
	*stubStore
}

func (s *brokenOpeningCapabilitiesStore) GetOpeningCapabilities(context.Context) (*domain.OpeningCapabilities, error) {
	return nil, dupErr("overlay corrupto")
}
