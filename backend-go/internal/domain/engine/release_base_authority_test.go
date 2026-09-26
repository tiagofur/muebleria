package engine

import (
	"encoding/json"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #830 — frozen base-treatment authority parity. Pricing freezes the
// effective base mode per quote unit (QuoteCommercialPricingContext.BaseMode);
// release resolution must consume the SAME mode when the frozen commercial
// context governs, so the accepted sale and the manufacturing BOM cannot
// disagree. These cases pin each retained base-treatment role:
// plinth_board→ZOCLO, plinth_strip→ZOCLO_PERFIL, legs→PATAS.

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
		&domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560})
	if err != nil {
		t.Fatalf("pricing resolve under frozen %s must succeed: %v", tc.frozenMode, err)
	}
	return bom
}

// RED (#830): with the module defaulting to X and the quote having frozen Y,
// the current release resolver (module default authority) rejects the retained
// base-treatment choice that the accepted quote legitimately consumed. The
// desired contract — release resolution under the frozen authority agreeing
// with pricing — fails on current code.
func TestReleaseBaseAuthority_Red_QuotedFrozenModeDivergence(t *testing.T) {
	for _, tc := range baseAuthorityCases {
		t.Run(tc.name, func(t *testing.T) {
			item, catalog := releaseUnitFixture(t)
			catalog.Modules[0].BaseMode = tc.moduleMode
			item.MaterialChoices = map[string]string{"INTERIOR": "mat-body", tc.retainedRole: tc.retainedChoice}

			pricingBOM := resolveUnderFrozenContext(t, tc, item, catalog)

			unit, err := ResolveReleaseUnit(item, catalog)
			if err != nil {
				t.Fatalf("#830 divergence: quote froze base mode %q (consumed %s) but release resolution uses module default %q and rejects: %v",
					tc.frozenMode, tc.retainedRole, tc.moduleMode, err)
			}
			pricingJSON, _ := json.Marshal(pricingBOM)
			releaseJSON, _ := json.Marshal(unit.BOM)
			if string(pricingJSON) != string(releaseJSON) {
				t.Fatalf("#830 divergence: BOM under frozen mode %q differs from release BOM under module default %q:\npricing: %s\nrelease: %s",
					tc.frozenMode, tc.moduleMode, pricingJSON, releaseJSON)
			}
		})
	}
}
