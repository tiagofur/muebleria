package engine_test

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1518 F1 (was #1512): paridad TS↔Go del herraje multi-diseño (pieces con
// anclas left/right/center). Datos NEUTROS en
// contracts/fixtures/handsAssemblyParity.contract.json — cada lado construye
// sus objetos tipados (patrón accessoryKitParity). El espejo TS vive en
// packages/domain/src/handsAssemblyParity.test.ts.

type handsParityFixture struct {
	Assembly struct {
		WidthMm  float64 `json:"widthMm"`
		DepthMm  float64 `json:"depthMm"`
		HeightMm float64 `json:"heightMm"`
	} `json:"assembly"`
	Hardware []struct {
		ID       string  `json:"id"`
		Code     string  `json:"code"`
		Name     string  `json:"name"`
		WidthMm  float64 `json:"widthMm"`
		HeightMm float64 `json:"heightMm"`
		DepthMm  float64 `json:"depthMm"`
		Global   struct {
			AssetID         string `json:"assetId"`
			AssetRevisionID string `json:"assetRevisionId"`
			SHA256          string `json:"sha256"`
		} `json:"globalAsset"`
		Pieces []struct {
			Anchor   string `json:"anchor"`
			AssetID  string `json:"assetId"`
			Revision string `json:"assetRevisionId"`
			SHA256   string `json:"sha256"`
			OffsetMm *struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
				Z float64 `json:"z"`
			} `json:"offsetMm"`
		} `json:"pieces"`
	} `json:"hardware"`
	Members []struct {
		MemberID   string  `json:"memberId"`
		Role       string  `json:"role"`
		HardwareID string  `json:"hardwareId"`
		Hand       string  `json:"hand"`
		YRef       string  `json:"yRef"`
		ZRef       string  `json:"zRef"`
		ZOffsetMm  float64 `json:"zOffsetMm"`
	} `json:"members"`
	Expected struct {
		Members []struct {
			MemberID string  `json:"memberId"`
			Hand     string  `json:"hand"`
			XCoordMm float64 `json:"xCoordMm"`
			ZCoordMm float64 `json:"zCoordMm"`
			AssetID  string  `json:"assetId"`
		} `json:"members"`
	} `json:"expected"`
}

func TestHandsAssemblyParity_1518(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "handsAssemblyParity.contract.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var f handsParityFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}

	hardware := make([]domain.Hardware, 0, len(f.Hardware))
	for _, h := range f.Hardware {
		hw := domain.Hardware{
			ID:       h.ID,
			Code:     h.Code,
			Name:     h.Name,
			Unit:     domain.HardwareUnit("piece"),
			Active:   true,
			VisualAsset: &domain.HardwareVisualAssetBinding{
				AssetID:         h.Global.AssetID,
				AssetRevisionID: h.Global.AssetRevisionID,
				SHA256:          h.Global.SHA256,
			},
		}
		for _, pc := range h.Pieces {
			piece := domain.HardwarePiece{Anchor: pc.Anchor}
			if pc.AssetID != "" && pc.Revision != "" {
				piece.Asset = &domain.HardwareVisualAssetBinding{
					AssetID:         pc.AssetID,
					AssetRevisionID: pc.Revision,
					SHA256:          pc.SHA256,
				}
			}
			if pc.OffsetMm != nil {
				piece.OffsetMm = &domain.HardwarePieceOffset{X: pc.OffsetMm.X, Y: pc.OffsetMm.Y, Z: pc.OffsetMm.Z}
			}
			hw.Pieces = append(hw.Pieces, piece)
		}
		hw.Dimensions = &domain.HardwareDimensions{WidthMm: h.WidthMm, HeightMm: h.HeightMm, DepthMm: h.DepthMm}
		hardware = append(hardware, hw)
	}
	catalog := domain.Catalog{Hardware: hardware}

	members := make([]domain.AgregadoRigidMember, 0, len(f.Members))
	for _, m := range f.Members {
		members = append(members, domain.AgregadoRigidMember{
			MemberID: m.MemberID,
			Role:     m.Role,
			Source: domain.RigidMemberSource{
				Kind:  domain.RigidMemberSourceFixed,
				Fixed: &domain.FixedHardwareSource{HardwareID: m.HardwareID},
			},
			// Ref X VACÍA a propósito: el default por ancla es lo bajo prueba.
			Placement: domain.AssemblyAnchorRule{
				Y: domain.AssemblyAxisPlacement{Ref: domain.AssemblyAxisRef(m.YRef)},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AssemblyAxisRef(m.ZRef), OffsetMm: m.ZOffsetMm},
			},
			BOMRole: domain.BOMRoleSeparatelyPurchased,
			Hand:    m.Hand,
		})
	}
	agr := domain.Agregado{ID: "agr-pieces", Code: "PIECES-SYNTH", RigidMembers: members}

	res, err := engine.ResolveAgregadoAssembly(agr, engine.AssemblyResolutionParams{
		WidthMm:  f.Assembly.WidthMm,
		DepthMm:  f.Assembly.DepthMm,
		HeightMm: f.Assembly.HeightMm,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	engine.AttachHardwareAssetsToMembers(res.RigidMembers, catalog)

	if len(res.RigidMembers) != len(f.Expected.Members) {
		t.Fatalf("members = %d, want %d", len(res.RigidMembers), len(f.Expected.Members))
	}
	for _, exp := range f.Expected.Members {
		var got *domain.ResolvedRigidMember
		for i := range res.RigidMembers {
			if res.RigidMembers[i].MemberID == exp.MemberID {
				got = &res.RigidMembers[i]
				break
			}
		}
		if got == nil {
			t.Errorf("miembro %s ausente", exp.MemberID)
			continue
		}
		if got.Hand != exp.Hand {
			t.Errorf("miembro %s: hand = %q, want %q", exp.MemberID, got.Hand, exp.Hand)
		}
		if x := got.LocalTransform.TranslationMm[0]; math.Abs(x-exp.XCoordMm) > 1e-6 {
			t.Errorf("miembro %s: xCoord = %g, want %g", exp.MemberID, x, exp.XCoordMm)
		}
		if z := got.LocalTransform.TranslationMm[2]; math.Abs(z-exp.ZCoordMm) > 1e-6 {
			t.Errorf("miembro %s: zCoord = %g, want %g", exp.MemberID, z, exp.ZCoordMm)
		}
		if got.AssetID == nil || *got.AssetID != exp.AssetID {
			t.Errorf("miembro %s: assetId = %v, want %s", exp.MemberID, got.AssetID, exp.AssetID)
		}
	}
}
