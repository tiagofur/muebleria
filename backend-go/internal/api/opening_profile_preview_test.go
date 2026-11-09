package api

// #1534 — the gola profile editor's live preview endpoint: in-flight fields
// in, resolved datasheet sentences out; nothing saved, no catalog join.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func openingPreviewRequest(t *testing.T, srv *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("POST /api/catalog/opening-profiles/preview", http.HandlerFunc(srv.HandleOpeningProfilePreview))
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/opening-profiles/preview", strings.NewReader(body)), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestOpeningProfilePreviewResolvesSentencesServerSide(t *testing.T) {
	srv := &Server{Store: nil}
	rr := openingPreviewRequest(t, srv, `{"heightMm":720,"positions":["top"],"frontDiscountTopMm":40}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Mueble de 720: una puerta = 680") {
		t.Fatalf("preview drifted: %s", rr.Body.String())
	}

	// Italian both positions: una puerta 684 + dos frentes 324 y 324.
	rr = openingPreviewRequest(t, srv, `{"heightMm":720,"positions":["top","between"],"frontDiscountTopMm":36,"frontDiscountBetweenMm":36}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "una puerta = 684") || !strings.Contains(rr.Body.String(), "324") {
		t.Fatalf("italian preview drifted: %s", rr.Body.String())
	}
}

func TestOpeningProfilePreviewHonestMissingLine(t *testing.T) {
	srv := &Server{Store: nil}
	// Top declared without its discount: that line reports the missing piece
	// and the between line still resolves (disponible ≠ válido).
	rr := openingPreviewRequest(t, srv, `{"heightMm":720,"positions":["top","between"],"frontDiscountBetweenMm":36}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "falta el descuento superior") || !strings.Contains(rr.Body.String(), "340.5") {
		t.Fatalf("missing-discount lines drifted: %s", rr.Body.String())
	}
}

func TestOpeningProfilePreviewRejectsInvalidInput(t *testing.T) {
	srv := &Server{Store: nil}
	rr := openingPreviewRequest(t, srv, `{"heightMm":0,"positions":["top"]}`)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("height 0 must 422, got %d", rr.Code)
	}
	rr = openingPreviewRequest(t, srv, `{"heightMm":720,"positions":[]}`)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("no positions must 422, got %d", rr.Code)
	}
}
