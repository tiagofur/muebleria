package engine

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #830 — frozen base-treatment authority parity. Pricing freezes the
// effective base mode per quote unit (QuoteCommercialPricingContext.BaseMode);
// release resolution consumes the SAME mode when the frozen commercial context
// governs, so the accepted sale and the manufacturing BOM cannot disagree.
// These cases pin each retained base-treatment role: plinth_board→ZOCLO,
// plinth_strip→ZOCLO_PERFIL, legs→PATAS.

// baseAuthorityCase is one frozen-mode scenario: the catalog module defaults
// to moduleMode (X) while the frozen commercial context froze frozenMode (Y),
// and the revision item retains the base role Y consumes.
type baseAuthorityCase struct {
	name           string
	frozenMode     string
	moduleMode     string
	retainedRole   string
	retainedChoice string
}

var baseAuthorityCases = []baseAuthorityCase{
	{name: "plinth_board/zoclo", frozenMode: "plinth_board", moduleMode: "none", retainedRole: "ZOCLO", retainedChoice: "mat-body"},
	{name: "plinth_strip/perfil", frozenMode: "plinth_strip", moduleMode: "none", retainedRole: "ZOCLO_PERFIL", retainedChoice: "hw-perfil"},
	{name: "legs/patas", frozenMode: "legs", moduleMode: "none", retainedRole: "PATAS", retainedChoice: "hw-patas"},
}

// resolveUnderFrozenContext is the pricing-side oracle: the exact resolve the
// commercial snapshot froze for a unit quoted with frozenMode.
func resolveUnderFrozenContext(t *testing.T, tc baseAuthorityCase, item domain.DesignRevisionItem, catalog domain.Catalog) domain.ResolvedBom {
	t.Helper()
	clearance := 80
	frozen := &BaseResolutionContext{BaseMode: tc.frozenMode, BaseClearanceMm: &clearance}
	bom, err := ResolveBomWithContext(catalog.Modules[0], item.MaterialChoices, catalog, frozen, "", nil,
		&domain.ItemCustomDims{WidthMm: 600, HeightMm: 750, DepthMm: 500})
	if err != nil {
		t.Fatalf("pricing resolve under frozen %s must succeed: %v", tc.frozenMode, err)
	}
	return bom
}

func frozenAuthorityItem(t *testing.T, tc baseAuthorityCase) (domain.DesignRevisionItem, domain.Catalog) {
	t.Helper()
	item, catalog := releaseUnitFixture(t)
	item.DesignRevisionID = "rev-830"
	// One lateral on both paths: pricing expands the module's own instance
	// quantity, the release path applies the shelves parameter binding.
	item.Parameters["shelves"] = float64(1)
	catalog.Modules[0].BaseMode = tc.moduleMode
	item.MaterialChoices = map[string]string{"INTERIOR": "mat-body", tc.retainedRole: tc.retainedChoice}
	return item, catalog
}

func marshalBOM(t *testing.T, bom domain.ResolvedBom) string {
	t.Helper()
	raw, err := json.Marshal(bom)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// GREEN (#830): under the frozen authority the release collection resolves
// each unit with the SAME effective base mode pricing froze — the BOMs agree
// byte-for-byte and the strict consumed-choice gate accepts the retained role.
func TestReleaseBaseAuthority_FrozenContextMatchesPricing(t *testing.T) {
	for _, tc := range baseAuthorityCases {
		t.Run(tc.name, func(t *testing.T) {
			item, catalog := frozenAuthorityItem(t, tc)
			pricingBOM := resolveUnderFrozenContext(t, tc, item, catalog)

			clearance := 80
			authority, err := NewReleaseResolutionContext(map[string]*BaseResolutionContext{
				item.FurnitureInstanceID: {BaseMode: tc.frozenMode, BaseClearanceMm: &clearance},
			})
			if err != nil {
				t.Fatal(err)
			}
			collection, err := ResolveReleaseCollection("rev-830", []domain.DesignRevisionItem{item}, catalog, authority, nil)
			if err != nil {
				t.Fatalf("quoted release under frozen %s must resolve: %v", tc.frozenMode, err)
			}
			if len(collection.Units) != 1 {
				t.Fatalf("one unit expected, got %d", len(collection.Units))
			}
			if got, want := marshalBOM(t, collection.Units[0].BOM), marshalBOM(t, pricingBOM); got != want {
				t.Fatalf("release BOM must equal the pricing BOM under frozen %s:\nrelease: %s\npricing: %s", tc.frozenMode, got, want)
			}
		})
	}
}

// Quote-less policy pin (#830 policy B): without a quoted authority the module
// default governs, and a base role it does not consume still fails the strict
// gate honestly — the mode is never changed to absorb choices.
func TestReleaseBaseAuthority_QuoteLessKeepsModuleDefaultHonestly(t *testing.T) {
	for _, tc := range baseAuthorityCases {
		t.Run(tc.name, func(t *testing.T) {
			item, catalog := frozenAuthorityItem(t, tc)
			_, err := ResolveReleaseCollection("rev-830", []domain.DesignRevisionItem{item}, catalog, nil, nil)
			if err == nil {
				t.Fatalf("quote-less release must keep rejecting the %s choice the module default %s does not consume", tc.retainedRole, tc.moduleMode)
			}
			var failure *domain.ReleaseUnitResolutionFailure
			if !errors.As(err, &failure) {
				t.Fatalf("typed unit failure expected, got %T %v", err, err)
			}
		})
	}
}

// A quoted authority binds exact physical identities: an unbound unit fails
// closed instead of borrowing another unit's frozen truth (#830 identity).
func TestReleaseBaseAuthority_UnboundUnitFailsClosed(t *testing.T) {
	item, catalog := frozenAuthorityItem(t, baseAuthorityCases[0])
	clearance := 80
	authority, err := NewReleaseResolutionContext(map[string]*BaseResolutionContext{
		"another-physical-unit": {BaseMode: "plinth_board", BaseClearanceMm: &clearance},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = ResolveReleaseCollection("rev-830", []domain.DesignRevisionItem{item}, catalog, authority, nil)
	if err == nil {
		t.Fatal("unbound unit must fail closed under a quoted authority")
	}
	var failure *domain.ReleaseUnitResolutionFailure
	if !errors.As(err, &failure) || failure.FurnitureInstanceID != item.FurnitureInstanceID {
		t.Fatalf("typed unit failure for the exact identity expected, got %T %v", err, err)
	}
}

// Malformed frozen truth is rejected at the authority boundary — never
// silently degraded to module defaults (#830 fail-closed constructor).
func TestReleaseBaseAuthority_ConstructorRejectsInvalidModes(t *testing.T) {
	clearance := 80
	for _, mode := range []string{"", "plastic", "ZOCALO"} {
		if _, err := NewReleaseResolutionContext(map[string]*BaseResolutionContext{
			"unit-1": {BaseMode: mode, BaseClearanceMm: &clearance},
		}); err == nil {
			t.Fatalf("invalid frozen base mode %q must be rejected", mode)
		}
	}
	if _, err := NewReleaseResolutionContext(map[string]*BaseResolutionContext{"unit-1": nil}); err == nil {
		t.Fatal("nil frozen unit context must be rejected")
	}
	if !IsValidBaseMode("legs") || IsValidBaseMode("wheels") {
		t.Fatal("IsValidBaseMode must mirror the canonical base mode set")
	}
}
