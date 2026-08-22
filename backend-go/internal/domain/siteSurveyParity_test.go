package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var surveyParityRoles = []UserRole{
	RoleAdmin, RoleUser, RoleVendedor, RoleGerenteVentas,
	RoleGerenteProduccion, RoleIngeniero, RoleProduccion, RoleAlmacen,
}

// TestSiteSurveyFixtureParity validates parity with
// contracts/siteSurvey.json (OC-040/OC-041, issue #305).
func TestSiteSurveyFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "siteSurvey.json"))
	if err != nil {
		t.Fatalf("read contracts/siteSurvey.json: %v", err)
	}
	var fixture struct {
		MeasureIntents         []string `json:"measureIntents"`
		RejectedMeasureIntents []string `json:"rejectedMeasureIntents"`
		SurveyElementKinds     []string `json:"surveyElementKinds"`
		RejectedElementKinds   []string `json:"rejectedSurveyElementKinds"`
		FabricationGate        struct {
			BlockingSpaceIntents   []string `json:"blockingSpaceIntents"`
			RequiresSurveyVerified bool     `json:"requiresSurveyVerified"`
		} `json:"fabricationGate"`
		EventTypes []string            `json:"eventTypes"`
		EventRoles map[string][]string `json:"eventRoles"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/siteSurvey.json: %v", err)
	}

	assertFixtureSetParity(t, "measureIntents", fixture.MeasureIntents, measureIntents, IsValidMeasureIntent)
	assertFixtureSetParity(t, "surveyElementKinds", fixture.SurveyElementKinds, surveyElementKinds, IsValidSurveyElementKind)

	for _, rejected := range fixture.RejectedMeasureIntents {
		if IsValidMeasureIntent(rejected) {
			t.Errorf("fixture rejected measureIntent %q must be invalid in Go", rejected)
		}
	}
	for _, rejected := range fixture.RejectedElementKinds {
		if IsValidSurveyElementKind(rejected) {
			t.Errorf("fixture rejected surveyElementKind %q must be invalid in Go", rejected)
		}
	}

	// OC-041 hard gate: a verified survey with a blocking-intent space must
	// surface a space blocker; a fully approved survey must pass.
	blocking := map[string]bool{}
	for _, intent := range fixture.FabricationGate.BlockingSpaceIntents {
		blocking[intent] = true
	}
	for _, intent := range fixture.MeasureIntents {
		hasBlocker := verifiedSurveyWithIntent(t, intent)
		if hasBlocker != blocking[intent] {
			t.Errorf("fixture blocking intent parity failed for %q (blocker=%v, fixture says blocking=%v)",
				intent, hasBlocker, blocking[intent])
		}
	}
	if fixture.FabricationGate.RequiresSurveyVerified {
		unverified := &SiteSurvey{
			ID: "svy_1", ProjectID: "p1", Revision: 1,
			Spaces: []SurveySpace{{ID: "spc_1", Name: "Cocina", Intent: MeasureIntentApproved}},
		}
		if IsSurveyApprovedForFabrication(unverified) {
			t.Error("unverified survey must not pass the gate even with all spaces approved")
		}
		verifiedAt := time.Now().UTC()
		verified := *unverified
		verified.VerifiedAt = &verifiedAt
		verified.VerifiedByUserID = "ing-1"
		if !IsSurveyApprovedForFabrication(&verified) {
			t.Error("approved + verified survey must pass the gate")
		}
	}

	for _, eventType := range fixture.EventTypes {
		if !IsValidProjectEventType(eventType) {
			t.Errorf("fixture eventType %q missing from the Go canonical vocabulary", eventType)
		}
	}
	for eventType, allowedRoles := range fixture.EventRoles {
		for _, role := range surveyParityRoles {
			want := false
			for _, allowed := range allowedRoles {
				if allowed == string(role) {
					want = true
					break
				}
			}
			if RoleCanAppendProjectEvent(role, eventType) != want {
				t.Errorf("event role parity failed for %s/%s", eventType, role)
			}
		}
	}
}

// verifiedSurveyWithIntent builds a verified survey with one space carrying
// the intent and reports whether the fabrication gate blocks it.
func verifiedSurveyWithIntent(t *testing.T, intent string) bool {
	t.Helper()
	verifiedAt := time.Now().UTC()
	survey := &SiteSurvey{
		ID: "svy_1", ProjectID: "p1", Revision: 1,
		Spaces: []SurveySpace{{ID: "spc_1", Name: "Cocina", Intent: MeasureIntent(intent)}},
		VerifiedAt: &verifiedAt, VerifiedByUserID: "ing-1",
	}
	for _, b := range SurveyFabricationBlockers(survey) {
		if b.Kind == SurveyBlockerPreliminarySpace || b.Kind == SurveyBlockerFieldUnapproved {
			return true
		}
	}
	return false
}

// TestSiteSurveyLifecycleMirror walks the canonical OC-041 flow mirroring the
// TS tests: preliminary space → capture → verify → approve → freeze, with the
// hard rejections in between.
func TestSiteSurveyLifecycleMirror(t *testing.T) {
	survey := &SiteSurvey{ID: "svy_1", ProjectID: "p1", Revision: 1, CreatedAt: time.Now().UTC()}

	next, err := UpsertSurveySpace(survey, SurveySpaceInput{Name: "  Cocina "})
	if err != nil {
		t.Fatalf("upsert space: %v", err)
	}
	if next.Spaces[0].Intent != MeasureIntentPreliminary {
		t.Fatalf("new space must start as preliminary, got %s", next.Spaces[0].Intent)
	}
	spaceID := next.Spaces[0].ID

	// OC-041: a preliminary space can never be approved directly.
	if _, _, err := ApproveSpaceMeasures(next, spaceID, "ing-1", time.Now().UTC()); err == nil {
		t.Fatal("approving a preliminary space must fail")
	}
	// Verify without captured spaces must fail.
	if _, err := VerifySiteSurvey(next, "ing-1", time.Now().UTC()); err == nil {
		t.Fatal("verifying a survey without captured spaces must fail")
	}

	depth := 600.0
	captured, spaceName, err := CaptureSpaceMeasures(next, spaceID, SpaceMeasures{WidthMm: 3200, HeightMm: 2600, DepthMm: &depth}, "vend-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if spaceName != "Cocina" {
		t.Fatalf("capture must report the space name, got %q", spaceName)
	}
	if captured.Revision != 2 {
		t.Fatalf("capture must bump the revision, got %d", captured.Revision)
	}
	if captured.Spaces[0].PreliminaryMeasures != nil {
		t.Fatal("first capture has no prior measures to preserve")
	}

	verified, err := VerifySiteSurvey(captured, "ing-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("verify: %v", err)
	}

	approved, _, err := ApproveSpaceMeasures(verified, spaceID, "ing-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	if _, err := FreezeMeasuresForFabrication(captured, "ing-1", time.Now().UTC()); err == nil {
		t.Fatal("freezing without approval/verification must fail")
	}
	frozen, err := FreezeMeasuresForFabrication(approved, "ing-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("freeze: %v", err)
	}
	if frozen.Spaces[0].Intent != MeasureIntentFabrication {
		t.Fatalf("frozen space must be fabrication, got %s", frozen.Spaces[0].Intent)
	}
	if err := ValidateSiteSurveyShape(frozen); err != nil {
		t.Fatalf("frozen survey must be shape-valid: %v", err)
	}
	if _, err := RemoveSurveySpace(frozen, spaceID); err == nil {
		t.Fatal("removing a fabrication-frozen space must fail")
	}
}
