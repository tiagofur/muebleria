package application

import (
	"context"
	"encoding/json"
	"errors"

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

// demoConstructionPolicyOverrides is the tuned "Taller inicial" construction
// policy (#1065): spacing-derived station patterns per engine-resolvable
// family. Every provisioned org starts with dimension-driven drilling — a
// 400mm and a 1000mm cabinet derive their own fastener counts from the same
// rule — and can re-customize or restore inheritance in Ajustes →
// Construcción. Families the engine cannot resolve yet (top-to-side, #874)
// stay inherited: honest absence, never fake coverage.
// Granular keys ONLY, no `joint.constructionPolicy` structured blob: the
// flat form is the canonical merge surface — a later writer that adds
// granular keys (the settings UI, tests, future API flows) can never be
// silently overridden by a stale structured blob, because there isn't one.
func demoConstructionPolicyOverrides() json.RawMessage {
	return json.RawMessage(`{
		"joint.floorToSide.systemId": "minifix-dowel",
		"joint.floorToSide.maxSpacingMm": 250,
		"joint.floorToSide.startMarginMm": 50,
		"joint.floorToSide.endMarginMm": 50,
		"joint.floorToSide.withDowels": true,
		"joint.shelfToSide.systemId": "minifix-dowel",
		"joint.shelfToSide.maxSpacingMm": 400,
		"joint.shelfToSide.startMarginMm": 50,
		"joint.shelfToSide.endMarginMm": 50,
		"joint.shelfToSide.withDowels": true
	}`)
}

// ProvisionDemoConstructionPolicyForOrg idempotently provisions the org's
// factory construction overlay with the tuned demo policy. An org that
// already owns an active overlay keeps it untouched — provisioning seeds
// the tuned default, never overwrites a factory's own decisions (#875 C1:
// the policy belongs to the factory).
func ProvisionDemoConstructionPolicyForOrg(ctx context.Context, store interface {
	GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error)
	CreateOverlay(ctx context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error)
}, orgID string) (bool, error) {
	orgIDParsed, err := uuid.Parse(orgID)
	if err != nil {
		return false, err
	}
	libraryID := uuid.MustParse(domain.GraneteStandardLibraryID)
	if _, err := store.GetActiveOverlayByLibrary(ctx, orgIDParsed, libraryID); err == nil {
		return false, nil // the org already owns overlay decisions
	} else if !errors.Is(err, storage.ErrOverlayNotFound) {
		return false, err
	}
	overlay := &domain.LibraryOverlay{
		OrganizationID: orgIDParsed,
		LibraryID:      libraryID,
		BaseReleaseID:  uuid.MustParse(domain.GraneteStandardDraftReleaseID),
		Status:         "active",
		Overrides:      demoConstructionPolicyOverrides(),
	}
	if _, err := store.CreateOverlay(ctx, overlay); err != nil {
		return false, err
	}
	return true, nil
}
