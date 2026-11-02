package engine_test

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1460 F2 — parity twin of packages/domain
// agregadoMemberDimensionOverride.contract.test.ts: el MISMO fixture
// (contracts/agregadoMemberDimensionOverride.contract.json) fija el merge
// override↔catálogo, el entorno de la fórmula (PW/PH/PD + HW/HH/HD de
// catálogo) y la exposición de resolvedDimensions (sólo con override) en el
// resolve Go — idéntico al TS, incluido el caso legacy sin override.
func TestAgregadoMemberDimensionOverrideSharedContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/agregadoMemberDimensionOverride.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		SchemaID string `json:"schemaId"`
		Params   struct {
			WidthMm  float64 `json:"widthMm"`
			DepthMm  float64 `json:"depthMm"`
			HeightMm float64 `json:"heightMm"`
		} `json:"params"`
		HardwareDimensions map[string]domain.HardwareDimensions `json:"hardwareDimensions"`
		// Runtime-neutral (TS camelCase): domain.Agregado carries snake_case
		// JSON tags, so the recipe maps explicitly like every shared fixture.
		Agregado struct {
			ID           string                       `json:"id"`
			RigidMembers []domain.AgregadoRigidMember `json:"rigidMembers"`
		} `json:"agregado"`
		Expected map[string]struct {
			TranslationMm      [3]float64                 `json:"translationMm"`
			ResolvedDimensions *domain.HardwareDimensions `json:"resolvedDimensions"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	if fixture.SchemaID != "granete.agregado-member-dimension-override.v1" {
		t.Fatalf("unexpected fixture schema %q", fixture.SchemaID)
	}

	resolved, err := engine.ResolveAgregadoAssembly(domain.Agregado{
		ID:           fixture.Agregado.ID,
		RigidMembers: fixture.Agregado.RigidMembers,
	}, engine.AssemblyResolutionParams{
		WidthMm:            fixture.Params.WidthMm,
		DepthMm:            fixture.Params.DepthMm,
		HeightMm:           fixture.Params.HeightMm,
		HardwareDimensions: fixture.HardwareDimensions,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	byID := map[string]domain.ResolvedRigidMember{}
	for _, m := range resolved.RigidMembers {
		byID[m.MemberID] = m
	}
	for memberID, want := range fixture.Expected {
		m, ok := byID[memberID]
		if !ok {
			t.Fatalf("member %s not resolved", memberID)
		}
		for i := range want.TranslationMm {
			if math.Abs(m.LocalTransform.TranslationMm[i]-want.TranslationMm[i]) > 0.0001 {
				t.Fatalf("%s translationMm[%d]: expected %v, got %v", memberID, i, want.TranslationMm, m.LocalTransform.TranslationMm)
			}
		}
		if want.ResolvedDimensions == nil {
			if m.ResolvedDimensions != nil {
				t.Fatalf("%s: expected no resolvedDimensions (legacy byte-identical), got %+v", memberID, m.ResolvedDimensions)
			}
			continue
		}
		if m.ResolvedDimensions == nil {
			t.Fatalf("%s: expected resolvedDimensions %+v, got none", memberID, want.ResolvedDimensions)
		}
		if math.Abs(m.ResolvedDimensions.WidthMm-want.ResolvedDimensions.WidthMm) > 0.0001 ||
			math.Abs(m.ResolvedDimensions.HeightMm-want.ResolvedDimensions.HeightMm) > 0.0001 ||
			math.Abs(m.ResolvedDimensions.DepthMm-want.ResolvedDimensions.DepthMm) > 0.0001 {
			t.Fatalf("%s resolvedDimensions: expected %+v, got %+v", memberID, want.ResolvedDimensions, m.ResolvedDimensions)
		}
	}
}
