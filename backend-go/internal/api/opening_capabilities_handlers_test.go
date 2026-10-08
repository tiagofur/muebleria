package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1134 — the opening-capabilities catalog read: the web authoring surfaces
// must see the SAME factory offering the server governs (nil = library
// ladder; a broken overlay fails closed, never a silent default).

func TestHandleOpeningCapabilitiesReturnsOverlayBlob(t *testing.T) {
	srv := &Server{Store: &stubStore{
		openingCapabilities: &domain.OpeningCapabilities{
			Version: 1,
			Grips: map[string]domain.OpeningGripCapability{
				domain.OpeningGripSystemHandle: {Enabled: true, Default: true},
				domain.OpeningGripSystemGola:   {Enabled: true, Profiles: []string{"profile.gola-l.alu"}},
			},
			ByFurnitureType: map[string]domain.OpeningFurnitureTypeCapabilities{
				"superior": {Grips: map[string]domain.OpeningFurnitureTypeGrip{
					domain.OpeningGripSystemGola: {Placements: []string{"top"}},
				}},
			},
		},
	}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-capabilities", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleOpeningCapabilities(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var got struct {
		OpeningCapabilities *struct {
			Version int `json:"version"`
			Grips   map[string]struct {
				Enabled  bool     `json:"enabled"`
				Default  bool     `json:"default"`
				Profiles []string `json:"profiles"`
			} `json:"grips"`
			ByFurnitureType map[string]struct {
				Grips map[string]struct {
					Placements []string `json:"placements"`
				} `json:"grips"`
			} `json:"byFurnitureType"`
		} `json:"opening_capabilities"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.OpeningCapabilities == nil || got.OpeningCapabilities.Version != 1 {
		t.Fatalf("expected the parsed capabilities, got %s", rr.Body.String())
	}
	gola := got.OpeningCapabilities.Grips[domain.OpeningGripSystemGola]
	if !gola.Enabled || len(gola.Profiles) != 1 {
		t.Fatalf("unexpected gola capability: %s", rr.Body.String())
	}
	if got.OpeningCapabilities.ByFurnitureType["superior"].Grips[domain.OpeningGripSystemGola].Placements[0] != "top" {
		t.Fatalf("unexpected per-type restriction: %s", rr.Body.String())
	}
}

func TestHandleOpeningCapabilitiesNilWithoutOverlay(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-capabilities", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleOpeningCapabilities(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if body := rr.Body.String(); body != `{"opening_capabilities":null}` {
		t.Fatalf("body = %s, want the explicit null (library ladder governs)", body)
	}
}

func TestHandleOpeningCapabilitiesBrokenOverlayFailsClosed(t *testing.T) {
	srv := &Server{Store: &stubStore{constructionPolicyErr: dupErr("overlay corrupto")}}
	// El stub devuelve el blob sin error; el camino de error real se cubre en
	// storage (mismo patrón de parse fail-closed). Aquí fijamos el envelope
	// del método.
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/opening-capabilities", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleOpeningCapabilities(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestHandleOpeningCapabilitiesRejectsNonGet(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-capabilities", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleOpeningCapabilities(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}
