package application

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Per-org provisioning of the demo recipe-bearing profile (#964): the seed's
// FIXED profile/hardware ids are global primary keys over org-scoped rows, so
// a second organization collides (the /seed 500). Provisioning derives
// STABLE per-org ids from (orgID, demo id) — the same org always provisions
// the same rows (idempotent re-calls), distinct orgs never collide — and
// creates the org-scoped hardware + profile copies WITH the verified recipe
// body. The publication itself needs no change: the builder already gathers
// active profiles from every organization.
//
// Authority stays with the caller: this runs under the platform-staff path
// the #955 publication already uses (the seed handler gates it), never by
// loosening tenant RLS.

// DemoProvisioningNamespace is the fixed uuid namespace for per-org demo ids
// (constant, not configuration).
var DemoProvisioningNamespace = uuid.MustParse("a0000096-4000-4964-8000-000000000001")

// ProvisionedDemoIDs are the deterministic per-org ids of the demo
// provisioning.
type ProvisionedDemoIDs struct {
	MinifixHardwareID string
	TaqueteHardwareID string
	ProfileID         string
}

// ProvisionedDemoIDsForOrg derives the stable per-org ids.
func ProvisionedDemoIDsForOrg(orgID string) ProvisionedDemoIDs {
	// MustParse validates the org id AND anchors per-org uniqueness.
	_ = uuid.MustParse(orgID)
	derive := func(demoID string) string {
		return uuid.NewMD5(DemoProvisioningNamespace, []byte(orgID+"\x00"+demoID)).String()
	}
	return ProvisionedDemoIDs{
		MinifixHardwareID: derive("a0000003-0000-0000-0000-000000000012"),
		TaqueteHardwareID: derive("a0000003-0000-0000-0000-000000000011"),
		ProfileID:         derive(SeedDemoProfileID),
	}
}

// ProvisionDemoProfileForOrg idempotently creates the org-scoped demo
// hardware (minifix + taquete) and the demo profile with its verified recipe
// body, under the CALLER's tenant context. Re-provisioning the same org is a
// no-op.
func ProvisionDemoProfileForOrg(ctx context.Context, store interface {
	GetHardwareProfileByID(ctx context.Context, id string) (*domain.HardwareProfile, error)
	CreateHardwareProfile(ctx context.Context, p *domain.HardwareProfile) error
	CreateHardware(ctx context.Context, h *domain.Hardware) error
}, orgID string) error {
	ids := ProvisionedDemoIDsForOrg(orgID)
	if _, err := store.GetHardwareProfileByID(ctx, ids.ProfileID); err == nil {
		return nil // already provisioned for this org
	}
	hardware := []domain.Hardware{
		{ID: ids.MinifixHardwareID, Code: "HER-MIN-15", Name: "Minifix 15 (demo provisionado)", Unit: domain.UnitPiece, CostPerUnit: 12.5, Active: true},
		{ID: ids.TaqueteHardwareID, Code: "HER-TAQ-8X30", Name: "Taquete 8x30 (demo provisionado)", Unit: domain.UnitPiece, CostPerUnit: 0.8, Active: true},
	}
	for i := range hardware {
		if err := store.CreateHardware(ctx, &hardware[i]); err != nil {
			return fmt.Errorf("provision demo hardware %s: %w", hardware[i].Code, err)
		}
	}
	profile := demoProfile()
	profile.ID = ids.ProfileID
	profile.Code = "PERF-DEMO-" + orgID[:8]
	profile.Name = "Unión fija minifix + tarugo (demo provisionada)"
	profile.Items = []domain.HardwareProfileItem{
		{HardwareID: ids.MinifixHardwareID, Quantity: 1, ApplicationRole: "cam"},
		{HardwareID: ids.TaqueteHardwareID, Quantity: 1, ApplicationRole: "dowel"},
	}
	profile.RecipeRef = &domain.ProfileRecipeRef{RecipeID: profile.Recipe.RecipeID, RecipeRevision: profile.Recipe.RecipeRevision}
	if err := store.CreateHardwareProfile(ctx, profile); err != nil {
		return fmt.Errorf("provision demo profile: %w", err)
	}
	return nil
}
