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
	if !a.valid() || !b.valid() {
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
					// Endpoint checks alone do not bound an oblique bore's swept cylinder.
					valid = valid && axisLocal[i] == 0 && value >= radius-1e-6 && value <= dims[i]-radius+1e-6
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

// deriveResolvedContactOperations reconciles complete singular results and
// removes every operation of a relationship if any of its contacts fails.
func deriveResolvedContactOperations(resolution ContactResolutionResult, plans StationPlanResult,
	boards []ContactBoard, specs []StationSpec, recipes []ContactOperationRecipe) ContactOperationResult {
	result := ContactOperationResult{Operations: []NeutralContactOperation{}, Issues: []domain.ContractIssue{}}
	if len(resolution.Issues) != 0 || len(plans.Issues) != 0 {
		result.Issues = append(result.Issues, resolution.Issues...)
		result.Issues = append(result.Issues, plans.Issues...)
		return result
	}
	contactCounts, planCounts, specCounts, recipeCounts := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	planByID, specByID, recipeByID := map[string]StationPlan{}, map[string]StationSpec{}, map[string]ContactOperationRecipe{}
	for _, contact := range resolution.Contacts {
		contactCounts[contact.ContactID]++
	}
	for _, plan := range plans.Plans {
		planCounts[plan.ContactID]++
		planByID[plan.ContactID] = plan
	}
	for _, spec := range specs {
		specCounts[spec.ContactID]++
		specByID[spec.ContactID] = spec
	}
	for _, recipe := range recipes {
		recipeCounts[recipe.ContactID]++
		recipeByID[recipe.ContactID] = recipe
	}
	for _, counts := range []map[string]int{planCounts, specCounts, recipeCounts} {
		for id := range counts {
			if contactCounts[id] == 0 {
				result.Issues = append(result.Issues, domain.ContractIssue{Code: "OPERATION_CONTACT_UNKNOWN",
					Message: "OPERATION_CONTACT_UNKNOWN", Severity: domain.IssueSeverityError})
				return result
			}
		}
	}
	contacts := append([]ResolvedContact(nil), resolution.Contacts...)
	sort.Slice(contacts, func(i, j int) bool { return contacts[i].ContactID < contacts[j].ContactID })
	invalidRelationships := map[string]bool{}
	fail := func(contact ResolvedContact, code string) {
		result.Issues = append(result.Issues, domain.ContractIssue{Code: code, Message: code,
			Severity: domain.IssueSeverityError, EntityID: contact.ContactID})
		invalidRelationships[contact.RelationshipID] = true
	}
	for _, contact := range contacts {
		id := contact.ContactID
		switch {
		case contactCounts[id] != 1:
			fail(contact, "OPERATION_CONTACT_AMBIGUOUS")
			continue
		case planCounts[id] != 1 || specCounts[id] != 1:
			fail(contact, "OPERATION_PLAN_INVALID")
			continue
		case recipeCounts[id] == 0:
			fail(contact, "OPERATION_RECIPE_REQUIRED")
			continue
		case recipeCounts[id] != 1:
			fail(contact, "OPERATION_RECIPE_AMBIGUOUS")
			continue
		}
		paired := deriveResolvedContactOperationsForContact(contact, planByID[id], boards, specByID[id], recipeByID[id])
		if len(paired.Issues) != 0 {
			invalidRelationships[contact.RelationshipID] = true
		}
		result.Issues = append(result.Issues, paired.Issues...)
		result.Operations = append(result.Operations, paired.Operations...)
	}
	kept := []NeutralContactOperation{}
	ids := map[string]bool{}
	geometryOwners := map[string]string{}
	for _, operation := range result.Operations {
		if invalidRelationships[operation.Provenance.RelationshipID] {
			continue
		}
		key, _ := json.Marshal([]any{operation.Provenance.ParticipantID, operation.EntryFace,
			operation.CenterLocalMm, operation.AxisLocal, operation.DiameterMm, operation.DepthMm})
		if previous, found := geometryOwners[string(key)]; found && !invalidRelationships[previous] {
			invalidRelationships[previous], invalidRelationships[operation.Provenance.RelationshipID] = true, true
			result.Issues = append(result.Issues, domain.ContractIssue{Code: "OPERATION_GEOMETRY_DUPLICATE",
				Message: "OPERATION_GEOMETRY_DUPLICATE", Severity: domain.IssueSeverityError})
		} else {
			geometryOwners[string(key)] = operation.Provenance.RelationshipID
		}
	}
	for _, operation := range result.Operations {
		if invalidRelationships[operation.Provenance.RelationshipID] {
			continue
		}
		if ids[operation.OperationID] {
			result.Issues = append(result.Issues, domain.ContractIssue{Code: "OPERATION_ID_AMBIGUOUS",
				Message: "OPERATION_ID_AMBIGUOUS", Severity: domain.IssueSeverityError})
			result.Operations = []NeutralContactOperation{}
			return result
		}
		ids[operation.OperationID] = true
		kept = append(kept, operation)
	}
	result.Operations = kept
	return result
}
