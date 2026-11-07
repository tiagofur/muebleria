package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1557 — paridad TS↔Go de la expansión/sync por ancla de partes de kit
// multi-diseño (#1518 F1). Autoridad única: contracts/fixtures/
// kitPartAnchorParity.contract.json — Go (syncAgregadoRigidMembersFromCatalog)
// y TS (syncAgregadoWithKitParts) deben producir el MISMO conjunto de
// miembros desde la receta parcial (reparación del ancla faltante) y los
// MISMOS defaults de fallback (10 / 35 móvil-cajón / negado en right).

type kitPartAnchorFixture struct {
	Kit struct {
		ID   string `json:"id"`
		Code string `json:"code"`
		Name string `json:"name"`
	} `json:"kit"`
	Agregado struct {
		Code string `json:"code"`
	} `json:"agregado"`
	Parts []struct {
		ID           string `json:"id"`
		Code         string `json:"code"`
		Name         string `json:"name"`
		PreviewShape string `json:"previewShape"`
		Pieces       []struct {
			Anchor string `json:"anchor"`
		} `json:"pieces"`
	} `json:"parts"`
	PartialRecipe []struct {
		MemberID   string `json:"memberId"`
		Hand       string `json:"hand"`
		HardwareID string `json:"hardwareId"`
		X          struct {
			Ref      string  `json:"ref"`
			OffsetMm float64 `json:"offsetMm"`
		} `json:"x"`
	} `json:"partialRecipe"`
	ExpectedMembers []struct {
		MemberID  string  `json:"memberId"`
		Hand      string  `json:"hand"`
		XRef      string  `json:"xRef"`
		XOffsetMm float64 `json:"xOffsetMm"`
	} `json:"expectedMembers"`
}

func loadKitPartAnchorFixture(t *testing.T) kitPartAnchorFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "kitPartAnchorParity.contract.json"))
	if err != nil {
		t.Fatalf("reading shared fixture: %v", err)
	}
	var f kitPartAnchorFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("unmarshal shared fixture: %v", err)
	}
	if len(f.ExpectedMembers) == 0 || len(f.Parts) == 0 {
		t.Fatalf("fixture carries no expectation")
	}
	return f
}

func TestKitPartAnchorSyncParity_1557(t *testing.T) {
	f := loadKitPartAnchorFixture(t)

	kit := f.Kit.ID
	parts := make([]domain.Hardware, 0, len(f.Parts)+1)
	parts = append(parts, domain.Hardware{
		ID: f.Kit.ID, Code: f.Kit.Code, Name: f.Kit.Name, Unit: domain.UnitSet, Active: true,
	})
	for _, p := range f.Parts {
		pieces := make([]domain.HardwarePiece, 0, len(p.Pieces))
		for _, pc := range p.Pieces {
			pieces = append(pieces, domain.HardwarePiece{Anchor: pc.Anchor})
		}
		kitLink := p.ID
		_ = kitLink
		parts = append(parts, domain.Hardware{
			ID: p.ID, Code: p.Code, Name: p.Name, Unit: domain.UnitPiece, Active: true,
			PreviewShape:  &p.PreviewShape,
			KitHardwareID: &kit,
			Pieces:        pieces,
		})
	}

	members := make([]domain.AgregadoRigidMember, 0, len(f.PartialRecipe))
	for _, m := range f.PartialRecipe {
		members = append(members, domain.AgregadoRigidMember{
			MemberID: m.MemberID,
			Role:     "slide",
			Source: domain.RigidMemberSource{
				Kind:  domain.RigidMemberSourceFixed,
				Fixed: &domain.FixedHardwareSource{HardwareID: m.HardwareID},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AssemblyAxisRef(m.X.Ref), OffsetMm: m.X.OffsetMm},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole:         domain.BOMRoleIncludedInKit,
			ActorMembership: "body",
			Hand:            m.Hand,
		})
	}

	agr := domain.Agregado{ID: "agr-par", Code: f.Agregado.Code, Active: true, RigidMembers: members}
	catalog := domain.Catalog{Hardware: parts}

	synced := syncAgregadoRigidMembersFromCatalog(agr, catalog, kit)

	byMember := map[string]domain.AgregadoRigidMember{}
	for _, m := range synced.RigidMembers {
		byMember[m.MemberID] = m
	}
	if len(synced.RigidMembers) != len(f.ExpectedMembers) {
		t.Fatalf("sync produced %d members, want %d: %+v", len(synced.RigidMembers), len(f.ExpectedMembers), synced.RigidMembers)
	}
	for _, want := range f.ExpectedMembers {
		got, ok := byMember[want.MemberID]
		if !ok {
			t.Fatalf("missing member %s: %+v", want.MemberID, byMember)
		}
		if got.Hand != want.Hand {
			t.Errorf("%s hand = %q, want %q", want.MemberID, got.Hand, want.Hand)
		}
		if string(got.Placement.X.Ref) != want.XRef {
			t.Errorf("%s xRef = %q, want %q", want.MemberID, got.Placement.X.Ref, want.XRef)
		}
		if got.Placement.X.OffsetMm != want.XOffsetMm {
			t.Errorf("%s xOffset = %g, want %g (defaults por-ancla)", want.MemberID, got.Placement.X.OffsetMm, want.XOffsetMm)
		}
	}
}
