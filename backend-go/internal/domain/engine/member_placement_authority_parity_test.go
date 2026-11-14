package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1625: paridad TS↔Go de «la posición del miembro la manda el catálogo».
// Autoridad única: contracts/fixtures/memberPlacementAuthority.contract.json.
// Este lado ejerce el sync REAL (syncAgregadoRigidMembersFromCatalog) sobre un
// miembro con posición centinela: si el sync la reescribe, la posición la manda
// el catálogo. El espejo TS (memberPlacementAuthority) vive en
// packages/domain/src/memberPlacementAuthority.contract.test.ts.

type memberPlacementFixture struct {
	Hardware []struct {
		ID     string `json:"id"`
		Code   string `json:"code"`
		Label  string `json:"label"`
		Pieces []struct {
			Anchor   string                      `json:"anchor"`
			OffsetMm *domain.HardwarePieceOffset `json:"offsetMm"`
		} `json:"pieces"`
	} `json:"hardware"`
	Cases []struct {
		Name       string `json:"name"`
		HardwareID string `json:"hardwareId"`
		Hand       string `json:"hand"`
		Expected   string `json:"expected"`
		// ExpectedPlacement: the placement the sync leaves on the stored
		// member (derived cases only).
		ExpectedPlacement *struct {
			X, Y, Z struct {
				Ref      string  `json:"ref"`
				OffsetMm float64 `json:"offsetMm"`
			}
		} `json:"expectedPlacement"`
	} `json:"cases"`
}

func TestMemberPlacementAuthorityParity_1625(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "memberPlacementAuthority.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}
	var f memberPlacementFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}

	catalog := domain.Catalog{}
	for _, h := range f.Hardware {
		hw := domain.Hardware{ID: h.ID, Code: h.Code, Name: h.Code, Unit: "piece", Active: true}
		for _, p := range h.Pieces {
			hw.Pieces = append(hw.Pieces, domain.HardwarePiece{Anchor: p.Anchor, OffsetMm: p.OffsetMm})
		}
		if h.Label != "" {
			hw.DesignParts = []domain.HardwareDesignPart{{ComponentName: h.Code, Label: h.Label}}
		}
		catalog.Hardware = append(catalog.Hardware, hw)
	}

	sentinelFormula := "PW/3"
	sentinel := domain.AssemblyAnchorRule{
		X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefCenter, OffsetMm: 777, OffsetFormula: &sentinelFormula},
		Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 777},
		Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 777},
	}

	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			agr := domain.Agregado{
				ID:   "agr-placement",
				Code: "AGR-PLACEMENT",
				RigidMembers: []domain.AgregadoRigidMember{{
					MemberID:  "m1",
					Role:      "part",
					Source:    domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: c.HardwareID}},
					Placement: sentinel,
					Hand:      c.Hand,
				}},
			}
			// Sin kit efectivo: el sync no añade ni filtra partes, sólo refresca
			// la posición de los miembros existentes — exactamente la regla.
			synced := syncAgregadoRigidMembersFromCatalog(agr, catalog, "")
			if len(synced.RigidMembers) != 1 {
				t.Fatalf("sync changed the member count: %d", len(synced.RigidMembers))
			}
			got := synced.RigidMembers[0].Placement
			rewritten := got.X.Ref != sentinel.X.Ref || got.X.OffsetMm != 777 || got.X.OffsetFormula == nil ||
				got.Y.OffsetMm != 777 || got.Z.OffsetMm != 777
			if rewritten != (c.Expected != "none") {
				t.Fatalf("expected %q, sync rewrote placement = %v (%+v)", c.Expected, rewritten, got)
			}
			if c.ExpectedPlacement != nil {
				want := c.ExpectedPlacement
				axes := []struct {
					name string
					got  domain.AssemblyAxisPlacement
					ref  string
					off  float64
				}{
					{"x", got.X, want.X.Ref, want.X.OffsetMm},
					{"y", got.Y, want.Y.Ref, want.Y.OffsetMm},
					{"z", got.Z, want.Z.Ref, want.Z.OffsetMm},
				}
				for _, a := range axes {
					if string(a.got.Ref) != a.ref || a.got.OffsetMm != a.off || a.got.OffsetFormula != nil {
						t.Fatalf("axis %s = %+v, want ref %s offset %g", a.name, a.got, a.ref, a.off)
					}
				}
			}
		})
	}
}
