package domain_test

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestHardwareMountFrame_ValidOrthonormalBasis(t *testing.T) {
	raw := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [10.0, 20.0, 5.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		},
		"assetNormalization": {
			"translationMm": [-10.0, -20.0, -5.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	origin, err := domain.ValidateHardwareAssetOrigin(raw)
	if err != nil {
		t.Fatalf("ValidateHardwareAssetOrigin failed unexpectedly: %v", err)
	}
	if origin == nil || origin.MountFrame == nil || origin.AssetNormalization == nil {
		t.Fatalf("expected origin with MountFrame and AssetNormalization, got %+v", origin)
	}
	if origin.MountFrame.OriginMm != [3]float64{10.0, 20.0, 5.0} {
		t.Errorf("expected originMm [10, 20, 5], got %v", origin.MountFrame.OriginMm)
	}
}

func TestHardwareMountFrame_RejectsNonUnitVector(t *testing.T) {
	raw := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 0.0, 0.0],
			"basis": {
				"x": [2.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	_, err := domain.ValidateHardwareAssetOrigin(raw)
	if err == nil {
		t.Fatalf("expected error for non-unit basis vector, got nil")
	}
}

func TestHardwareMountFrame_RejectsNonOrthogonalAxes(t *testing.T) {
	raw := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 0.0, 0.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.70710678, 0.70710678, 0.0],
				"z": [0.0, 0.0, 1.0]
			}
		}
	}`)

	_, err := domain.ValidateHardwareAssetOrigin(raw)
	if err == nil {
		t.Fatalf("expected error for non-orthogonal basis axes, got nil")
	}
}

func TestHardwareMountFrame_RejectsMirroredBasis(t *testing.T) {
	// Left-handed basis (det = -1) must be rejected: mirror is never allowed
	raw := json.RawMessage(`{
		"sourceUnits": "mm",
		"upAxis": "z",
		"mountFrame": {
			"originMm": [0.0, 0.0, 0.0],
			"basis": {
				"x": [1.0, 0.0, 0.0],
				"y": [0.0, 1.0, 0.0],
				"z": [0.0, 0.0, -1.0]
			}
		}
	}`)

	_, err := domain.ValidateHardwareAssetOrigin(raw)
	if err == nil {
		t.Fatalf("expected error for left-handed (mirrored) basis, got nil")
	}
}

func TestHardwareMountFrame_RejectsNonFiniteValues(t *testing.T) {
	for _, invalidCoord := range []string{"NaN", "Infinity", "-Infinity"} {
		raw := json.RawMessage(`{
			"sourceUnits": "mm",
			"upAxis": "z",
			"mountFrame": {
				"originMm": [` + invalidCoord + `, 0.0, 0.0],
				"basis": {
					"x": [1.0, 0.0, 0.0],
					"y": [0.0, 1.0, 0.0],
					"z": [0.0, 0.0, 1.0]
				}
			}
		}`)
		_, err := domain.ValidateHardwareAssetOrigin(raw)
		if err == nil {
			t.Errorf("expected error for non-finite origin %s, got nil", invalidCoord)
		}
	}
}

func TestHardwareMountFrame_DeriveAssetNormalizationAndDistancePreservation(t *testing.T) {
	// SKP has handle along Y axis, mounted on XZ plane:
	// Origin at (15.0, 30.0, 45.0)
	// +X canonical (longitudinal) is along SKP +Y: (0, 1, 0)
	// +Z canonical (outward normal) is along SKP +X: (1, 0, 0)
	// +Y canonical (in-plane) is Z x X = (0, 0, -1)
	mf := domain.HardwareMountFrame{
		OriginMm: [3]float64{15.0, 30.0, 45.0},
		Basis: domain.HardwareBasis{
			X: [3]float64{0.0, 1.0, 0.0},
			Y: [3]float64{0.0, 0.0, 1.0},
			Z: [3]float64{1.0, 0.0, 0.0},
		},
	}

	norm, err := domain.DeriveAssetNormalization(mf)
	if err != nil {
		t.Fatalf("DeriveAssetNormalization failed: %v", err)
	}

	// 1. Origin maps to (0, 0, 0)
	pOrigCanonical := norm.Apply(mf.OriginMm)
	for i, val := range pOrigCanonical {
		if math.Abs(val) > 1e-6 {
			t.Errorf("pOrigCanonical[%d] = %g, want 0", i, val)
		}
	}

	// 2. Primary axis maps to canonical +X: (1, 0, 0)
	pAxisCanonical := norm.ApplyVector(mf.Basis.X)
	if math.Abs(pAxisCanonical[0]-1.0) > 1e-6 || math.Abs(pAxisCanonical[1]) > 1e-6 || math.Abs(pAxisCanonical[2]) > 1e-6 {
		t.Errorf("pAxisCanonical = %v, want [1, 0, 0]", pAxisCanonical)
	}

	// 3. Normal axis maps to canonical +Z: (0, 0, 1)
	pNormCanonical := norm.ApplyVector(mf.Basis.Z)
	if math.Abs(pNormCanonical[0]) > 1e-6 || math.Abs(pNormCanonical[1]) > 1e-6 || math.Abs(pNormCanonical[2]-1.0) > 1e-6 {
		t.Errorf("pNormCanonical = %v, want [0, 0, 1]", pNormCanonical)
	}

	// 4. Distance preservation invariant (rigid transform):
	// Distance between two arbitrary points in SKP space must equal distance in canonical space
	pt1 := [3]float64{10.0, 50.0, 20.0}
	pt2 := [3]float64{80.0, -20.0, 95.0}

	dx := pt2[0] - pt1[0]
	dy := pt2[1] - pt1[1]
	dz := pt2[2] - pt1[2]
	distSKP := math.Sqrt(dx*dx + dy*dy + dz*dz)

	c1 := norm.Apply(pt1)
	c2 := norm.Apply(pt2)
	cdx := c2[0] - c1[0]
	cdy := c2[1] - c1[1]
	cdz := c2[2] - c1[2]
	distCanonical := math.Sqrt(cdx*cdx + cdy*cdy + cdz*cdz)

	if math.Abs(distSKP-distCanonical) > 1e-6 {
		t.Errorf("distance not preserved: SKP dist = %g, canonical dist = %g", distSKP, distCanonical)
	}
}

func TestHardwareAssetRevision_PreparationStateVsValidationState(t *testing.T) {
	// Revision without MountFrame/AssetNormalization is unprepared
	revUnprepared := domain.HardwareAssetRevision{
		ID:              "rev-1",
		ValidationState: domain.HardwareAssetValidationValidated, // host validated but no mount frame
		Origin: &domain.HardwareAssetOrigin{
			SourceUnits: "mm",
			UpAxis:      "z",
		},
	}
	if revUnprepared.PreparationState() != domain.HardwareAssetPreparationUnprepared {
		t.Errorf("expected unprepared, got %s", revUnprepared.PreparationState())
	}

	// Revision with MountFrame and AssetNormalization is prepared
	revPrepared := domain.HardwareAssetRevision{
		ID:              "rev-2",
		ValidationState: domain.HardwareAssetValidationPending, // pending host test but prepared
		Origin: &domain.HardwareAssetOrigin{
			SourceUnits: "mm",
			UpAxis:      "z",
			MountFrame: &domain.HardwareMountFrame{
				OriginMm: [3]float64{0, 0, 0},
				Basis: domain.HardwareBasis{
					X: [3]float64{1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
			},
			AssetNormalization: &domain.HardwareAssetNormalization{
				TranslationMm: [3]float64{0, 0, 0},
				Basis: domain.HardwareBasis{
					X: [3]float64{1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
			},
		},
	}
	if revPrepared.PreparationState() != domain.HardwareAssetPreparationPrepared {
		t.Errorf("expected prepared, got %s", revPrepared.PreparationState())
	}
	if revPrepared.ValidationState != domain.HardwareAssetValidationPending {
		t.Errorf("validationState must remain pending, got %s", revPrepared.ValidationState)
	}
}

func TestHardwareHandle_ValidateHoleSpacing(t *testing.T) {
	// Hole 1 at (0, -80, 0), Hole 2 at (0, 80, 0) -> distance = 160 mm
	hole1 := [3]float64{0.0, -80.0, 0.0}
	hole2 := [3]float64{0.0, 80.0, 0.0}

	// 1. Matches exact 160 mm within 1.0 mm tolerance
	actual, ok := domain.ValidateHoleSpacing(hole1, hole2, 160.0, 1.0)
	if !ok || math.Abs(actual-160.0) > 1e-6 {
		t.Errorf("expected match at 160 mm, got actual=%g ok=%v", actual, ok)
	}

	// 2. Discrepancy: expected 128 mm, actual is 160 mm -> fails validation
	actualWrong, okWrong := domain.ValidateHoleSpacing(hole1, hole2, 128.0, 1.0)
	if okWrong {
		t.Errorf("expected failure for 128 mm vs actual %g, got ok=true", actualWrong)
	}
}

func TestHardwareHandle_CompareNominalVsMeasured(t *testing.T) {
	// Configurable tolerance (e.g. 1.5 mm)
	customTolerance := 1.5

	// Case A: 160 mm nominal vs 160.4 mm measured -> within tolerance
	discA := domain.CompareNominalVsMeasured(160.0, 160.4, customTolerance, "overallLength")
	if discA != nil {
		t.Errorf("expected no discrepancy within tolerance, got %+v", discA)
	}

	// Case B: 160 mm nominal vs 1600 mm measured -> strong discrepancy
	discB := domain.CompareNominalVsMeasured(160.0, 1600.0, customTolerance, "overallLength")
	if discB == nil {
		t.Fatalf("expected discrepancy for 160 mm vs 1600 mm, got nil")
	}
	if discB.Dimension != "overallLength" || discB.NominalMm != 160.0 || discB.MeasuredMm != 1600.0 {
		t.Errorf("unexpected discrepancy content: %+v", discB)
	}
	if math.Abs(discB.DeltaMm-1440.0) > 1e-6 {
		t.Errorf("expected delta 1440 mm, got %g", discB.DeltaMm)
	}
}
