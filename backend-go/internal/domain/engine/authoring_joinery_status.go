package engine

import (
	"fmt"
	"math"

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
	Status        string                    `json:"status"`
	IssueCodes    []string                  `json:"issueCodes"`
	StationCounts []JoineryStationPlanCount `json:"stationCounts"`
}

type JoineryStationPlanCount struct {
	ContactID    string `json:"contactId"`
	StationCount int    `json:"stationCount"`
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
	issues *[]domain.ContractIssue) JoineryRelationshipStatus {
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
	notPlanned := JoineryStationPlanStatus{Status: "NOT_PLANNED", IssueCodes: []string{}, StationCounts: []JoineryStationPlanCount{}}
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
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: []string{"STATION_PATTERN_INVALID"}},
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
			Stations: JoineryStationPlanStatus{Status: "INVALID", IssueCodes: codes}, Blockers: codes}
	}

	// No verified production technical profile exists for floor-side yet; the
	// honest terminal state, never a synthetic fallback (#874 §J4).
	pushIssue("TECHNICAL_PROFILE_REQUIRED",
		fmt.Sprintf("floor-side relationship %s has no verified production technical profile", relationshipID),
		"Attach a versioned, verified technical profile before fabrication; synthetic fixtures never enter production.")
	counts := make([]JoineryStationPlanCount, 0, len(planned.Plans))
	for _, plan := range planned.Plans {
		counts = append(counts, JoineryStationPlanCount{ContactID: plan.ContactID, StationCount: len(plan.Stations)})
	}
	return JoineryRelationshipStatus{RelationshipID: relationshipID, Kind: relationship.Kind,
		Stage: JoineryTechnicalProfileMissing, Contacts: validContacts(),
		Stations: JoineryStationPlanStatus{Status: "PLANNED", IssueCodes: []string{}, StationCounts: counts},
		Blockers: []string{"TECHNICAL_PROFILE_REQUIRED"}}
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
