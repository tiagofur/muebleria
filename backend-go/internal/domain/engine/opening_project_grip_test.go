package engine

// #1532 (judgment-day r1 S4): the project grip BOM's between-fronts path —
// the runs multiplication per between edge, the fail-closed missing between
// profile, and the stack report feeding the edge count.

import (
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func gripBOMTestProfile(id, boundary string) *ProjectGripBOMProfile {
	spacing := 400
	return &ProjectGripBOMProfile{
		ProfileID: id,
		Version:   3,
		BOMMembers: map[string]OpeningContractBOMMember{
			"profile":  {HardwareID: "HW-8006", Rule: "interior_width", Unit: "meter"},
			"supports": {HardwareID: "HW-SU116", Rule: "per_length", SpacingMm: &spacing},
			"endCaps":  {HardwareID: "HW-CAP", Rule: "per_exposed_end"},
		},
	}
}

func TestResolveProjectGripBOMBetweenRunsMultiplyPerEdge(t *testing.T) {
	lines, resErr := ResolveProjectGripBOM(ProjectGripBOMInput{
		CabinetInteriorWidthMm: 564,
		Ends:                   OpeningBOMDefaultEnds,
		Top:                    gripBOMTestProfile("p-top", "top"),
		Between:                gripBOMTestProfile("p-between", "between"),
		BetweenEdgeCount:       2,
	})
	if resErr != nil {
		t.Fatalf("resolve: %s (%s)", resErr.Code, resErr.Message)
	}
	byBoundary := map[string]map[string]OpeningResolvedBOMLine{}
	for _, line := range lines {
		byMember := byBoundary[line.Boundary]
		if byMember == nil {
			byMember = map[string]OpeningResolvedBOMLine{}
			byBoundary[line.Boundary] = byMember
		}
		byMember[line.MemberKey] = line
	}
	if len(byBoundary) != 2 {
		t.Fatalf("boundaries = %v, want top + between", keysOf(byBoundary))
	}
	// Top: ONE run of each member with the v1 rules verbatim.
	top := byBoundary["top"]
	if top["profile"].Quantity != 0.564 || top["profile"].CutLengthMm != 564 {
		t.Fatalf("top run drifted: %+v", top["profile"])
	}
	if top["supports"].Quantity != 3 || top["endCaps"].Quantity != 2 {
		t.Fatalf("top members drifted: %+v / %+v", top["supports"], top["endCaps"])
	}
	// Between: ONE run per between edge — quantities ×2, identity intact.
	between := byBoundary["between"]
	if between["profile"].Quantity != 1.128 || between["profile"].CutLengthMm != 564 {
		t.Fatalf("between run must be 2×0.564 with the same cut: %+v", between["profile"])
	}
	if between["supports"].Quantity != 6 || between["endCaps"].Quantity != 4 {
		t.Fatalf("between members must double: %+v / %+v", between["supports"], between["endCaps"])
	}
	if between["profile"].ProfileID != "p-between" || between["profile"].ProfileVersion != 3 {
		t.Fatalf("between provenance drifted: %+v", between["profile"])
	}
}

func TestResolveProjectGripBOMFailsClosedWithoutBetweenProfile(t *testing.T) {
	_, resErr := ResolveProjectGripBOM(ProjectGripBOMInput{
		CabinetInteriorWidthMm: 564,
		Ends:                   OpeningBOMDefaultEnds,
		Top:                    gripBOMTestProfile("p-top", "top"),
		Between:                nil,
		BetweenEdgeCount:       2,
	})
	if resErr == nil || resErr.Code != OpeningErrBOMInvalid {
		t.Fatalf("a stack with between edges and no between profile must fail closed, got %v", resErr)
	}
}

func TestProjectGripFrontsNilDiscountFailsClosed(t *testing.T) {
	_, resErr := ProjectGripFronts(&domain.GripSnapshotRecipe{
		Mode:       domain.GripModeGola,
		TopProfile: &domain.FrozenGripProfile{ProfileID: "p", Code: "C"},
	})
	if resErr == nil || resErr.Code != OpeningErrLayoutInvalid {
		t.Fatalf("a gola recipe without its frozen discount must fail closed, got %v", resErr)
	}
}

func TestOpeningFrontStackReportBetweenEdgesFromAStack(t *testing.T) {
	module, catalog := drawerColumnCatalog()
	grips := OpeningEdgeGrips{}
	stack, err := OpeningFrontStackReport(module, catalog, LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 560}, nil, grips)
	if err != nil {
		t.Fatalf("stack report: %v", err)
	}
	if stack == nil || len(stack.Rows) != 3 {
		t.Fatalf("3-drawer column must report 3 rows, got %+v", stack)
	}
	// The between edges the BOM consumes: rows − 1.
	lines, resErr := ResolveProjectGripBOM(ProjectGripBOMInput{
		CabinetInteriorWidthMm: 564,
		Ends:                   OpeningBOMDefaultEnds,
		Top:                    gripBOMTestProfile("p-top", "top"),
		Between:                gripBOMTestProfile("p-between", "between"),
		BetweenEdgeCount:       len(stack.Rows) - 1,
	})
	if resErr != nil {
		t.Fatalf("resolve: %s", resErr.Code)
	}
	betweenRuns := 0
	for _, line := range lines {
		if line.Boundary == "between" && line.MemberKey == "profile" {
			betweenRuns++
			if line.Quantity != 1.128 { // 2 edges × 0.564
				t.Fatalf("between run = %v, want 1.128 (2 edges)", line.Quantity)
			}
		}
	}
	if betweenRuns != 1 {
		t.Fatalf("aggregated between run missing: %d", betweenRuns)
	}
	if len(lines) != 6 { // 3 members × 2 boundaries
		t.Fatalf("lines = %d, want 6", len(lines))
	}
}

func keysOf(m map[string]map[string]OpeningResolvedBOMLine) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

var _ = errors.New
