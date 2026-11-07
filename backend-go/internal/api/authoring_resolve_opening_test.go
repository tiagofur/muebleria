package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1264 / V2 OPEN-FRONT — the authoring resolve with a designId: the design's
// persisted opening constrains the door boards of ITS first module, a blocked
// opening fails closed (never a degraded layout), and any other furniture of
// the same design never borrows the opening.

// openingAuthoringServer builds the authoring stub with the store exposed so
// opening state (working copy, profiles, overhang rule) can be seeded.
func openingAuthoringServer(t *testing.T) (*Server, string, *stubStore) {
	t.Helper()
	module, catalog := authoringAPICabinetFixture()
	u := &domain.User{ID: "u1", AccountStatus: domain.AccountStatusActive}
	server := licenseTestServer(t, u, nil)
	fullCatalog := catalog
	fullCatalog.Modules = []domain.Module{*module}
	store := &stubStore{
		getUserByEmail:     u,
		moduleReturnedByID: module,
		catalogOverride:    &fullCatalog,
		listModules:        []domain.Module{*module},
		listStructures:     catalog.Structures,
		listComponents:     catalog.Components,
		listAgregados:      catalog.Agregados,
		listHardwares:      catalog.Hardware,
	}
	server.Store = store
	token, err := auth.GenerateLegacyWebToken(u.ID, "u@example.com", auth.TokenContext{
		Roles: []string{"user"}, OrgID: "org-1", MembershipID: u.ID + ":org-1",
		MembershipCredentialVersion: 1, OrganizationCredentialVersion: 1,
	}, furnitureTestSecret)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return server, token, store
}

// openingDesignWC seeds a working copy for the fixture module with a gola
// selection whose pin carries the Cymisa-8006 datasheet slice (reduction 38 +
// clearance 2 = the ficha's H−40) or a pending datasheet when verified=false.
func openingDesignWC(designID string, verified bool) domain.DesignWorkingCopy {
	status := "verified"
	if !verified {
		status = "pending"
	}
	return domain.DesignWorkingCopy{
		DesignID:   designID,
		ProjectID:  "proj-1",
		SourceType: domain.DesignRevisionSourceManual,
		Items: []domain.DesignWorkingItem{{
			ID:                    "witem-1",
			FurnitureInstanceID:   "fi-1",
			FurnitureDefinitionID: authoringFixtureModuleID,
			Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
		}},
		AuthoringDefaults: domain.DesignAuthoringDefaults{
			Opening: &domain.DesignOpeningSelection{
				System: "gola", ProfileID: "profile.gola-l.alu", Placements: []string{"top"},
				ProfilePin: &domain.DesignOpeningProfilePin{
					ProfileCode: "8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: status,
				},
			},
		},
	}
}

func openingResolvedDoor(t *testing.T, rec *httptest.ResponseRecorder) (int, [3]float64) {
	t.Helper()
	var response struct {
		Status   string `json:"status"`
		Resolved *struct {
			Layout struct {
				Components []struct {
					SlotID    string `json:"slotId"`
					LengthMm  int    `json:"lengthMm"`
					Transform struct {
						TranslationMm [3]float64 `json:"translationMm"`
					} `json:"transform"`
				} `json:"components"`
			} `json:"layout"`
		} `json:"resolved"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode resolve: %v (%s)", err, rec.Body.String())
	}
	if response.Status != "accepted" || response.Resolved == nil {
		t.Fatalf("expected accepted resolve: %s", rec.Body.String())
	}
	for _, component := range response.Resolved.Layout.Components {
		if component.SlotID == "puerta" {
			return component.LengthMm, component.Transform.TranslationMm
		}
	}
	t.Fatalf("missing puerta in resolve: %s", rec.Body.String())
	return 0, [3]float64{}
}

// openingGripState builds the facade state the v2 resolve consumes (#1532):
// the frozen gola recipe of the fixture, with the workshop discount and the
// declared members the layout places.
func openingGripState(doorDiscount int, heightMm, depthMm float64, members map[string]domain.OpeningBOMMember) *storage.DesignOpeningFacadeState {
	discount := doorDiscount
	frozen := &domain.FrozenGripProfile{
		ProfileID: "profile.gola-l.alu", Code: "GOLA-L-ALU",
		Material: "aluminum", Positions: []string{"top"},
		ProfileHeightMm: &heightMm, ProfileDepthMm: &depthMm,
		FrontDiscountTopMm:   &discount,
		CompatiblePlacements: []string{"top"},
		BOMVersion:           1,
		BOMMembers:           members,
	}
	recipe := domain.GripSnapshotRecipe{Mode: "gola", TopProfile: frozen}
	recipes := map[string]domain.GripSnapshotRecipe{"inferior": recipe, "superior": recipe, "alto": recipe}
	return &storage.DesignOpeningFacadeState{
		ProjectID: "proj-1", InstanceID: "fi-1", FurnitureType: "inferior",
		Snapshot: &domain.GripSnapshot{Recipes: recipes, FrozenAt: time.Now().UTC()},
	}
}

func TestAuthoringResolveDesignOpeningConstrainsFronts(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000001"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}
	// The project's frozen grip (discount 40) governs the resolve.
	store.designGripFacadeState = openingGripState(40, 56.5, 27.2, nil)

	// WITHOUT the designId: the historical layout (door 716 = PH−4).
	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("baseline status = %d body=%s", rec.Code, rec.Body.String())
	}
	if length, _ := openingResolvedDoor(t, rec); length != 716 {
		t.Fatalf("baseline door length = %d, want 716", length)
	}

	// WITH the designId: the frozen discount (40) constrains the door from
	// the top under A3 — 720−40 = 680, bottom edge intact.
	rec = postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("designId status = %d body=%s", rec.Code, rec.Body.String())
	}
	length, translation := openingResolvedDoor(t, rec)
	if length != 680 {
		t.Fatalf("opened door length = %d, want 680 (720 − 40 under A3)", length)
	}
	if translation[2] != 2 {
		t.Fatalf("opened door bottom edge must stay at z=2, got %v", translation)
	}
}

// The FROZEN discount governs the AUTHORING resolve (the path the plugin's
// insert/sync consumes): 720 − 30 = 690 — one number, never a pair.
func TestAuthoringResolveDesignOpeningFrozenDiscountGoverns(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1316000-0000-0000-0000-000000000031"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}
	store.designGripFacadeState = openingGripState(30, 56.5, 27.2, nil)

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	length, _ := openingResolvedDoor(t, rec)
	if length != 690 {
		t.Fatalf("door length = %d, want 690 (720 − 30 frozen discount)", length)
	}
}

// A grip whose frozen recipe cannot produce its grips (a gola without its
// top profile) rejects the resolve — a design that DECLARES a grip never
// renders a degraded layout.
func TestAuthoringResolveDesignOpeningFailsClosedWhenBlocked(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000002"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, false)}
	brokenRecipe := domain.GripSnapshotRecipe{Mode: "gola"}
	recipes := map[string]domain.GripSnapshotRecipe{"inferior": brokenRecipe, "superior": brokenRecipe, "alto": brokenRecipe}
	store.designGripFacadeState = &storage.DesignOpeningFacadeState{
		ProjectID: "proj-1", InstanceID: "fi-1", FurnitureType: "inferior",
		Snapshot: &domain.GripSnapshot{Recipes: recipes, FrozenAt: time.Now().UTC()},
	}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("blocked opening must reject, status = %d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		Status string `json:"status"`
		Issues []struct {
			Code string `json:"code"`
			Path string `json:"path"`
		} `json:"issues"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode rejection: %v", err)
	}
	if response.Status != "rejected" || len(response.Issues) == 0 ||
		response.Issues[0].Code != "GRIP_SNAPSHOT_INVALID" ||
		response.Issues[0].Path != "furniture.designId" {
		t.Fatalf("unexpected rejection: %s", rec.Body.String())
	}
}

// The opening belongs to the design's FIRST module: resolving any other
// furniture of the same design never borrows it.
// #1274: the pinned BOM members materialize as DERIVED hardware placements
// on the top panel — profile run centered on the useful span, supports
// spread by the ficha spacing, one cap per end — with the hardware SKP
// asset fields riding the placements.
func TestAuthoringResolveDesignOpeningPlacesPinnedMembers(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000004"
	spacing := 400
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}
	// #1283 / §13.2: the frozen profile carries the datasheet envelope (8006:
	// 56.5 tall × 27.2 deep) and the accessories' declared dims; the layout
	// places from these, never from engine constants.
	supportDims := [3]float64{17, 19.5, 39.5}
	capDims := [3]float64{3, 28.8, 58}
	store.designGripFacadeState = openingGripState(40, 56.5, 27.2, map[string]domain.OpeningBOMMember{
		"profile":  {HardwareID: "hw-gola-profile", Rule: "interior_width", Unit: "meter"},
		"supports": {HardwareID: "hw-gola-support", Rule: "per_length", SpacingMm: &spacing, DimensionsMm: &supportDims},
		"endCaps":  {HardwareID: "hw-gola-cap", Rule: "per_exposed_end", DimensionsMm: &capDims},
	})
	if store.catalogOverride != nil {
		shape := func(s string) *string { return &s }
		store.catalogOverride.Hardware = append(store.catalogOverride.Hardware,
			domain.Hardware{ID: "hw-gola-profile", Code: "8006", Name: "Perfil GOLA L", Active: true,
				PreviewShape: shape("rail"), VisualAsset: &domain.HardwareVisualAssetBinding{
					AssetID: "asset-profile", AssetRevisionID: "rev-profile",
				}},
			domain.Hardware{ID: "hw-gola-support", Code: "SU116", Name: "Soporte GOLA", Active: true, PreviewShape: shape("leg")},
			domain.Hardware{ID: "hw-gola-cap", Code: "CF8006TP", Name: "Tapas GOLA", Active: true, PreviewShape: shape("knob")},
		)
	}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("members resolve status = %d body=%s", rec.Code, rec.Body.String())
	}

	var response struct {
		Resolved *struct {
			Layout struct {
				Hardware []struct {
					HardwareID    string `json:"hardwareId"`
					PlacementKind string `json:"placementKind"`
					AssetID       string `json:"assetId"`
					Transform     struct {
						TranslationMm [3]float64 `json:"translationMm"`
					} `json:"transform"`
				} `json:"hardware"`
			} `json:"layout"`
		} `json:"resolved"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if response.Resolved == nil {
		t.Fatalf("no resolved payload: %s", rec.Body.String())
	}
	counts := map[string]int{}
	derivedAssets := 0
	for _, hw := range response.Resolved.Layout.Hardware {
		if hw.PlacementKind != "derived" {
			continue
		}
		counts[hw.HardwareID]++
		if hw.AssetID != "" {
			derivedAssets++
		}
	}
	// 600 interior: span 564 → supports ceil(564/400)+1 = 3; caps 2; run 1.
	if counts["hw-gola-profile"] != 1 || counts["hw-gola-support"] != 3 || counts["hw-gola-cap"] != 2 {
		t.Fatalf("derived member counts = %v", counts)
	}
	// #1296: every support origin (the bracket's bottom, at the L's corner)
	// centers the bracket on the profile's height — 720 − 56.5/2 − 39.5/2.
	for _, hw := range response.Resolved.Layout.Hardware {
		if hw.HardwareID == "hw-gola-support" {
			z := hw.Transform.TranslationMm[2]
			want := 720 - 56.5/2 - 39.5/2
			if diff := z - want; diff < -1e-9 || diff > 1e-9 {
				t.Fatalf("support Z = %v, want %v (bracket centered on the profile section)", z, want)
			}
		}
	}
	if derivedAssets == 0 {
		t.Fatalf("derived placements must carry the catalog asset fields")
	}
}

// is NOT the pilot item's still constrains its fronts at its own
// dimensions. The pilot-module scope of #1261 died on real multi-module
// designs (the constrained mueble depended on arbitrary item order).
func TestAuthoringResolveDesignOpeningAppliesToEveryDesignFurniture(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000003"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: func() domain.DesignWorkingCopy {
		wc := openingDesignWC(designID, true)
		wc.Items[0].FurnitureDefinitionID = "other-module-of-the-same-design"
		return wc
	}()}
	store.designGripFacadeState = openingGripState(40, 56.5, 27.2, nil)

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("scoped resolve status = %d body=%s", rec.Code, rec.Body.String())
	}
	length, translation := openingResolvedDoor(t, rec)
	if length != 680 {
		t.Fatalf("a non-pilot module of the design must constrain its door (720 − 40 under A3), got %d", length)
	}
	if translation[2] != 2 {
		t.Fatalf("constrained door bottom edge must stay at z=2, got %v", translation)
	}

	// The same furniture resolved at DIFFERENT dimensions constrains at its
	// own size (640 tall: 640 − 40 = 600 under A3) — the front region is
	// never borrowed from another module's dims.
	rec = postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 640.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("short resolve status = %d body=%s", rec.Code, rec.Body.String())
	}
	if length, _ := openingResolvedDoor(t, rec); length != 600 {
		t.Fatalf("short door must constrain at its own dims (640 − 40 under A3), got %d", length)
	}
}
