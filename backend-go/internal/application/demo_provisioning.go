package application

import (
	"context"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Per-org provisioning of the demo recipe-bearing profile (#964): the seed's
// FIXED profile id is a global primary key over org-scoped rows, so a second
// organization collides on insert (the historical /seed 500). Provisioning
// derives a STABLE per-org profile id from (orgID, demo id) — the same org
// always provisions the same row (idempotent re-calls), distinct orgs never
// collide — and creates the org-scoped profile WITH the verified recipe body.
//
// The demo HARDWARE rows (HER-MIN-15 / HER-TAQ-8X30) are NOT provisioned
// here: SeedCatalog — which the seed endpoint runs first — creates them once
// per organization with their stable seed ids, and the provisioned profile's
// items reference exactly those. The publication itself needs no change: the
// builder already gathers active profiles from every organization.
//
// Authority stays with the caller: this runs under the platform-staff path
// the #955 publication already uses (the seed handler gates it), never by
// loosening tenant RLS.

// DemoProvisioningNamespace is the fixed uuid namespace for per-org demo ids
// (constant, not configuration).
var DemoProvisioningNamespace = uuid.MustParse("a0000096-4000-4964-8000-000000000001")

// ProvisionedDemoIDs are the deterministic per-org ids of the demo
// provisioning. Only the PROFILE is per-org; the demo hardware keeps its
// stable seed ids (created per org by SeedCatalog).
type ProvisionedDemoIDs struct {
	ProfileID string
}

// ProvisionedDemoIDsForOrg derives the stable per-org profile id.
func ProvisionedDemoIDsForOrg(orgID string) ProvisionedDemoIDs {
	// MustParse validates the org id AND anchors per-org uniqueness.
	_ = uuid.MustParse(orgID)
	return ProvisionedDemoIDs{ProfileID: uuid.NewMD5(DemoProvisioningNamespace,
		[]byte(orgID+"\x00"+SeedDemoProfileID)).String()}
}

// ProvisionDemoProfileForOrg idempotently creates the org-scoped demo
// profile with its verified recipe body, under the CALLER's tenant context.
// Re-provisioning the same org is a no-op.
func ProvisionDemoProfileForOrg(ctx context.Context, store interface {
	GetHardwareProfileByID(ctx context.Context, id string) (*domain.HardwareProfile, error)
	CreateHardwareProfile(ctx context.Context, p *domain.HardwareProfile) error
}, orgID string) error {
	ids := ProvisionedDemoIDsForOrg(orgID)
	if _, err := store.GetHardwareProfileByID(ctx, ids.ProfileID); err == nil {
		return nil // already provisioned for this org
	}
	profile := demoProfile()
	profile.ID = ids.ProfileID
	profile.Code = "PERF-DEMO-" + orgID[:8]
	profile.Name = "Unión fija minifix + tarugo (demo provisionada)"
	// The demo hardware rows are the org's OWN seed copies (#964): their ids
	// derive from the same per-org mapping the catalog seed used.
	profile.Items = []domain.HardwareProfileItem{
		{HardwareID: storage.SeededIDForOrg(orgID, seedDemoMinifixID), Quantity: 1, ApplicationRole: "cam"},
		{HardwareID: storage.SeededIDForOrg(orgID, seedDemoTaqueteID), Quantity: 1, ApplicationRole: "dowel"},
	}
	return store.CreateHardwareProfile(ctx, profile)
}
