package domain

import (
	"errors"
	"fmt"
	"time"
)

/**
 * Installation domain (OC-070..OC-074): installation job per project with
 * visits, field issues, punch items and gated client closeout.
 * Parity with packages/domain/src/installation.ts and
 * contracts/installationStatuses.json.
 */

type InstallationJobStatus string

const (
	InstallationJobPlanned    InstallationJobStatus = "planned"
	InstallationJobInProgress InstallationJobStatus = "in_progress"
	InstallationJobCompleted  InstallationJobStatus = "completed"
)

type InstallationVisitStatus string

const (
	InstallationVisitScheduled InstallationVisitStatus = "scheduled"
	InstallationVisitInProgress InstallationVisitStatus = "in_progress"
	InstallationVisitCompleted InstallationVisitStatus = "completed"
	InstallationVisitCancelled InstallationVisitStatus = "cancelled"
)

type InstallationVisitResult string

const (
	InstallationVisitResultFinished InstallationVisitResult = "finished"
	InstallationVisitResultPartial   InstallationVisitResult = "partial"
	InstallationVisitResultBlocked   InstallationVisitResult = "blocked"
)

type FieldIssueStatus string

const (
	FieldIssueOpen           FieldIssueStatus = "open"
	FieldIssueActionRequired FieldIssueStatus = "action_required"
	FieldIssueBlocked        FieldIssueStatus = "blocked"
	FieldIssueResolved       FieldIssueStatus = "resolved"
	FieldIssueVerified       FieldIssueStatus = "verified"
)

type PunchItemStatus string

const (
	PunchItemOpen   PunchItemStatus = "open"
	PunchItemClosed PunchItemStatus = "closed"
)

type PunchSeverity string

const (
	PunchSeverityMinor    PunchSeverity = "minor"
	PunchSeverityMajor    PunchSeverity = "major"
	PunchSeverityCritical PunchSeverity = "critical"
)

var installationVisitStatuses = map[string]struct{}{
	"scheduled":   {},
	"in_progress": {},
	"completed":   {},
	"cancelled":   {},
}

var installationVisitResults = map[string]struct{}{
	"finished": {},
	"partial":  {},
	"blocked":  {},
}

var fieldIssueStatuses = map[string]struct{}{
	"open":            {},
	"action_required": {},
	"blocked":         {},
	"resolved":        {},
	"verified":        {},
}

// fieldIssueStatusTransitions mirrors FIELD_ISSUE_STATUS_TRANSITIONS
// (resolved/verified → open models a failed verification reopen).
var fieldIssueStatusTransitions = map[FieldIssueStatus][]FieldIssueStatus{
	FieldIssueOpen:           {FieldIssueActionRequired, FieldIssueBlocked, FieldIssueResolved},
	FieldIssueActionRequired: {FieldIssueBlocked, FieldIssueResolved},
	FieldIssueBlocked:        {FieldIssueActionRequired, FieldIssueResolved},
	FieldIssueResolved:       {FieldIssueVerified, FieldIssueOpen},
	FieldIssueVerified:       {FieldIssueOpen},
}

var punchItemStatuses = map[string]struct{}{
	"open":   {},
	"closed": {},
}

var punchSeverities = map[string]struct{}{
	"minor":    {},
	"major":    {},
	"critical": {},
}

func IsValidInstallationVisitStatus(s string) bool {
	_, ok := installationVisitStatuses[s]
	return ok
}

func IsValidInstallationVisitResult(s string) bool {
	_, ok := installationVisitResults[s]
	return ok
}

func IsValidFieldIssueStatus(s string) bool {
	_, ok := fieldIssueStatuses[s]
	return ok
}

func IsValidPunchItemStatus(s string) bool {
	_, ok := punchItemStatuses[s]
	return ok
}

func IsValidPunchSeverity(s string) bool {
	_, ok := punchSeverities[s]
	return ok
}

// CanTransitionFieldIssueStatus reports whether the issue may move from one
// status to another (parity with canTransitionFieldIssueStatus).
func CanTransitionFieldIssueStatus(from, to FieldIssueStatus) bool {
	for _, next := range fieldIssueStatusTransitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

// CanTransitionInstallationVisitStatus reports the legal visit lifecycle:
// scheduled → in_progress → completed, with scheduled/in_progress → cancelled.
func CanTransitionInstallationVisitStatus(from, to InstallationVisitStatus) bool {
	switch from {
	case InstallationVisitScheduled:
		return to == InstallationVisitInProgress || to == InstallationVisitCancelled
	case InstallationVisitInProgress:
		return to == InstallationVisitCompleted || to == InstallationVisitCancelled
	default:
		return false
	}
}

// InstallationVisit is one crew visit to the site (OC-071).
type InstallationVisit struct {
	ID          string                     `json:"id"`
	Date        string                     `json:"date"` // YYYY-MM-DD
	Crew        []string                   `json:"crew"`
	ArrivalAt   *time.Time                 `json:"arrival_at,omitempty"`
	StartAt     *time.Time                 `json:"start_at,omitempty"`
	EndAt       *time.Time                 `json:"end_at,omitempty"`
	Notes       string                     `json:"notes,omitempty"`
	PhotoIDs    []string                   `json:"photo_ids,omitempty"`
	UnitIDs     []string                   `json:"unit_ids,omitempty"`
	Status      InstallationVisitStatus    `json:"status"`
	Result      InstallationVisitResult    `json:"result,omitempty"`
	ResultNotes string                     `json:"result_notes,omitempty"`
	CreatedAt   time.Time                  `json:"created_at"`
}

// FieldIssue is a traceable on-site incident (OC-072).
type FieldIssue struct {
	ID              string          `json:"id"`
	Description     string          `json:"description"`
	Status          FieldIssueStatus `json:"status"`
	ProjectItemID   string          `json:"project_item_id,omitempty"`
	PartInstanceID  string          `json:"part_instance_id,omitempty"`
	PhotoIDs        []string        `json:"photo_ids,omitempty"`
	Notes           string          `json:"notes,omitempty"`
	ReportedBy      string          `json:"reported_by,omitempty"`
	ReportedAt      time.Time       `json:"reported_at"`
	ResolvedAt      *time.Time      `json:"resolved_at,omitempty"`
	ResolvedBy      string          `json:"resolved_by,omitempty"`
	ResolutionNotes string          `json:"resolution_notes,omitempty"`
	VerifiedAt      *time.Time      `json:"verified_at,omitempty"`
	VerifiedBy      string          `json:"verified_by,omitempty"`
}

// PunchItem is a post-installation pending item (OC-073).
type PunchItem struct {
	ID                 string          `json:"id"`
	Description        string          `json:"description"`
	Owner              string          `json:"owner"`
	DueDate            string          `json:"due_date,omitempty"` // YYYY-MM-DD
	Severity           PunchSeverity   `json:"severity"`
	IsBlocker          bool            `json:"is_blocker"`
	Status             PunchItemStatus `json:"status"`
	PhotoIDs           []string        `json:"photo_ids,omitempty"`
	OpenedBy           string          `json:"opened_by,omitempty"`
	OpenedAt           time.Time       `json:"opened_at"`
	ClosedAt           *time.Time      `json:"closed_at,omitempty"`
	ClosedBy           string          `json:"closed_by,omitempty"`
	ResolutionNotes    string          `json:"resolution_notes,omitempty"`
	ResolutionPhotoIDs []string        `json:"resolution_photo_ids,omitempty"`
}

// ClientCloseout is the audited conformity + project close record (OC-074).
type ClientCloseout struct {
	SignedOffBy       string     `json:"signed_off_by"`
	SignedOffAt       time.Time  `json:"signed_off_at"`
	SignedOffByUserID string     `json:"signed_off_by_user_id,omitempty"`
	SignedOffNotes    string     `json:"signed_off_notes,omitempty"`
	SignedOffPhotoIDs []string   `json:"signed_off_photo_ids,omitempty"`
	ClosedAt          *time.Time `json:"closed_at,omitempty"`
	ClosedByUserID    string     `json:"closed_by_user_id,omitempty"`
}

// InstallationJob is the installation subprocess of one project (OC-070).
type InstallationJob struct {
	ID          string          `json:"id"`
	ProjectID   string          `json:"project_id"`
	Visits      []InstallationVisit `json:"visits"`
	FieldIssues []FieldIssue    `json:"field_issues"`
	PunchItems  []PunchItem     `json:"punch_items"`
	Closeout    *ClientCloseout `json:"closeout,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

/* ── Shape + transition validation for the server-authoritative PUT ──────── */

// ValidateInstallationJobShape checks the structural invariants of a candidate
// job, independent of what was stored before.
func ValidateInstallationJobShape(job *InstallationJob) error {
	if job == nil {
		return nil
	}
	if job.ProjectID == "" {
		return errors.New("installation job requiere project_id")
	}
	visitIDs := map[string]struct{}{}
	for _, v := range job.Visits {
		if _, dup := visitIDs[v.ID]; dup {
			return fmt.Errorf("visita duplicada: %s", v.ID)
		}
		visitIDs[v.ID] = struct{}{}
		if !IsValidInstallationVisitStatus(string(v.Status)) {
			return fmt.Errorf("estado de visita inválido: %s", v.Status)
		}
		if v.Result != "" && !IsValidInstallationVisitResult(string(v.Result)) {
			return fmt.Errorf("resultado de visita inválido: %s", v.Result)
		}
		if v.Status == InstallationVisitCompleted && v.Result == "" {
			return fmt.Errorf("la visita completada %s requiere resultado", v.ID)
		}
		if v.Date == "" {
			return fmt.Errorf("la visita %s requiere fecha", v.ID)
		}
		if len(v.Crew) == 0 {
			return fmt.Errorf("la visita %s requiere crew", v.ID)
		}
	}
	issueIDs := map[string]struct{}{}
	for _, i := range job.FieldIssues {
		if _, dup := issueIDs[i.ID]; dup {
			return fmt.Errorf("incidencia duplicada: %s", i.ID)
		}
		issueIDs[i.ID] = struct{}{}
		if !IsValidFieldIssueStatus(string(i.Status)) {
			return fmt.Errorf("estado de incidencia inválido: %s", i.Status)
		}
		if i.Description == "" {
			return fmt.Errorf("la incidencia %s requiere descripción", i.ID)
		}
	}
	punchIDs := map[string]struct{}{}
	for _, p := range job.PunchItems {
		if _, dup := punchIDs[p.ID]; dup {
			return fmt.Errorf("pendiente duplicado: %s", p.ID)
		}
		punchIDs[p.ID] = struct{}{}
		if !IsValidPunchItemStatus(string(p.Status)) {
			return fmt.Errorf("estado de pendiente inválido: %s", p.Status)
		}
		if !IsValidPunchSeverity(string(p.Severity)) {
			return fmt.Errorf("severidad de pendiente inválida: %s", p.Severity)
		}
		if p.Owner == "" {
			return fmt.Errorf("el pendiente %s requiere owner", p.ID)
		}
		if p.Status == PunchItemClosed && p.ResolutionNotes == "" && len(p.ResolutionPhotoIDs) == 0 {
			return fmt.Errorf("el pendiente cerrado %s requiere evidencia de resolución", p.ID)
		}
	}
	if job.Closeout != nil {
		if job.Closeout.SignedOffBy == "" || job.Closeout.SignedOffAt.IsZero() {
			return errors.New("closeout requiere firma (signed_off_by) y fecha")
		}
		if job.Closeout.ClosedAt != nil && job.Closeout.ClosedAt.Before(job.Closeout.SignedOffAt) {
			return errors.New("closeout no puede cerrarse antes de la conformidad")
		}
	}
	return nil
}

// ValidateInstallationJobTransition validates a candidate job against the
// previously stored one: entities are append-only, status transitions follow
// the legal maps and recorded closeout facts cannot be revoked.
func ValidateInstallationJobTransition(prev, next *InstallationJob) error {
	if err := ValidateInstallationJobShape(next); err != nil {
		return err
	}
	if prev == nil {
		return nil
	}
	if next != nil && next.ID != prev.ID {
		return fmt.Errorf("installation job id inmutable (%s ≠ %s)", prev.ID, next.ID)
	}

	prevVisits := map[string]InstallationVisit{}
	for _, v := range prev.Visits {
		prevVisits[v.ID] = v
	}
	prevIssues := map[string]FieldIssue{}
	for _, i := range prev.FieldIssues {
		prevIssues[i.ID] = i
	}
	prevPunch := map[string]PunchItem{}
	for _, p := range prev.PunchItems {
		prevPunch[p.ID] = p
	}

	if next != nil {
		nextVisitIDs := map[string]struct{}{}
		for _, v := range next.Visits {
			nextVisitIDs[v.ID] = struct{}{}
			before, existed := prevVisits[v.ID]
			if !existed {
				if v.Status != InstallationVisitScheduled {
					return fmt.Errorf("visita nueva %s debe crearse como scheduled", v.ID)
				}
			} else if before.Status != v.Status {
				if !CanTransitionInstallationVisitStatus(before.Status, v.Status) {
					return fmt.Errorf("transición de visita inválida %s: %s → %s", v.ID, before.Status, v.Status)
				}
			}
		}
		for id := range prevVisits {
			if _, ok := nextVisitIDs[id]; !ok {
				return fmt.Errorf("visita no removible: %s", id)
			}
		}

		nextIssueIDs := map[string]struct{}{}
		for _, i := range next.FieldIssues {
			nextIssueIDs[i.ID] = struct{}{}
			before, existed := prevIssues[i.ID]
			if !existed {
				if i.Status != FieldIssueOpen {
					return fmt.Errorf("incidencia nueva %s debe crearse como open", i.ID)
				}
			} else if before.Status != i.Status {
				if !CanTransitionFieldIssueStatus(before.Status, i.Status) {
					return fmt.Errorf("transición de incidencia inválida %s: %s → %s", i.ID, before.Status, i.Status)
				}
			}
		}
		for id := range prevIssues {
			if _, ok := nextIssueIDs[id]; !ok {
				return fmt.Errorf("incidencia no removible: %s", id)
			}
		}

		nextPunchIDs := map[string]struct{}{}
		for _, p := range next.PunchItems {
			nextPunchIDs[p.ID] = struct{}{}
			before, existed := prevPunch[p.ID]
			if !existed {
				if p.Status != PunchItemOpen {
					return fmt.Errorf("pendiente nuevo %s debe crearse como open", p.ID)
				}
			} else {
				if before.Status != p.Status {
					legal := (before.Status == PunchItemOpen && p.Status == PunchItemClosed) ||
						(before.Status == PunchItemClosed && p.Status == PunchItemOpen)
					if !legal {
						return fmt.Errorf("transición de pendiente inválida %s: %s → %s", p.ID, before.Status, p.Status)
					}
				}
				if before.ClosedAt != nil && p.ClosedAt == nil {
					return fmt.Errorf("cierre de pendiente no revocable: %s", p.ID)
				}
			}
		}
		for id := range prevPunch {
			if _, ok := nextPunchIDs[id]; !ok {
				return fmt.Errorf("pendiente no removible: %s", id)
			}
		}

		if prev.Closeout != nil && next.Closeout != nil {
			if next.Closeout.SignedOffAt.Before(prev.Closeout.SignedOffAt) {
				return errors.New("conformidad no retrocedible")
			}
			if prev.Closeout.ClosedAt != nil && next.Closeout.ClosedAt == nil {
				return errors.New("cierre de proyecto no revocable vía installation")
			}
		}
		if prev.Closeout != nil && next.Closeout == nil {
			return errors.New("closeout no removible")
		}
	}
	return nil
}

/* ── Closeout gates (OC-074) ───────────────────────────────────────────────── */

type CloseoutCheckCode string

const (
	CloseoutCheckUnitsInstalled     CloseoutCheckCode = "units_installed"
	CloseoutCheckFieldIssuesResolved CloseoutCheckCode = "field_issues_resolved"
	CloseoutCheckPunchBlockersClosed CloseoutCheckCode = "punch_blockers_closed"
	CloseoutCheckVisitsCompleted    CloseoutCheckCode = "visits_completed"
	CloseoutCheckClientSignOff      CloseoutCheckCode = "client_signoff"
)

type CloseoutCheck struct {
	Code     CloseoutCheckCode `json:"code"`
	Label    string            `json:"label"`
	Passed   bool              `json:"passed"`
	Required bool              `json:"required"`
	Details  string            `json:"details"`
}

var closeoutCheckLabels = map[CloseoutCheckCode]string{
	CloseoutCheckUnitsInstalled:      "Todas las unidades instaladas",
	CloseoutCheckFieldIssuesResolved: "Incidencias de campo resueltas",
	CloseoutCheckPunchBlockersClosed: "Pendientes bloqueantes de punch list cerrados",
	CloseoutCheckVisitsCompleted:     "Visitas de instalación cerradas",
	CloseoutCheckClientSignOff:       "Conformidad firmada por el cliente",
}

// InstallationUnitsSummary counts installed units: physical module units when
// present, legacy item floor status otherwise. Parity with
// installationUnitsSummary in installation.ts.
func InstallationUnitsSummary(units []ModuleUnitExecution, items []ProjectItem) (mode string, installed, total int) {
	if len(units) > 0 {
		for _, u := range units {
			if u.Status == ModuleUnitStatusInstalled {
				installed++
			}
		}
		return "physical", installed, len(units)
	}
	if len(items) == 0 {
		return "none", 0, 0
	}
	for _, it := range items {
		if it.FloorStatus == "installed" {
			installed++
		}
	}
	return "legacy", installed, len(items)
}

// OpenInstallationVisits returns visits still scheduled or in progress.
func OpenInstallationVisits(job *InstallationJob) []InstallationVisit {
	if job == nil {
		return nil
	}
	var open []InstallationVisit
	for _, v := range job.Visits {
		if v.Status == InstallationVisitScheduled || v.Status == InstallationVisitInProgress {
			open = append(open, v)
		}
	}
	return open
}

// OpenFieldIssues returns issues not yet resolved/verified.
func OpenFieldIssues(job *InstallationJob) []FieldIssue {
	if job == nil {
		return nil
	}
	var open []FieldIssue
	for _, i := range job.FieldIssues {
		if i.Status != FieldIssueResolved && i.Status != FieldIssueVerified {
			open = append(open, i)
		}
	}
	return open
}

// BlockingPunchItems returns open punch items flagged as closeout blockers.
func BlockingPunchItems(job *InstallationJob) []PunchItem {
	if job == nil {
		return nil
	}
	var blockers []PunchItem
	for _, p := range job.PunchItems {
		if p.Status == PunchItemOpen && p.IsBlocker {
			blockers = append(blockers, p)
		}
	}
	return blockers
}

// EvaluateCloseoutGates evaluates the four physical/operational closeout
// gates (OC-074): installed units alone never close a project. Parity with
// evaluateCloseoutGates in installation.ts.
func EvaluateCloseoutGates(units []ModuleUnitExecution, items []ProjectItem, job *InstallationJob) []CloseoutCheck {
	_, installed, total := InstallationUnitsSummary(units, items)
	unitsPassed := total > 0 && installed == total

	var unitsDetails string
	switch {
	case unitsPassed:
		unitsDetails = fmt.Sprintf("%d de %d unidades instaladas", installed, total)
	case total == 0:
		unitsDetails = "El proyecto no tiene unidades registradas para instalar"
	default:
		unitsDetails = fmt.Sprintf("Faltan instalar %d de %d unidades", total-installed, total)
	}

	openIssues := OpenFieldIssues(job)
	blockers := BlockingPunchItems(job)
	openVisits := OpenInstallationVisits(job)

	issuesDetails := "Sin incidencias de campo abiertas"
	if n := len(openIssues); n > 0 {
		issuesDetails = fmt.Sprintf("%d incidencia(s) sin resolver: resolver o verificar antes del cierre", n)
	}

	punchDetails := "Punch list cerrado"
	openNonBlocking := 0
	if job != nil {
		for _, p := range job.PunchItems {
			if p.Status == PunchItemOpen && !p.IsBlocker {
				openNonBlocking++
			}
		}
	}
	if n := len(blockers); n > 0 {
		punchDetails = fmt.Sprintf("%d pendiente(s) bloqueante(s) del punch list: cerrar con evidencia antes del cierre", n)
	} else if openNonBlocking > 0 {
		punchDetails = fmt.Sprintf("%d pendiente(s) no bloqueante(s) abierto(s)", openNonBlocking)
	}

	visitsDetails := "Sin visitas pendientes"
	if n := len(openVisits); n > 0 {
		visitsDetails = fmt.Sprintf("%d visita(s) en curso o planificada(s): completar o cancelar antes del cierre", n)
	}

	return []CloseoutCheck{
		{Code: CloseoutCheckUnitsInstalled, Label: closeoutCheckLabels[CloseoutCheckUnitsInstalled], Passed: unitsPassed, Required: true, Details: unitsDetails},
		{Code: CloseoutCheckFieldIssuesResolved, Label: closeoutCheckLabels[CloseoutCheckFieldIssuesResolved], Passed: len(openIssues) == 0, Required: true, Details: issuesDetails},
		{Code: CloseoutCheckPunchBlockersClosed, Label: closeoutCheckLabels[CloseoutCheckPunchBlockersClosed], Passed: len(blockers) == 0, Required: true, Details: punchDetails},
		{Code: CloseoutCheckVisitsCompleted, Label: closeoutCheckLabels[CloseoutCheckVisitsCompleted], Passed: len(openVisits) == 0, Required: true, Details: visitsDetails},
	}
}

// EvaluateCloseoutReadiness adds the client sign-off check on top of the
// physical gates when requireSignOff is set (project close path).
func EvaluateCloseoutReadiness(units []ModuleUnitExecution, items []ProjectItem, job *InstallationJob, requireSignOff bool) ([]CloseoutCheck, bool) {
	checks := EvaluateCloseoutGates(units, items, job)
	if requireSignOff {
		signed := job != nil && job.Closeout != nil && !job.Closeout.SignedOffAt.IsZero()
		details := "Conformidad registrada"
		if !signed {
			details = "Registrar primero la conformidad firmada por el cliente"
		}
		checks = append(checks, CloseoutCheck{
			Code:     CloseoutCheckClientSignOff,
			Label:    closeoutCheckLabels[CloseoutCheckClientSignOff],
			Passed:   signed,
			Required: true,
			Details:  details,
		})
	}
	ready := true
	for _, c := range checks {
		if c.Required && !c.Passed {
			ready = false
			break
		}
	}
	return checks, ready
}

// ValidateCloseoutEventAppend guards raw client_signed_off/project_closed
// event appends (OC-074 server-side enforcement). Returns the failing gate
// labels; empty means the append may proceed.
func ValidateCloseoutEventAppend(units []ModuleUnitExecution, items []ProjectItem, job *InstallationJob, eventType string) []string {
	requireSignOff := eventType == "project_closed"
	if eventType != "client_signed_off" && !requireSignOff {
		return nil
	}
	checks, ready := EvaluateCloseoutReadiness(units, items, job, requireSignOff)
	if ready {
		return nil
	}
	var failing []string
	for _, c := range checks {
		if c.Required && !c.Passed {
			failing = append(failing, c.Label)
		}
	}
	return failing
}

// DeriveInstallationJobStatus derives planned/in_progress/completed from the
// recorded work (visits) and the installation_completed event flag. Parity
// with deriveInstallationJobStatus in installation.ts.
func DeriveInstallationJobStatus(job *InstallationJob, hasInstallationCompletedEvent bool) InstallationJobStatus {
	if hasInstallationCompletedEvent {
		return InstallationJobCompleted
	}
	if job != nil {
		for _, v := range job.Visits {
			if v.Status == InstallationVisitInProgress || v.Status == InstallationVisitCompleted {
				return InstallationJobInProgress
			}
		}
	}
	return InstallationJobPlanned
}

// InstallationSnapshot is the locked state handed to an installation
// mutation: the stored job plus everything the closeout gates depend on.
type InstallationSnapshot struct {
	Job                           *InstallationJob
	Units                         []ModuleUnitExecution
	Items                         []ProjectItem
	HasInstallationStartedEvent   bool
	HasInstallationCompletedEvent bool
}

// InstallationMutation is what an installation mutation produced and what
// gets persisted atomically: the new job payload and the audit events.
type InstallationMutation struct {
	Job    *InstallationJob
	Events []ProjectEvent
}
