package domain

import (
	"encoding/json"
	"time"
)

/**
 * Project Lifecycle Events & Commercial Status (OC-010..OC-013).
 * Parity with packages/domain/src/projectLifecycle.ts.
 */

// CommercialStatus represents the business outcome separating commercial pipeline from physical manufacturing (OC-011).
type CommercialStatus string

const (
	CommercialStatusDraft     CommercialStatus = "draft"
	CommercialStatusSent      CommercialStatus = "sent"
	CommercialStatusWon       CommercialStatus = "won"
	CommercialStatusLost      CommercialStatus = "lost"
	CommercialStatusExpired   CommercialStatus = "expired"
	CommercialStatusCancelled CommercialStatus = "cancelled"
)

// ProjectEventSource identifies where the event originated.
type ProjectEventSource string

const (
	ProjectEventSourceWeb      ProjectEventSource = "web"
	ProjectEventSourceDesktop  ProjectEventSource = "desktop"
	ProjectEventSourceMobile   ProjectEventSource = "mobile"
	ProjectEventSourceAPI      ProjectEventSource = "api"
	ProjectEventSourceBackfill ProjectEventSource = "backfill"
)

// NormalizeProjectEventSource ensures fallback to "web".
func NormalizeProjectEventSource(s string) ProjectEventSource {
	switch ProjectEventSource(s) {
	case ProjectEventSourceWeb, ProjectEventSourceDesktop, ProjectEventSourceMobile, ProjectEventSourceAPI, ProjectEventSourceBackfill:
		return ProjectEventSource(s)
	default:
		return ProjectEventSourceWeb
	}
}

// projectEventTypes is the canonical event vocabulary (OC-010), in parity with
// packages/domain/src/projectLifecycle.ts (PROJECT_EVENT_TYPES). The parity
// test below pins both lists to the shared contract fixture
// contracts/projectEventTypes.json — update the fixture together with both
// implementations when adding a type.
var projectEventTypes = map[string]struct{}{
	"quote_created":                {},
	"quote_sent":                   {},
	"quote_won":                    {},
	"quote_lost":                   {},
	"quote_expired":                {},
	"quote_cancelled":              {},
	"deposit_received":             {},
	"survey_started":               {},
	"survey_completed":             {},
	"design_revision_created":      {},
	"design_submitted":             {},
	"design_approved":              {},
	"design_changes_requested":     {},
	"customer_approved":            {},
	"customer_rejected":            {},
	"engineering_approved":         {},
	"engineering_rejected":         {},
	"project_approved":             {},
	"change_order_created":         {},
	"change_order_submitted":       {},
	"change_order_approved":        {},
	"change_order_rejected":        {},
	"change_order_cancelled":       {},
	"engineering_started":          {},
	"engineering_documented":       {},
	"production_released":          {},
	"production_release_revoked":   {},
	"materials_required":           {},
	"materials_reserved":           {},
	"materials_shortage_detected":  {},
	"materials_ready":              {},
	"materials_release_overridden": {},
	"production_started":           {},
	"production_completed":         {},
	"quality_issue_reported":       {},
	"rework_started":               {},
	"shipment_loaded":              {},
	"shipment_departed":            {},
	"installation_started":         {},
	"installation_completed":       {},
	"punch_opened":                 {},
	"punch_closed":                 {},
	"client_signed_off":            {},
	"project_closed":               {},
	"warranty_opened":              {},
}

// IsValidProjectEventType reports whether t belongs to the canonical lifecycle
// vocabulary. The append-only log must not accept invented types.
func IsValidProjectEventType(t string) bool {
	_, ok := projectEventTypes[t]
	return ok
}

// ProjectEvent is one immutable append-only lifecycle event (OC-010).
type ProjectEvent struct {
	ID        string             `json:"id"`
	ProjectID string             `json:"project_id"`
	Type      string             `json:"type"`
	At        time.Time          `json:"at"`
	ByUserID  *string            `json:"by_user_id,omitempty"`
	Source    ProjectEventSource `json:"source,omitempty"`
	Note      string             `json:"note,omitempty"`
	Payload   json.RawMessage    `json:"payload,omitempty"`
	CreatedAt time.Time          `json:"created_at"`
}

// DesignRevision represents a formal snapshot of design and BOM (OC-020).
type DesignRevision struct {
	ID             string          `json:"id"`
	ProjectID      string          `json:"project_id"`
	Revision       int             `json:"revision"`
	Name           string          `json:"name,omitempty"`
	Description    string          `json:"description,omitempty"`
	BOMFingerprint string          `json:"bom_fingerprint"`
	LayoutSnapshot json.RawMessage `json:"layout_snapshot,omitempty"`
	CreatedBy      string          `json:"created_by"`
	CreatedAt      time.Time       `json:"created_at"`
}

type ApprovalStatus string

const (
	ApprovalStatusPending          ApprovalStatus = "pending"
	ApprovalStatusApproved         ApprovalStatus = "approved"
	ApprovalStatusApprovedWithNotes ApprovalStatus = "approved_with_notes"
	ApprovalStatusChangesRequested ApprovalStatus = "changes_requested"
	ApprovalStatusRejected         ApprovalStatus = "rejected"
)

type ApprovalType string

const (
	ApprovalTypeCustomer   ApprovalType = "customer"
	ApprovalTypeTechnical  ApprovalType = "technical"
	ApprovalTypeSupervisor ApprovalType = "supervisor"
)

// Approval tracks multi-role project sign-offs (OC-021).
type Approval struct {
	ID               string         `json:"id"`
	ProjectID        string         `json:"project_id"`
	DesignRevisionID *string        `json:"design_revision_id,omitempty"`
	Type             ApprovalType   `json:"type"`
	Status           ApprovalStatus `json:"status"`
	Notes            string         `json:"notes,omitempty"`
	DecidedBy        *string        `json:"decided_by,omitempty"`
	DecidedAt        *time.Time     `json:"decided_at,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
}

type ProductionReleaseCheckCode string

const (
	CheckCodeCommercialWon     ProductionReleaseCheckCode = "commercial_won"
	CheckCodeDepositReceived   ProductionReleaseCheckCode = "deposit_received"
	CheckCodeSurveyVerified    ProductionReleaseCheckCode = "survey_verified"
	CheckCodeCustomerApproved  ProductionReleaseCheckCode = "customer_approved"
	CheckCodeTechnicalApproved ProductionReleaseCheckCode = "technical_approved"
	CheckCodeBOMValid          ProductionReleaseCheckCode = "bom_valid"
)

// ProductionReleaseCheck records the outcome of a single release gate.
type ProductionReleaseCheck struct {
	Code     ProductionReleaseCheckCode `json:"code"`
	Label    string                     `json:"label"`
	Passed   bool                       `json:"passed"`
	Required bool                       `json:"required"`
	Details  string                     `json:"details,omitempty"`
}

// ProductionRelease is the explicit, auditable production release record (OC-022).
type ProductionRelease struct {
	ID               string                   `json:"id"`
	ProjectID        string                   `json:"project_id"`
	ProjectVersion   int                      `json:"project_version"`
	DesignRevisionID string                   `json:"design_revision_id"`
	BOMFingerprint   string                   `json:"bom_fingerprint"`
	ReleasedBy       string                   `json:"released_by"`
	ReleasedAt       time.Time                `json:"released_at"`
	Checks           []ProductionReleaseCheck `json:"checks"`
	Note             string                   `json:"note,omitempty"`
}

type ChangeOrderStatus string

const (
	ChangeOrderStatusDraft     ChangeOrderStatus = "draft"
	ChangeOrderStatusSubmitted ChangeOrderStatus = "submitted"
	ChangeOrderStatusApproved  ChangeOrderStatus = "approved"
	ChangeOrderStatusRejected  ChangeOrderStatus = "rejected"
	ChangeOrderStatusCancelled ChangeOrderStatus = "cancelled"
)

// ChangeOrderImpact captures cost, price, and schedule adjustments (OC-024).
type ChangeOrderImpact struct {
	CostDelta         *float64 `json:"cost_delta,omitempty"`
	PriceDelta        *float64 `json:"price_delta,omitempty"`
	LeadTimeDaysDelta *int     `json:"lead_time_days_delta,omitempty"`
	ScopeDescription  string   `json:"scope_description,omitempty"`
}

// ChangeOrder represents formal scope/cost amendments post-approval/post-release (OC-024).
type ChangeOrder struct {
	ID                       string             `json:"id"`
	ProjectID                string             `json:"project_id"`
	Number                   int                `json:"number"`
	Status                   ChangeOrderStatus  `json:"status"`
	Reason                   string             `json:"reason"`
	Description              string             `json:"description,omitempty"`
	Impact                   *ChangeOrderImpact `json:"impact,omitempty"`
	PreviousBOMFingerprint   string             `json:"previous_bom_fingerprint"`
	NewBOMFingerprint        *string            `json:"new_bom_fingerprint,omitempty"`
	PreviousDesignRevisionID *string            `json:"previous_design_revision_id,omitempty"`
	NewDesignRevisionID      *string            `json:"new_design_revision_id,omitempty"`
	RequestedBy              string             `json:"requested_by"`
	RequestedAt              time.Time          `json:"requested_at"`
	DecidedBy                *string            `json:"decided_by,omitempty"`
	DecidedAt                *time.Time         `json:"decided_at,omitempty"`
	DecisionNotes            string             `json:"decision_notes,omitempty"`
	CreatedAt                time.Time          `json:"created_at"`
}


