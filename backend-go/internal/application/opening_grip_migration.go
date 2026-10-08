package application

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Opening grip migration (#1136) — moves the legacy `jaladera-gola-*` handle
// options to the semantic grip model (OpeningProfile, ADR-0009) with EVERY
// conversion explicit and traceable. Nothing is inferred from names: the
// mapping is DECLARED data (the owner's reviewable decision); the tool only
// executes and reports it.
//
// Every legacy record ends in exactly one of four categories:
//   - migrated          — a mapping entry declared a NEW profile; created as
//     datasheet-pending with a trace note naming the legacy origin.
//   - already_canonical — the mapping's target profile code already exists
//     in the organization; the link is recorded, nothing is written.
//   - unsupported       — the mapping explicitly declares there is NO grip
//     equivalent; the record stays a handle, untouched.
//   - ambiguous         — no mapping entry: manual review, blocked. Design
//     overrides (modules.agregados option_overrides selecting a legacy gola
//     handle) are ALWAYS manual-review: converting one into an opening
//     intent is a design decision (zones, layout) a migration must never
//     invent.
//
// Fail-closed: a mapping entry pointing at a nonexistent profile code fails
// the WHOLE run before any write (a stale mapping is a configuration error,
// never a silent skip) — but an organization WITHOUT family records has
// nothing to map, so its run reports zero categories instead of failing; an
// invalid mapping entry fails at load. The default mode is a dry-run
// report; only apply writes, and it NEVER touches modules — dimensions and
// BOM stay exactly as they are, changed only by the canonical resolve when
// designs adopt the grip model.
//
// Deactivation ("authoring stops depending on jaladera-gola-*"): a legacy
// option classified migrated/already_canonical with NO design override
// references is deactivated (Active=false) so the option selector stops
// offering it. Referenced options stay active — their overrides are the
// manual-review queue, and the #1215 in-use guard double-checks. Re-running
// is safe: a second run reclassifies creations as already_canonical and
// skips inactive records.

// Report categories.
const (
	OpeningGripMigrated         = "migrated"
	OpeningGripAlreadyCanonical = "already_canonical"
	OpeningGripUnsupported      = "unsupported"
	OpeningGripAmbiguous        = "ambiguous"
)

// legacyGolaPrefix identifies the migrating family (explicit, documented).
const legacyGolaPrefix = "jaladera-gola"

// OpeningGripMappingEntry is one DECLARED conversion decision.
type OpeningGripMappingEntry struct {
	// LegacyCode is the exact hardware code of the legacy option (e.g.
	// "jaladera-gola-256"); matched case-insensitively.
	LegacyCode string `json:"legacyCode"`
	// ProfileCode targets an EXISTING org profile (e.g. "GOLA-C-ALU").
	ProfileCode string `json:"profileCode,omitempty"`
	// NewProfile declares a profile to CREATE (datasheet-pending; the
	// placements are the owner's explicit declaration, never inferred).
	NewProfile *OpeningGripNewProfile `json:"newProfile,omitempty"`
	// Unsupported declares there is NO grip equivalent: the record stays a
	// handle, untouched.
	Unsupported bool `json:"unsupported,omitempty"`
}

// OpeningGripNewProfile is the explicit declaration for a profile creation.
type OpeningGripNewProfile struct {
	Code       string   `json:"code"`
	Name       string   `json:"name"`
	Placements []string `json:"placements"`
}

// OpeningGripMigrationRecord traces one legacy record's outcome.
type OpeningGripMigrationRecord struct {
	LegacyCode  string `json:"legacyCode"`
	HardwareID  string `json:"hardwareId"`
	ProfileID   string `json:"profileId,omitempty"`
	ProfileCode string `json:"profileCode,omitempty"`
	// Action: migrated | already_canonical | unsupported | ambiguous.
	Action string `json:"action"`
	// Deactivated reports whether the legacy option left the offering.
	Deactivated bool `json:"deactivated"`
}

// OpeningGripOverrideHitWithHint is one design override needing manual
// review, with the suggested target when the mapping declares one.
type OpeningGripOverrideHitWithHint struct {
	storage.OpeningGripOverrideHit
	SuggestedProfileCode string `json:"suggestedProfileCode,omitempty"`
}

// OpeningGripMigrationReport is the per-run outcome with category counts.
type OpeningGripMigrationReport struct {
	OrgID             string                           `json:"orgId"`
	DryRun            bool                             `json:"dryRun"`
	Categories        map[string]int                   `json:"categories"`
	Records           []OpeningGripMigrationRecord     `json:"records"`
	ManualReview      []OpeningGripOverrideHitWithHint `json:"manualReview"`
	Deactivated       []string                         `json:"deactivated"`
	UnmatchedMappings []string                         `json:"unmatchedMappings"`
}

// OpeningGripMigrationStore is the narrow surface the migration consumes.
type OpeningGripMigrationStore interface {
	ListHardwares(ctx context.Context) ([]domain.Hardware, error)
	ListOpeningProfiles(ctx context.Context) ([]domain.OpeningProfile, error)
	CreateOpeningProfile(ctx context.Context, profile *domain.OpeningProfile) error
	DeactivateHardware(ctx context.Context, id string, expectedVersion int64) error
	ScanModuleAgregadoOverrides(ctx context.Context, valuePrefix string) ([]storage.OpeningGripOverrideHit, error)
}

// ValidateOpeningGripMapping checks the declared mapping before anything
// runs: every entry must declare exactly one outcome (unsupported |
// profileCode | newProfile) and a new profile needs a code, a name and
// placements from the entity's vocabulary.
func ValidateOpeningGripMapping(entries []OpeningGripMappingEntry) error {
	seen := map[string]bool{}
	for _, entry := range entries {
		code := strings.ToLower(strings.TrimSpace(entry.LegacyCode))
		if !strings.HasPrefix(code, legacyGolaPrefix) {
			return fmt.Errorf("el mapeo %q no es de la familia %s", entry.LegacyCode, legacyGolaPrefix)
		}
		if seen[code] {
			return fmt.Errorf("el mapeo declara %q dos veces", entry.LegacyCode)
		}
		seen[code] = true
		declared := 0
		if entry.Unsupported {
			declared++
		}
		if strings.TrimSpace(entry.ProfileCode) != "" {
			declared++
		}
		if entry.NewProfile != nil {
			declared++
		}
		if declared != 1 {
			return fmt.Errorf("el mapeo de %q debe declarar exactamente una salida (unsupported | profileCode | newProfile)", entry.LegacyCode)
		}
		if entry.NewProfile != nil {
			np := entry.NewProfile
			if strings.TrimSpace(np.Code) == "" || strings.TrimSpace(np.Name) == "" {
				return fmt.Errorf("el nuevo perfil de %q exige código y nombre", entry.LegacyCode)
			}
			if len(np.Placements) == 0 {
				return fmt.Errorf("el nuevo perfil de %q exige al menos una placement (la colocación es una declaración explícita, nunca inferida)", entry.LegacyCode)
			}
			for _, placement := range np.Placements {
				known := false
				for _, candidate := range domain.OpeningProfilePlacements {
					if candidate == placement {
						known = true
						break
					}
				}
				if !known {
					return fmt.Errorf("el nuevo perfil de %q declara la placement desconocida %q", entry.LegacyCode, placement)
				}
			}
		}
	}
	return nil
}

// MigrateOpeningGrips executes the classification and — only with apply —
// the writes. The returned report carries the category counts.
func MigrateOpeningGrips(
	ctx context.Context,
	store OpeningGripMigrationStore,
	orgID string,
	entries []OpeningGripMappingEntry,
	apply bool,
) (OpeningGripMigrationReport, error) {
	if err := ValidateOpeningGripMapping(entries); err != nil {
		return OpeningGripMigrationReport{}, err
	}
	mappingByCode := map[string]OpeningGripMappingEntry{}
	for _, entry := range entries {
		mappingByCode[strings.ToLower(strings.TrimSpace(entry.LegacyCode))] = entry
	}

	hardwares, err := store.ListHardwares(ctx)
	if err != nil {
		return OpeningGripMigrationReport{}, fmt.Errorf("list hardware: %w", err)
	}
	profiles, err := store.ListOpeningProfiles(ctx)
	if err != nil {
		return OpeningGripMigrationReport{}, fmt.Errorf("list opening profiles: %w", err)
	}
	profileByCode := map[string]domain.OpeningProfile{}
	for _, profile := range profiles {
		profileByCode[strings.ToUpper(profile.Code)] = profile
	}

	// Design override references first: they gate deactivation and are the
	// manual-review queue.
	hits, err := store.ScanModuleAgregadoOverrides(ctx, legacyGolaPrefix+"%")
	if err != nil {
		return OpeningGripMigrationReport{}, fmt.Errorf("scan module overrides: %w", err)
	}
	referencedCodes := map[string]bool{}
	report := OpeningGripMigrationReport{
		OrgID:             orgID,
		DryRun:            !apply,
		Categories:        map[string]int{OpeningGripMigrated: 0, OpeningGripAlreadyCanonical: 0, OpeningGripUnsupported: 0, OpeningGripAmbiguous: 0},
		Records:           []OpeningGripMigrationRecord{},
		ManualReview:      []OpeningGripOverrideHitWithHint{},
		Deactivated:       []string{},
		UnmatchedMappings: []string{},
	}
	for _, hit := range hits {
		referencedCodes[strings.ToLower(strings.TrimSpace(hit.Value))] = true
		hint := OpeningGripOverrideHitWithHint{OpeningGripOverrideHit: hit}
		if entry, ok := mappingByCode[strings.ToLower(strings.TrimSpace(hit.Value))]; ok && strings.TrimSpace(entry.ProfileCode) != "" {
			hint.SuggestedProfileCode = entry.ProfileCode
		}
		report.ManualReview = append(report.ManualReview, hint)
	}

	// Stale mappings fail the run BEFORE any write.
	matchedCodes := map[string]bool{}
	var legacyRecords []domain.Hardware
	for _, hw := range hardwares {
		code := strings.ToLower(strings.TrimSpace(hw.Code))
		matchedCodes[code] = true
		if strings.HasPrefix(code, legacyGolaPrefix) {
			legacyRecords = append(legacyRecords, hw)
		}
	}
	for code, entry := range mappingByCode {
		if !matchedCodes[code] {
			report.UnmatchedMappings = append(report.UnmatchedMappings, entry.LegacyCode)
		}
	}
	// A stale mapping is a configuration error ONLY when the family exists:
	// an organization without jaladera-gola-* records has nothing to map —
	// the run reports zero categories and the entries stay informational.
	if len(legacyRecords) > 0 && len(report.UnmatchedMappings) > 0 {
		sort.Strings(report.UnmatchedMappings)
		return OpeningGripMigrationReport{}, fmt.Errorf("el mapeo declara registros inexistentes en esta organización: %v — corregí el mapeo antes de migrar", report.UnmatchedMappings)
	}
	// B1 (independent review): every DECLARED target profile must also exist
	// BEFORE the write loop — a mid-list nonexistent ProfileCode used to
	// abort AFTER earlier records had already written (and the error return
	// discarded the report, leaving a partial run with no trace). Gated like
	// the check above: an organization without the family has nothing to map.
	if len(legacyRecords) > 0 {
		for _, entry := range mappingByCode {
			if strings.TrimSpace(entry.ProfileCode) == "" {
				continue
			}
			if _, exists := profileByCode[strings.ToUpper(strings.TrimSpace(entry.ProfileCode))]; !exists {
				return OpeningGripMigrationReport{}, fmt.Errorf("el mapeo de %q apunta al perfil %q que no existe en la organización", entry.LegacyCode, entry.ProfileCode)
			}
		}
	}

	sort.Slice(legacyRecords, func(i, j int) bool { return legacyRecords[i].Code < legacyRecords[j].Code })
	for _, hw := range legacyRecords {
		code := strings.ToLower(strings.TrimSpace(hw.Code))
		entry, mapped := mappingByCode[code]
		record := OpeningGripMigrationRecord{LegacyCode: hw.Code, HardwareID: hw.ID}
		switch {
		case mapped && entry.Unsupported:
			record.Action = OpeningGripUnsupported
			report.Categories[OpeningGripUnsupported]++
		case mapped && strings.TrimSpace(entry.ProfileCode) != "":
			profile, exists := profileByCode[strings.ToUpper(strings.TrimSpace(entry.ProfileCode))]
			if !exists {
				return OpeningGripMigrationReport{}, fmt.Errorf("el mapeo de %q apunta al perfil %q que no existe en la organización", hw.Code, entry.ProfileCode)
			}
			record.Action = OpeningGripAlreadyCanonical
			record.ProfileID = profile.ID
			record.ProfileCode = profile.Code
			report.Categories[OpeningGripAlreadyCanonical]++
		case mapped && entry.NewProfile != nil:
			if existing, exists := profileByCode[strings.ToUpper(entry.NewProfile.Code)]; exists {
				// The declared creation already happened in a previous run.
				record.Action = OpeningGripAlreadyCanonical
				record.ProfileID = existing.ID
				record.ProfileCode = existing.Code
				report.Categories[OpeningGripAlreadyCanonical]++
				break
			}
			if !apply {
				record.Action = OpeningGripMigrated
				record.ProfileCode = entry.NewProfile.Code
				report.Categories[OpeningGripMigrated]++
				report.Records = append(report.Records, record)
				continue
			}
			profile := &domain.OpeningProfile{
				ID:                   uuid.NewString(),
				OrganizationID:       orgID,
				Code:                 entry.NewProfile.Code,
				Name:                 entry.NewProfile.Name,
				GripType:             "gola",
				CompatiblePlacements: append([]string{}, entry.NewProfile.Placements...),
				DatasheetStatus:      "pending",
				Active:               true,
			}
			if err := store.CreateOpeningProfile(ctx, profile); err != nil {
				return OpeningGripMigrationReport{}, fmt.Errorf("create profile for %s: %w", hw.Code, err)
			}
			profileByCode[strings.ToUpper(profile.Code)] = *profile
			record.Action = OpeningGripMigrated
			record.ProfileID = profile.ID
			record.ProfileCode = profile.Code
			report.Categories[OpeningGripMigrated]++
		default:
			record.Action = OpeningGripAmbiguous
			report.Categories[OpeningGripAmbiguous]++
		}

		// Deactivation: only mapped-to-grip records with no design
		// references leave the offering. The #1215 guard double-checks.
		if apply && (record.Action == OpeningGripMigrated || record.Action == OpeningGripAlreadyCanonical) &&
			hw.Active && !referencedCodes[code] {
			if err := store.DeactivateHardware(ctx, hw.ID, hw.Version); err != nil {
				return OpeningGripMigrationReport{}, fmt.Errorf("deactivate %s: %w", hw.Code, err)
			}
			record.Deactivated = true
			report.Deactivated = append(report.Deactivated, hw.Code)
		}
		report.Records = append(report.Records, record)
	}
	return report, nil
}
