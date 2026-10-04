package api

// Contrato: stub del stubStore espejo de store_furniture (store_furniture.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_furniture.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Project furniture identity (#385 / DT-1).
func (s *stubStore) CreateFurnitureInstance(_ context.Context, cmd storage.CreateFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
	s.createFurnitureInstanceCalls++
	s.createFurnitureInstanceCmd = &cmd
	if s.createFurnitureInstanceErr != nil {
		return nil, s.createFurnitureInstanceErr
	}
	if s.furnitureInstancesByID == nil {
		s.furnitureInstancesByID = map[string]domain.FurnitureInstance{}
	}
	instance := &domain.FurnitureInstance{
		ID: "fi-1", ProjectID: cmd.ProjectID, Origin: cmd.Origin,
		FurnitureDefinitionID: cmd.FurnitureDefinitionID,
		LifecycleStatus:       domain.FurnitureInstanceLifecycleActive,
		Version:               1,
	}
	s.furnitureInstancesByID[instance.ID] = *instance
	return instance, nil
}

func (s *stubStore) GetFurnitureInstanceByID(_ context.Context, id string) (*domain.FurnitureInstance, error) {
	if instance, ok := s.furnitureInstancesByID[id]; ok {
		copy := instance
		return &copy, nil
	}
	return nil, nil
}

func (s *stubStore) ListFurnitureInstancesByProject(_ context.Context, projectID string, includeTerminal bool) ([]domain.FurnitureInstance, error) {
	if s.listFurnitureInstances != nil {
		return s.listFurnitureInstances, nil
	}
	out := []domain.FurnitureInstance{}
	for _, instance := range s.furnitureInstancesByID {
		if instance.ProjectID == projectID && (includeTerminal || instance.LifecycleStatus == domain.FurnitureInstanceLifecycleActive) {
			out = append(out, instance)
		}
	}
	return out, nil
}

func (s *stubStore) ListFurnitureInstanceSummariesByProject(ctx context.Context, projectID string, includeTerminal bool) ([]storage.FurnitureInstanceSummary, error) {
	if s.listFurnitureInstanceSummaries != nil {
		return s.listFurnitureInstanceSummaries, nil
	}
	instances, err := s.ListFurnitureInstancesByProject(ctx, projectID, includeTerminal)
	if err != nil {
		return nil, err
	}
	out := make([]storage.FurnitureInstanceSummary, 0, len(instances))
	for _, instance := range instances {
		out = append(out, storage.FurnitureInstanceSummary{Instance: instance})
	}
	return out, nil
}

func (s *stubStore) RemoveFurnitureInstance(_ context.Context, cmd storage.RemoveFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
	s.removeFurnitureInstanceCmd = &cmd
	if s.removeFurnitureInstanceErr != nil {
		return nil, s.removeFurnitureInstanceErr
	}
	instance, ok := s.furnitureInstancesByID[cmd.FurnitureInstanceID]
	if !ok {
		return nil, storage.ErrFurnitureInstanceNotFound
	}
	instance.LifecycleStatus = domain.FurnitureInstanceLifecycleRemoved
	instance.Version++
	s.furnitureInstancesByID[cmd.FurnitureInstanceID] = instance
	return &instance, nil
}

func (s *stubStore) DuplicateFurnitureInstance(_ context.Context, cmd storage.DuplicateFurnitureInstanceCommand) (*domain.FurnitureInstance, error) {
	s.duplicateFurnitureInstanceCalls++
	s.duplicateFurnitureInstanceCmd = &cmd
	if s.duplicateFurnitureInstanceErr != nil {
		return nil, s.duplicateFurnitureInstanceErr
	}
	if s.furnitureInstancesByID == nil {
		s.furnitureInstancesByID = map[string]domain.FurnitureInstance{}
	}
	source, ok := s.furnitureInstancesByID[cmd.SourceFurnitureInstanceID]
	if !ok || source.ProjectID != cmd.ProjectID {
		return nil, storage.ErrFurnitureInstanceNotFound
	}
	if domain.FurnitureInstanceLifecycleTerminal(source.LifecycleStatus) {
		return nil, domain.ErrFurnitureInstanceLifecycleConflict
	}
	instance := &domain.FurnitureInstance{
		ID:                        "fi-dup-1",
		ProjectID:                 cmd.ProjectID,
		FurnitureDefinitionID:     source.FurnitureDefinitionID,
		Origin:                    domain.FurnitureInstanceOriginDuplicate,
		OriginFurnitureInstanceID: source.ID,
		LifecycleStatus:           domain.FurnitureInstanceLifecycleActive,
		Version:                   1,
	}
	s.furnitureInstancesByID[instance.ID] = *instance
	return instance, nil
}

// QuoteLine ↔ FurnitureInstance relation (#386 / DT-2).

// QuoteLine ↔ FurnitureInstance relation (#386 / DT-2).
func (s *stubStore) MaterializeQuoteLine(_ context.Context, cmd storage.MaterializeQuoteLineCommand) (*domain.QuoteLineMaterialization, error) {
	s.materializeQuoteLineCmd = &cmd
	if s.materializeQuoteLineErr != nil {
		return nil, s.materializeQuoteLineErr
	}
	if s.materializeQuoteLineResult != nil {
		return s.materializeQuoteLineResult, nil
	}
	return &domain.QuoteLineMaterialization{
		ProjectID:   cmd.ProjectID,
		QuoteLineID: cmd.QuoteLineID,
		Quantity:    1,
		Instances:   s.listQuoteLineFurnitureLinks,
	}, nil
}

func (s *stubStore) ListQuoteLineFurnitureInstances(_ context.Context, _, _ string) ([]domain.QuoteLineFurnitureInstance, error) {
	if s.listQuoteLineFurnitureErr != nil {
		return nil, s.listQuoteLineFurnitureErr
	}
	return s.listQuoteLineFurnitureLinks, nil
}

// Design aggregate & revisions (#387 / DT-3).
