package api

// #1533 — the style editor's preview endpoint: the server joins the editor's
// profile IDs against the catalog (the #1530 use rule) and resolves the
// «Mueble de 720 → puerta de 680» sentences with the A3 contract.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func gripPreviewStub() *stubStore {
	store := openingDesignStub()
	for i := range store.openingProfiles {
		p := &store.openingProfiles[i]
		p.Active = true
		height, depth := 56.5, 27.2
		p.Material = domain.GolaMaterialAluminum
		p.Positions = []string{domain.GolaPositionTop, domain.GolaPositionBetween}
		p.FrontDiscountTopMm = openingTestIntPtr(40)
		p.FrontDiscountBetweenMm = openingTestIntPtr(36)
		p.ProfileHeightMm = &height
		p.ProfileDepthMm = &depth
	}
	return store
}

func gripPreviewRequest(t *testing.T, srv *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("POST /api/catalog/grip-styles/preview", http.HandlerFunc(srv.HandleGripStylePreview))
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/grip-styles/preview", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestGripStylePreviewResolvesSentencesServerSide(t *testing.T) {
	srv := &Server{Store: gripPreviewStub()}
	rr := gripPreviewRequest(t, srv, `{"heightMm":720,"byFurnitureType":{"inferior":{"mode":"gola","topProfileId":"profile.gola-l.alu","betweenProfileId":"profile.gola-l.alu"},"superior":{"mode":"handle"},"alto":{"mode":"bottom_overhang","overhangMm":20}}}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Mueble de 720 → puerta de 680") {
		t.Fatalf("top preview drifted: %s", rr.Body.String())
	}
	// (720 − 40 − 36)/2 = 322 per front, resolved by the A3 contract.
	if !strings.Contains(rr.Body.String(), "322") {
		t.Fatalf("between column preview drifted: %s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "El frente baja 20 mm por debajo del cuerpo") {
		t.Fatalf("rebase preview drifted: %s", rr.Body.String())
	}
}

func TestGripStylePreviewFailsClosedOnUnusableProfile(t *testing.T) {
	store := gripPreviewStub()
	// A profile that only declares the top position cannot serve as the
	// between profile: the use rule names it.
	for i := range store.openingProfiles {
		store.openingProfiles[i].Positions = []string{domain.GolaPositionTop}
	}
	srv := &Server{Store: store}
	rr := gripPreviewRequest(t, srv, `{"heightMm":720,"byFurnitureType":{"inferior":{"mode":"gola","topProfileId":"profile.gola-l.alu","betweenProfileId":"profile.gola-l.alu"}}}`)
	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "no se puede usar") {
		t.Fatalf("an unusable between profile must answer the use-rule message, got %d %s", rr.Code, rr.Body.String())
	}

	rr = gripPreviewRequest(t, srv, `{"heightMm":720,"byFurnitureType":{"inferior":{"mode":"gola","topProfileId":"perfil-fantasma"}}}`)
	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "no existe") {
		t.Fatalf("an unknown profile must fail closed, got %d %s", rr.Code, rr.Body.String())
	}
}
