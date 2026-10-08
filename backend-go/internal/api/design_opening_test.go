package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1137 — the design opening endpoints: PUT validates the intent as NEW
// authoring (capabilities + catalog) and persists surgically; GET rebuilds
// the authoritative state (intent + read-only resolution). An invalid
// selection never touches the persisted one.

func openingDesignStub() *stubStore {
	return &stubStore{
		openingCapabilities: &domain.OpeningCapabilities{
			Version: 1,
			Grips: map[string]domain.OpeningGripCapability{
				domain.OpeningGripSystemHandle: {Enabled: true, Default: true},
				domain.OpeningGripSystemGola:   {Enabled: true, Profiles: []string{"profile.gola-l.alu"}},
			},
		},
		openingProfiles: []domain.OpeningProfile{{
			ID: "profile.gola-l.alu", CompatiblePlacements: []string{"top"},
			DatasheetStatus: "verified", FrontReductionMm: openingTestIntPtr(66), GripClearanceMm: openingTestIntPtr(4),
		}},
	}
}

func designWCWithDims(itemParameters map[string]any) *domain.DesignWorkingCopy {
	wc := &domain.DesignWorkingCopy{
		DesignID:   "d1137000-0000-0000-0000-000000000001",
		ProjectID:  "proj-1",
		SourceType: domain.DesignRevisionSourceManual,
		UpdatedAt:  time.Now(),
	}
	if itemParameters != nil {
		wc.Items = []domain.DesignWorkingItem{{
			ID:                  "witem-1",
			FurnitureInstanceID: "fi-1",
			Parameters:          itemParameters,
		}}
	}
	return wc
}

func openingRequest(t *testing.T, srv *Server, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("GET /api/designs/{designId}/opening", http.HandlerFunc(srv.HandleDesignOpening))
	mux.Handle("PUT /api/designs/{designId}/opening", http.HandlerFunc(srv.HandleDesignOpening))
	req := withClaims(httptest.NewRequest(method, "/api/designs/d1137000-0000-0000-0000-000000000001/opening", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestHandleDesignOpeningPutPersistsValidSelection(t *testing.T) {
	store := openingDesignStub()
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{
		"d1137000-0000-0000-0000-000000000001": *designWCWithDims(map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}),
	}
	srv := &Server{Store: store}

	rr := openingRequest(t, srv, http.MethodPut, `{"system":"gola","profileId":"profile.gola-l.alu","placements":["top"]}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	if store.setOpeningCmd == nil || store.setOpeningCmd.Opening == nil ||
		store.setOpeningCmd.Opening.System != "gola" || store.setOpeningCmd.Opening.ProfileID != "profile.gola-l.alu" {
		t.Fatalf("the surgical write never received the selection: %+v", store.setOpeningCmd)
	}
	var got struct {
		Opening *struct {
			System string `json:"system"`
		} `json:"opening"`
		Resolution *struct {
			State  string `json:"state"`
			Fronts []struct {
				HeightMm int `json:"heightMm"`
			} `json:"fronts"`
		} `json:"resolution"`
		DimsKnown bool `json:"dimsKnown"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Opening == nil || got.Opening.System != "gola" {
		t.Fatalf("expected the persisted opening, got %s", rr.Body.String())
	}
	if !got.DimsKnown || got.Resolution == nil || got.Resolution.State != "resolved" || len(got.Resolution.Fronts) != 1 {
		t.Fatalf("expected the resolved front, got %s", rr.Body.String())
	}
	// 720 − 70 = 650: the read-only front the Inspector renders.
	if got.Resolution.Fronts[0].HeightMm != 650 {
		t.Fatalf("front height = %d, want 650", got.Resolution.Fronts[0].HeightMm)
	}
}

func TestHandleDesignOpeningPutRejectsInvalidAndKeepsPersisted(t *testing.T) {
	store := openingDesignStub()
	// The gola capability is DISABLED today: the selection is unavailable
	// for new authoring.
	store.openingCapabilities.Grips[domain.OpeningGripSystemGola] = domain.OpeningGripCapability{Enabled: false}
	existing := designWCWithDims(map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0})
	handle := domain.DesignOpeningSelection{System: "handle"}
	existing.AuthoringDefaults.Opening = &handle
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{"d1137000-0000-0000-0000-000000000001": *existing}
	srv := &Server{Store: store}

	rr := openingRequest(t, srv, http.MethodPut, `{"system":"gola","profileId":"profile.gola-l.alu"}`)

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
	if got.Code != "INVALID_OPENING_CONFIGURATION" || got.Details.Reason != "OPENING_SYSTEM_UNAVAILABLE" {
		t.Fatalf("unexpected rejection: %s", rr.Body.String())
	}
	// The previously persisted selection stays untouched.
	if store.setOpeningCmd != nil {
		t.Fatal("an invalid selection must never reach the storage write")
	}
	readback := openingRequest(t, srv, http.MethodGet, "")
	if readback.Code != http.StatusOK || !strings.Contains(readback.Body.String(), `"system":"handle"`) {
		t.Fatalf("the persisted selection must survive: %s", readback.Body.String())
	}
}

func TestHandleDesignOpeningGetRebuildsFromAuthoritativeState(t *testing.T) {
	store := openingDesignStub()
	existing := designWCWithDims(map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0})
	gola := domain.DesignOpeningSelection{System: "gola", ProfileID: "profile.gola-l.alu", Placements: []string{"top"}}
	existing.AuthoringDefaults.Opening = &gola
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{"d1137000-0000-0000-0000-000000000001": *existing}
	srv := &Server{Store: store}

	rr := openingRequest(t, srv, http.MethodGet, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	// Reopening the Inspector rebuilds the intent AND its read-only
	// resolution from the server — never from client memory.
	if !strings.Contains(rr.Body.String(), `"profileId":"profile.gola-l.alu"`) ||
		!strings.Contains(rr.Body.String(), `"state":"resolved"`) {
		t.Fatalf("authoritative rebuild drifted: %s", rr.Body.String())
	}
}

func TestHandleDesignOpeningWithoutDimsIsTruthful(t *testing.T) {
	store := openingDesignStub()
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{
		"d1137000-0000-0000-0000-000000000001": *designWCWithDims(nil),
	}
	srv := &Server{Store: store}

	rr := openingRequest(t, srv, http.MethodGet, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	var got struct {
		Opening    *json.RawMessage `json:"opening"`
		Resolution *json.RawMessage `json:"resolution"`
		DimsKnown  bool             `json:"dimsKnown"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.DimsKnown || got.Resolution != nil {
		t.Fatalf("no explicit dims must surface as the truthful absence: %s", rr.Body.String())
	}
}

func TestHandleDesignOpeningRejectsBadShape(t *testing.T) {
	srv := &Server{Store: openingDesignStub()}

	rr := openingRequest(t, srv, http.MethodPut, `{"system":"tirador","profileId":""}`)
	if rr.Code != http.StatusUnprocessableEntity || !strings.Contains(rr.Body.String(), "INVALID_OPENING_CONFIGURATION") {
		t.Fatalf("unknown system must fail closed: %s", rr.Body.String())
	}

	rr = openingRequest(t, srv, http.MethodPut, `{"system":"handle","profileId":"profile.gola-l.alu"}`)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a profile outside gola must fail closed: %s", rr.Body.String())
	}
}

func TestHandleDesignOpeningRejectsNonDesignMethods(t *testing.T) {
	srv := &Server{Store: openingDesignStub()}
	mux := http.NewServeMux()
	mux.Handle("/api/designs/{designId}/opening", http.HandlerFunc(srv.HandleDesignOpening))
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/designs/d1137000-0000-0000-0000-000000000001/opening", nil), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func openingTestIntPtr(v int) *int { return &v }
