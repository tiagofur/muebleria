package api

// Contrato: stub del stubStore espejo de store_workflow (store_workflow.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_workflow.go
import (
	"context"
	"errors"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #110 / H15 — project templates stubs (no behavior; tests below inject data).
func (s *stubStore) ListProjectTemplates(_ context.Context) ([]domain.ProjectTemplate, error) {
	return s.listProjectTemplates, nil
}

func (s *stubStore) GetProjectTemplateByID(_ context.Context, _ string) (*domain.ProjectTemplate, error) {
	return nil, errors.New("template not found")
}

func (s *stubStore) CreateProjectTemplate(_ context.Context, t domain.ProjectTemplate) error {
	cp := t
	s.lastCreatedTemplate = &cp
	return nil
}

func (s *stubStore) UpdateProjectTemplate(_ context.Context, _ string, t domain.ProjectTemplate) error {
	cp := t
	s.lastCreatedTemplate = &cp
	return nil
}

func (s *stubStore) DeleteProjectTemplate(_ context.Context, _ string) error {
	s.deleteTemplateCalled = true
	return nil
}

func (s *stubStore) ListProjectPhotos(_ context.Context, _ string) ([]domain.ProjectPhoto, error) {
	return []domain.ProjectPhoto{}, nil
}

func (s *stubStore) GetProjectPhotoByID(_ context.Context, _ string) (*domain.ProjectPhoto, error) {
	return nil, nil
}

func (s *stubStore) CreateProjectPhoto(_ context.Context, _ *domain.ProjectPhoto) error {
	return nil
}

func (s *stubStore) UpdateProjectPhoto(_ context.Context, _ string, _ string, _ bool, _ domain.ProjectPhotoStage) (*domain.ProjectPhoto, error) {
	return nil, nil
}

func (s *stubStore) DeleteProjectPhoto(_ context.Context, _ string) error {
	return nil
}

func (s *stubStore) ListProjectInternalMessages(_ context.Context, _ string) ([]domain.ProjectInternalMessage, error) {
	return []domain.ProjectInternalMessage{}, nil
}

func (s *stubStore) CreateProjectInternalMessage(_ context.Context, _ *domain.ProjectInternalMessage) error {
	return nil
}

func (s *stubStore) UpdateProjectTechnicalWorkflow(_ context.Context, _ string, _ *string, _ string, _ *string, _ *string) error {
	return nil
}

func (s *stubStore) ListWarrantyTickets(_ context.Context, _, _, _ string) ([]domain.WarrantyTicket, error) {
	return []domain.WarrantyTicket{}, nil
}

func (s *stubStore) GetWarrantyTicketByID(_ context.Context, _ string) (*domain.WarrantyTicket, error) {
	return nil, nil
}

func (s *stubStore) CreateWarrantyTicket(_ context.Context, _ *domain.WarrantyTicket) error {
	return nil
}

func (s *stubStore) UpdateWarrantyTicket(_ context.Context, _ *domain.WarrantyTicket) error {
	return nil
}

func (s *stubStore) DeleteWarrantyTicket(_ context.Context, _ string) error {
	return nil
}

func (s *stubStore) ListWarrantyTicketPhotos(_ context.Context, _ string) ([]domain.WarrantyTicketPhoto, error) {
	return []domain.WarrantyTicketPhoto{}, nil
}

func (s *stubStore) AddWarrantyTicketPhoto(_ context.Context, _ *domain.WarrantyTicketPhoto) error {
	return nil
}

func (s *stubStore) DeleteWarrantyTicketPhoto(_ context.Context, _, _ string) error {
	return nil
}

func (s *stubStore) ListShowcasePhotos(_ context.Context, _ bool) ([]domain.ShowcasePhotoItem, error) {
	return []domain.ShowcasePhotoItem{}, nil
}

// Production activity stubs
