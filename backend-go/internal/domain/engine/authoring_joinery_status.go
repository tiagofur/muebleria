package engine

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// JoineryResolutionStage is the canonical stage a declared relationship
// occupies in the J1-B productive resolver (#874).
type JoineryResolutionStage string

const (
	JoineryRelationshipUnsupported JoineryResolutionStage = "RELATIONSHIP_UNSUPPORTED"
	JoineryContactInvalid          JoineryResolutionStage = "CONTACT_INVALID"
	JoineryStationInvalid          JoineryResolutionStage = "STATION_INVALID"
	JoineryTechnicalProfileMissing JoineryResolutionStage = "TECHNICAL_PROFILE_REQUIRED"
	JoineryMachiningInvalid        JoineryResolutionStage = "MACHINING_INVALID"
	JoineryMachiningReady          JoineryResolutionStage = "MACHINING_READY"
)

type JoineryContactStatus struct {
	ContactID  string   `json:"contactId"`
	Status     string   `json:"status"`
	IssueCodes []string `json:"issueCodes"`
}

type JoineryStationPlanStatus struct {
	Status           string                    `json:"status"`
	IssueCodes       []string                  `json:"issueCodes"`
	StationCounts    []JoineryStationPlanCount `json:"stationCounts"`
	StationDistances []JoineryStationDistances `json:"stationDistances"`
	// FamilyPlans carries the per-family breakdown when the relationship
	// declares independent operation families (#874 J2-A); absent otherwise.
	// The aggregate counts/distances above stay honest: sums and the united
	// (ascending) physical drilling pattern per contact.
	FamilyPlans []JoineryFamilyPlan `json:"familyPlans,omitempty"`
}

// JoineryFamilyPlan is one family's independently planned station set per
// contact. Plans are sorted by familyId for deterministic parity.
type JoineryFamilyPlan struct {
	FamilyID         string                    `json:"familyId"`
	StationCounts    []JoineryStationPlanCount `json:"stationCounts"`
	StationDistances []JoineryStationDistances `json:"stationDistances"`
}

type JoineryStationPlanCount struct {
	ContactID    string `json:"contactId"`
	StationCount int    `json:"stationCount"`
}

// JoineryStationDistances publishes the planned station positions along the
// contact axis (mm from the frame origin). They are manufacturing truth: the
// fingerprint hashes them, so margin or geometry changes move the identity
// even when the count stays the same.
type JoineryStationDistances struct {
	ContactID   string    `json:"contactId"`
	DistancesMm []float64 `json:"distancesMm"`
}

type JoineryRelationshipStatus struct {
	RelationshipID string                   `json:"relationshipId"`
	Kind           string                   `json:"kind"`
	Stage          JoineryResolutionStage   `json:"stage"`
	Contacts       []JoineryContactStatus   `json:"contacts"`
	Stations       JoineryStationPlanStatus `json:"stations"`
	Blockers       []string                 `json:"blockers"`
}

// layoutContactBoard publishes a resolved layout board as an A0a contact
// participant. The published pose already carries the extents convention
// (X=width, Y=thickness, Z=length) and right-handed basis.
func layoutContactBoard(board *layoutBoard) (ContactBoard, error) {
	pose, _, _, err := boardLocalPose(board)
	if err != nil {
		return ContactBoard{}, err
	}
	return ContactBoard{
		OccurrenceID: board.id, WidthMm: board.widthMm, ThicknessMm: board.thicknessMm,
		LengthMm: board.lengthMm, Translation: pose.TranslationMm, Basis: pose.Basis,
	}, nil
}

var joineryFaces = map[string]bool{
	"top": true, "bottom": true, "left": true, "right": true, "front": true, "back": true,
}

// deriveFloorSideJoinery runs the J1 chain for one floor-side relationship:
// explicit anchors, A0a contact verification, A0b station planning, and the
// honest terminal TECHNICAL_PROFILE_REQUIRED blocker — never a synthetic
// recipe (#874 §J4). Zero operations are emitted at this stage.
func deriveFloorSideJoinery(relationship AuthoringRelationship, boardIndex map[string]*layoutBoard,
	issues *[]domain.ContractIssue, familyProfiles FamilyProfileResolver,
	operations *[]ResolvedMachiningOperation) JoineryRelationshipStatus {
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
	notPlanned := JoineryStationPlanStatus{Status: "NOT_PLANNED", IssueCodes: []string{}, StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}}
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

	boardFor := func(anchor AuthoringRelationshipAnchor, anchorKind string) (ContactBoard, string, bool) {
		board, ok := boardIndex[anchor.ComponentInstanceID]
		if !ok {
			pushIssue("RELATIONSHIP_ORPHANED",
				fmt.Sprintf("%s anchor references componentInstanceId %s that is not part of this furniture", anchorKind, anchor.ComponentInstanceID),
				"Anchor the relationship to a component instance present in the snapshot.")
			return ContactBoard{}, "", false
		}
		if anchorKind == "target" && !joineryFaces[anchor.Face] {
			pushIssue("CONTACT_FACE_REQUIRED",
				fmt.Sprintf("%s anchor must declare one concrete contact face (%s)", anchorKind, anchor.ComponentInstanceID),
				"Declare the physical contact face on every floor-side target; proximity never infers a union.")
			return ContactBoard{}, "", false
		}
		if anchorKind == "source" && anchor.Face != "" && !joineryFaces[anchor.Face] {
			pushIssue("CONTACT_FACE_REQUIRED",
				"source anchor declares a face outside the six concrete board faces",
				"Declare a top/bottom/left/right/front/back source face or omit it for exact plane verification.")
			return ContactBoard{}, "", false
		}
		contactBoard, err := layoutContactBoard(board)
		if err != nil {
			pushIssue("TRANSFORM_INVALID",
				fmt.Sprintf("component %s placement is not a rigid unit-scale frame", anchor.ComponentInstanceID),
				"Resolve the board to a rigid local frame before declaring floor-side contacts.")
			return ContactBoard{}, "", false
		}
		return contactBoard, anchor.Face, true
	}

	sourceBefore := len(*issues)
	sourceBoard, _, ok := boardFor(relationship.Source, "source")
	if !ok {
		return failContacts((*issues)[sourceBefore].Code)
	}
	boards := []ContactBoard{sourceBoard}
	intents := make([]ExplicitContact, 0, len(relationship.Targets))
	for index, anchor := range relationship.Targets {
		before := len(*issues)
		targetBoard, faceB, ok := boardFor(anchor, "target")
		if !ok {
			return failContacts((*issues)[before].Code)
		}
		boards = append(boards, targetBoard)
		faceA, okFace := coincidentFaceA(sourceBoard, targetBoard, faceB)
		if !okFace || (relationship.Source.Face != "" && relationship.Source.Face != faceA) {
			pushIssue("CONTACT_FACE_REQUIRED",
				fmt.Sprintf("declared target face does not coincide with exactly one face of %s", relationship.Source.ComponentInstanceID),
				"Anchor floor-side contacts on faces that physically coincide; proximity never infers a union.")
			return failContacts("CONTACT_FACE_REQUIRED")
		}
		intents = append(intents, ExplicitContact{
			RelationshipID: relationshipID, ContactID: contactIDs[index],
			ParticipantA: relationship.Source.ComponentInstanceID, ParticipantB: anchor.ComponentInstanceID,
			FaceA: faceA, FaceB: faceB,
		})
	}

	resolution := resolveExplicitContacts(boards, intents, contactIDs)
	if len(resolution.Issues) > 0 {
		*issues = append(*issues, resolution.Issues...)
		codes := uniqueIssueCodes(resolution.Issues)
		return failContacts(codes...)
	}

	// J2-A (#874): declared families plan independently per family — one
	// joint, one status, per-family counts and positions. stationCount and
	// families are mutually exclusive (fail closed, never silent precedence).
	if len(relationship.Families) > 0 {
		return deriveFamilyPlans(relationship, resolution, boards, contactIDs, validContacts, pushIssue, familyProfiles, operations)
	}
	count, hasCount := relationship.Parameters["stationCount"].(float64)
	start, hasStart := relationship.Parameters["startMarginMm"].(float64)
	end, hasEnd := relationship.Parameters["endMarginMm"].(float64)
	if !hasStart {
		start = 0
	}
	if !hasEnd {
		end = 0
	}
	if !hasCount || count != math.Trunc(count) || count < 2 ||
		math.IsNaN(start) || math.IsInf(start, 0) || start < 0 ||
		math.IsNaN(end) || math.IsInf(end, 0) || end < 0 {
		pushIssue("STATION_PATTERN_INVALID",
			"floor-side station pattern needs an integer stationCount >= 2 and finite nonnegative margins",
			"Declare stationCount (>= 2) and optional nonnegative start/end margins on the relationship.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"}, StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"STATION_PATTERN_INVALID"}}
	}
	specs := make([]StationSpec, 0, len(contactIDs))
	for _, contactID := range contactIDs {
		specs = append(specs, StationSpec{ContactID: contactID, Count: int(count), StartMarginMm: start, EndMarginMm: end})
	}
	planned := planResolvedContactStations(resolution, boards, specs)
	if len(planned.Issues) > 0 {
		*issues = append(*issues, planned.Issues...)
		codes := uniqueIssueCodes(planned.Issues)
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: codes, StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}}, Blockers: codes}
	}

	// No verified production technical profile exists for floor-side yet; the
	// honest terminal state, never a synthetic fallback (#874 §J4).
	pushIssue("TECHNICAL_PROFILE_REQUIRED",
		fmt.Sprintf("floor-side relationship %s has no verified production technical profile", relationshipID),
		"Attach a versioned, verified technical profile before fabrication; synthetic fixtures never enter production.")
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
		Stage: JoineryTechnicalProfileMissing, Contacts: validContacts(),
		Stations: JoineryStationPlanStatus{Status: "PLANNED", IssueCodes: []string{}, StationCounts: counts, StationDistances: distances},
		Blockers: []string{"TECHNICAL_PROFILE_REQUIRED"}}
}

// deriveFamilyPlans plans each declared operation family independently over
// the SAME verified contacts (#874 J2-A): one joint, one status, per-family
// counts and positions; cross-family position collisions fail the whole
// pattern (no auto-reduction, no silent overlap). The aggregate counts are
// the per-contact sums and the aggregate distances the united ascending
// physical drilling pattern.
func deriveFamilyPlans(relationship AuthoringRelationship, resolution ContactResolutionResult,
	boards []ContactBoard, contactIDs []string, validContacts func() []JoineryContactStatus,
	pushIssue func(code, message, remediation string), familyProfiles FamilyProfileResolver,
	operations *[]ResolvedMachiningOperation) JoineryRelationshipStatus {
	relationshipID := relationship.RelationshipID
	invalid := func(codes []string) JoineryRelationshipStatus {
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryStationInvalid, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: codes,
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: codes}
	}
	if _, hasCount := relationship.Parameters["stationCount"]; hasCount {
		pushIssue("STATION_PATTERN_INVALID",
			"stationCount and families are mutually exclusive: declare one station pattern per relationship",
			"Declare either a stationCount parameter or families with unique ids and counts >= 2.")
		return invalid([]string{"STATION_PATTERN_INVALID"})
	}
	seen := map[string]bool{}
	for _, family := range relationship.Families {
		if strings.TrimSpace(family.FamilyID) == "" || seen[family.FamilyID] || family.Count < 2 ||
			math.IsNaN(family.StartMarginMm) || math.IsInf(family.StartMarginMm, 0) || family.StartMarginMm < 0 ||
			math.IsNaN(family.EndMarginMm) || math.IsInf(family.EndMarginMm, 0) || family.EndMarginMm < 0 {
			pushIssue("STATION_PATTERN_INVALID",
				"every family needs a unique non-blank familyId, an integer count >= 2 and finite nonnegative margins",
				"Declare families with unique ids, counts >= 2 and optional nonnegative margins.")
			return invalid([]string{"STATION_PATTERN_INVALID"})
		}
		seen[family.FamilyID] = true
	}
	families := append([]AuthoringRelationshipFamily(nil), relationship.Families...)
	sort.Slice(families, func(i, j int) bool { return families[i].FamilyID < families[j].FamilyID })

	familyPlans := make([]JoineryFamilyPlan, 0, len(families))
	aggregateCounts := map[string]int{}
	aggregatePositions := map[string][]float64{}
	for _, family := range families {
		specs := make([]StationSpec, 0, len(contactIDs))
		for _, contactID := range contactIDs {
			specs = append(specs, StationSpec{ContactID: contactID, Count: family.Count,
				StartMarginMm: family.StartMarginMm, EndMarginMm: family.EndMarginMm})
		}
		planned := planResolvedContactStations(resolution, boards, specs)
		if len(planned.Issues) > 0 {
			for _, issue := range planned.Issues {
				pushIssue(issue.Code, issue.Message, issue.Remediation)
			}
			codes := uniqueIssueCodes(planned.Issues)
			return invalid(codes)
		}
		counts := make([]JoineryStationPlanCount, 0, len(planned.Plans))
		distances := make([]JoineryStationDistances, 0, len(planned.Plans))
		for _, plan := range planned.Plans {
			counts = append(counts, JoineryStationPlanCount{ContactID: plan.ContactID, StationCount: len(plan.Stations)})
			positions := make([]float64, 0, len(plan.Stations))
			for _, station := range plan.Stations {
				positions = append(positions, station.DistanceMm)
			}
			distances = append(distances, JoineryStationDistances{ContactID: plan.ContactID, DistancesMm: positions})
			aggregateCounts[plan.ContactID] += len(plan.Stations)
			aggregatePositions[plan.ContactID] = append(aggregatePositions[plan.ContactID], positions...)
		}
		familyPlans = append(familyPlans, JoineryFamilyPlan{FamilyID: family.FamilyID,
			StationCounts: counts, StationDistances: distances})
	}
	// Cross-family collision: two families planning the same physical
	// position on one contact is a construction error, never an overlap.
	for _, contactID := range contactIDs {
		positions := append([]float64(nil), aggregatePositions[contactID]...)
		sort.Float64s(positions)
		for i := 1; i < len(positions); i++ {
			if positions[i]-positions[i-1] <= 1e-6 {
				pushIssue("STATION_FAMILY_COLLISION",
					fmt.Sprintf("families plan the same station position %.3f on contact %s; patterns must not overlap",
						positions[i], contactID),
					"Adjust each family's count or margins so planned positions stay distinct.")
				return invalid([]string{"STATION_FAMILY_COLLISION"})
			}
		}
	}
	counts := make([]JoineryStationPlanCount, 0, len(contactIDs))
	distances := make([]JoineryStationDistances, 0, len(contactIDs))
	for _, contactID := range contactIDs {
		counts = append(counts, JoineryStationPlanCount{ContactID: contactID, StationCount: aggregateCounts[contactID]})
		positions := append([]float64(nil), aggregatePositions[contactID]...)
		sort.Float64s(positions)
		distances = append(distances, JoineryStationDistances{ContactID: contactID, DistancesMm: positions})
	}
	// J2-A.2 (#874): with a verified technical profile for EVERY family the
	// joint derives real operations (one per family×contact×participant,
	// every station one hole on the participant's contact face). Any missing
	// profile keeps the honest terminal state and ZERO operations for the
	// whole relationship — all-or-nothing, never a partial fabrication.
	profiles := make([]*FamilyTechnicalProfile, 0, len(families))
	complete := familyProfiles != nil
	if complete {
		for _, family := range families {
			profile := familyProfiles(relationship.Kind, family.FamilyID)
			if profile == nil {
				complete = false
				break
			}
			profiles = append(profiles, profile)
		}
	}
	if !complete {
		pushIssue("TECHNICAL_PROFILE_REQUIRED",
			fmt.Sprintf("floor-side relationship %s has no verified production technical profile", relationshipID),
			"Attach a versioned, verified technical profile before fabrication; synthetic fixtures never enter production.")
		return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
			Stage: JoineryTechnicalProfileMissing, Contacts: validContacts(),
			Stations: JoineryStationPlanStatus{Status: "PLANNED", IssueCodes: []string{},
				StationCounts: counts, StationDistances: distances, FamilyPlans: familyPlans},
			Blockers: []string{"TECHNICAL_PROFILE_REQUIRED"}}
	}
	for familyIndex, family := range families {
		profile := profiles[familyIndex]
		if profile.DiameterMm <= 0 || profile.DepthMm <= 0 ||
			math.IsNaN(profile.DiameterMm) || math.IsInf(profile.DiameterMm, 0) ||
			math.IsNaN(profile.DepthMm) || math.IsInf(profile.DepthMm, 0) {
			pushIssue("TECHNICAL_PROFILE_INVALID",
				fmt.Sprintf("family %s profile %s needs finite positive diameter and depth", family.FamilyID, profile.ProfileID),
				"Attach a verified profile with real tool geometry.")
			return invalid([]string{"TECHNICAL_PROFILE_INVALID"})
		}
	}
	byID := map[string]ContactBoard{}
	for _, board := range boards {
		byID[board.OccurrenceID] = board
	}
	operationsBefore := len(*operations)
	for familyIndex, family := range families {
		profile := profiles[familyIndex]
		// Re-plan to recover the per-station local points (A0b is
		// deterministic): one operation per contact×participant. A profile
		// whose geometry does not fit a participant (bit breakout, bore
		// deeper than the board) fails the WHOLE relationship — a hole is
		// never silently omitted (#874).
		specs := make([]StationSpec, 0, len(contactIDs))
		for _, contactID := range contactIDs {
			specs = append(specs, StationSpec{ContactID: contactID, Count: family.Count,
				StartMarginMm: family.StartMarginMm, EndMarginMm: family.EndMarginMm})
		}
		planned := planResolvedContactStations(resolution, boards, specs)
		for _, contact := range resolution.Contacts {
			boardA, boardB := byID[contact.ParticipantA], byID[contact.ParticipantB]
			holesA, holesB := []ResolveHole{}, []ResolveHole{}
			for _, plan := range planned.Plans {
				if plan.ContactID != contact.ContactID {
					continue
				}
				for _, station := range plan.Stations {
					holeA, okA := stationHole(boardA, contact.FaceA, station.ParticipantALocalMm, profile)
					if !okA {
						pushIssue("TECHNICAL_PROFILE_INCOMPATIBLE",
							fmt.Sprintf("family %s profile %s does not fit participant %s on face %s",
								family.FamilyID, profile.ProfileID, boardA.OccurrenceID, contact.FaceA),
							"Attach a profile whose diameter and depth fit every participant of this joint.")
						*operations = (*operations)[:operationsBefore]
						return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
							Stage: JoineryMachiningInvalid, Contacts: validContacts(),
							Stations: JoineryStationPlanStatus{Status: "PLANNED",
								IssueCodes:    []string{"TECHNICAL_PROFILE_INCOMPATIBLE"},
								StationCounts: counts, StationDistances: distances, FamilyPlans: familyPlans},
							Blockers: []string{"TECHNICAL_PROFILE_INCOMPATIBLE"}}
					}
					holesA = append(holesA, holeA)
					holeB, okB := stationHole(boardB, contact.FaceB, station.ParticipantBLocalMm, profile)
					if !okB {
						pushIssue("TECHNICAL_PROFILE_INCOMPATIBLE",
							fmt.Sprintf("family %s profile %s does not fit participant %s on face %s",
								family.FamilyID, profile.ProfileID, boardB.OccurrenceID, contact.FaceB),
							"Attach a profile whose diameter and depth fit every participant of this joint.")
						*operations = (*operations)[:operationsBefore]
						return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
							Stage: JoineryMachiningInvalid, Contacts: validContacts(),
							Stations: JoineryStationPlanStatus{Status: "PLANNED",
								IssueCodes:    []string{"TECHNICAL_PROFILE_INCOMPATIBLE"},
								StationCounts: counts, StationDistances: distances, FamilyPlans: familyPlans},
							Blockers: []string{"TECHNICAL_PROFILE_INCOMPATIBLE"}}
					}
					holesB = append(holesB, holeB)
				}
			}
			*operations = append(*operations,
				familyOperation(relationshipID, family.FamilyID, contact.ContactID, boardA.OccurrenceID, profile.ProfileID, holesA),
				familyOperation(relationshipID, family.FamilyID, contact.ContactID, boardB.OccurrenceID, profile.ProfileID, holesB))
		}
	}
	return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
		Stage: JoineryMachiningReady, Contacts: validContacts(),
		Stations: JoineryStationPlanStatus{Status: "PLANNED", IssueCodes: []string{},
			StationCounts: counts, StationDistances: distances, FamilyPlans: familyPlans},
		Blockers: []string{}}
}

// familyOperation builds one family×contact×participant machining operation.
func familyOperation(relationshipID, familyID, contactID, participantID, profileID string, holes []ResolveHole) ResolvedMachiningOperation {
	return ResolvedMachiningOperation{
		OperationID:             fmt.Sprintf("%s:%s:%s:%s", relationshipID, familyID, contactID, participantID),
		HostComponentInstanceID: participantID,
		Provenance: ResolvedMachiningProvenance{
			SourceKind: "relationship", RelationshipID: relationshipID,
			FamilyID: familyID, CatalogRuleID: profileID,
		},
		Holes: holes,
	}
}

// stationHole projects a station's board-local point onto its contact face
// (the entry face) using the #356 face-coordinate convention: the two
// non-normal local axes in X<Y<Z order. The bore runs along the face
// normal; depth must fit inside the board from that face and the bit must
// fit the face plane.
func stationHole(board ContactBoard, face string, local [3]float64, profile *FamilyTechnicalProfile) (ResolveHole, bool) {
	axis, high := contactOperationFaceAxis(face)
	if axis < 0 {
		return ResolveHole{}, false
	}
	dims := [3]float64{board.WidthMm, board.ThicknessMm, board.LengthMm}
	radius := profile.DiameterMm / 2
	entry := 0.0
	if high {
		entry = dims[axis]
	}
	if math.Abs(local[axis]-entry) > 1e-6 {
		return ResolveHole{}, false
	}
	inward := 1.0
	if high {
		inward = -1
	}
	if profile.DepthMm < 0 || profile.DepthMm > dims[axis]+1e-6 {
		return ResolveHole{}, false
	}
	// Face coordinates follow the #356 convention: the two non-normal
	// local axes in X<Y<Z order (contactOperationFaceAxis defines the
	// normal axis; same package, same board-local frame).
	plane := [2]float64{}
	nonAxis := [2]int{}
	pi, ni := 0, 0
	for i := 0; i < 3; i++ {
		if i == axis {
			continue
		}
		plane[pi] = local[i]
		nonAxis[ni] = i
		pi++
		ni++
	}
	// The bit must fit the face plane and the bore must fit the board from
	// the entry face along the inward normal.
	if plane[0] < radius-1e-6 || plane[1] < radius-1e-6 ||
		plane[0] > dims[nonAxis[0]]-radius+1e-6 || plane[1] > dims[nonAxis[1]]-radius+1e-6 {
		return ResolveHole{}, false
	}
	_ = inward
	return ResolveHole{
		Face: face, XMm: plane[0], YMm: plane[1],
		DiameterMm: profile.DiameterMm, DepthMm: profile.DepthMm, Type: profile.HoleType,
	}, true
}

// coincidentFaceA finds the single face of a whose plane exactly coincides
// (1e-6) with b's declared face plane.
func coincidentFaceA(a, b ContactBoard, faceB string) (string, bool) {
	cornersB, normalB := b.surface(faceB)
	negatedB := negVec3(normalB)
	matches := make([]string, 0, 6)
	for _, faceA := range []string{"top", "bottom", "left", "right", "front", "back"} {
		cornersA, normalA := a.surface(faceA)
		if math.Abs(dot3(normalA, negatedB)-1) > 1e-6 {
			continue
		}
		delta := contactAdd(cornersA[0], negVec3(cornersB[0]), 1)
		if math.Abs(dot3(delta, normalB)) <= 1e-6 {
			matches = append(matches, faceA)
		}
	}
	if len(matches) == 1 {
		return matches[0], true
	}
	return "", false
}

func uniqueIssueCodes(issues []domain.ContractIssue) []string {
	seen := map[string]bool{}
	codes := []string{}
	for _, issue := range issues {
		if !seen[issue.Code] {
			seen[issue.Code] = true
			codes = append(codes, issue.Code)
		}
	}
	return codes
}
