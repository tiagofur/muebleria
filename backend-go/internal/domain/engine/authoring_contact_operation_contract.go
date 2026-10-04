package engine

import (
	"encoding/json"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ContactOperationRecipe is explicit technical input, never a built-in default.
type ContactOperationRecipe struct {
	ContactID                string                 `json:"contactId"`
	RecipeID                 string                 `json:"recipeId"`
	RecipeRevision           string                 `json:"recipeRevision"`
	TechnicalProfileID       string                 `json:"technicalProfileId"`
	TechnicalProfileRevision string                 `json:"technicalProfileRevision"`
	Rules                    []ContactOperationRule `json:"rules"`
}

type ContactOperationRule struct {
	RuleID          string     `json:"ruleId"`
	RuleRevision    string     `json:"ruleRevision"`
	ParticipantRole string     `json:"participantRole"`
	OperationRole   string     `json:"operationRole"`
	EntryFace       string     `json:"entryFace"`
	OffsetMm        [3]float64 `json:"offsetMm"` // contact axis, normal, axis × normal
	Axis            [3]float64 `json:"axis"`
	DiameterMm      float64    `json:"diameterMm"`
	DepthMm         float64    `json:"depthMm"`
	// StationMode selects which planned stations the rule applies at:
	// "" / "all" = every station (the uniform pattern); "center" = exactly
	// one operation at the contact span's midpoint (a single centered
	// fastener — e.g. one central dowel between two flanking screws).
	// The midpoint station carries StationIndex -1.
	StationMode string `json:"stationMode,omitempty"`
}

// ContactOperation rule station modes.
const (
	ContactRuleStationModeAll    = "all"
	ContactRuleStationModeCenter = "center"
)

// ValidContactRuleStationMode reports whether a rule's station mode is usable.
func ValidContactRuleStationMode(mode string) bool {
	return mode == "" || mode == ContactRuleStationModeAll || mode == ContactRuleStationModeCenter
}

type ContactOperationProvenance struct {
	SourceKind      string `json:"sourceKind"`
	RelationshipID  string `json:"relationshipId"`
	ContactID       string `json:"contactId"`
	ParticipantID   string `json:"participantId"`
	ParticipantRole string `json:"participantRole"`
	StationIndex    int    `json:"stationIndex"`
	RecipeID        string `json:"recipeId"`
	RecipeRevision  string `json:"recipeRevision"`
	RuleID          string `json:"ruleId"`
	RuleRevision    string `json:"ruleRevision"`
	OperationRole   string `json:"operationRole"`
}

type NeutralContactOperation struct {
	OperationID              string                     `json:"operationId"`
	Provenance               ContactOperationProvenance `json:"provenance"`
	TechnicalProfileID       string                     `json:"technicalProfileId"`
	TechnicalProfileRevision string                     `json:"technicalProfileRevision"`
	EntryFace                string                     `json:"entryFace"`
	CenterLocalMm            [3]float64                 `json:"centerLocalMm"`
	AxisLocal                [3]float64                 `json:"axisLocal"`
	DiameterMm               float64                    `json:"diameterMm"`
	DepthMm                  float64                    `json:"depthMm"`
}

type ContactOperationResult struct {
	Operations []NeutralContactOperation `json:"operations"`
	Issues     []domain.ContractIssue    `json:"issues"`
}

// ContactOperationID encodes the nine dependent provenance fields with Go JSON escaping.
func ContactOperationID(provenance ContactOperationProvenance) string {
	identity, _ := json.Marshal([]any{provenance.RelationshipID, provenance.ContactID, provenance.ParticipantID,
		provenance.StationIndex, provenance.RecipeID, provenance.RecipeRevision, provenance.RuleID,
		provenance.RuleRevision, provenance.OperationRole})
	return "j1:" + string(identity)
}
