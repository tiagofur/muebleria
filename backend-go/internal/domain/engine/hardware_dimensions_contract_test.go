package engine

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1453 F1: parity twin of packages/domain hardwareDimensions.contract.test.ts —
// effective HW/HH/HD per family and formula evaluation agree with the shared
// fixture in contracts/hardwareDimensions.contract.json. Internal package so
// the formula evaluator is exercised exactly like the placement paths do.
type fixtureHardware struct {
	ID           string                    `json:"id"`
	Shape        *string                   `json:"shape"`
	SizeMm       *float64                  `json:"sizeMm"`
	DiameterMm   *float64                  `json:"diameterMm"`
	ProjectionMm *float64                  `json:"projectionMm"`
	Dimensions   *domain.HardwareDimensions `json:"dimensions"`
}

func TestHardwareDimensionsSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../../contracts/hardwareDimensions.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Hardware []fixtureHardware `json:"hardware"`
		Expected map[string]struct {
			HW float64 `json:"HW"`
			HH float64 `json:"HH"`
			HD float64 `json:"HD"`
		} `json:"expected"`
		FormulaCases []struct {
			Name     string         `json:"name"`
			HwID     string         `json:"hwId"`
			Formula  string         `json:"formula"`
			Env      map[string]int `json:"env"`
			Expected int            `json:"expected"`
		} `json:"formulaCases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}

	toDomain := func(entry fixtureHardware) domain.Hardware {
		return domain.Hardware{
			ID:                  entry.ID,
			Code:                entry.ID,
			Name:                entry.ID,
			Unit:                domain.HardwareUnit("piece"),
			Active:              true,
			PreviewShape:        entry.Shape,
			PreviewSizeMm:       entry.SizeMm,
			PreviewDiameterMm:   entry.DiameterMm,
			PreviewProjectionMm: entry.ProjectionMm,
			Dimensions:          entry.Dimensions,
		}
	}

	byID := map[string]fixtureHardware{}
	catalog := make([]domain.Hardware, 0, len(fixture.Hardware))
	for _, h := range fixture.Hardware {
		byID[h.ID] = h
		catalog = append(catalog, toDomain(h))
	}

	for _, h := range fixture.Hardware {
		dh := toDomain(h)
		w, hh, d := HardwareFormulaDims(&dh)
		want := fixture.Expected[h.ID]
		if int(w) != int(want.HW) || int(hh) != int(want.HH) || int(d) != int(want.HD) {
			t.Fatalf("%s: expected HW/HH/HD=%g/%g/%g, got %g/%g/%g",
				h.ID, want.HW, want.HH, want.HD, w, hh, d)
		}
	}

	for _, c := range fixture.FormulaCases {
		entry, ok := byID[c.HwID]
		if !ok {
			t.Fatalf("%s: unknown hardware %s", c.Name, c.HwID)
		}
		dh := toDomain(entry)
		hwW, hwH, hwD := HardwareFormulaDims(&dh)
		dims := formulaDims{
			W: c.Env["W"], H: c.Env["H"], D: c.Env["D"],
			PW: c.Env["PW"], PH: c.Env["PH"], PD: c.Env["PD"],
			T: c.Env["T"], HW: int(hwW), HH: int(hwH), HD: int(hwD),
		}
		got, err := evaluatePartFormula(c.Formula, dims)
		if err != nil {
			t.Fatalf("%s: evaluate: %v", c.Name, err)
		}
		if got != c.Expected {
			t.Fatalf("%s: expected %d, got %d", c.Name, c.Expected, got)
		}
	}
}

// The lookup built for AssemblyResolutionParams carries each member's
// effective dimensions into its offset formula (#1453 F1) — same numbers the
// live layout resolve computes.
func TestAssemblyMemberFormulaSeesHardwareDimensions(t *testing.T) {
	shape := "bar-pull"
	size := 128.0
	dims := domain.HardwareDimensions{WidthMm: 128, HeightMm: 32, DepthMm: 35}
	catalog := []domain.Hardware{
		{ID: "hw-pull-dims", PreviewShape: &shape, PreviewSizeMm: &size, Dimensions: &dims},
	}
	formula := "(PW-HW)/2"
	agregado := domain.Agregado{
		ID:   "agr-dim-parity",
		Code: "AGR-DIM",
		Name: "Miembro con HW",
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "m",
				Role:     "center_rail",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-pull-dims"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetFormula: &formula},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
				},
				BOMRole: domain.BOMRoleNonPurchasing,
			},
		},
	}
	params := AssemblyResolutionParams{
		WidthMm:            600,
		DepthMm:            500,
		HeightMm:           150,
		HardwareDimensions: HardwareDimensionsFromCatalog(catalog),
	}
	resolved, err := ResolveAgregadoAssembly(agregado, params)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(resolved.RigidMembers) != 1 {
		t.Fatalf("expected 1 member, got %d", len(resolved.RigidMembers))
	}
	gotX := resolved.RigidMembers[0].LocalTransform.TranslationMm[0]
	// min(0) + round((600-128)/2) = 236 — the member formula sees HW=128.
	if gotX != 236 {
		t.Fatalf("expected x=236, got %g", gotX)
	}

	// Without the lookup the same formula degrades to the historical
	// behavior (HW=0), never a guess.
	params.HardwareDimensions = nil
	resolved, err = ResolveAgregadoAssembly(agregado, params)
	if err != nil {
		t.Fatalf("resolve without lookup: %v", err)
	}
	gotX = resolved.RigidMembers[0].LocalTransform.TranslationMm[0]
	if gotX != 300 {
		t.Fatalf("expected x=300 with HW=0 fallback, got %g", gotX)
	}
}
