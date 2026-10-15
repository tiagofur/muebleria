package storage

import (
	"context"
	"strings"
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
				// #1327 slice 3: the declared door bevel rides the same JSONB.
				{Role: "door", BevelAngleDeg: openingFloatPtr(45), BevelSizeMm: openingFloatPtr(18), BevelAt: "top_front"},
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
		if loaded.Code != "GOLA-L-ALU" || loaded.DatasheetStatus != "pending" || len(loaded.BodyModifiers) != 3 {
			t.Fatalf("round-trip drifted: %+v", loaded)
		}
		bevel := loaded.BodyModifiers[2]
		if bevel.Role != "door" || bevel.BevelAngleDeg == nil || *bevel.BevelAngleDeg != 45 ||
			bevel.BevelSizeMm == nil || *bevel.BevelSizeMm != 18 || bevel.BevelAt != "top_front" {
			t.Fatalf("el bisel declarado no sobrevive el JSONB: %+v", bevel)
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

// #1316 — the workshop-facing door discount round-trips, and a profile
// authored WITHOUT it keeps resolving the legacy pair (nil stays nil, the
// truthful absence — the pin path consumes exactly what it froze).
func TestOpeningProfile_doorDiscountRoundTrip(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	suffix := time.Now().Format("150405.000000")

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		profile := domain.OpeningProfile{
			ID:                   "op-door-" + suffix,
			Code:                 "GOLA-DOOR",
			Name:                 "Gola con descuento de puerta",
			GripType:             "gola",
			CrossSectionShape:    "L",
			CompatiblePlacements: []string{"top"},
			DatasheetStatus:      "verified",
			FrontReductionMm:     openingIntPtr(38),
			GripClearanceMm:      openingIntPtr(2),
			ProfileHeightMm:      openingFloatPtr(56.5),
			ProfileDepthMm:       openingFloatPtr(27.2),
			GeometryOrigin:       "Ficha #1316",
			DoorReductionMm:      openingIntPtr(32),
			Active:               true,
		}
		if err := store.CreateOpeningProfile(txCtx, &profile); err != nil {
			return err
		}
		loaded, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if loaded.DoorReductionMm == nil || *loaded.DoorReductionMm != 32 {
			t.Fatalf("door discount round-trip drifted: %+v", loaded.DoorReductionMm)
		}
		// Editing the discount creates the next version (If-Match).
		thirty := 30
		edited := *loaded
		edited.DoorReductionMm = &thirty
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, loaded.Version, &edited); err != nil {
			return err
		}
		again, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if again.Version != loaded.Version+1 || again.DoorReductionMm == nil || *again.DoorReductionMm != 30 {
			t.Fatalf("edit must bump version and persist 30: v%d %v", again.Version, again.DoorReductionMm)
		}
		return nil
	})
}

// #1329 — the informational MANUFACTURER round-trips (two gola L of
// different makers stay distinguishable), and the write boundary bounds it
// so the picker line stays readable. Optional: absent stays absent.
func TestOpeningProfile_manufacturerRoundTrip(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	suffix := time.Now().Format("150405.000000")

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		profile := domain.OpeningProfile{
			ID:                   "op-mfr-" + suffix,
			Code:                 "GOLA-L-SCILM-8006",
			Name:                 "Gola L SCILM 8006",
			Manufacturer:         "SCILM",
			GripType:             "gola",
			CrossSectionShape:    "L",
			CompatiblePlacements: []string{"top"},
			DatasheetStatus:      "verified",
			FrontReductionMm:     openingIntPtr(38),
			GripClearanceMm:      openingIntPtr(2),
			ProfileHeightMm:      openingFloatPtr(56.5),
			ProfileDepthMm:       openingFloatPtr(27.2),
			GeometryOrigin:       "Ficha SCILM 2022-04-01 p.42",
			DoorReductionMm:      openingIntPtr(35),
			Active:               true,
		}
		if err := store.CreateOpeningProfile(txCtx, &profile); err != nil {
			return err
		}
		loaded, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if loaded.Manufacturer != "SCILM" {
			t.Fatalf("manufacturer round-trip drifted: %q", loaded.Manufacturer)
		}

		edited := *loaded
		edited.Manufacturer = "Otro Fabricante"
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, loaded.Version, &edited); err != nil {
			return err
		}
		again, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if again.Manufacturer != "Otro Fabricante" {
			t.Fatalf("edit must persist the new manufacturer: %q", again.Manufacturer)
		}

		// Sin fabricante declarado: la ausencia veraz persiste (el picker
		// simplemente no muestra la parte informativa).
		bare := *again
		bare.Manufacturer = ""
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, again.Version, &bare); err != nil {
			return err
		}
		final, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		if err != nil {
			return err
		}
		if final.Manufacturer != "" {
			t.Fatalf("la ausencia de fabricante debe persistir vacía: %q", final.Manufacturer)
		}

		// Fuera de límite: el write falla cerrado.
		tooLong := *final
		tooLong.Manufacturer = strings.Repeat("x", 121)
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, final.Version, &tooLong); err == nil {
			t.Fatal("un fabricante de 121 caracteres debe fallar cerrado")
		}
		return nil
	})
}

// #1327 slice 1 — a member may reference a CATALOG COMPONENT (the italian
// gola strip) instead of a hardware SKU; the JSONB map round-trips it and
// the write boundary refuses a member that references BOTH.
func TestOpeningProfile_componentMemberRoundTrip(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	suffix := time.Now().Format("150405.000000")

	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		profile := domain.OpeningProfile{
			ID:                   "op-comp-" + suffix,
			Code:                 "GOLA-IT-TIRA",
			Name:                 "Gola italiano con tira",
			GripType:             "gola",
			CrossSectionShape:    "flat",
			CompatiblePlacements: []string{"top"},
			DatasheetStatus:      "verified",
			FrontReductionMm:     openingIntPtr(30),
			GripClearanceMm:      openingIntPtr(2),
			ProfileHeightMm:      openingFloatPtr(40),
			ProfileDepthMm:       openingFloatPtr(18),
			GeometryOrigin:       "Tira de taller #1327",
			DoorReductionMm:      openingIntPtr(32),
			BOMMembers: map[string]domain.OpeningBOMMember{
				"tira": {ComponentID: "comp-tira-gola-it", Rule: "interior_width", Unit: "piece"},
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
		tira := loaded.BOMMembers["tira"]
		if tira.ComponentID != "comp-tira-gola-it" || tira.HardwareID != "" {
			t.Fatalf("component member drifted: %+v", tira)
		}

		// Both references at once: the ambiguity fails closed.
		ambiguous := *loaded
		ambiguous.BOMMembers = map[string]domain.OpeningBOMMember{
			"tira": {HardwareID: "hw-x", ComponentID: "comp-tira-gola-it", Rule: "interior_width"},
		}
		if err := store.UpdateOpeningProfile(txCtx, profile.ID, loaded.Version, &ambiguous); err == nil {
			t.Fatal("miembro con herraje Y componente debe fallar cerrado")
		}
		return nil
	})
}
