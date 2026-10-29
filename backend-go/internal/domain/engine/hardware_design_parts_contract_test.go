package engine_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1417: parity test for hardware design parts against the shared contract
// fixture — parts declared on the catalog hardware attach to the rigid member
// referencing it; a monolithic hardware leaves its member untouched.
func TestHardwareDesignPartsSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../../contracts/hardwareDesignParts.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	var fixture struct {
		Hardware []domain.Hardware `json:"hardware"`
		Agregado domain.Agregado   `json:"agregado"`
		Params   struct {
			WidthMm  float64 `json:"widthMm"`
			DepthMm  float64 `json:"depthMm"`
			HeightMm float64 `json:"heightMm"`
		} `json:"params"`
		ExpectedMembers []struct {
			MemberID      string                      `json:"memberId"`
			ExpectedParts []domain.HardwareDesignPart `json:"expectedDesignParts"`
		} `json:"expectedMembers"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}

	resolved, err := engine.ResolveAgregadoAssembly(fixture.Agregado, engine.AssemblyResolutionParams{
		WidthMm:  fixture.Params.WidthMm,
		DepthMm:  fixture.Params.DepthMm,
		HeightMm: fixture.Params.HeightMm,
	})
	if err != nil {
		t.Fatalf("resolve assembly: %v", err)
	}

	byID := make(map[string]domain.Hardware, len(fixture.Hardware))
	for _, h := range fixture.Hardware {
		byID[h.ID] = h
	}
	out := engine.AttachHardwareDesignParts(resolved, byID)

	if len(out.RigidMembers) != len(fixture.ExpectedMembers) {
		t.Fatalf("expected %d rigid members, got %d", len(fixture.ExpectedMembers), len(out.RigidMembers))
	}
	for _, expected := range fixture.ExpectedMembers {
		var member *domain.ResolvedRigidMember
		for i := range out.RigidMembers {
			if out.RigidMembers[i].MemberID == expected.MemberID {
				member = &out.RigidMembers[i]
				break
			}
		}
		if member == nil {
			t.Fatalf("member %q not found in resolved assembly", expected.MemberID)
		}
		if expected.ExpectedParts == nil {
			if len(member.DesignParts) != 0 {
				t.Fatalf("member %q: expected no design parts, got %+v", expected.MemberID, member.DesignParts)
			}
			continue
		}
		if len(member.DesignParts) != len(expected.ExpectedParts) {
			t.Fatalf("member %q: expected %d design parts, got %d", expected.MemberID, len(expected.ExpectedParts), len(member.DesignParts))
		}
		for i, p := range expected.ExpectedParts {
			got := member.DesignParts[i]
			if got != p {
				t.Fatalf("member %q part %d: expected %+v, got %+v", expected.MemberID, i, p, got)
			}
		}
	}
}
