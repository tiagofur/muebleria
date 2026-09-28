package engine

import (
	"encoding/json"
	"math"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func contactOperationCross(a, b [3]float64) [3]float64 {
	return [3]float64{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}

func contactOperationNear(a, b [3]float64) bool {
	for i := range a {
		if math.IsNaN(a[i]) || math.IsInf(a[i], 0) || math.Abs(a[i]-b[i]) > 1e-6 {
			return false
		}
	}
	return true
}

func contactOperationFaceAxis(face string) (int, bool) {
	switch face {
	case "left":
		return 0, false
	case "right":
		return 0, true
	case "back":
		return 1, false
	case "front":
		return 1, true
	case "bottom":
		return 2, false
	case "top":
		return 2, true
	default:
		return -1, false
	}
}

// deriveResolvedContactOperationsForContact emits a complete paired set for
// exactly one resolved contact, or no operations on any validation failure.
func deriveResolvedContactOperationsForContact(contact ResolvedContact, plan StationPlan,
	boards []ContactBoard, spec StationSpec, recipe ContactOperationRecipe) ContactOperationResult {
	result := ContactOperationResult{Operations: []NeutralContactOperation{}, Issues: []domain.ContractIssue{}}
	fail := func(code string) ContactOperationResult {
		return ContactOperationResult{Operations: []NeutralContactOperation{}, Issues: []domain.ContractIssue{{
			Code: code, Message: code, Severity: domain.IssueSeverityError, EntityID: contact.ContactID,
		}}}
	}
	id := contact.ContactID
	if strings.TrimSpace(id) == "" || strings.TrimSpace(contact.RelationshipID) == "" ||
		strings.TrimSpace(contact.ParticipantA) == "" || strings.TrimSpace(contact.ParticipantB) == "" ||
		plan.ContactID != id || spec.ContactID != id || recipe.ContactID != id {
		return fail("OPERATION_IDENTITY_INVALID")
	}
	var a, b ContactBoard
	aCount, bCount := 0, 0
	for _, board := range boards {
		if board.OccurrenceID == contact.ParticipantA {
			a, aCount = board, aCount+1
		}
		if board.OccurrenceID == contact.ParticipantB {
			b, bCount = board, bCount+1
		}
	}
	if aCount != 1 || bCount != 1 || contact.ParticipantA == contact.ParticipantB {
		return fail("OPERATION_PARTICIPANT_INVALID")
	}
	authoritative := planResolvedContactStations(ContactResolutionResult{Contacts: []ResolvedContact{contact}},
		boards, []StationSpec{spec})
	if len(authoritative.Issues) != 0 || len(authoritative.Plans) != 1 ||
		len(plan.Stations) != len(authoritative.Plans[0].Stations) {
		return fail("OPERATION_PLAN_INVALID")
	}
	stations := authoritative.Plans[0].Stations
	for i, station := range plan.Stations {
		expected := stations[i]
		if station.DistanceMm != expected.DistanceMm ||
			!contactOperationNear(station.AssemblyPointMm, expected.AssemblyPointMm) ||
			!contactOperationNear(station.ParticipantALocalMm, expected.ParticipantALocalMm) ||
			!contactOperationNear(station.ParticipantBLocalMm, expected.ParticipantBLocalMm) {
			return fail("OPERATION_PLAN_INVALID")
		}
	}
	if strings.TrimSpace(recipe.RecipeID) == "" || strings.TrimSpace(recipe.RecipeRevision) == "" {
		return fail("OPERATION_RECIPE_INVALID")
	}
	if strings.TrimSpace(recipe.TechnicalProfileID) == "" || strings.TrimSpace(recipe.TechnicalProfileRevision) == "" {
		return fail("TECHNICAL_PROFILE_REQUIRED")
	}
	if len(recipe.Rules) == 0 {
		return fail("OPERATION_RULE_INVALID")
	}
	roleA, roleB := false, false
	ruleIDs := map[string]bool{}
	finite := func(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
	for _, rule := range recipe.Rules {
		roleA = roleA || rule.ParticipantRole == "A"
		roleB = roleB || rule.ParticipantRole == "B"
	}
	if !roleA || !roleB {
		return fail("OPERATION_PARTICIPANT_RULE_MISSING")
	}
	for _, rule := range recipe.Rules {
		faceAxis, _ := contactOperationFaceAxis(rule.EntryFace)
		if strings.TrimSpace(rule.RuleID) == "" || strings.TrimSpace(rule.RuleRevision) == "" ||
			strings.TrimSpace(rule.OperationRole) == "" || ruleIDs[rule.RuleID] ||
			(rule.ParticipantRole != "A" && rule.ParticipantRole != "B") || faceAxis < 0 ||
			!isFiniteVec3(rule.OffsetMm) || !isFiniteVec3(rule.Axis) ||
			!finite(rule.DiameterMm) || !finite(rule.DepthMm) ||
			math.Abs(dot3(rule.Axis, rule.Axis)-1) > 1e-6 ||
			rule.DiameterMm <= 0 || rule.DepthMm <= 0 {
			return fail("OPERATION_RULE_INVALID")
		}
		ruleIDs[rule.RuleID] = true
	}
	along, normal := contact.Frame.AxisAssembly, contact.Frame.NormalAssembly
	cross := contactOperationCross(along, normal)
	project := func(v [3]float64) [3]float64 {
		return contactAdd(contactAdd(contactAdd([3]float64{}, along, v[0]), normal, v[1]), cross, v[2])
	}
	rules := append([]ContactOperationRule(nil), recipe.Rules...)
	sort.Slice(rules, func(i, j int) bool {
		if rules[i].ParticipantRole != rules[j].ParticipantRole {
			return rules[i].ParticipantRole < rules[j].ParticipantRole
		}
		return rules[i].RuleID < rules[j].RuleID
	})
	for stationIndex, station := range stations {
		for _, rule := range rules {
			board := a
			if rule.ParticipantRole == "B" {
				board = b
			}
			centerLocal := board.toLocal(contactAdd(station.AssemblyPointMm, project(rule.OffsetMm), 1))
			direction := project(rule.Axis)
			axisLocal := [3]float64{dot3(direction, board.Basis.X), dot3(direction, board.Basis.Y), dot3(direction, board.Basis.Z)}
			dims := [3]float64{board.WidthMm, board.ThicknessMm, board.LengthMm}
			faceAxis, high := contactOperationFaceAxis(rule.EntryFace)
			radius := rule.DiameterMm / 2
			target := 0.0
			if high {
				target = dims[faceAxis]
			}
			valid := math.Abs(centerLocal[faceAxis]-target) <= 1e-6
			if high {
				valid = valid && axisLocal[faceAxis] < -1e-6
			} else {
				valid = valid && axisLocal[faceAxis] > 1e-6
			}
			for i, value := range centerLocal {
				valid = valid && finite(value) && value >= -1e-6 && value <= dims[i]+1e-6 &&
					value+rule.DepthMm*axisLocal[i] >= -1e-6 && value+rule.DepthMm*axisLocal[i] <= dims[i]+1e-6
				if i != faceAxis {
					valid = valid && value >= radius-1e-6 && value <= dims[i]-radius+1e-6
				}
			}
			if !valid {
				return fail("OPERATION_GEOMETRY_INVALID")
			}
			provenance := ContactOperationProvenance{SourceKind: "relationship", RelationshipID: contact.RelationshipID,
				ContactID: id, ParticipantID: board.OccurrenceID, ParticipantRole: rule.ParticipantRole,
				StationIndex: stationIndex, RecipeID: recipe.RecipeID, RecipeRevision: recipe.RecipeRevision,
				RuleID: rule.RuleID, RuleRevision: rule.RuleRevision, OperationRole: rule.OperationRole}
			result.Operations = append(result.Operations, NeutralContactOperation{OperationID: ContactOperationID(provenance),
				Provenance: provenance, TechnicalProfileID: recipe.TechnicalProfileID,
				TechnicalProfileRevision: recipe.TechnicalProfileRevision, EntryFace: rule.EntryFace,
				CenterLocalMm: centerLocal, AxisLocal: axisLocal, DiameterMm: rule.DiameterMm, DepthMm: rule.DepthMm})
		}
	}
	ids := map[string]bool{}
	geometryKeys := map[string]bool{}
	for _, op := range result.Operations {
		if ids[op.OperationID] {
			return fail("OPERATION_ID_AMBIGUOUS")
		}
		ids[op.OperationID] = true
		key, _ := json.Marshal([]any{op.Provenance.ParticipantID, op.EntryFace, op.CenterLocalMm,
			op.AxisLocal, op.DiameterMm, op.DepthMm})
		if geometryKeys[string(key)] {
			return fail("OPERATION_GEOMETRY_DUPLICATE")
		}
		geometryKeys[string(key)] = true
	}
	return result
}
