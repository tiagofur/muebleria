package domain_test

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Canonical SKP/GLB parity (#669 Gate P0).
//
// Single numeric authority: contracts/fixtures/glb-parity-canonical.json.
// The Go domain must derive the same asset normalization and compose the same
// placement chain (furniture x assembly x member x inverse(mountFrame)) that
// the SketchUp host smoke measured and the TS domain suite asserts, so no
// runtime can keep a "slightly different" interpretation of the GLB boundary.
//
// The expected world points are hand-derived constants in the canonical file;
// they are never produced by the functions under test.

const glbParityFixturePath = "../../../contracts/fixtures/glb-parity-canonical.json"
const glbParityToleranceMm = 1e-3
const glbParityMutantMinErrorMm = 1.0

type glbParityBasis struct {
	X [3]float64 `json:"x"`
	Y [3]float64 `json:"y"`
	Z [3]float64 `json:"z"`
}

type glbParityFixture struct {
	Asset struct {
		NominalExtentsMm    [3]float64          `json:"nominalExtentsMm"`
		MountFrame          domain.HardwareMountFrame `json:"mountFrame"`
		ReferencePointsAssetMm [][3]float64      `json:"referencePointsAssetMm"`
	} `json:"asset"`
	GlbRepresentation struct {
		SourceUnits               string      `json:"sourceUnits"`
		UpAxis                    string      `json:"upAxis"`
		ExpectedGlbReferencePointsM [][3]float64 `json:"expectedGlbReferencePointsM"`
	} `json:"glbRepresentation"`
	PlacementChain struct {
		Furniture struct {
			TranslationMm [3]float64 `json:"translationMm"`
		} `json:"furniture"`
		Assembly struct {
			TranslationMm [3]float64 `json:"translationMm"`
		} `json:"assembly"`
		Member struct {
			TranslationMm [3]float64    `json:"translationMm"`
			Basis         glbParityBasis `json:"basis"`
		} `json:"member"`
	} `json:"placementChain"`
	Expected struct {
		AssetNormalization struct {
			TranslationMm [3]float64    `json:"translationMm"`
			Basis         glbParityBasis `json:"basis"`
		} `json:"assetNormalization"`
		ReferencePoints []struct {
			AssetMm        [3]float64 `json:"assetMm"`
			ExpectedWorldMm [3]float64 `json:"expectedWorldMm"`
		} `json:"referencePoints"`
	} `json:"expected"`
}

func loadGlbParityFixture(t *testing.T) glbParityFixture {
	t.Helper()
	raw, err := os.ReadFile(glbParityFixturePath)
	if err != nil {
		t.Fatalf("read canonical fixture: %v", err)
	}
	var fixture glbParityFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse canonical fixture: %v", err)
	}
	return fixture
}

func applyBasis(b glbParityBasis, p [3]float64) [3]float64 {
	return [3]float64{
		p[0]*b.X[0] + p[1]*b.Y[0] + p[2]*b.Z[0],
		p[0]*b.X[1] + p[1]*b.Y[1] + p[2]*b.Z[1],
		p[0]*b.X[2] + p[1]*b.Y[2] + p[2]*b.Z[2],
	}
}

func addPoints(a, b [3]float64) [3]float64 {
	return [3]float64{a[0] + b[0], a[1] + b[1], a[2] + b[2]}
}

func pointDistanceMm(a, b [3]float64) float64 {
	dx, dy, dz := a[0]-b[0], a[1]-b[1], a[2]-b[2]
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}

// glbPointToAssetMm mirrors the canonical GLB boundary conversion
// (metres Y-up -> mm Z-up): asset = (X, -Z, Y) * unitScale.
func glbPointToAssetMm(sourceUnits string, upAxis string, p [3]float64) [3]float64 {
	scale := 1000.0
	switch sourceUnits {
	case "mm":
		scale = 1.0
	case "cm":
		scale = 10.0
	case "inch":
		scale = 25.4
	}
	x, y, z := p[0]*scale, p[1]*scale, p[2]*scale
	if upAxis == "z" {
		return [3]float64{x, y, z}
	}
	return [3]float64{x, -z, y}
}

// chainToWorld composes furniture x assembly x (member x normalization).
func chainToWorld(f glbParityFixture, norm domain.HardwareAssetNormalization, p [3]float64) [3]float64 {
	normalized := norm.Apply(p)
	member := addPoints(f.PlacementChain.Member.TranslationMm, applyBasis(f.PlacementChain.Member.Basis, normalized))
	assembly := addPoints(f.PlacementChain.Assembly.TranslationMm, member)
	return addPoints(f.PlacementChain.Furniture.TranslationMm, assembly)
}

func TestGlbParityCanonicalNormalizationMatchesContract(t *testing.T) {
	fixture := loadGlbParityFixture(t)
	norm, err := domain.DeriveAssetNormalization(fixture.Asset.MountFrame)
	if err != nil {
		t.Fatalf("derive normalization: %v", err)
	}
	want := fixture.Expected.AssetNormalization
	for i := 0; i < 3; i++ {
		if math.Abs(norm.TranslationMm[i]-want.TranslationMm[i]) > 1e-9 {
			t.Fatalf("normalization translation[%d] = %v, want %v", i, norm.TranslationMm[i], want.TranslationMm[i])
		}
	}
	bases := map[string][2][3]float64{
		"x": {norm.Basis.X, want.Basis.X},
		"y": {norm.Basis.Y, want.Basis.Y},
		"z": {norm.Basis.Z, want.Basis.Z},
	}
	for axis, pair := range bases {
		for i := 0; i < 3; i++ {
			if math.Abs(pair[0][i]-pair[1][i]) > 1e-9 {
				t.Fatalf("normalization basis %s[%d] = %v, want %v", axis, i, pair[0][i], pair[1][i])
			}
		}
	}
}

func TestGlbParityCanonicalWorldPoints(t *testing.T) {
	fixture := loadGlbParityFixture(t)
	norm, err := domain.DeriveAssetNormalization(fixture.Asset.MountFrame)
	if err != nil {
		t.Fatalf("derive normalization: %v", err)
	}

	if len(fixture.GlbRepresentation.ExpectedGlbReferencePointsM) != len(fixture.Expected.ReferencePoints) {
		t.Fatalf("canonical fixture glb/reference point count mismatch")
	}

	for i, rp := range fixture.Expected.ReferencePoints {
		assetFromGlb := glbPointToAssetMm(
			fixture.GlbRepresentation.SourceUnits,
			fixture.GlbRepresentation.UpAxis,
			fixture.GlbRepresentation.ExpectedGlbReferencePointsM[i],
		)
		for axis := 0; axis < 3; axis++ {
			if math.Abs(assetFromGlb[axis]-rp.AssetMm[axis]) > 1e-6 {
				t.Fatalf("P%d glb->asset axis %d = %v, want %v", i, axis, assetFromGlb[axis], rp.AssetMm[axis])
			}
		}
		world := chainToWorld(fixture, norm, assetFromGlb)
		if delta := pointDistanceMm(world, rp.ExpectedWorldMm); delta > glbParityToleranceMm {
			t.Fatalf("P%d world = %v, want %v (delta %g mm)", i, world, rp.ExpectedWorldMm, delta)
		}
	}
}

func TestGlbParityCanonicalMutantSensitivity(t *testing.T) {
	fixture := loadGlbParityFixture(t)
	norm, err := domain.DeriveAssetNormalization(fixture.Asset.MountFrame)
	if err != nil {
		t.Fatalf("derive normalization: %v", err)
	}

	memberNoNorm := func(p [3]float64) [3]float64 {
		member := addPoints(fixture.PlacementChain.Member.TranslationMm, applyBasis(fixture.PlacementChain.Member.Basis, p))
		return addPoints(addPoints(fixture.PlacementChain.Furniture.TranslationMm, fixture.PlacementChain.Assembly.TranslationMm), member)
	}
	mutants := map[string]func(i int) [3]float64{
		"unit_x25_4": func(i int) [3]float64 {
			p := fixture.GlbRepresentation.ExpectedGlbReferencePointsM[i]
			scaled := [3]float64{p[0] * 25.4, p[1] * 25.4, p[2] * 25.4}
			return chainToWorld(fixture, norm, glbPointToAssetMm(fixture.GlbRepresentation.SourceUnits, fixture.GlbRepresentation.UpAxis, scaled))
		},
		"unit_x1000": func(i int) [3]float64 {
			p := fixture.GlbRepresentation.ExpectedGlbReferencePointsM[i]
			scaled := [3]float64{p[0] * 1000, p[1] * 1000, p[2] * 1000}
			return chainToWorld(fixture, norm, glbPointToAssetMm(fixture.GlbRepresentation.SourceUnits, fixture.GlbRepresentation.UpAxis, scaled))
		},
		"omitted": func(i int) [3]float64 {
			asset := fixture.Asset.ReferencePointsAssetMm[i]
			return memberNoNorm(asset)
		},
		"double": func(i int) [3]float64 {
			asset := fixture.Asset.ReferencePointsAssetMm[i]
			return chainToWorld(fixture, norm, norm.Apply(asset))
		},
	}

	for mode, mutant := range mutants {
		minDelta := math.Inf(1)
		for i, rp := range fixture.Expected.ReferencePoints {
			if delta := pointDistanceMm(mutant(i), rp.ExpectedWorldMm); delta < minDelta {
				minDelta = delta
			}
		}
		if minDelta <= glbParityMutantMinErrorMm {
			t.Fatalf("mutant %s would not be detectable (min error %g mm)", mode, minDelta)
		}
	}
}
