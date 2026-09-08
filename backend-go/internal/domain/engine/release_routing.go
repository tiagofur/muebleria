package engine

import (
	"fmt"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #577 frozen manufacturing routing evidence. The ProductionRelease snapshot
// (schema v2) freezes a machine-NEUTRAL routing program per physical unit:
// what each released part requires (cut, edge banding sides, drilling) with
// exact part identity and machining provenance. It deliberately freezes
// manufacturing INTENT, never machine instructions (no PTX/SAW/MPR/CADmatic
// syntax, no controller coordinates) — station/machine adapters own that
// translation later (#591/#351 lane).
//
// Authority: the EXISTING #477 authoring resolve engine, invoked server-side
// at release time over the definition-default state (no authored occurrences,
// no relationships — release units already fail closed on those — and the
// catalog's component-instance hardware placements materialized as the
// effective manual set). No second manufacturing engine, no TS
// projectDrilling port: the Go resolver is the release-side authority.

// ReleaseRoutingProgramContract versions the frozen neutral program shape so
// a future extension never collides with a v1 payload.
const ReleaseRoutingProgramContract = "granete.release-manufacturing-program.v1"

// Neutral operation intents. DRILL is the neutral manufacturing intent; the
// physical execution vocabulary maps it to the existing "cnc" station
// operation at derivation time (domain part execution), never here.
const (
	ReleaseRoutingOperationCut      = "cut"
	ReleaseRoutingOperationEdgeBand = "edge_banding"
	ReleaseRoutingOperationDrill    = "drill"
)

// ReleaseRoutingHole is one frozen board-local machining feature (#477
// ResolveHole parity: face/reference plane, position, diameter, depth, type).
type ReleaseRoutingHole struct {
	Face       string  `json:"face"`
	XMm        float64 `json:"xMm"`
	YMm        float64 `json:"yMm"`
	DiameterMm float64 `json:"diameterMm"`
	DepthMm    float64 `json:"depthMm"`
	Type       string  `json:"type"`
}

// ReleaseRoutingOperation is one frozen machining operation with the exact
// provenance the #477 resolver derived it from.
type ReleaseRoutingOperation struct {
	OperationID string                      `json:"operationId"`
	Provenance  ResolvedMachiningProvenance `json:"provenance"`
	Operation   string                      `json:"operation"`
	Holes       []ReleaseRoutingHole        `json:"holes"`
}

// ReleaseRoutingPart is the frozen routing evidence of ONE released part.
// CncRequired is the EXPLICIT resolved verdict of the authoritative machining
// derivation — false means the resolver ran and produced no machining
// operation hosted on this part, never "data missing" (missing evidence keeps
// the whole program invalid and physical execution blocked).
type ReleaseRoutingPart struct {
	PartID            string                   `json:"partId"`
	Cut               bool                     `json:"cut"`
	EdgeBandingSides  []string                 `json:"edgeBandingSides,omitempty"`
	CncRequired       bool                     `json:"cncRequired"`
	Operations        []ReleaseRoutingOperation `json:"operations,omitempty"`
}

// ReleaseRoutingUnit is the frozen routing program of one physical unit.
type ReleaseRoutingUnit struct {
	FurnitureInstanceID   string `json:"furnitureInstanceId"`
	FurnitureDefinitionID string `json:"furnitureDefinitionId"`
	// MachiningFingerprint is the #477 resolve fingerprint frozen at P1 time:
	// identical inputs resolve to the identical string, so a later catalog or
	// rule change can never silently reproduce this program.
	MachiningFingerprint string               `json:"machiningFingerprint"`
	Parts                []ReleaseRoutingPart `json:"parts"`
}

// ReleaseRoutingProgram is the neutral frozen routing section of a schema-v2
// ProductionRelease manufacturing snapshot.
type ReleaseRoutingProgram struct {
	Contract                string               `json:"contract"`
	IndustrialRulesRevision string               `json:"industrialRulesRevision"`
	Units                   []ReleaseRoutingUnit `json:"units"`
}

// DeriveReleaseRoutingProgram derives the neutral routing program of an exact
// release collection. Pure and fail-closed: any structural or manufacturing
// error issue from the authoritative resolve blocks the whole derivation (a
// release can never commit without complete routing evidence), and a machining
// operation hosted outside the frozen BOM part identities is an error, never a
// silent drop.
func DeriveReleaseRoutingProgram(items []domain.DesignRevisionItem, units []ResolvedReleaseUnit, catalog domain.Catalog) (*ReleaseRoutingProgram, error) {
	if len(items) != len(units) || len(units) == 0 {
		return nil, fmt.Errorf("routing program requires matching nonempty items and units")
	}
	program := &ReleaseRoutingProgram{
		Contract:                ReleaseRoutingProgramContract,
		IndustrialRulesRevision: AuthoringIndustrialRulesRevision(),
		Units:                   make([]ReleaseRoutingUnit, 0, len(units)),
	}
	for i := range units {
		unitProgram, err := deriveReleaseRoutingUnit(items[i], units[i], catalog)
		if err != nil {
			return nil, fmt.Errorf("routing unit %s: %w", items[i].FurnitureInstanceID, err)
		}
		program.Units = append(program.Units, *unitProgram)
	}
	if err := ValidateReleaseRoutingProgram(program, units); err != nil {
		return nil, err
	}
	return program, nil
}

func deriveReleaseRoutingUnit(item domain.DesignRevisionItem, unit ResolvedReleaseUnit, catalog domain.Catalog) (*ReleaseRoutingUnit, error) {
	var module domain.Module
	matches := 0
	for _, candidate := range catalog.Modules {
		if candidate.ID == unit.FurnitureDefinitionID {
			module = candidate
			matches++
		}
	}
	if matches != 1 {
		return nil, fmt.Errorf("routing unit requires exactly one matching definition")
	}

	dims, err := releaseUnitLayoutDims(module, item)
	if err != nil {
		return nil, err
	}

	// Definition-default resolve (#477): no authored occurrences, no
	// relationships, catalog hardware placements materialized as the
	// effective manual set. Same binding application and part identity
	// namespace the BOM resolution already used for this unit.
	resolved, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:                  module,
		Catalog:                 catalog,
		Dims:                    dims,
		OptionChoices:           item.MaterialChoices,
		Occurrences:             nil,
		Relationships:           nil,
		ManualPlacements:        nil,
		ManualPlacementsPresent: false,
		EvaluatedParameters:     unit.EvaluatedParameters,
	})
	if err != nil {
		return nil, err
	}
	if len(resolved.StructuralIssues) > 0 {
		return nil, fmt.Errorf("authoring resolve rejected the definition-default state: %s", resolved.StructuralIssues[0].Message)
	}
	for _, issue := range resolved.ValidationIssues {
		if issue.Severity == domain.IssueSeverityError {
			return nil, fmt.Errorf("machining derivation issue %s: %s", issue.Code, issue.Message)
		}
	}

	operationsByHost := make(map[string][]ReleaseRoutingOperation, len(resolved.Machining.Operations))
	for _, operation := range resolved.Machining.Operations {
		if len(operation.Holes) == 0 {
			continue
		}
		holes := make([]ReleaseRoutingHole, 0, len(operation.Holes))
		for _, hole := range operation.Holes {
			holes = append(holes, ReleaseRoutingHole{
				Face: hole.Face, XMm: hole.XMm, YMm: hole.YMm,
				DiameterMm: hole.DiameterMm, DepthMm: hole.DepthMm, Type: hole.Type,
			})
		}
		operationsByHost[operation.HostComponentInstanceID] = append(operationsByHost[operation.HostComponentInstanceID], ReleaseRoutingOperation{
			OperationID: operation.OperationID,
			Provenance:  operation.Provenance,
			Operation:   ReleaseRoutingOperationDrill,
			Holes:       holes,
		})
	}

	parts := make([]ReleaseRoutingPart, 0, len(unit.BOM.BoardParts))
	knownHosts := make(map[string]bool, len(unit.BOM.BoardParts))
	for _, board := range unit.BOM.BoardParts {
		knownHosts[board.ID] = true
		sides := make([]string, 0, len(board.Edges))
		for _, edge := range board.Edges {
			if edge.Enabled {
				sides = append(sides, edge.Side)
			}
		}
		operations := operationsByHost[board.ID]
		// Deterministic order regardless of resolver map iteration order.
		sort.Slice(operations, func(a, b int) bool {
			return operations[a].OperationID < operations[b].OperationID
		})
		parts = append(parts, ReleaseRoutingPart{
			PartID:           board.ID,
			Cut:              true,
			EdgeBandingSides: sides,
			CncRequired:      len(operations) > 0,
			Operations:       operations,
		})
	}
	for host := range operationsByHost {
		if !knownHosts[host] {
			return nil, fmt.Errorf("machining operation host %s is not a frozen part of this unit", host)
		}
	}
	// Part order is the frozen BOM order (already identity-stable).
	sort.Slice(parts, func(a, b int) bool { return parts[a].PartID < parts[b].PartID })

	return &ReleaseRoutingUnit{
		FurnitureInstanceID:   item.FurnitureInstanceID,
		FurnitureDefinitionID: unit.FurnitureDefinitionID,
		MachiningFingerprint: resolved.Machining.ManufacturingFingerprint,
		Parts:                parts,
	}, nil
}

// releaseUnitLayoutDims recomputes the exact layout dimensions the BOM
// resolution already validated: structure modules carry explicit positive
// integer dimensions on the item parameters, fixed modules resolve at their
// own definition dimensions (nil override).
func releaseUnitLayoutDims(module domain.Module, item domain.DesignRevisionItem) (*LayoutDims, error) {
	if strings.TrimSpace(module.StructureID) == "" {
		return nil, nil
	}
	dims := &LayoutDims{}
	for i, name := range []string{"widthMm", "heightMm", "depthMm"} {
		value, ok := item.Parameters[name].(float64)
		if !ok || !releaseUnitSafeInteger(value) || value <= 0 {
			return nil, fmt.Errorf("routing unit requires explicit positive integer %s", name)
		}
		switch i {
		case 0:
			dims.WidthMm = int(value)
		case 1:
			dims.HeightMm = int(value)
		case 2:
			dims.DepthMm = int(value)
		}
	}
	return dims, nil
}

// ValidateReleaseRoutingProgram is the fail-closed structural validation every
// consumer (freeze and guard) runs over a frozen routing section. It proves
// COMPLETE part coverage and exact unit identity against the frozen collection
// — a program that cannot prove coverage is missing evidence, not no-CNC.
func ValidateReleaseRoutingProgram(program *ReleaseRoutingProgram, units []ResolvedReleaseUnit) error {
	if program == nil {
		return fmt.Errorf("routing program is missing")
	}
	if program.Contract != ReleaseRoutingProgramContract {
		return fmt.Errorf("routing program contract %q is not %s", program.Contract, ReleaseRoutingProgramContract)
	}
	if strings.TrimSpace(program.IndustrialRulesRevision) == "" {
		return fmt.Errorf("routing program requires the industrial rules revision")
	}
	if len(program.Units) != len(units) {
		return fmt.Errorf("routing program covers %d units, collection has %d", len(program.Units), len(units))
	}
	unitByID := make(map[string]ReleaseRoutingUnit, len(program.Units))
	for _, unit := range program.Units {
		if strings.TrimSpace(unit.FurnitureInstanceID) == "" {
			return fmt.Errorf("routing unit requires the furniture instance identity")
		}
		if _, dup := unitByID[unit.FurnitureInstanceID]; dup {
			return fmt.Errorf("routing unit %s appears more than once", unit.FurnitureInstanceID)
		}
		if strings.TrimSpace(unit.MachiningFingerprint) == "" {
			return fmt.Errorf("routing unit %s carries no machining fingerprint", unit.FurnitureInstanceID)
		}
		unitByID[unit.FurnitureInstanceID] = unit
	}
	for _, resolved := range units {
		unit, ok := unitByID[resolved.FurnitureInstanceID]
		if !ok {
			return fmt.Errorf("routing program does not cover unit %s", resolved.FurnitureInstanceID)
		}
		if unit.FurnitureDefinitionID != resolved.FurnitureDefinitionID {
			return fmt.Errorf("routing unit %s definition mismatch", resolved.FurnitureInstanceID)
		}
		frozenParts := make(map[string]bool, len(resolved.BOM.BoardParts))
		for _, board := range resolved.BOM.BoardParts {
			frozenParts[board.ID] = true
		}
		seenParts := make(map[string]bool, len(unit.Parts))
		for _, part := range unit.Parts {
			if strings.TrimSpace(part.PartID) == "" {
				return fmt.Errorf("routing part of unit %s requires identity", resolved.FurnitureInstanceID)
			}
			if _, dup := seenParts[part.PartID]; dup {
				return fmt.Errorf("routing part %s appears more than once", part.PartID)
			}
			seenParts[part.PartID] = true
			if !frozenParts[part.PartID] {
				return fmt.Errorf("routing part %s is not a frozen part of unit %s", part.PartID, resolved.FurnitureInstanceID)
			}
			if !part.Cut {
				return fmt.Errorf("routing part %s requires cut intent", part.PartID)
			}
			if part.CncRequired != (len(part.Operations) > 0) {
				return fmt.Errorf("routing part %s cncRequired verdict contradicts its operations", part.PartID)
			}
			seenOperations := make(map[string]bool, len(part.Operations))
			for _, operation := range part.Operations {
				if strings.TrimSpace(operation.OperationID) == "" {
					return fmt.Errorf("routing operation of part %s requires identity", part.PartID)
				}
				if _, dup := seenOperations[operation.OperationID]; dup {
					return fmt.Errorf("routing operation %s appears more than once", operation.OperationID)
				}
				seenOperations[operation.OperationID] = true
				if operation.Operation != ReleaseRoutingOperationDrill {
					return fmt.Errorf("routing operation %s carries unknown neutral intent %q", operation.OperationID, operation.Operation)
				}
				switch operation.Provenance.SourceKind {
				case "relationship", "manualHardwarePlacement":
				default:
					return fmt.Errorf("routing operation %s carries unknown provenance %q", operation.OperationID, operation.Provenance.SourceKind)
				}
				if len(operation.Holes) == 0 {
					return fmt.Errorf("routing operation %s freezes no holes", operation.OperationID)
				}
				for _, hole := range operation.Holes {
					if strings.TrimSpace(hole.Face) == "" || strings.TrimSpace(hole.Type) == "" {
						return fmt.Errorf("routing operation %s freezes a hole without face or type", operation.OperationID)
					}
					if !(hole.DiameterMm > 0) || !(hole.DepthMm > 0) {
						return fmt.Errorf("routing operation %s freezes a hole without positive diameter/depth", operation.OperationID)
					}
				}
			}
		}
		for boardID := range frozenParts {
			if !seenParts[boardID] {
				return fmt.Errorf("routing program does not cover frozen part %s of unit %s", boardID, resolved.FurnitureInstanceID)
			}
		}
	}
	return nil
}
