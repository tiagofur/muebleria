package engine

import (
	"fmt"
	"math"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// J2-B (#874): fixed shelf ↔ sides as the cabinet's second physical contact.
// The shelf reuses the floor-side contact geometry class (a horizontal board
// whose length-axis end faces meet the sides' declared inner faces) but is
// NOT a floor, and an adjustable shelf-support relationship never inherits a
// fixed joint: the explicit `fixed-shelf-side` kind carries both facts. This
// path consumes the REAL versioned recipe contract (ContactOperationRecipe)
// through the unmodified A1a/A1b derivation; the floor-side path and the
// frozen test-only FamilyTechnicalProfile seam stay untouched.

// deriveFixedShelfJoinery is the productive wiring: it resolves the
// relationship's anchors to rigid contact boards (server-authoritative
// layout geometry) and delegates to the pure derivation below.
func deriveFixedShelfJoinery(relationship AuthoringRelationship, boardIndex map[string]*layoutBoard,
	issues *[]domain.ContractIssue, operations *[]ResolvedMachiningOperation) JoineryRelationshipStatus {
	relationshipID := relationship.RelationshipID
	pushIssue := func(code, message, remediation string) {
		*issues = append(*issues, domain.ContractIssue{
			Code: code, Message: message, Severity: domain.IssueSeverityError,
			EntityID:    relationshipID,
			Path:        fmt.Sprintf("furniture.relationships[relationshipId=%s]", relationshipID),
			Remediation: remediation,
		})
	}
	contactIDs := make([]string, 0, len(relationship.Targets))
	for _, anchor := range relationship.Targets {
		contactIDs = append(contactIDs, fmt.Sprintf("%s:%s", relationshipID, anchor.ComponentInstanceID))
	}
	failContacts := func(codes ...string) JoineryRelationshipStatus {
		contacts := make([]JoineryContactStatus, 0, len(contactIDs))
		for _, contactID := range contactIDs {
			contacts = append(contacts, JoineryContactStatus{ContactID: contactID, Status: "INVALID", IssueCodes: codes})
		}
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryContactInvalid, Contacts: contacts,
			Stations: JoineryStationPlanStatus{Status: "NOT_PLANNED", IssueCodes: []string{},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: codes}
	}
	boardFor := func(anchor AuthoringRelationshipAnchor, anchorKind string) (ContactBoard, bool) {
		board, ok := boardIndex[anchor.ComponentInstanceID]
		if !ok {
			pushIssue("RELATIONSHIP_ORPHANED",
				fmt.Sprintf("%s anchor references componentInstanceId %s that is not part of this furniture", anchorKind, anchor.ComponentInstanceID),
				"Anchor the relationship to a component instance present in the snapshot.")
			return ContactBoard{}, false
		}
		contactBoard, err := layoutContactBoard(board)
		if err != nil {
			pushIssue("TRANSFORM_INVALID",
				fmt.Sprintf("component %s placement is not a rigid unit-scale frame", anchor.ComponentInstanceID),
				"Resolve the board to a rigid local frame before declaring fixed-shelf contacts.")
			return ContactBoard{}, false
		}
		return contactBoard, true
	}
	sourceBefore := len(*issues)
	sourceBoard, ok := boardFor(relationship.Source, "source")
	if !ok {
		return failContacts((*issues)[sourceBefore].Code)
	}
	boards := []ContactBoard{sourceBoard}
	for _, anchor := range relationship.Targets {
		before := len(*issues)
		targetBoard, ok := boardFor(anchor, "target")
		if !ok {
			return failContacts((*issues)[before].Code)
		}
		boards = append(boards, targetBoard)
	}
	return deriveFixedShelfOperations(relationship, boards, issues, operations)
}

// deriveFixedShelfOperations is the pure J2-B derivation over concrete
// contact boards: declared faces, exact plane coincidence (A0a), one uniform
// station pattern (A0b), and — when versioned recipes cover every contact —
// the real A1a/A1b operation derivation converted to productive operations.
// Without recipes the joint stays at the honest TECHNICAL_PROFILE_REQUIRED
// terminal with zero operations (#874 §J4: no verified production technical
// profile exists yet; the test: recipe namespace never enters production).
func deriveFixedShelfOperations(relationship AuthoringRelationship, boards []ContactBoard,
	issues *[]domain.ContractIssue, operations *[]ResolvedMachiningOperation) JoineryRelationshipStatus {
	relationshipID := relationship.RelationshipID
	pushIssue := func(code, message, remediation string) {
		*issues = append(*issues, domain.ContractIssue{
			Code: code, Message: message, Severity: domain.IssueSeverityError,
			EntityID:    relationshipID,
			Path:        fmt.Sprintf("furniture.relationships[relationshipId=%s]", relationshipID),
			Remediation: remediation,
		})
	}
	contactIDs := make([]string, 0, len(relationship.Targets))
	for _, anchor := range relationship.Targets {
		contactIDs = append(contactIDs, fmt.Sprintf("%s:%s", relationshipID, anchor.ComponentInstanceID))
	}
	notPlanned := JoineryStationPlanStatus{Status: "NOT_PLANNED", IssueCodes: []string{},
		StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}}
	failContacts := func(codes ...string) JoineryRelationshipStatus {
		contacts := make([]JoineryContactStatus, 0, len(contactIDs))
		for _, contactID := range contactIDs {
			contacts = append(contacts, JoineryContactStatus{ContactID: contactID, Status: "INVALID", IssueCodes: codes})
		}
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryContactInvalid, Contacts: contacts, Stations: notPlanned, Blockers: codes}
	}
	validContacts := func() []JoineryContactStatus {
		contacts := make([]JoineryContactStatus, 0, len(contactIDs))
		for _, contactID := range contactIDs {
			contacts = append(contacts, JoineryContactStatus{ContactID: contactID, Status: "VALID", IssueCodes: []string{}})
		}
		return contacts
	}

	counts := map[string]int{}
	byID := map[string]ContactBoard{}
	for _, board := range boards {
		counts[board.OccurrenceID]++
		byID[board.OccurrenceID] = board
	}
	boardFor := func(anchor AuthoringRelationshipAnchor, anchorKind string) (ContactBoard, bool) {
		if counts[anchor.ComponentInstanceID] != 1 {
			pushIssue("RELATIONSHIP_ORPHANED",
				fmt.Sprintf("%s anchor references componentInstanceId %s that is not an unambiguous participant board", anchorKind, anchor.ComponentInstanceID),
				"Anchor the relationship to exactly one component instance present in the snapshot.")
			return ContactBoard{}, false
		}
		if anchorKind == "target" && !joineryFaces[anchor.Face] {
			pushIssue("CONTACT_FACE_REQUIRED",
				fmt.Sprintf("%s anchor must declare one concrete contact face (%s)", anchorKind, anchor.ComponentInstanceID),
				"Declare the physical contact face on every fixed-shelf target; proximity never infers a union.")
			return ContactBoard{}, false
		}
		if anchorKind == "source" && anchor.Face != "" && !joineryFaces[anchor.Face] {
			pushIssue("CONTACT_FACE_REQUIRED",
				"source anchor declares a face outside the six concrete board faces",
				"Declare a top/bottom/left/right/front/back source face or omit it for exact plane verification.")
			return ContactBoard{}, false
		}
		return byID[anchor.ComponentInstanceID], true
	}
	sourceBefore := len(*issues)
	sourceBoard, ok := boardFor(relationship.Source, "source")
	if !ok {
		return failContacts((*issues)[sourceBefore].Code)
	}
	participants := []ContactBoard{sourceBoard}
	intents := make([]ExplicitContact, 0, len(relationship.Targets))
	for index, anchor := range relationship.Targets {
		before := len(*issues)
		targetBoard, ok := boardFor(anchor, "target")
		if !ok {
			return failContacts((*issues)[before].Code)
		}
		participants = append(participants, targetBoard)
		faceA, okFace := coincidentFaceA(sourceBoard, targetBoard, anchor.Face)
		if !okFace || (relationship.Source.Face != "" && relationship.Source.Face != faceA) {
			pushIssue("CONTACT_FACE_REQUIRED",
				fmt.Sprintf("declared target face does not coincide with exactly one face of %s", relationship.Source.ComponentInstanceID),
				"Anchor fixed-shelf contacts on faces that physically coincide; proximity never infers a union.")
			return failContacts("CONTACT_FACE_REQUIRED")
		}
		intents = append(intents, ExplicitContact{
			RelationshipID: relationshipID, ContactID: contactIDs[index],
			ParticipantA: relationship.Source.ComponentInstanceID, ParticipantB: anchor.ComponentInstanceID,
			FaceA: faceA, FaceB: anchor.Face,
		})
	}

	resolution := resolveExplicitContacts(participants, intents, contactIDs)
	if len(resolution.Issues) > 0 {
		*issues = append(*issues, resolution.Issues...)
		return failContacts(uniqueIssueCodes(resolution.Issues)...)
	}

	if len(relationship.Families) > 0 {
		pushIssue("STATION_PATTERN_INVALID",
			"fixed-shelf-side declares one uniform station pattern; families are the floor-side mechanism",
			"Declare a stationCount parameter or use a floor-side relationship for operation families.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"STATION_PATTERN_INVALID"}}
	}
	count, hasCount := relationship.Parameters["stationCount"].(float64)
	maxSpacing, hasMaxSpacing := relationship.Parameters["maxSpacingMm"].(float64)
	start, hasStart := relationship.Parameters["startMarginMm"].(float64)
	end, hasEnd := relationship.Parameters["endMarginMm"].(float64)
	if !hasStart {
		start = 0
	}
	if !hasEnd {
		end = 0
	}
	if hasCount && hasMaxSpacing {
		pushIssue("STATION_PATTERN_INVALID",
			"fixed-shelf-side declares both stationCount and maxSpacingMm",
			"Declare either an explicit stationCount or a spacing-derived pattern, never both.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"STATION_PATTERN_INVALID"}}
	}
	if hasMaxSpacing && (math.IsNaN(maxSpacing) || math.IsInf(maxSpacing, 0) || maxSpacing <= 0) {
		pushIssue("STATION_PATTERN_INVALID",
			"fixed-shelf-side maxSpacingMm must be a positive finite number",
			"Declare a positive spacing so the station count derives from the real contact span.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"STATION_PATTERN_INVALID"}}
	}
	if !hasCount && !hasMaxSpacing {
		pushIssue("STATION_PATTERN_INVALID",
			fmt.Sprintf("fixed-shelf-side relationship %s declares no station pattern", relationshipID),
			"Declare stationCount (>= 2) or maxSpacingMm (> 0) with optional margins.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"STATION_PATTERN_INVALID"}}
	}
	if hasCount && (count != math.Trunc(count) || count < 2 ||
		math.IsNaN(start) || math.IsInf(start, 0) || start < 0 ||
		math.IsNaN(end) || math.IsInf(end, 0) || end < 0) {
		pushIssue("STATION_PATTERN_INVALID",
			"fixed-shelf station pattern needs an integer stationCount >= 2 and finite nonnegative margins",
			"Declare stationCount (>= 2) and optional nonnegative start/end margins on the relationship.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"STATION_PATTERN_INVALID"}}
	}
	specs := make([]StationSpec, 0, len(contactIDs))
	for _, contactID := range contactIDs {
		if hasMaxSpacing {
			specs = append(specs, StationSpec{ContactID: contactID, MaxSpacingMm: maxSpacing, StartMarginMm: start, EndMarginMm: end})
		} else {
			specs = append(specs, StationSpec{ContactID: contactID, Count: int(count), StartMarginMm: start, EndMarginMm: end})
		}
	}
	planned := planResolvedContactStations(resolution, participants, specs)
	if len(planned.Issues) > 0 {
		*issues = append(*issues, planned.Issues...)
		codes := uniqueIssueCodes(planned.Issues)
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: codes,
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: codes}
	}
	plannedStatus := func(codes []string, stage JoineryResolutionStage) JoineryRelationshipStatus {
		counts := make([]JoineryStationPlanCount, 0, len(planned.Plans))
		distances := make([]JoineryStationDistances, 0, len(planned.Plans))
		for _, plan := range planned.Plans {
			counts = append(counts, JoineryStationPlanCount{ContactID: plan.ContactID, StationCount: len(plan.Stations)})
			planDistances := make([]float64, 0, len(plan.Stations))
			for _, station := range plan.Stations {
				planDistances = append(planDistances, station.DistanceMm)
			}
			distances = append(distances, JoineryStationDistances{ContactID: plan.ContactID, DistancesMm: planDistances})
		}
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: stage, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "PLANNED", IssueCodes: codes,
				StationCounts: counts, StationDistances: distances},
			Blockers: codes}
	}

	if len(relationship.Recipes) == 0 {
		// No versioned recipe with a verified technical profile exists for
		// this joint: the honest terminal state, never a synthetic fallback
		// (#874 §J4). Stations are published; zero operations are emitted.
		pushIssue("TECHNICAL_PROFILE_REQUIRED",
			fmt.Sprintf("fixed-shelf-side relationship %s declares no versioned recipe with a verified technical profile", relationshipID),
			"Attach a versioned recipe with a verified technical profile before fabrication; synthetic fixtures never enter production.")
		return plannedStatus([]string{"TECHNICAL_PROFILE_REQUIRED"}, JoineryTechnicalProfileMissing)
	}

	// The REAL versioned recipe derivation (#874 J2-B): the A1b reconciler
	// re-validates identity, rules, technical profiles and swept-cylinder
	// geometry, and fails the whole relationship on any defect — a hole is
	// never silently omitted.
	derived := deriveResolvedContactOperations(resolution, planned, participants, specs, relationship.Recipes)
	if len(derived.Issues) > 0 {
		stage := JoineryMachiningInvalid
		profileRequired := false
		for _, issue := range derived.Issues {
			if issue.Code == "TECHNICAL_PROFILE_REQUIRED" {
				profileRequired = true
			}
			*issues = append(*issues, domain.ContractIssue{
				Code: issue.Code, Message: issue.Message, Severity: domain.IssueSeverityError,
				EntityID:    relationshipID,
				Path:        fmt.Sprintf("furniture.relationships[relationshipId=%s].recipes", relationshipID),
				Remediation: "Attach a versioned recipe with a verified technical profile that fits every participant of this joint.",
			})
		}
		if profileRequired {
			stage = JoineryTechnicalProfileMissing
		}
		return plannedStatus(uniqueIssueCodes(derived.Issues), stage)
	}

	// Convert the neutral per-station operations into productive operations:
	// one per contact×participant×rule, one hole per station on the entry
	// face under the #356 face-coordinate convention. A1a admits only
	// face-normal bores, so the projection is lossless.
	operationsBefore := len(*operations)
	type pendingOperation struct {
		operationID string
		participant string
		provenance  ResolvedMachiningProvenance
		holes       []ResolveHole
	}
	order := []*pendingOperation{}
	byKey := map[string]*pendingOperation{}
	for _, neutral := range derived.Operations {
		key := neutral.Provenance.ContactID + "\x00" + neutral.Provenance.ParticipantID + "\x00" + neutral.Provenance.RuleID
		pending, found := byKey[key]
		if !found {
			pending = &pendingOperation{
				operationID: fmt.Sprintf("%s:%s:%s:%s", relationshipID,
					neutral.Provenance.ContactID, neutral.Provenance.ParticipantID, neutral.Provenance.RuleID),
				participant: neutral.Provenance.ParticipantID,
				provenance: ResolvedMachiningProvenance{
					SourceKind: "relationship", RelationshipID: relationshipID,
					CatalogRuleID:            neutral.Provenance.RecipeID,
					RecipeRevision:           neutral.Provenance.RecipeRevision,
					TechnicalProfileID:       neutral.TechnicalProfileID,
					TechnicalProfileRevision: neutral.TechnicalProfileRevision,
				},
				holes: []ResolveHole{},
			}
			byKey[key] = pending
			order = append(order, pending)
		}
		hole, ok := fixedShelfHole(neutral)
		if !ok {
			pushIssue("OPERATION_GEOMETRY_INVALID",
				fmt.Sprintf("recipe rule %s does not project onto a concrete entry face", neutral.Provenance.RuleID),
				"Attach a recipe whose rules enter through one of the six concrete board faces.")
			*operations = (*operations)[:operationsBefore]
			return plannedStatus([]string{"OPERATION_GEOMETRY_INVALID"}, JoineryMachiningInvalid)
		}
		pending.holes = append(pending.holes, hole)
	}
	for _, pending := range order {
		*operations = append(*operations, ResolvedMachiningOperation{
			OperationID: pending.operationID, HostComponentInstanceID: pending.participant,
			Provenance: pending.provenance, Holes: pending.holes,
		})
	}
	// A joint whose own emitted holes collide is NOT ready: the collision
	// belongs to the relationship's state (#874). The whole relationship
	// rolls back to zero operations.
	if collision := firstHoleCollision((*operations)[operationsBefore:]); collision != nil {
		pushIssue("DRILLING_CONFLICT", collision.Message, collision.Remediation)
		*operations = (*operations)[:operationsBefore]
		return plannedStatus([]string{"DRILLING_CONFLICT"}, JoineryMachiningInvalid)
	}
	return plannedStatus([]string{}, JoineryMachiningReady)
}

// fixedShelfHole projects one neutral operation onto its participant's entry
// face using the #356 face-coordinate convention: the two non-normal local
// axes in X<Y<Z order.
func fixedShelfHole(operation NeutralContactOperation) (ResolveHole, bool) {
	axis, _ := contactOperationFaceAxis(operation.EntryFace)
	if axis < 0 {
		return ResolveHole{}, false
	}
	plane := [2]float64{}
	pi := 0
	for i := 0; i < 3; i++ {
		if i == axis {
			continue
		}
		plane[pi] = operation.CenterLocalMm[i]
		pi++
	}
	return ResolveHole{Face: operation.EntryFace, XMm: plane[0], YMm: plane[1],
		DiameterMm: operation.DiameterMm, DepthMm: operation.DepthMm,
		Type: operation.Provenance.OperationRole}, true
}

// validateRelationshipRecipes enforces the closed per-contact recipe shape a
// fixed-shelf-side relationship may declare (#874 J2-B): recipes exist only
// on that kind, every contactId is exactly one of the relationship's own
// contacts, coverage is complete, and every rule carries full versioned
// technical identity. The engine re-validates everything through the A1a
// derivation (including swept-cylinder geometry).
func validateRelationshipRecipes(relationship AuthoringRelationship) []domain.ContractIssue {
	if len(relationship.Recipes) == 0 {
		return nil
	}
	path := fmt.Sprintf("furniture.relationships[relationshipId=%s].recipes", relationship.RelationshipID)
	issues := []domain.ContractIssue{}
	add := func(message string) {
		issues = append(issues, domain.ContractIssue{
			Code: "RELATIONSHIP_INVALID", Message: message,
			Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path,
			Remediation: "Declare per-contact recipes with versioned identity, both participant roles and geometry that fits the joint.",
		})
	}
	if relationship.Kind != "fixed-shelf-side" {
		add("recipes are only valid on fixed-shelf-side relationships")
		return issues
	}
	if len(relationship.Families) > 0 {
		add("recipes and families are mutually exclusive: declare one machining pattern per relationship")
	}
	contactIDs := map[string]bool{}
	for _, anchor := range relationship.Targets {
		contactIDs[fmt.Sprintf("%s:%s", relationship.RelationshipID, anchor.ComponentInstanceID)] = true
	}
	seenContacts := map[string]bool{}
	finite := func(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
	for _, recipe := range relationship.Recipes {
		if !contactIDs[recipe.ContactID] {
			add(fmt.Sprintf("recipe contactId %s is not a contact of this relationship", recipe.ContactID))
			continue
		}
		if seenContacts[recipe.ContactID] {
			add(fmt.Sprintf("recipe contactId %s appears more than once", recipe.ContactID))
		}
		seenContacts[recipe.ContactID] = true
		if recipe.RecipeID == "" || recipe.RecipeRevision == "" {
			add("recipe needs a non-blank recipeId and recipeRevision")
		}
		if recipe.TechnicalProfileID == "" || recipe.TechnicalProfileRevision == "" {
			add("recipe needs a non-blank versioned technicalProfileId and technicalProfileRevision")
		}
		if len(recipe.Rules) == 0 {
			add(fmt.Sprintf("recipe for contact %s needs at least one rule", recipe.ContactID))
			continue
		}
		roleA, roleB := false, false
		ruleIDs := map[string]bool{}
		for _, rule := range recipe.Rules {
			roleA = roleA || rule.ParticipantRole == "A"
			roleB = roleB || rule.ParticipantRole == "B"
		}
		if !roleA || !roleB {
			add(fmt.Sprintf("recipe for contact %s needs at least one rule per participant role (source and target)", recipe.ContactID))
		}
		for _, rule := range recipe.Rules {
			if rule.RuleID == "" || rule.RuleRevision == "" || rule.OperationRole == "" || ruleIDs[rule.RuleID] ||
				(rule.ParticipantRole != "A" && rule.ParticipantRole != "B") || !joineryFaces[rule.EntryFace] ||
				!isFiniteVec3(rule.OffsetMm) || !isFiniteVec3(rule.Axis) ||
				!finite(rule.DiameterMm) || !finite(rule.DepthMm) ||
				math.Abs(dot3(rule.Axis, rule.Axis)-1) > 1e-6 ||
				rule.DiameterMm <= 0 || rule.DepthMm <= 0 {
				add(fmt.Sprintf("recipe for contact %s has an invalid rule: unique ruleId, revision, operationRole, participantRole, one of the six entry faces, finite offset and unit axis, positive finite diameter and depth are required", recipe.ContactID))
				break
			}
			ruleIDs[rule.RuleID] = true
		}
	}
	for _, anchor := range relationship.Targets {
		contactID := fmt.Sprintf("%s:%s", relationship.RelationshipID, anchor.ComponentInstanceID)
		if !seenContacts[contactID] {
			add(fmt.Sprintf("contact %s has no recipe; coverage must be complete", contactID))
		}
	}
	return issues
}
