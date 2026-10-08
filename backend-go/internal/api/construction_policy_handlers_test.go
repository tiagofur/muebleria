package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1218 — the construction-policy catalog read: the web previews must see
// the SAME factory hinge bands the server quotes with (nil = library ladder;
// a broken overlay fails closed, never a silent default preview).

func TestHandleConstructionPolicyReturnsOverlayPolicy(t *testing.T) {
	surge := 650.0
	srv := &Server{Store: &stubStore{
		constructionPolicy: &engine.FactoryConstructionPolicy{
			DoorHingeDemand: &domain.HingeDemandPolicy{
				OptionRole:       "BISAGRA",
				Bands:            []domain.HingeDemandBand{{UpToHeightMm: 1200, Hinges: 2}, {UpToHeightMm: 2400, Hinges: 6}},
				WidthSurgeOverMm: &surge,
			},
		},
	}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/construction-policy", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleConstructionPolicy(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var got struct {
		ConstructionPolicy *struct {
			DoorHingeDemand *struct {
				OptionRole string `json:"optionRole"`
				Bands      []struct {
					UpToHeightMm float64 `json:"upToHeightMm"`
					Hinges       int     `json:"hinges"`
				} `json:"bands"`
			} `json:"doorHingeDemand"`
		} `json:"construction_policy"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ConstructionPolicy == nil || got.ConstructionPolicy.DoorHingeDemand == nil {
		t.Fatalf("expected the parsed overlay policy, got %s", rr.Body.String())
	}
	if got.ConstructionPolicy.DoorHingeDemand.OptionRole != "BISAGRA" || len(got.ConstructionPolicy.DoorHingeDemand.Bands) != 2 {
		t.Fatalf("unexpected policy payload: %s", rr.Body.String())
	}
}

func TestHandleConstructionPolicyNilWithoutOverlay(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/construction-policy", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleConstructionPolicy(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if body := rr.Body.String(); body != `{"construction_policy":null}` {
		t.Fatalf("body = %s, want the explicit null (library ladder governs)", body)
	}
}

func TestHandleConstructionPolicyBrokenOverlayFailsClosed(t *testing.T) {
	srv := &Server{Store: &stubStore{constructionPolicyErr: dupErr("overlay corrupto")}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/construction-policy", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleConstructionPolicy(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d — a broken overlay must fail closed, never default silently", rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleConstructionPolicyRejectsNonGet(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/construction-policy", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleConstructionPolicy(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}
