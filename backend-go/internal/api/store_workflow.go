package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: CRM del proyecto — plantillas, fotos, mensajes internos,
// workflow técnico y tickets de garantía.
type ProjectWorkflowStore interface {
	// Project templates (#110 / H15)
	ListProjectTemplates(ctx context.Context) ([]domain.ProjectTemplate, error)
	GetProjectTemplateByID(ctx context.Context, id string) (*domain.ProjectTemplate, error)
	CreateProjectTemplate(ctx context.Context, t domain.ProjectTemplate) error
	UpdateProjectTemplate(ctx context.Context, id string, t domain.ProjectTemplate) error
	DeleteProjectTemplate(ctx context.Context, id string) error

	// Project photos (CRM Gallery)
	ListProjectPhotos(ctx context.Context, projectID string) ([]domain.ProjectPhoto, error)
	GetProjectPhotoByID(ctx context.Context, photoID string) (*domain.ProjectPhoto, error)
	CreateProjectPhoto(ctx context.Context, photo *domain.ProjectPhoto) error
	UpdateProjectPhoto(ctx context.Context, photoID string, caption string, isShowcase bool, stage domain.ProjectPhotoStage) (*domain.ProjectPhoto, error)
	DeleteProjectPhoto(ctx context.Context, photoID string) error
	ListShowcasePhotos(ctx context.Context, onlyShowcase bool) ([]domain.ShowcasePhotoItem, error)

	// Project internal messages & technical workflow (CRM Phase 2)
	ListProjectInternalMessages(ctx context.Context, projectID string) ([]domain.ProjectInternalMessage, error)
	CreateProjectInternalMessage(ctx context.Context, msg *domain.ProjectInternalMessage) error
	UpdateProjectTechnicalWorkflow(ctx context.Context, projectID string, engineerID *string, status string, surveyCompletedAt *string, installDate *string) error

	// Warranty tickets (CRM Phase 3)
	ListWarrantyTickets(ctx context.Context, projectID, customerID, status string) ([]domain.WarrantyTicket, error)
	GetWarrantyTicketByID(ctx context.Context, id string) (*domain.WarrantyTicket, error)
	CreateWarrantyTicket(ctx context.Context, ticket *domain.WarrantyTicket) error
	UpdateWarrantyTicket(ctx context.Context, ticket *domain.WarrantyTicket) error
	DeleteWarrantyTicket(ctx context.Context, id string) error
	ListWarrantyTicketPhotos(ctx context.Context, ticketID string) ([]domain.WarrantyTicketPhoto, error)
	AddWarrantyTicketPhoto(ctx context.Context, photo *domain.WarrantyTicketPhoto) error
	DeleteWarrantyTicketPhoto(ctx context.Context, ticketID, photoID string) error
}
