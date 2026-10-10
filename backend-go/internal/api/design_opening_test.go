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
	spacing := 400
	return &stubStore{
		openingCapabilities: &domain.OpeningCapabilities{
			Version: 1,
			Grips: map[string]domain.OpeningGripCapability{
				domain.OpeningGripSystemHandle: {Enabled: true, Default: true},
				domain.OpeningGripSystemGola:   {Enabled: true, Profiles: []string{"profile.gola-l.alu"}},
			},
		},
		openingProfiles: []domain.OpeningProfile{{
			ID: "profile.gola-l.alu", Code: "GOLA-L-ALU", CompatiblePlacements: []string{"top"},
			DatasheetStatus: "verified", FrontReductionMm: openingTestIntPtr(66), GripClearanceMm: openingTestIntPtr(4),
			Version: 7,
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: "HW-8006", Rule: "interior_width", Unit: "meter"},
				"supports": {HardwareID: "HW-SU116", Rule: "per_length", SpacingMm: &spacing},
				"endCaps":  {HardwareID: "HW-CF8006TP", Rule: "per_exposed_end"},
			},
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
	// #1263: the pin freezes the BOM slice too — revision + declared members —
	// so the historical quote resolves the same physical truth.
	if pin := store.setOpeningCmd.Opening.ProfilePin; pin == nil || pin.BOM == nil ||
		pin.BOM.ProfileVersion != 7 || len(pin.BOM.Members) != 3 ||
		pin.BOM.Members["supports"].HardwareID != "HW-SU116" || pin.BOM.Members["supports"].SpacingMm == nil {
		t.Fatalf("the pin must freeze the BOM slice: %+v", pin)
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
	// The concurrency token rides the answer: the card's next PUT carries it
	// back so a concurrent authoring write is a visible conflict.
	var full struct {
		WorkingVersion string `json:"workingVersion"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &full); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if full.WorkingVersion == "" {
		t.Fatal("the answer must carry the working copy's version token")
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

// B2 (review): a persisted selection resolves against its PIN, not the live
// catalog — a datasheet update never silently changes a design's fronts.
func TestHandleDesignOpeningPinSurvivesCatalogChange(t *testing.T) {
	store := openingDesignStub()
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{
		"d1137000-0000-0000-0000-000000000001": *designWCWithDims(map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}),
	}
	srv := &Server{Store: store}

	rr := openingRequest(t, srv, http.MethodPut, `{"system":"gola","profileId":"profile.gola-l.alu","placements":["top"]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"profilePin"`) || !strings.Contains(rr.Body.String(), `"profileCode"`) {
		t.Fatalf("the PUT answer must carry the captured pin: %s", rr.Body.String())
	}

	// The org updates the datasheet AFTER the selection was saved.
	for i := range store.openingProfiles {
		if store.openingProfiles[i].ID == "profile.gola-l.alu" {
			store.openingProfiles[i].FrontReductionMm = openingTestIntPtr(80)
			store.openingProfiles[i].GripClearanceMm = openingTestIntPtr(10)
		}
	}

	rr2 := openingRequest(t, srv, http.MethodGet, "")
	if rr2.Code != http.StatusOK {
		t.Fatalf("GET status = %d", rr2.Code)
	}
	// 720 − (66+4) = 650 from the PIN; the live 80+10 must NOT leak in.
	if !strings.Contains(rr2.Body.String(), `"heightMm":650`) {
		t.Fatalf("the historical resolution must consume the pin, not the live catalog: %s", rr2.Body.String())
	}
	if strings.Contains(rr2.Body.String(), `"heightMm":630`) {
		t.Fatal("the updated datasheet leaked into the persisted design")
	}
}

// B3 (review): `between` is geometrically meaningless in v1's single-zone
// layout — rejected at the write boundary, blocked (never reinterpreted)
// if a pre-fix row carries it.
func TestHandleDesignOpeningRejectsBetweenPlacement(t *testing.T) {
	srv := &Server{Store: openingDesignStub()}

	rr := openingRequest(t, srv, http.MethodPut, `{"system":"gola","profileId":"profile.gola-l.alu","placements":["between"]}`)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusUnprocessableEntity, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Entre frentes") {
		t.Fatalf("the rejection must name the v1 limitation: %s", rr.Body.String())
	}
}

// #1263 — the resolution payload carries the BOM lines when the body context
// derives (structure lateral panels), and reports the truthful absence when
// it cannot — the endpoint never invents a run length.
func TestHandleDesignOpeningResolvesBOM(t *testing.T) {
	spacing := 400
	newSelection := func() *domain.DesignOpeningSelection {
		return &domain.DesignOpeningSelection{
			System: "gola", ProfileID: "profile.gola-l.alu",
			ProfilePin: &domain.DesignOpeningProfilePin{
				ProfileCode: "GOLA-L-ALU", FrontReductionMm: 66, GripClearanceMm: 4, DatasheetStatus: "verified",
				BOM: &domain.DesignOpeningProfilePinBOM{ProfileVersion: 7, Members: map[string]domain.OpeningBOMMember{
					"profile":  {HardwareID: "HW-8006", Rule: "interior_width", Unit: "meter"},
					"supports": {HardwareID: "HW-SU116", Rule: "per_length", SpacingMm: &spacing},
					"endCaps":  {HardwareID: "HW-CF8006TP", Rule: "per_exposed_end"},
				}},
			},
		}
	}

	// Body context: module → structure with 18mm lateral panels ⇒ interior
	// 600 − 2×18 = 564.
	store := openingDesignStub()
	store.catalogOverride = &domain.Catalog{
		Modules:    []domain.Module{{ID: "mod-base", StructureID: "struct-base"}},
		Structures: []domain.Structure{{ID: "struct-base", Components: []domain.ComponentInstance{{ComponentID: "comp-side", Quantity: 2}}}},
		Components: []domain.Component{{ID: "comp-side", ThicknessMm: 18, Construction: &domain.ComponentConstruction{ConstructiveRole: "lateral"}}},
	}
	wc := designWCWithDims(map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0})
	wc.Items[0].FurnitureDefinitionID = "mod-base"
	wc.AuthoringDefaults.Opening = newSelection()
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{"d1137000-0000-0000-0-000000000001": *wc}
	_ = store.designWorkingCopiesByID
	delete(store.designWorkingCopiesByID, "d1137000-0000-0000-0-000000000001")
	store.designWorkingCopiesByID["d1137000-0000-0000-0000-000000000001"] = *wc
	srv := &Server{Store: store}

	rr := openingRequest(t, srv, http.MethodGet, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	var got struct {
		Resolution *struct {
			State string `json:"state"`
			BOM   []struct {
				MemberKey   string  `json:"memberKey"`
				Quantity    float64 `json:"quantity"`
				Unit        string  `json:"unit"`
				CutLengthMm int     `json:"cutLengthMm"`
			} `json:"bom"`
			BOMReason string `json:"bomReason"`
			BOMEnds   *struct {
				LeftEnd  string `json:"leftEnd"`
				RightEnd string `json:"rightEnd"`
			} `json:"bomEnds"`
		} `json:"resolution"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, rr.Body.String())
	}
	if got.Resolution == nil || got.Resolution.State != "resolved" || len(got.Resolution.BOM) != 3 || got.Resolution.BOMReason != "" {
		t.Fatalf("expected the three BOM lines, got %s", rr.Body.String())
	}
	byMember := map[string]struct {
		MemberKey   string  `json:"memberKey"`
		Quantity    float64 `json:"quantity"`
		Unit        string  `json:"unit"`
		CutLengthMm int     `json:"cutLengthMm"`
	}{}
	for _, line := range got.Resolution.BOM {
		byMember[line.MemberKey] = line
	}
	if line := byMember["profile"]; line.Quantity != 0.564 || line.CutLengthMm != 564 || line.Unit != "meter" {
		t.Fatalf("profile run drifted: %+v", line)
	}
	if line := byMember["supports"]; line.Quantity != 3 || line.Unit != "piece" {
		t.Fatalf("supports drifted: %+v", line)
	}
	if line := byMember["endCaps"]; line.Quantity != 2 {
		t.Fatalf("end caps drifted: %+v", line)
	}
	if got.Resolution.BOMEnds == nil || got.Resolution.BOMEnds.LeftEnd != "exposed" || got.Resolution.BOMEnds.RightEnd != "exposed" {
		t.Fatalf("ends must ride visibly: %s", rr.Body.String())
	}

	// No structure context: the truthful absence, never a guessed run.
	bare := openingDesignStub()
	bareWC := designWCWithDims(map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0})
	bareWC.AuthoringDefaults.Opening = newSelection()
	bare.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{"d1137000-0000-0000-0000-000000000001": *bareWC}
	rr = openingRequest(t, &Server{Store: bare}, http.MethodGet, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", rr.Code, rr.Body.String())
	}
	var bareGot struct {
		Resolution *struct {
			BOM       []json.RawMessage `json:"bom"`
			BOMReason string            `json:"bomReason"`
		} `json:"resolution"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &bareGot); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if bareGot.Resolution == nil || bareGot.Resolution.BOM != nil || bareGot.Resolution.BOMReason != "OPENING_BOM_BODY_CONTEXT_MISSING" {
		t.Fatalf("expected the truthful absence, got %s", rr.Body.String())
	}
}
