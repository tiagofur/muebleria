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
			ID:     "op-rt-" + suffix,
			Code:   "GOLA-L-ALU",
			Name:   "Gola L aluminio (superior)",
			GripType: "gola",
			CrossSectionShape: "L",
			CompatiblePlacements: []string{"top"},
			DatasheetStatus: "pending",
			BodyModifiers: []domain.OpeningBodyModifier{
				{Role: "top", DepthReductionMm: openingIntPtr(18)},
				{Role: "side", NotchHeightMm: openingIntPtr(16), NotchDepthMm: openingIntPtr(9), NotchAt: "top_front"},
			},
			BOMMembers: map[string]domain.OpeningBOMMember{
				"profile": {HardwareID: "", Rule: "interior_width", Unit: "meter"},
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
