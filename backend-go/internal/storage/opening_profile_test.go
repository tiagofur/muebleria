package storage

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1130 — PG real: the opening profile catalog round-trips (JSONB modifiers
// and BOM members included), writes are If-Match guarded (version), and the
// family is tenant-scoped. A pending profile persists fine but is not
// authorable — the fail-closed gate lives in the contract (#1129) and the
// domain validation rejects verified-without-geometry at the write boundary.
func TestOpeningProfile_roundTripAndIfMatch(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	suffix := time.Now().Format("150405.000000")

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		profile := domain.OpeningProfile{
			ID:                   "op-rt-" + suffix,
			Code:                 "GOLA-L-ALU",
			Name:                 "Gola L aluminio (superior)",
			GripType:             "gola",
			CrossSectionShape:    "L",
			CompatiblePlacements: []string{"top"},
			DatasheetStatus:      "pending",
			BodyModifiers: []domain.OpeningBodyModifier{
				{Role: "top", DepthReductionMm: openingIntPtr(18)},
				{Role: "side", NotchHeightMm: openingFloatPtr(56.5), NotchDepthMm: openingFloatPtr(27.2), NotchAt: "top_front"},
			},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile":  {HardwareID: "", Rule: "interior_width", Unit: "meter"},
				"supports": {HardwareID: "", Rule: "per_length", SpacingMm: openingIntPtr(300)},
			},
			Active: true,
		}
		if err := store.CreateOpeningProfile(txCtx, &profile); err != nil {
			return err
		}

		loaded, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if loaded.Code != "GOLA-L-ALU" || loaded.DatasheetStatus != "pending" || len(loaded.BodyModifiers) != 2 {
			t.Fatalf("round-trip drifted: %+v", loaded)
		}
		if loaded.AuthoringReady() {
			t.Fatal("un perfil pending NUNCA está apto para authoring")
		}

		// If-Match: version vieja rechaza; la correcta actualiza.
		stale := *loaded
		stale.Name = "Gola L (stale)"
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, loaded.Version-1, &stale); err == nil {
			t.Fatal("expected version conflict")
		}
		fresh := *loaded
		fresh.Name = "Gola L aluminio"
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, loaded.Version, &fresh); err != nil {
			return err
		}

		// verified sin geometría ni origen: el write falla cerrado.
		bad := *loaded
		bad.DatasheetStatus = "verified"
		bad.GeometryOrigin = ""
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, fresh.Version, &bad); err == nil {
			t.Fatal("verified sin geometría/origen debe fallar cerrado")
		}
		return nil
	})
}

func openingIntPtr(v int) *int { return &v }

func openingFloatPtr(v float64) *float64 { return &v }

// #1325 — a profile authored WITHOUT body modifiers or BOM members (the
// browser editor's create flow) writes their empty JSON, never NULL: the
// NOT NULL JSONB columns rejected nil maps with a 500 (the create path was
// only ever exercised with full members before the UI existed).
func TestOpeningProfile_createWithoutModifiersOrMembers(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	suffix := time.Now().Format("150405.000000")

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		profile := domain.OpeningProfile{
			ID:                   "op-empty-" + suffix,
			Code:                 "GOLA-E2E-EMPTY",
			Name:                 "Gola sin efectos ni herrajes",
			GripType:             "gola",
			CrossSectionShape:    "L",
			CompatiblePlacements: []string{"top"},
			DatasheetStatus:      "pending",
			Active:               true,
		}
		if err := store.CreateOpeningProfile(txCtx, &profile); err != nil {
			return err
		}

		loaded, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if len(loaded.BodyModifiers) != 0 || len(loaded.BOMMembers) != 0 {
			t.Fatalf("un perfil sin declaración debe leerse vacío, got modifiers=%v members=%v", loaded.BodyModifiers, loaded.BOMMembers)
		}

		// And the empty profile updates fine (the editor edit flow).
		edited := *loaded
		edited.DatasheetStatus = "verified"
		edited.FrontReductionMm = openingIntPtr(38)
		edited.GripClearanceMm = openingIntPtr(2)
		edited.ProfileHeightMm = openingFloatPtr(56.5)
		edited.ProfileDepthMm = openingFloatPtr(27.2)
		edited.GeometryOrigin = "Ficha E2E #1325"
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, loaded.Version, &edited); err != nil {
			return err
		}
		return nil
	})
}
