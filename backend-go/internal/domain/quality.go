package domain

import (
	"errors"
	"fmt"
	mrand "math/rand"
	"time"
)

var qualityRand = mrand.New(mrand.NewSource(time.Now().UnixNano()))

/**
 * Quality & rework domain (OC-060..OC-062).
 * Parity with packages/domain/src/quality.ts and
 * contracts/qualityStatuses.json.
 */

type QualityIssueCategory string

const (
	QualityCategoryDimensional  QualityIssueCategory = "dimensional"
	QualityCategoryAcabadoCanto QualityIssueCategory = "acabado_canto"
	QualityCategoryMecanizado   QualityIssueCategory = "mecanizado"
	QualityCategoryDano         QualityIssueCategory = "dano"
	QualityCategoryFaltante     QualityIssueCategory = "faltante"
	QualityCategoryArmado       QualityIssueCategory = "armado"
	QualityCategoryOtro         QualityIssueCategory = "otro"
)

var qualityIssueCategories = map[string]struct{}{
	"dimensional":   {},
	"acabado_canto": {},
	"mecanizado":    {},
	"dano":          {},
	"faltante":      {},
	"armado":        {},
	"otro":          {},
}

func IsValidQualityIssueCategory(s string) bool {
	_, ok := qualityIssueCategories[s]
	return ok
}

type QualityIssueStatus string

const (
	QualityIssueOpen     QualityIssueStatus = "open"
	QualityIssueResolved QualityIssueStatus = "resolved"
	QualityIssueVerified QualityIssueStatus = "verified"
)

var qualityIssueStatuses = map[string]struct{}{
	"open":     {},
	"resolved": {},
	"verified": {},
}

func IsValidQualityIssueStatus(s string) bool {
	_, ok := qualityIssueStatuses[s]
	return ok
}

// qualityIssueStatusTransitions mirrors QUALITY_ISSUE_STATUS_TRANSITIONS
// (resolved/verified → open models a failed verification reopen).
var qualityIssueStatusTransitions = map[QualityIssueStatus][]QualityIssueStatus{
	QualityIssueOpen:     {QualityIssueResolved},
	QualityIssueResolved: {QualityIssueVerified, QualityIssueOpen},
	QualityIssueVerified: {QualityIssueOpen},
}

func CanTransitionQualityIssueStatus(from, to QualityIssueStatus) bool {
	for _, next := range qualityIssueStatusTransitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

type ReworkActionType string

const (
	ReworkActionRework     ReworkActionType = "rework"
	ReworkActionRefabricate ReworkActionType = "refabricate"
	ReworkActionScrap      ReworkActionType = "scrap"
	ReworkActionAcceptAsIs ReworkActionType = "accept_as_is"
)

var reworkActionTypes = map[string]struct{}{
	"rework":       {},
	"refabricate":  {},
	"scrap":        {},
	"accept_as_is": {},
}

func IsValidReworkActionType(s string) bool {
	_, ok := reworkActionTypes[s]
	return ok
}

type QcCheckCode string

const (
	QcCheckSquare         QcCheckCode = "square"
	QcCheckDimensions     QcCheckCode = "dimensions"
	QcCheckHardware       QcCheckCode = "hardware"
	QcCheckDoorsDrawers   QcCheckCode = "doors_drawers"
	QcCheckFinish         QcCheckCode = "finish"
	QcCheckIdentification QcCheckCode = "identification"
)

var qcCheckCodes = map[string]struct{}{
	"square":         {},
	"dimensions":     {},
	"hardware":       {},
	"doors_drawers":  {},
	"finish":         {},
	"identification": {},
}

func IsValidQcCheckCode(s string) bool {
	_, ok := qcCheckCodes[s]
	return ok
}

/* ── Entities ──────────────────────────────────────────────────────────────── */

// QualityIssue is a defect detected before delivery, linked to a piece and/or
// unit (OC-060).
type QualityIssue struct {
	ID              string              `json:"id"`
	Description     string              `json:"description"`
	Category        QualityIssueCategory `json:"category"`
	Status          QualityIssueStatus  `json:"status"`
	ProjectItemID   string              `json:"project_item_id,omitempty"`
	PartInstanceID  string              `json:"part_instance_id,omitempty"`
	ModuleUnitID    string              `json:"module_unit_id,omitempty"`
	Station         string              `json:"station,omitempty"`
	PhotoIDs        []string            `json:"photo_ids,omitempty"`
	Notes           string              `json:"notes,omitempty"`
	ReportedBy      string              `json:"reported_by,omitempty"`
	ReportedAt      time.Time           `json:"reported_at"`
	ResolvedAt      *time.Time          `json:"resolved_at,omitempty"`
	ResolvedBy      string              `json:"resolved_by,omitempty"`
	ResolutionNotes string              `json:"resolution_notes,omitempty"`
	VerifiedAt      *time.Time          `json:"verified_at,omitempty"`
	VerifiedBy      string              `json:"verified_by,omitempty"`
}

// ReworkAction is the resolution of a quality issue (OC-061): what was done
// and how much material/time it cost — the input for job costing.
type ReworkAction struct {
	ID             string          `json:"id"`
	IssueID        string          `json:"issue_id"`
	Action         ReworkActionType `json:"action"`
	Reason         string          `json:"reason,omitempty"`
	MaterialCost   float64         `json:"material_cost"`
	LaborMinutes   float64         `json:"labor_minutes"`
	PartInstanceID string          `json:"part_instance_id,omitempty"`
	ByUserID       string          `json:"by_user_id,omitempty"`
	At             time.Time       `json:"at"`
}

type UnitQcChecklistItem struct {
	Code   QcCheckCode `json:"code"`
	Passed bool        `json:"passed"`
}

type QcOverride struct {
	Reason   string    `json:"reason"`
	ByUserID string    `json:"by_user_id,omitempty"`
	At       time.Time `json:"at"`
}

// UnitQcRecord is the per-unit QC result (OC-062): checklist evidence or an
// audited supervisor override.
type UnitQcRecord struct {
	UnitID    string                `json:"unit_id"`
	Checklist []UnitQcChecklistItem `json:"checklist"`
	PassedAt  *time.Time            `json:"passed_at,omitempty"`
	PassedBy  string                `json:"passed_by,omitempty"`
	Notes     string                `json:"notes,omitempty"`
	PhotoIDs  []string              `json:"photo_ids,omitempty"`
	Override  *QcOverride           `json:"override,omitempty"`
}

// QualityJob is the quality subprocess of one project.
type QualityJob struct {
	ID            string           `json:"id"`
	ProjectID     string           `json:"project_id"`
	Issues        []QualityIssue   `json:"issues"`
	ReworkActions []ReworkAction   `json:"rework_actions"`
	UnitQC        []UnitQcRecord   `json:"unit_qc"`
	CreatedAt     time.Time        `json:"created_at"`
}

/* ── Shape + transition validation ────────────────────────────────────────── */

// ValidateQualityJobShape checks the structural invariants of a candidate
// quality job, independent of what was stored before.
func ValidateQualityJobShape(job *QualityJob) error {
	if job == nil {
		return nil
	}
	if job.ProjectID == "" {
		return errors.New("quality job requiere project_id")
	}
	issueIDs := map[string]struct{}{}
	for _, i := range job.Issues {
		if _, dup := issueIDs[i.ID]; dup {
			return fmt.Errorf("problema de calidad duplicado: %s", i.ID)
		}
		issueIDs[i.ID] = struct{}{}
		if !IsValidQualityIssueStatus(string(i.Status)) {
			return fmt.Errorf("estado de calidad inválido: %s", i.Status)
		}
		if !IsValidQualityIssueCategory(string(i.Category)) {
			return fmt.Errorf("categoría de calidad inválida: %s", i.Category)
		}
		if i.Description == "" {
			return fmt.Errorf("el problema %s requiere descripción", i.ID)
		}
	}
	actionIDs := map[string]struct{}{}
	for _, a := range job.ReworkActions {
		if _, dup := actionIDs[a.ID]; dup {
			return fmt.Errorf("acción de retrabajo duplicada: %s", a.ID)
		}
		actionIDs[a.ID] = struct{}{}
		if !IsValidReworkActionType(string(a.Action)) {
			return fmt.Errorf("acción de retrabajo inválida: %s", a.Action)
		}
		if a.MaterialCost < 0 || a.LaborMinutes < 0 {
			return fmt.Errorf("la acción %s no puede tener costos negativos", a.ID)
		}
		if _, ok := issueIDs[a.IssueID]; !ok {
			return fmt.Errorf("la acción %s referencia un problema inexistente: %s", a.ID, a.IssueID)
		}
	}
	seenUnits := map[string]struct{}{}
	for _, r := range job.UnitQC {
		if _, dup := seenUnits[r.UnitID]; dup {
			return fmt.Errorf("registro de QC duplicado para la unidad: %s", r.UnitID)
		}
		seenUnits[r.UnitID] = struct{}{}
		for _, item := range r.Checklist {
			if !IsValidQcCheckCode(string(item.Code)) {
				return fmt.Errorf("punto de QC inválido: %s", item.Code)
			}
		}
		if r.Override != nil && r.Override.Reason == "" {
			return fmt.Errorf("el override de QC de la unidad %s requiere motivo", r.UnitID)
		}
	}
	return nil
}

// ValidateQualityJobTransition validates a candidate job against the
// previously stored one: entities are append-only, issue statuses follow the
// legal transitions and overrides are never silently revoked.
func ValidateQualityJobTransition(prev, next *QualityJob) error {
	if err := ValidateQualityJobShape(next); err != nil {
		return err
	}
	if prev == nil {
		return nil
	}
	if next != nil && next.ID != prev.ID {
		return fmt.Errorf("quality job id inmutable (%s ≠ %s)", prev.ID, next.ID)
	}
	if next == nil {
		return errors.New("quality job no removible")
	}

	prevIssues := map[string]QualityIssue{}
	for _, i := range prev.Issues {
		prevIssues[i.ID] = i
	}
	for _, i := range next.Issues {
		before, existed := prevIssues[i.ID]
		if !existed {
			if i.Status != QualityIssueOpen {
				return fmt.Errorf("problema nuevo %s debe crearse como open", i.ID)
			}
		} else if before.Status != i.Status {
			if !CanTransitionQualityIssueStatus(before.Status, i.Status) {
				return fmt.Errorf("transición de calidad inválida %s: %s → %s", i.ID, before.Status, i.Status)
			}
		}
	}
	for id := range prevIssues {
		found := false
		for _, i := range next.Issues {
			if i.ID == id {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("problema de calidad no removible: %s", id)
		}
	}

	prevActions := map[string]ReworkAction{}
	for _, a := range prev.ReworkActions {
		prevActions[a.ID] = a
	}
	for _, a := range next.ReworkActions {
		if _, existed := prevActions[a.ID]; !existed {
			continue
		}
	}
	for id := range prevActions {
		found := false
		for _, a := range next.ReworkActions {
			if a.ID == id {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("acción de retrabajo no removible: %s", id)
		}
	}

	prevQC := map[string]UnitQcRecord{}
	for _, r := range prev.UnitQC {
		prevQC[r.UnitID] = r
	}
	for _, r := range next.UnitQC {
		if before, existed := prevQC[r.UnitID]; existed {
			if before.Override != nil && r.Override == nil {
				return fmt.Errorf("override de QC no revocable para la unidad %s", r.UnitID)
			}
			if before.PassedAt != nil && r.PassedAt == nil {
				return fmt.Errorf("QC aprobado de la unidad %s no revocable (registrar override)", r.UnitID)
			}
		}
	}
	return nil
}

/* ── QC gate (OC-062) ──────────────────────────────────────────────────────── */

type QcGateCheckCode string

const (
	QcGateCheckPassed      QcGateCheckCode = "qc_passed"
	QcGateCheckNoOpenIssues QcGateCheckCode = "no_open_issues"
)

type QcGateCheck struct {
	Code     QcGateCheckCode `json:"code"`
	Label    string          `json:"label"`
	Passed   bool            `json:"passed"`
	Required bool            `json:"required"`
	Details  string          `json:"details"`
}

var qcGateCheckLabels = map[QcGateCheckCode]string{
	QcGateCheckPassed:       "QC de la unidad aprobado",
	QcGateCheckNoOpenIssues: "Sin problemas de calidad abiertos",
}

type UnitQcGateResult struct {
	Ready     bool           `json:"ready"`
	Checks    []QcGateCheck  `json:"checks"`
	Failing   []QcGateCheck  `json:"failing"`
	Overridden bool          `json:"overridden"`
}

// OpenIssuesForUnit returns open issues linked to the unit directly or through
// its mueble (project item).
func OpenIssuesForUnit(job *QualityJob, unit ModuleUnitExecution) []QualityIssue {
	if job == nil {
		return nil
	}
	var open []QualityIssue
	for _, i := range job.Issues {
		if i.Status != QualityIssueOpen {
			continue
		}
		if i.ModuleUnitID == unit.ID || (i.ModuleUnitID == "" && i.ProjectItemID == unit.ProjectItemID) {
			open = append(open, i)
		}
	}
	return open
}

// EvaluateUnitQcGate evaluates the QC gate before module_qc → packaged
// (OC-062). Parity with evaluateUnitQcGate in quality.ts.
func EvaluateUnitQcGate(job *QualityJob, unit ModuleUnitExecution) UnitQcGateResult {
	var record *UnitQcRecord
	if job != nil {
		for i := range job.UnitQC {
			if job.UnitQC[i].UnitID == unit.ID {
				record = &job.UnitQC[i]
				break
			}
		}
	}
	hasPass := record != nil && record.PassedAt != nil
	overridden := record != nil && record.Override != nil
	openIssues := OpenIssuesForUnit(job, unit)

	qcDetails := "Registrar el checklist de QC de la unidad con todos los puntos aprobados"
	if hasPass {
		passed := 0
		for _, item := range record.Checklist {
			if item.Passed {
				passed++
			}
		}
		qcDetails = fmt.Sprintf("Checklist aprobado (%d/%d puntos)", passed, len(record.Checklist))
	} else if overridden {
		qcDetails = fmt.Sprintf("Sin checklist aprobado — Packaging habilitado por override de supervisor: %s", record.Override.Reason)
	}
	issuesDetails := "Sin problemas de calidad abiertos para la unidad"
	if n := len(openIssues); n > 0 {
		issuesDetails = fmt.Sprintf("%d problema(s) de calidad abierto(s): resolver o verificar antes de empaquetar", n)
	}

	checks := []QcGateCheck{
		{Code: QcGateCheckPassed, Label: qcGateCheckLabels[QcGateCheckPassed], Passed: hasPass, Required: true, Details: qcDetails},
		{Code: QcGateCheckNoOpenIssues, Label: qcGateCheckLabels[QcGateCheckNoOpenIssues], Passed: len(openIssues) == 0, Required: true, Details: issuesDetails},
	}
	var failing []QcGateCheck
	for _, c := range checks {
		if c.Required && !c.Passed {
			failing = append(failing, c)
		}
	}
	return UnitQcGateResult{
		Ready:      len(failing) == 0 || overridden,
		Checks:     checks,
		Failing:    failing,
		Overridden: overridden,
	}
}

/* ── Snapshot + mutation (transactional contract) ──────────────────────────── */

// QualitySnapshot is the locked state handed to a quality mutation: the
// stored job plus the physical executions a rework action may touch.
type QualitySnapshot struct {
	Quality         *QualityJob
	Parts           []PartInstance
	Units           []ModuleUnitExecution
	ItemStatuses    map[string]string
	ItemQuantities  map[string]int
	ReleasedRevision string
}

// QualityMutation is what a quality mutation produced: the new job payload,
// (optionally) updated physical executions, derived item statuses and the
// audit events (floor + lifecycle).
type QualityMutation struct {
	Quality      *QualityJob
	Parts        []PartInstance
	Units        []ModuleUnitExecution
	ItemStatuses map[string]string
	FloorEvents  []FloorStatusEvent
	Events       []ProjectEvent
}

// NewQualityEntityID generates an entity id (mirror of the TS
// generateQualityId shape).
func NewQualityEntityID(prefix string) string {
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixNano(), qualityRandomSuffix())
}

func qualityRandomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 5)
	for i := range out {
		out[i] = alphabet[qualityRand.Intn(len(alphabet))]
	}
	return string(out)
}
