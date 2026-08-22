package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

/**
 * Site survey domain (OC-040/OC-041, issue #305) — parity with
 * packages/domain/src/siteSurvey.ts and contracts/siteSurvey.json.
 *
 * Structured field measurements per project space/room with explicit
 * authorship (captured/verified/approved) and measure intents separated
 * (preliminary → field → approved → fabrication) so a commercial
 * approximation can never reach production/CNC silently.
 */

type MeasureIntent string

const (
	MeasureIntentPreliminary MeasureIntent = "preliminary"
	MeasureIntentField       MeasureIntent = "field"
	MeasureIntentApproved    MeasureIntent = "approved"
	MeasureIntentFabrication MeasureIntent = "fabrication"
)

var measureIntents = map[string]struct{}{
	"preliminary": {},
	"field":       {},
	"approved":    {},
	"fabrication": {},
}

func IsValidMeasureIntent(s string) bool {
	_, ok := measureIntents[s]
	return ok
}

type SurveyElementKind string

const (
	SurveyElementOpening  SurveyElementKind = "opening"
	SurveyElementObstacle SurveyElementKind = "obstacle"
	SurveyElementUtility  SurveyElementKind = "utility"
)

var surveyElementKinds = map[string]struct{}{
	"opening":  {},
	"obstacle": {},
	"utility":  {},
}

func IsValidSurveyElementKind(s string) bool {
	_, ok := surveyElementKinds[s]
	return ok
}

/* ── Entities ──────────────────────────────────────────────────────────────── */

// SurveyElement is a wall opening, obstacle or utility with optional
// dimensions in mm that constrains the furniture layout.
type SurveyElement struct {
	ID         string            `json:"id"`
	Kind       SurveyElementKind `json:"kind"`
	Label      string            `json:"label"`
	WidthMm    *float64          `json:"width_mm,omitempty"`
	HeightMm   *float64          `json:"height_mm,omitempty"`
	DistanceMm *float64          `json:"distance_mm,omitempty"`
	Notes      string            `json:"notes,omitempty"`
}

// SpaceMeasures are room/space dimensions in mm; width/height are required
// to fabricate.
type SpaceMeasures struct {
	WidthMm  float64 `json:"width_mm"`
	HeightMm float64 `json:"height_mm"`
	DepthMm  *float64 `json:"depth_mm,omitempty"`
	Notes    string  `json:"notes,omitempty"`
}

// SurveySpace is one surveyed space/room. Measures holds the current (field
// or better) measurements; PreliminaryMeasures preserves the commercial
// approximation so deviations stay visible.
type SurveySpace struct {
	ID                   string            `json:"id"`
	Name                 string            `json:"name"`
	Intent               MeasureIntent     `json:"intent"`
	Measures             *SpaceMeasures    `json:"measures,omitempty"`
	PreliminaryMeasures  *SpaceMeasures    `json:"preliminary_measures,omitempty"`
	Elements             []SurveyElement   `json:"elements"`
	PlumbNote            string            `json:"plumb_note,omitempty"`
	LevelNote            string            `json:"level_note,omitempty"`
	SquareNote           string            `json:"square_note,omitempty"`
	PhotoIDs             []string          `json:"photo_ids,omitempty"`
	CapturedAt           *time.Time        `json:"captured_at,omitempty"`
	CapturedByUserID     string            `json:"captured_by_user_id,omitempty"`
	ApprovedAt           *time.Time        `json:"approved_at,omitempty"`
	ApprovedByUserID     string            `json:"approved_by_user_id,omitempty"`
}

// SiteSurvey is the survey subprocess of one project.
type SiteSurvey struct {
	ID               string        `json:"id"`
	ProjectID        string        `json:"project_id"`
	Revision         int           `json:"revision"`
	Spaces           []SurveySpace `json:"spaces"`
	CreatedAt        time.Time     `json:"created_at"`
	CapturedByUserID string        `json:"captured_by_user_id,omitempty"`
	VerifiedAt       *time.Time    `json:"verified_at,omitempty"`
	VerifiedByUserID string        `json:"verified_by_user_id,omitempty"`
}

/* ── Gate readiness (OC-041) ───────────────────────────────────────────────── */

type SurveyGateBlockerKind string

const (
	SurveyBlockerNoSpaces          SurveyGateBlockerKind = "no_spaces"
	SurveyBlockerPreliminarySpace  SurveyGateBlockerKind = "preliminary_space"
	SurveyBlockerFieldUnapproved   SurveyGateBlockerKind = "field_space_unapproved"
	SurveyBlockerNotVerified       SurveyGateBlockerKind = "not_verified"
)

type SurveyGateBlocker struct {
	Kind      SurveyGateBlockerKind `json:"kind"`
	SpaceID   string                `json:"space_id,omitempty"`
	SpaceName string                `json:"space_name,omitempty"`
	Message   string                `json:"message"`
}

// SurveyFabricationBlockers mirrors surveyFabricationBlockers: every space
// must have been captured on site (never preliminary) and approved, and the
// survey must carry an explicit verification with author. A nil survey
// returns no_spaces so callers fall back to the legacy stamp check.
func SurveyFabricationBlockers(survey *SiteSurvey) []SurveyGateBlocker {
	if survey == nil {
		return []SurveyGateBlocker{{Kind: SurveyBlockerNoSpaces, Message: "La obra no tiene levantamiento estructurado"}}
	}
	blockers := make([]SurveyGateBlocker, 0)
	if len(survey.Spaces) == 0 {
		blockers = append(blockers, SurveyGateBlocker{
			Kind:    SurveyBlockerNoSpaces,
			Message: "El levantamiento no tiene espacios cargados",
		})
	}
	for _, space := range survey.Spaces {
		if space.Intent == MeasureIntentPreliminary {
			blockers = append(blockers, SurveyGateBlocker{
				Kind: SurveyBlockerPreliminarySpace, SpaceID: space.ID, SpaceName: space.Name,
				Message: fmt.Sprintf("«%s» sólo tiene medidas preliminares (comerciales)", space.Name),
			})
		} else if space.Intent == MeasureIntentField {
			blockers = append(blockers, SurveyGateBlocker{
				Kind: SurveyBlockerFieldUnapproved, SpaceID: space.ID, SpaceName: space.Name,
				Message: fmt.Sprintf("«%s» está levantada pero pendiente de aprobación", space.Name),
			})
		}
	}
	if survey.VerifiedAt == nil {
		blockers = append(blockers, SurveyGateBlocker{
			Kind:    SurveyBlockerNotVerified,
			Message: "El levantamiento no tiene verificación con autor",
		})
	}
	return blockers
}

// IsSurveyApprovedForFabrication mirrors isSurveyApprovedForFabrication.
func IsSurveyApprovedForFabrication(survey *SiteSurvey) bool {
	return len(SurveyFabricationBlockers(survey)) == 0
}

/* ── Actions (mirror of the TS mutations) ──────────────────────────────────── */

// NewSiteSurveyEntityID generates an entity id (mirror of the TS
// generateSurveyId shape).
func NewSiteSurveyEntityID(prefix string) string {
	if prefix == "" {
		prefix = "svy"
	}
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixNano(), jobCostingRandomSuffix())
}

// UpsertSurveySpace mirrors upsertSurveySpace: creates or updates a space. A
// new space starts as preliminary (commercial entry); its intent only
// advances through the explicit capture/approve actions.
func UpsertSurveySpace(survey *SiteSurvey, input SurveySpaceInput) (*SiteSurvey, error) {
	if survey == nil {
		return nil, errors.New("NOT_FOUND:la obra no tiene levantamiento estructurado")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, errors.New("BAD_REQUEST:el espacio necesita un nombre")
	}
	for _, el := range input.Elements {
		if !IsValidSurveyElementKind(string(el.Kind)) {
			return nil, fmt.Errorf("BAD_REQUEST:tipo de elemento inválido: %s", el.Kind)
		}
		if strings.TrimSpace(el.Label) == "" {
			return nil, errors.New("BAD_REQUEST:el elemento necesita una etiqueta")
		}
		for _, mm := range []*float64{el.WidthMm, el.HeightMm, el.DistanceMm} {
			if mm != nil && *mm <= 0 {
				return nil, errors.New("BAD_REQUEST:las medidas del elemento deben ser mayores a cero")
			}
		}
	}

	existingIdx := -1
	if input.ID != "" {
		for i, s := range survey.Spaces {
			if s.ID == input.ID {
				existingIdx = i
				break
			}
		}
		if existingIdx == -1 {
			return nil, errors.New("BAD_REQUEST:espacio inexistente en el levantamiento")
		}
	}
	for i, s := range survey.Spaces {
		if i != existingIdx && strings.EqualFold(strings.TrimSpace(s.Name), name) {
			return nil, fmt.Errorf("BAD_REQUEST:ya existe un espacio llamado «%s»", s.Name)
		}
	}

	elements := make([]SurveyElement, 0, len(input.Elements))
	for _, el := range input.Elements {
		id := el.ID
		if id == "" {
			id = NewSiteSurveyEntityID("elm")
		}
		elements = append(elements, SurveyElement{
			ID: id, Kind: el.Kind, Label: strings.TrimSpace(el.Label),
			WidthMm: el.WidthMm, HeightMm: el.HeightMm, DistanceMm: el.DistanceMm,
			Notes: strings.TrimSpace(el.Notes),
		})
	}

	spaces := make([]SurveySpace, len(survey.Spaces))
	copy(spaces, survey.Spaces)
	if existingIdx >= 0 {
		space := spaces[existingIdx]
		space.Name = name
		if input.Elements != nil {
			space.Elements = elements
		}
		space.PlumbNote = strings.TrimSpace(input.PlumbNote)
		space.LevelNote = strings.TrimSpace(input.LevelNote)
		space.SquareNote = strings.TrimSpace(input.SquareNote)
		if input.PhotoIDs != nil {
			space.PhotoIDs = input.PhotoIDs
		}
		spaces[existingIdx] = space
	} else {
		photoIDs := input.PhotoIDs
		if photoIDs == nil {
			photoIDs = []string{}
		}
		spaces = append(spaces, SurveySpace{
			ID: NewSiteSurveyEntityID("spc"), Name: name,
			Intent: MeasureIntentPreliminary, Elements: elements,
			PlumbNote: strings.TrimSpace(input.PlumbNote), LevelNote: strings.TrimSpace(input.LevelNote),
			SquareNote: strings.TrimSpace(input.SquareNote), PhotoIDs: photoIDs,
		})
	}
	next := *survey
	next.Spaces = spaces
	return &next, nil
}

// RemoveSurveySpace mirrors removeSurveySpace; fabrication-frozen spaces are
// protected.
func RemoveSurveySpace(survey *SiteSurvey, spaceID string) (*SiteSurvey, error) {
	if survey == nil {
		return nil, errors.New("NOT_FOUND:la obra no tiene levantamiento estructurado")
	}
	idx := -1
	for i, s := range survey.Spaces {
		if s.ID == spaceID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil, errors.New("BAD_REQUEST:espacio inexistente en el levantamiento")
	}
	if survey.Spaces[idx].Intent == MeasureIntentFabrication {
		return nil, fmt.Errorf("BAD_REQUEST:«%s» está congelada para fabricación; no se puede eliminar", survey.Spaces[idx].Name)
	}
	spaces := make([]SurveySpace, 0, len(survey.Spaces)-1)
	spaces = append(spaces, survey.Spaces[:idx]...)
	spaces = append(spaces, survey.Spaces[idx+1:]...)
	next := *survey
	next.Spaces = spaces
	return &next, nil
}

// CaptureSpaceMeasures mirrors captureSpaceMeasures: preliminary → field,
// preserving the previous measures as the commercial approximation and
// bumping the survey revision so consumers detect re-measured work.
func CaptureSpaceMeasures(survey *SiteSurvey, spaceID string, measures SpaceMeasures, byUserID string, at time.Time) (*SiteSurvey, string, error) {
	if survey == nil {
		return nil, "", errors.New("NOT_FOUND:la obra no tiene levantamiento estructurado")
	}
	idx := -1
	for i, s := range survey.Spaces {
		if s.ID == spaceID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil, "", errors.New("BAD_REQUEST:espacio inexistente en el levantamiento")
	}
	if measures.WidthMm <= 0 || measures.HeightMm <= 0 {
		return nil, "", errors.New("BAD_REQUEST:el ancho y el alto (mm) deben ser mayores a cero")
	}
	if measures.DepthMm != nil && *measures.DepthMm <= 0 {
		return nil, "", errors.New("BAD_REQUEST:la profundidad (mm) debe ser mayor a cero")
	}

	spaces := make([]SurveySpace, len(survey.Spaces))
	copy(spaces, survey.Spaces)
	space := spaces[idx]
	if space.PreliminaryMeasures == nil {
		space.PreliminaryMeasures = space.Measures
	}
	space.Intent = MeasureIntentField
	space.Measures = &measures
	space.CapturedAt = &at
	space.CapturedByUserID = byUserID
	spaces[idx] = space

	next := *survey
	next.Spaces = spaces
	next.Revision = survey.Revision + 1
	return &next, space.Name, nil
}

// VerifySiteSurvey mirrors verifySiteSurvey (OC-040 verifiedAt/By). Requires
// at least one space captured on site.
func VerifySiteSurvey(survey *SiteSurvey, byUserID string, at time.Time) (*SiteSurvey, error) {
	if survey == nil {
		return nil, errors.New("NOT_FOUND:la obra no tiene levantamiento estructurado")
	}
	if survey.VerifiedAt != nil {
		return nil, errors.New("CONFLICT:el levantamiento ya está verificado")
	}
	captured := 0
	for _, s := range survey.Spaces {
		if s.Intent != MeasureIntentPreliminary {
			captured++
		}
	}
	if captured == 0 {
		return nil, errors.New("BAD_REQUEST:no hay espacios levantados en obra para verificar")
	}
	next := *survey
	next.VerifiedAt = &at
	next.VerifiedByUserID = byUserID
	return &next, nil
}

// ApproveSpaceMeasures mirrors approveSpaceMeasures: field → approved
// (OC-041). Preliminary measures cannot be approved directly.
func ApproveSpaceMeasures(survey *SiteSurvey, spaceID string, byUserID string, at time.Time) (*SiteSurvey, string, error) {
	if survey == nil {
		return nil, "", errors.New("NOT_FOUND:la obra no tiene levantamiento estructurado")
	}
	idx := -1
	for i, s := range survey.Spaces {
		if s.ID == spaceID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil, "", errors.New("BAD_REQUEST:espacio inexistente en el levantamiento")
	}
	space := survey.Spaces[idx]
	if space.Intent == MeasureIntentPreliminary {
		return nil, "", fmt.Errorf("BAD_REQUEST:«%s» sólo tiene medidas preliminares; levántelas en obra antes de aprobar", space.Name)
	}
	if space.Intent == MeasureIntentApproved || space.Intent == MeasureIntentFabrication {
		return nil, "", fmt.Errorf("CONFLICT:«%s» ya está aprobada", space.Name)
	}

	spaces := make([]SurveySpace, len(survey.Spaces))
	copy(spaces, survey.Spaces)
	spaces[idx].Intent = MeasureIntentApproved
	spaces[idx].ApprovedAt = &at
	spaces[idx].ApprovedByUserID = byUserID
	next := *survey
	next.Spaces = spaces
	return &next, space.Name, nil
}

// FreezeMeasuresForFabrication mirrors freezeMeasuresForFabrication:
// approved → fabrication, requiring the full OC-041 gate.
func FreezeMeasuresForFabrication(survey *SiteSurvey, byUserID string, at time.Time) (*SiteSurvey, error) {
	if survey == nil {
		return nil, errors.New("NOT_FOUND:la obra no tiene levantamiento estructurado")
	}
	blockers := SurveyFabricationBlockers(survey)
	if len(blockers) > 0 {
		return nil, fmt.Errorf("BAD_REQUEST:no se puede congelar para fabricación: %s", blockers[0].Message)
	}
	spaces := make([]SurveySpace, len(survey.Spaces))
	copy(spaces, survey.Spaces)
	for i := range spaces {
		spaces[i].Intent = MeasureIntentFabrication
	}
	next := *survey
	next.Spaces = spaces
	return &next, nil
}

// SiteSurveyMutation is what a survey mutation produced: the new survey
// payload and the audit events.
type SiteSurveyMutation struct {
	Survey *SiteSurvey
	Events []ProjectEvent
}

/* ── Inputs ────────────────────────────────────────────────────────────────── */

// SurveySpaceInput is the client payload for upserting a space.
type SurveySpaceInput struct {
	ID         string               `json:"id"`
	Name       string               `json:"name"`
	Elements   []SurveyElementInput `json:"elements,omitempty"`
	PlumbNote  string               `json:"plumb_note,omitempty"`
	LevelNote  string               `json:"level_note,omitempty"`
	SquareNote string               `json:"square_note,omitempty"`
	PhotoIDs   []string             `json:"photo_ids,omitempty"`
}

type SurveyElementInput struct {
	ID         string            `json:"id"`
	Kind       SurveyElementKind `json:"kind"`
	Label      string            `json:"label"`
	WidthMm    *float64          `json:"width_mm,omitempty"`
	HeightMm   *float64          `json:"height_mm,omitempty"`
	DistanceMm *float64          `json:"distance_mm,omitempty"`
	Notes      string            `json:"notes,omitempty"`
}

/* ── Shape validation ──────────────────────────────────────────────────────── */

// ValidateSiteSurveyShape mirrors validateSiteSurveyShape: structural
// invariants of a candidate survey payload, independent of what was stored.
func ValidateSiteSurveyShape(survey *SiteSurvey) error {
	if survey == nil {
		return nil
	}
	if survey.ID == "" {
		return errors.New("siteSurvey.id requerido")
	}
	if survey.ProjectID == "" {
		return errors.New("siteSurvey.project_id requerido")
	}
	if survey.Revision < 1 {
		return errors.New("siteSurvey.revision debe ser >= 1")
	}
	if survey.VerifiedAt != nil && survey.VerifiedByUserID == "" {
		return errors.New("siteSurvey: verificación sin autor (verified_by_user_id)")
	}
	names := map[string]struct{}{}
	for _, space := range survey.Spaces {
		if space.ID == "" {
			return errors.New("space: id requerido")
		}
		name := strings.TrimSpace(space.Name)
		if name == "" {
			return fmt.Errorf("space %s: nombre requerido", space.ID)
		}
		key := strings.ToLower(name)
		if _, dup := names[key]; dup {
			return fmt.Errorf("space %s: nombre duplicado «%s»", space.ID, name)
		}
		names[key] = struct{}{}
		if !IsValidMeasureIntent(string(space.Intent)) {
			return fmt.Errorf("space %s: intent inválido %s", space.ID, space.Intent)
		}
		if space.Intent == MeasureIntentFabrication && space.ApprovedAt == nil {
			return fmt.Errorf("space %s: congelado sin aprobación previa", space.ID)
		}
		if space.Measures != nil {
			if space.Measures.WidthMm <= 0 || space.Measures.HeightMm <= 0 {
				return fmt.Errorf("space %s: medidas requieren width_mm/height_mm > 0", space.ID)
			}
			if space.Measures.DepthMm != nil && *space.Measures.DepthMm <= 0 {
				return fmt.Errorf("space %s: depth_mm debe ser > 0", space.ID)
			}
		}
		for _, el := range space.Elements {
			if !IsValidSurveyElementKind(string(el.Kind)) {
				return fmt.Errorf("element %s: tipo inválido %s", el.ID, el.Kind)
			}
			if strings.TrimSpace(el.Label) == "" {
				return fmt.Errorf("element %s: label requerido", el.ID)
			}
		}
	}
	return nil
}
