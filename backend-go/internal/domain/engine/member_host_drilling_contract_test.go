package engine_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1429 slice B: paridad TS↔Go de la proyección member-host. Autoridad
// numérica única: contracts/memberHostDrilling.contract.json — Go es el autor
// golden (ResolveAuthoringLayout) y el espejo TS (resolveProjectDrilling)
// consume el MISMO JSON y debe producir los mismos agujeros board-local por
// pieza anfitriona (drift 0, aceptación de la issue).

type memberHostFixture struct {
	Module struct {
		WidthMm  int `json:"widthMm"`
		HeightMm int `json:"heightMm"`
		DepthMm  int `json:"depthMm"`
	} `json:"module"`
	Carcase struct {
		ThicknessMm float64 `json:"thicknessMm"`
		Components  []struct {
			ID            string `json:"id"`
			Code          string `json:"code"`
			Name          string `json:"name"`
			Placement     string `json:"placement"`
			LengthFormula string `json:"lengthFormula"`
			WidthFormula  string `json:"widthFormula"`
			OptionRole    string `json:"optionRole"`
		} `json:"components"`
	} `json:"carcase"`
	Drawer struct {
		AgregadoID string `json:"agregadoId"`
		Code       string `json:"code"`
		Name       string `json:"name"`
		WidthMm    int    `json:"widthMm"`
		HeightMm   int    `json:"heightMm"`
		DepthMm    int    `json:"depthMm"`
		Members    []struct {
			MemberID      string  `json:"memberId"`
			Role          string  `json:"role"`
			HardwareID    string  `json:"hardwareId"`
			HostPlacement string  `json:"hostPlacement"`
			XRef          string  `json:"xRef"`
			YOffsetMm     float64 `json:"yOffsetMm"`
			Hand          string  `json:"hand,omitempty"`
		} `json:"members"`
	} `json:"drawer"`
	Hardware []struct {
		ID         string `json:"id"`
		Code       string `json:"code"`
		Name       string `json:"name"`
		Dimensions struct {
			WidthMm float64 `json:"widthMm"`
		} `json:"dimensions"`
		Operations []struct {
			ID          string   `json:"id"`
			Kind        string   `json:"kind"`
			DiameterMm  float64  `json:"diameterMm"`
			DepthMm     float64  `json:"depthMm"`
			XMm         float64  `json:"xMm"`
			YMm         float64  `json:"yMm"`
			Label       string   `json:"label,omitempty"`
			PlanesFaces []string `json:"planesFaces,omitempty"`
		} `json:"operations"`
	} `json:"hardware"`
	Expected struct {
		ByMember map[string]struct {
			HostPlacement string `json:"hostPlacement"`
			Holes         []struct {
				Face       string  `json:"face"`
				XMm        float64 `json:"xMm"`
				YMm        float64 `json:"yMm"`
				DiameterMm float64 `json:"diameterMm"`
				DepthMm    float64 `json:"depthMm"`
			} `json:"holes"`
		} `json:"byMember"`
	} `json:"expected"`
}

func loadMemberHostFixture(t *testing.T) memberHostFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "memberHostDrilling.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}
	var fixture memberHostFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}
	if len(fixture.Expected.ByMember) == 0 {
		t.Fatalf("fixture carries no expected holes")
	}
	return fixture
}

func buildMemberHostScenario(f memberHostFixture) (domain.Module, domain.Catalog) {
	components := make([]domain.Component, 0, len(f.Carcase.Components))
	instances := make([]domain.ComponentInstance, 0, len(f.Carcase.Components))
	placementOf := map[string]domain.ComponentPlacement{}
	for _, c := range f.Carcase.Components {
		placement := domain.ComponentPlacement(c.Placement)
		placementOf[c.ID] = placement
		components = append(components, domain.Component{
			ID: c.ID, Code: c.Code, Name: c.Name, Placement: placement,
			GeometryKind:  "rectangular_board",
			ThicknessMm:   int(f.Carcase.ThicknessMm),
			OptionRoles:   []string{c.OptionRole},
			LengthFormula: c.LengthFormula,
			WidthFormula:  c.WidthFormula,
			Active:        true,
		})
		instances = append(instances, domain.ComponentInstance{ComponentID: c.ID, Quantity: 1})
	}

	members := make([]domain.AgregadoRigidMember, 0, len(f.Drawer.Members))
	for _, m := range f.Drawer.Members {
		xRef := domain.AxisRefMin
		if m.XRef == "max" {
			xRef = domain.AxisRefMax
		}
		members = append(members, domain.AgregadoRigidMember{
			MemberID: m.MemberID, Role: m.Role,
			Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: m.HardwareID}},
			BOMRole:       domain.BOMRoleNonPurchasing,
			HostPlacement: m.HostPlacement,
			Hand:          m.Hand,
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: xRef},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: m.YOffsetMm},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
		})
	}

	hardware := make([]domain.Hardware, 0, len(f.Hardware))
	for _, h := range f.Hardware {
		ops := make([]domain.MachiningOperation, 0, len(h.Operations))
		for _, op := range h.Operations {
			depth := op.DepthMm
			ops = append(ops, domain.MachiningOperation{
				ID: op.ID, Kind: op.Kind, DiameterMm: op.DiameterMm, DepthMm: &depth,
				XMm: op.XMm, YMm: op.YMm, Label: op.Label, Face: "anchor",
			})
		}
		hw := domain.Hardware{
			ID: h.ID, Code: h.Code, Name: h.Name, Unit: domain.UnitPiece, Active: true,
			Machining: &domain.HardwareMachiningProfile{Parts: []domain.HardwareMachiningPart{{
				ID: "pilot", Role: "screw", Operations: ops,
			}}},
		}
		if h.Dimensions.WidthMm > 0 {
			hw.Dimensions = &domain.HardwareDimensions{WidthMm: h.Dimensions.WidthMm}
		}
		hardware = append(hardware, hw)
	}

	agr := domain.Agregado{
		ID: f.Drawer.AgregadoID, Code: f.Drawer.Code, Name: f.Drawer.Name, Active: true,
		WidthMm: f.Drawer.WidthMm, HeightMm: f.Drawer.HeightMm, DepthMm: f.Drawer.DepthMm,
		RigidMembers: members,
	}
	module := domain.Module{
		ID: "mod-mbox", Code: "MOD-MBOX", Name: "Base MERIVOBOX",
		WidthMm: f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm,
		StructureID: "st-mbox",
		Agregados:   []domain.ModuleAgregadoInstance{{AgregadoID: agr.ID, Quantity: 1}},
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{{
			ID: "st-mbox", Code: "CUERPO-MBOX", Name: "Cuerpo MBOX", Active: true,
			Components: instances,
		}},
		Components: components,
		Agregados:  []domain.Agregado{agr},
		Hardware:   hardware,
	}
	return module, catalog
}

func TestMemberHostDrillingSharedContract_1429(t *testing.T) {
	f := loadMemberHostFixture(t)
	module, catalog := buildMemberHostScenario(f)

	result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
		Module:  module,
		Catalog: catalog,
		Dims:    &engine.LayoutDims{WidthMm: f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm},
	})
	if err != nil {
		t.Fatalf("ResolveAuthoringLayout: %v", err)
	}

	// Golden dump (fixture authoring aid): the direct board-local values the
	// engine emits per member. Keep visible while pinning `expected`.
	if os.Getenv("MEMBER_HOST_DUMP") != "" {
		for _, op := range result.Machining.Operations {
			if op.Provenance.SourceKind != "assemblyMemberHost" {
				continue
			}
			for _, h := range op.Holes {
				fmt.Printf("DUMP %s %s face=%s x=%g y=%g d=%g depth=%g\n",
					op.Provenance.MemberID, op.HostComponentInstanceID, h.Face, h.XMm, h.YMm, h.DiameterMm, h.DepthMm)
			}
		}
	}

	byMember := map[string][]struct {
		Face       string  `json:"face"`
		XMm        float64 `json:"xMm"`
		YMm        float64 `json:"yMm"`
		DiameterMm float64 `json:"diameterMm"`
		DepthMm    float64 `json:"depthMm"`
	}{}
	for _, op := range result.Machining.Operations {
		if op.Provenance.SourceKind != "assemblyMemberHost" {
			continue
		}
		for _, h := range op.Holes {
			byMember[op.Provenance.MemberID] = append(byMember[op.Provenance.MemberID], struct {
				Face       string  `json:"face"`
				XMm        float64 `json:"xMm"`
				YMm        float64 `json:"yMm"`
				DiameterMm float64 `json:"diameterMm"`
				DepthMm    float64 `json:"depthMm"`
			}{h.Face, h.XMm, h.YMm, h.DiameterMm, h.DepthMm})
		}
	}

	for memberID, want := range f.Expected.ByMember {
		got := byMember[memberID]
		if len(got) != len(want.Holes) {
			t.Fatalf("member %s emitted %d holes, want %d: %+v", memberID, len(got), len(want.Holes), got)
		}
		sort.Slice(got, func(i, j int) bool {
			if got[i].XMm != got[j].XMm {
				return got[i].XMm < got[j].XMm
			}
			return got[i].YMm < got[j].YMm
		})
		sortedWant := append([]struct {
			Face       string  `json:"face"`
			XMm        float64 `json:"xMm"`
			YMm        float64 `json:"yMm"`
			DiameterMm float64 `json:"diameterMm"`
			DepthMm    float64 `json:"depthMm"`
		}{}, want.Holes...)
		sort.Slice(sortedWant, func(i, j int) bool {
			if sortedWant[i].XMm != sortedWant[j].XMm {
				return sortedWant[i].XMm < sortedWant[j].XMm
			}
			return sortedWant[i].YMm < sortedWant[j].YMm
		})
		for i, w := range sortedWant {
			g := got[i]
			if g.Face != w.Face || g.XMm != w.XMm || g.YMm != w.YMm || g.DiameterMm != w.DiameterMm || g.DepthMm != w.DepthMm {
				t.Fatalf("member %s hole %d = {face:%s x:%g y:%g d:%g depth:%g}, want {face:%s x:%g y:%g d:%g depth:%g}",
					memberID, i, g.Face, g.XMm, g.YMm, g.DiameterMm, g.DepthMm, w.Face, w.XMm, w.YMm, w.DiameterMm, w.DepthMm)
			}
		}
	}
}
