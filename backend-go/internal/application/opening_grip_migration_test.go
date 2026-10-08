package application

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1136 — the grip migration service: four explicit categories, mapping
// declared (never inferred), fail-closed on stale mappings, dry-run by
// default, deactivation gated on references, modules NEVER rewritten.
type openingGripStubStore struct {
	hardwares       []domain.Hardware
	profiles        []domain.OpeningProfile
	overrides       []storage.OpeningGripOverrideHit
	createdProfiles []domain.OpeningProfile
	deactivated     []string
	failDeactivate  map[string]error
}

func (s *openingGripStubStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	return s.hardwares, nil
}

func (s *openingGripStubStore) ListOpeningProfiles(context.Context) ([]domain.OpeningProfile, error) {
	return s.profiles, nil
}

func (s *openingGripStubStore) CreateOpeningProfile(_ context.Context, profile *domain.OpeningProfile) error {
	if profile.DatasheetStatus != "pending" {
		return fmt.Errorf("un perfil migrado nace pendiente, nunca verificado")
	}
	s.createdProfiles = append(s.createdProfiles, *profile)
	s.profiles = append(s.profiles, *profile)
	return nil
}

func (s *openingGripStubStore) DeactivateHardware(_ context.Context, id string, _ int64) error {
	if s.failDeactivate != nil {
		if err := s.failDeactivate[id]; err != nil {
			return err
		}
	}
	s.deactivated = append(s.deactivated, id)
	return nil
}

func (s *openingGripStubStore) ScanModuleAgregadoOverrides(context.Context, string) ([]storage.OpeningGripOverrideHit, error) {
	return s.overrides, nil
}

func openingGripOrg() string { return "org-1" }

func TestMigrateOpeningGripsClassifiesAllFourCategories(t *testing.T) {
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{
			{ID: "hw-1", Code: "jaladera-gola-256", Active: true, Version: 1},
			{ID: "hw-2", Code: "JALADERA-GOLA-L", Active: true, Version: 1},
			{ID: "hw-3", Code: "jaladera-gola-vertical", Active: true, Version: 1},
			{ID: "hw-4", Code: "jaladera-gola-sin-mapeo", Active: true, Version: 1},
			{ID: "hw-5", Code: "HER-JAL-INOX", Active: true, Version: 1},
		},
		profiles: []domain.OpeningProfile{
			{ID: "op-existing", OrganizationID: "org-1", Code: "GOLA-L-ALU", GripType: "gola", CompatiblePlacements: []string{"top"}, DatasheetStatus: "pending", Active: true},
		},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-256", NewProfile: &OpeningGripNewProfile{Code: "GOLA-256", Name: "Gola 256", Placements: []string{"top"}}},
		{LegacyCode: "jaladera-gola-l", ProfileCode: "GOLA-L-ALU"},
		{LegacyCode: "jaladera-gola-vertical", Unsupported: true},
		// jaladera-gola-sin-mapeo intentionally unmapped → ambiguous.
	}

	report, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, true)
	if err != nil {
		t.Fatalf("migrate rejected: %v", err)
	}
	if report.Categories[OpeningGripMigrated] != 1 ||
		report.Categories[OpeningGripAlreadyCanonical] != 1 ||
		report.Categories[OpeningGripUnsupported] != 1 ||
		report.Categories[OpeningGripAmbiguous] != 1 {
		t.Fatalf("category counts drifted: %+v", report.Categories)
	}
	// The created profile is datasheet-pending with the declared placements.
	if len(store.createdProfiles) != 1 {
		t.Fatalf("created profiles = %d, want 1", len(store.createdProfiles))
	}
	created := store.createdProfiles[0]
	if created.GripType != "gola" || created.Code != "GOLA-256" || !created.Active {
		t.Fatalf("created profile drifted: %+v", created)
	}
	// Unreferenced mapped records leave the offering (already_canonical too);
	// the ambiguous and unsupported ones stay. Sorted by code:
	// JALADERA-GOLA-L first, then jaladera-gola-256.
	if len(store.deactivated) != 2 || store.deactivated[0] != "hw-2" || store.deactivated[1] != "hw-1" {
		t.Fatalf("deactivated = %v, want [hw-2 hw-1]", store.deactivated)
	}
	// Regular handles are never scanned.
	for _, record := range report.Records {
		if record.HardwareID == "hw-5" {
			t.Fatal("non-gola hardware must not be part of the migration")
		}
	}
}

func TestMigrateOpeningGripsDryRunWritesNothing(t *testing.T) {
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{
			{ID: "hw-1", Code: "jaladera-gola-256", Active: true, Version: 1},
		},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-256", NewProfile: &OpeningGripNewProfile{Code: "GOLA-256", Name: "Gola 256", Placements: []string{"top"}}},
	}

	report, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, false)
	if err != nil {
		t.Fatalf("dry-run rejected: %v", err)
	}
	if !report.DryRun {
		t.Fatal("report must carry the dry-run flag")
	}
	if len(store.createdProfiles) != 0 || len(store.deactivated) != 0 {
		t.Fatal("a dry run must not write anything")
	}
	if report.Categories[OpeningGripMigrated] != 1 {
		t.Fatalf("dry-run must still classify: %+v", report.Categories)
	}
}

func TestMigrateOpeningGripsReferencedOverridesStayForManualReview(t *testing.T) {
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{
			{ID: "hw-1", Code: "jaladera-gola-256", Active: true, Version: 1},
		},
		profiles: []domain.OpeningProfile{
			{ID: "op-256", OrganizationID: "org-1", Code: "GOLA-256", GripType: "gola", CompatiblePlacements: []string{"top"}, DatasheetStatus: "pending", Active: true},
		},
		overrides: []storage.OpeningGripOverrideHit{{
			ModuleID: "mod-1", ModuleCode: "MOD-BAJ", AgregadoID: "agr-1", OptionRole: "JALADERA", Value: "jaladera-gola-256",
		}},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-256", ProfileCode: "GOLA-256"},
	}

	report, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, true)
	if err != nil {
		t.Fatalf("migrate rejected: %v", err)
	}
	if report.Categories[OpeningGripAlreadyCanonical] != 1 {
		t.Fatalf("existing target must be already_canonical: %+v", report.Categories)
	}
	if len(report.ManualReview) != 1 || report.ManualReview[0].SuggestedProfileCode != "GOLA-256" {
		t.Fatalf("the override must be manual-review with a suggestion: %+v", report.ManualReview)
	}
	// A referenced option NEVER leaves the offering.
	if len(store.deactivated) != 0 {
		t.Fatalf("referenced hardware must stay active: %v", store.deactivated)
	}
}

func TestMigrateOpeningGripsFailsClosedOnStaleMapping(t *testing.T) {
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{{ID: "hw-1", Code: "jaladera-gola-256", Active: true, Version: 1}},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-256", ProfileCode: "GOLA-FANTASMA"},
		{LegacyCode: "jaladera-gola-vieja", ProfileCode: "GOLA-L-ALU"},
	}

	_, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, true)
	if err == nil || !strings.Contains(err.Error(), "inexistentes") {
		t.Fatalf("stale mappings must fail the whole run before any write: %v", err)
	}
	if len(store.createdProfiles) != 0 || len(store.deactivated) != 0 {
		t.Fatal("a failed run must not have written anything")
	}
}

func TestValidateOpeningGripMappingRejectsBadDeclarations(t *testing.T) {
	if err := ValidateOpeningGripMapping([]OpeningGripMappingEntry{{LegacyCode: "HER-JAL-INOX"}}); err == nil {
		t.Fatal("entries outside the gola family must be rejected")
	}
	if err := ValidateOpeningGripMapping([]OpeningGripMappingEntry{{LegacyCode: "jaladera-gola-x"}}); err == nil {
		t.Fatal("an entry without a declared outcome must be rejected")
	}
	if err := ValidateOpeningGripMapping([]OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-x", NewProfile: &OpeningGripNewProfile{Code: "G", Name: "g"}},
	}); err == nil {
		t.Fatal("a new profile without placements must be rejected — placement is declared, never inferred")
	}
	if err := ValidateOpeningGripMapping([]OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-x", NewProfile: &OpeningGripNewProfile{Code: "G", Name: "g", Placements: []string{"izquierda"}}},
	}); err == nil {
		t.Fatal("unknown placements must be rejected")
	}
	if err := ValidateOpeningGripMapping([]OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-x", ProfileCode: "A", Unsupported: true},
	}); err == nil {
		t.Fatal("double declarations must be rejected")
	}
}

func TestMigrateOpeningGripsIdempotentRerun(t *testing.T) {
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{
			{ID: "hw-1", Code: "jaladera-gola-256", Active: true, Version: 1},
		},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-256", NewProfile: &OpeningGripNewProfile{Code: "GOLA-256", Name: "Gola 256", Placements: []string{"top"}}},
	}

	if _, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, true); err != nil {
		t.Fatalf("first run rejected: %v", err)
	}
	if len(store.createdProfiles) != 1 {
		t.Fatalf("first run must create the profile: %d", len(store.createdProfiles))
	}
	// The hardware is now inactive (deactivated) — reflect it as the DB would.
	for i := range store.hardwares {
		if store.hardwares[i].ID == "hw-1" {
			store.hardwares[i].Active = false
		}
	}
	report, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, true)
	if err != nil {
		t.Fatalf("second run rejected: %v", err)
	}
	if len(store.createdProfiles) != 1 {
		t.Fatal("the second run must NOT create the profile again")
	}
	if report.Categories[OpeningGripAlreadyCanonical] != 1 {
		t.Fatalf("the second run must classify as already_canonical: %+v", report.Categories)
	}
	if len(report.Deactivated) != 0 {
		t.Fatalf("an inactive record must not deactivate again: %v", report.Deactivated)
	}
}

func TestMigrateOpeningGripsZeroRecordsReportsZeros(t *testing.T) {
	// An organization WITHOUT the legacy family has nothing to map: the run
	// succeeds with zero categories and the mapping stays informational —
	// this is the real first-run scenario for a clean database.
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{
			{ID: "hw-9", Code: "HER-JAL-INOX", Active: true, Version: 1},
		},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-256", ProfileCode: "GOLA-256"},
	}

	report, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, false)
	if err != nil {
		t.Fatalf("zero-record run must not fail on unmatched mappings: %v", err)
	}
	if len(report.Records) != 0 {
		t.Fatalf("records = %+v, want none", report.Records)
	}
	for _, category := range []string{OpeningGripMigrated, OpeningGripAlreadyCanonical, OpeningGripUnsupported, OpeningGripAmbiguous} {
		if report.Categories[category] != 0 {
			t.Fatalf("category %s = %d, want 0", category, report.Categories[category])
		}
	}
	if len(report.UnmatchedMappings) != 1 {
		t.Fatalf("the unused mapping entry must stay informational: %v", report.UnmatchedMappings)
	}
	if len(store.createdProfiles) != 0 || len(store.deactivated) != 0 {
		t.Fatal("a zero-record run must not write anything")
	}
}

func TestMigrateOpeningGripsPrevalidatesTargetProfilesBeforeWriting(t *testing.T) {
	// B1 (independent review): a nonexistent target ProfileCode must abort
	// BEFORE any write even when an earlier record would have created a
	// profile first — the old code aborted mid-loop leaving a partial run
	// and the error return discarded the report.
	store := &openingGripStubStore{
		hardwares: []domain.Hardware{
			{ID: "hw-a", Code: "jaladera-gola-a", Active: true, Version: 1},
			{ID: "hw-b", Code: "jaladera-gola-b", Active: true, Version: 1},
		},
	}
	entries := []OpeningGripMappingEntry{
		{LegacyCode: "jaladera-gola-a", NewProfile: &OpeningGripNewProfile{Code: "GOLA-A", Name: "Gola A", Placements: []string{"top"}}},
		{LegacyCode: "jaladera-gola-b", ProfileCode: "NO-EXISTE"},
	}

	_, err := MigrateOpeningGrips(context.Background(), store, openingGripOrg(), entries, true)
	if err == nil || !strings.Contains(err.Error(), "no existe en la organización") {
		t.Fatalf("the stale target must abort the run: %v", err)
	}
	if len(store.createdProfiles) != 0 || len(store.deactivated) != 0 {
		t.Fatalf("the abort must happen BEFORE any write: created=%d deactivated=%d",
			len(store.createdProfiles), len(store.deactivated))
	}
}
