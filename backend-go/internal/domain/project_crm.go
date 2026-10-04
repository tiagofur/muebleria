package domain

import (
	"encoding/json"
	"time"
)

// Contrato: CRM del proyecto — fotos/showcase, mensajes internos con
// workflow técnico y tickets de garantía.
type ProjectPhotoStage string

const (
	ProjectPhotoStageSurvey          ProjectPhotoStage = "survey"
	ProjectPhotoStageInWorkshop      ProjectPhotoStage = "in_workshop"
	ProjectPhotoStageInstalled       ProjectPhotoStage = "installed"
	ProjectPhotoStageDeliveryReceipt ProjectPhotoStage = "delivery_receipt"
)

// ProjectPhoto is a photo attached to a project across its lifecycle.
type ProjectPhoto struct {
	ID           string            `json:"id"`
	ProjectID    string            `json:"project_id"`
	Stage        ProjectPhotoStage `json:"stage"`
	URL          string            `json:"url"`
	ThumbnailURL string            `json:"thumbnail_url,omitempty"`
	Caption      string            `json:"caption,omitempty"`
	IsShowcase   bool              `json:"is_showcase"`
	CreatedBy    string            `json:"created_by,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

// ShowcasePhotoItem is a photo enriched with project and customer names for commercial portfolio presentation.
type ShowcasePhotoItem struct {
	ID           string            `json:"id"`
	ProjectID    string            `json:"project_id"`
	ProjectName  string            `json:"project_name"`
	CustomerName string            `json:"customer_name,omitempty"`
	Stage        ProjectPhotoStage `json:"stage"`
	URL          string            `json:"url"`
	ThumbnailURL string            `json:"thumbnail_url,omitempty"`
	Caption      string            `json:"caption,omitempty"`
	IsShowcase   bool              `json:"is_showcase"`
	CreatedAt    time.Time         `json:"created_at"`
}

// TechnicalStatus represents the engineering and production stage of a project.
type TechnicalStatus string

const (
	TechStatusPendingAssignment     TechnicalStatus = "pending_assignment"
	TechStatusInReview              TechnicalStatus = "in_review"
	TechStatusChangesRequested      TechnicalStatus = "changes_requested"
	TechStatusApprovedForProduction TechnicalStatus = "approved_for_production"
	TechStatusInWorkshop            TechnicalStatus = "in_workshop"
	TechStatusReadyToInstall        TechnicalStatus = "ready_to_install"
	TechStatusInstalled             TechnicalStatus = "installed"
	TechStatusCompleted             TechnicalStatus = "completed"
)

// ProjectInternalMessageType classifies internal communications between sales, engineering and workshop.
type ProjectInternalMessageType string

const (
	InternalMsgComment         ProjectInternalMessageType = "comment"
	InternalMsgTechnicalQuery  ProjectInternalMessageType = "technical_query"
	InternalMsgQueryResponse   ProjectInternalMessageType = "query_response"
	InternalMsgDesignChange    ProjectInternalMessageType = "design_change"
	InternalMsgProductionAlert ProjectInternalMessageType = "production_alert"
	InternalMsgGateApproval    ProjectInternalMessageType = "gate_approval"
)

// ProjectInternalMessage is an internal message or query in a project collaboration thread.
type ProjectInternalMessage struct {
	ID          string                     `json:"id"`
	ProjectID   string                     `json:"project_id"`
	SenderID    string                     `json:"sender_id,omitempty"`
	SenderName  string                     `json:"sender_name"`
	MessageType ProjectInternalMessageType `json:"message_type"`
	Content     string                     `json:"content"`
	IsResolved  bool                       `json:"is_resolved"`
	Attachments json.RawMessage            `json:"attachments,omitempty"`
	CreatedAt   time.Time                  `json:"created_at"`
}

// WarrantyCategory classifies the nature of a warranty ticket.
type WarrantyCategory string

const (
	WarrantyCategoryHardwareAdjustment WarrantyCategory = "hardware_adjustment"
	WarrantyCategoryDamagedPart        WarrantyCategory = "damaged_part"
	WarrantyCategoryFinishingDefect    WarrantyCategory = "finishing_defect"
	WarrantyCategoryInstallationIssue  WarrantyCategory = "installation_issue"
	WarrantyCategoryOther              WarrantyCategory = "other"
)

// WarrantyPriority indicates the urgency of a warranty ticket.
type WarrantyPriority string

const (
	WarrantyPriorityLow    WarrantyPriority = "low"
	WarrantyPriorityNormal WarrantyPriority = "normal"
	WarrantyPriorityUrgent WarrantyPriority = "urgent"
)

// WarrantyStatus represents the lifecycle of a warranty ticket.
type WarrantyStatus string

const (
	WarrantyStatusOpen           WarrantyStatus = "open"
	WarrantyStatusVisitScheduled WarrantyStatus = "visit_scheduled"
	WarrantyStatusInProgress     WarrantyStatus = "in_progress"
	WarrantyStatusResolved       WarrantyStatus = "resolved"
	WarrantyStatusCancelled      WarrantyStatus = "cancelled"
)

// WarrantyPhotoKind classifies the reason for a warranty photo.
type WarrantyPhotoKind string

const (
	WarrantyPhotoIssueReport     WarrantyPhotoKind = "issue_report"
	WarrantyPhotoResolutionProof WarrantyPhotoKind = "resolution_proof"
)

// WarrantyRefabricationPiece is a single piece from a project cut list marked for re-cutting.
type WarrantyRefabricationPiece struct {
	PieceDescription string `json:"piece_description"`
	MaterialName     string `json:"material_name"`
	LengthMm         int    `json:"length_mm"`
	WidthMm          int    `json:"width_mm"`
	Quantity         int    `json:"quantity"`
	Grain            Grain  `json:"grain"`
	L1               int    `json:"L1"`
	L2               int    `json:"L2"`
	W1               int    `json:"W1"`
	W2               int    `json:"W2"`
	Notes            string `json:"notes,omitempty"`
}

// WarrantyTicketPhoto is a photo attached to a warranty ticket.
type WarrantyTicketPhoto struct {
	ID           string            `json:"id"`
	TicketID     string            `json:"ticket_id"`
	Kind         WarrantyPhotoKind `json:"kind"`
	URL          string            `json:"url"`
	ThumbnailURL string            `json:"thumbnail_url"`
	Caption      string            `json:"caption,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}

// WarrantyTicket is a post-sale warranty or repair ticket.
type WarrantyTicket struct {
	ID                   string                       `json:"id"`
	TicketNumber         string                       `json:"ticket_number"`
	ProjectID            string                       `json:"project_id"`
	CustomerID           *string                      `json:"customer_id,omitempty"`
	Title                string                       `json:"title"`
	Description          string                       `json:"description"`
	Category             WarrantyCategory             `json:"category"`
	Priority             WarrantyPriority             `json:"priority"`
	Status               WarrantyStatus               `json:"status"`
	AssignedTechnicianID *string                      `json:"assigned_technician_id,omitempty"`
	ScheduledDate        *string                      `json:"scheduled_date,omitempty"`
	ResolvedAt           *time.Time                   `json:"resolved_at,omitempty"`
	ResolutionNotes      string                       `json:"resolution_notes,omitempty"`
	RefabricationPieces  []WarrantyRefabricationPiece `json:"refabrication_pieces"`
	Photos               []WarrantyTicketPhoto        `json:"photos,omitempty"`
	CreatedAt            time.Time                    `json:"created_at"`
	UpdatedAt            time.Time                    `json:"updated_at"`
}
