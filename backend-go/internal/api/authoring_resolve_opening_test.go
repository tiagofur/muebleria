package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
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

func TestAuthoringResolveDesignOpeningConstrainsFronts(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000001"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, true)}

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

	// WITH the designId: the gola's ficha consumption (38+2) constrains the
	// door from the top — 716−40 = 676, bottom edge intact.
	rec = postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("designId status = %d body=%s", rec.Code, rec.Body.String())
	}
	length, translation := openingResolvedDoor(t, rec)
	if length != 676 {
		t.Fatalf("opened door length = %d, want 676 (716 − 40)", length)
	}
	if translation[2] != 2 {
		t.Fatalf("opened door bottom edge must stay at z=2, got %v", translation)
	}
}

// A blocked opening (datasheet flipped pending) rejects the resolve — a
// design that DECLARES an opening never renders a degraded layout.
func TestAuthoringResolveDesignOpeningFailsClosedWhenBlocked(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000002"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: openingDesignWC(designID, false)}

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
		response.Issues[0].Code != "OPENING_PROFILE_DATASHEET_PENDING" ||
		response.Issues[0].Path != "furniture.designId" {
		t.Fatalf("unexpected rejection: %s", rec.Body.String())
	}
}

// The opening belongs to the design's FIRST module: resolving any other
// furniture of the same design never borrows it.
func TestAuthoringResolveDesignOpeningScopedToFirstModule(t *testing.T) {
	server, token, store := openingAuthoringServer(t)
	const designID = "d1264000-0000-0000-0000-000000000003"
	wc := openingDesignWC(designID, true)
	wc.Items[0].FurnitureDefinitionID = "other-module-of-the-same-design"
	store.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{designID: wc}

	rec := postAuthoringResolve(server, token, "", authoringFixtureRequest(authoringCatalogRevision(t, server), authoringResolveFurniture{
		FurnitureDefinitionID: authoringFixtureModuleID,
		DesignID:              designID,
		Parameters:            map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("scoped resolve status = %d body=%s", rec.Code, rec.Body.String())
	}
	if length, _ := openingResolvedDoor(t, rec); length != 716 {
		t.Fatalf("another module's furniture must keep the baseline door, got %d", length)
	}
}
