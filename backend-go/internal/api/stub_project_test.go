package api

// Contrato: stub del stubStore espejo de store_project (store_project.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_project.go
import (
	"context"
	"errors"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

func (s *stubStore) CreateProject(ctx context.Context, p *domain.Project) error {
	if s.createProjectErr != nil {
		return s.createProjectErr
	}
	cp := *p
	s.lastCreatedProject = &cp
	return nil
}

func (s *stubStore) CreateProjectWithInlineCustomer(ctx context.Context, p *domain.Project, inline *domain.Customer) error {
	if s.createProjectWithInlineErr != nil {
		return s.createProjectWithInlineErr
	}
	cp := *p
	s.lastCreatedProject = &cp
	ic := *inline
	// Mirrors the real storage: the server mints the authoritative identity
	// and the project references exactly it.
	ic.ID = "70000000-0000-0000-0000-000000000712"
	ic.Active = true
	p.CustomerID = ic.ID
	inline.ID = ic.ID
	inline.Active = true
	s.lastInlineCustomer = &ic
	return nil
}

func (s *stubStore) BootstrapProjectDesign(_ context.Context, cmd storage.BootstrapProjectDesignCommand) (*storage.BootstrapProjectDesignResult, error) {
	cp := cmd
	s.bootstrapProjectDesignCmd = &cp
	if s.bootstrapProjectDesignErr != nil {
		return nil, s.bootstrapProjectDesignErr
	}
	if s.bootstrapProjectDesignResult != nil {
		return s.bootstrapProjectDesignResult, nil
	}
	return &storage.BootstrapProjectDesignResult{
		Customer: domain.Customer{ID: "70000000-0000-0000-0000-000000000718", Name: "Cliente"},
		Project:  domain.Project{ID: "71000000-0000-0000-0000-000000000718", Name: cmd.ProjectName},
		Design:   domain.Design{ID: "72000000-0000-0000-0000-000000000718", ProjectID: "71000000-0000-0000-0000-000000000718", Name: cmd.DesignName},
	}, nil
}

func (s *stubStore) SetProjectItemFloorStatus(_ context.Context, projectID, itemID, status string) error {
	if s.floorStatusErr != nil {
		return s.floorStatusErr
	}
	s.floorStatusWrites = append(s.floorStatusWrites, floorStatusWrite{projectID, itemID, status})
	return nil
}

func (s *stubStore) SetProjectItemFloorStatusGated(_ context.Context, adv storage.ItemFloorAdvance) error {
	if s.physicalAuthErr != nil {
		return s.physicalAuthErr
	}
	if s.floorStatusErr != nil {
		return s.floorStatusErr
	}
	s.floorStatusWrites = append(s.floorStatusWrites, floorStatusWrite{adv.ProjectID, adv.ItemID, adv.Status})
	if adv.Event != nil {
		s.floorEventWrites = append(s.floorEventWrites, *adv.Event)
	}
	return nil
}

func (s *stubStore) InsertFloorEvent(_ context.Context, ev domain.FloorStatusEvent) error {
	s.floorEventWrites = append(s.floorEventWrites, ev)
	return nil
}

func (s *stubStore) ListFloorEvents(_ context.Context, _ string) ([]domain.FloorStatusEvent, error) {
	return s.floorEventsList, nil
}

func (s *stubStore) MutateProjectPartExecutions(
	_ context.Context,
	_ string,
	mutate func(*domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error),
) (*domain.PartExecutionsMutation, error) {
	if s.mutateErr != nil {
		return nil, s.mutateErr
	}
	snap := &domain.PartExecutionsSnapshot{
		Parts:          append([]domain.PartInstance(nil), s.partInstances...),
		Units:          append([]domain.ModuleUnitExecution(nil), s.moduleUnits...),
		ItemStatuses:   map[string]string{},
		ItemQuantities: map[string]int{},
		Quality:        s.qualityJob,
	}
	if s.latestProductionRelease != nil {
		snap.ProductionRelease = domain.ResolvedFromCanonicalRelease(s.latestProductionRelease)
	}
	for k, v := range s.itemFloorStatuses {
		snap.ItemStatuses[k] = v
	}
	for k, v := range s.itemQuantities {
		snap.ItemQuantities[k] = v
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	s.partInstances = mutation.Parts
	s.moduleUnits = mutation.Units
	s.mutateFloorEvents = append(s.mutateFloorEvents, mutation.FloorEvents...)
	return mutation, nil
}

func (s *stubStore) GenerateCanonicalPartExecutions(
	_ context.Context,
	_ string,
	_ bool,
) ([]domain.PartInstance, []domain.ModuleUnitExecution, error) {
	s.canonicalExecCalls++
	if s.canonicalExecErr != nil {
		return nil, nil, s.canonicalExecErr
	}
	s.partInstances = append([]domain.PartInstance(nil), s.canonicalExecParts...)
	s.moduleUnits = append([]domain.ModuleUnitExecution(nil), s.canonicalExecUnits...)
	return s.canonicalExecParts, s.canonicalExecUnits, nil
}

func (s *stubStore) HasFrozenReleaseRouting(_ context.Context, _, _ string) bool {
	return s.canonicalRoutingReady
}

func (s *stubStore) MutateProjectInstallation(
	_ context.Context,
	_ string,
	mutate func(*domain.InstallationSnapshot) (*domain.InstallationMutation, error),
) (*domain.InstallationMutation, error) {
	snap := &domain.InstallationSnapshot{
		Job:                           s.installationJob,
		Units:                         append([]domain.ModuleUnitExecution(nil), s.installationUnits...),
		Items:                         append([]domain.ProjectItem(nil), s.installationItems...),
		HasInstallationStartedEvent:   s.installationHasStartedEvent,
		HasInstallationCompletedEvent: s.installationHasCompletedEvent,
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	s.installationJob = mutation.Job
	s.installationEvents = append(s.installationEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) MutateProjectMaterialPlanning(
	_ context.Context,
	_ string,
	mutate func(*domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
) (*domain.MaterialPlanningMutation, error) {
	return s.mutateMaterialPlanning("", mutate)
}

func (s *stubStore) MutateProjectMaterialPlanningForRelease(
	_ context.Context,
	_, releaseID string,
	mutate func(*domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
) (*domain.MaterialPlanningMutation, error) {
	return s.mutateMaterialPlanning(releaseID, mutate)
}

func (s *stubStore) MutateProjectQuality(
	_ context.Context,
	_ string,
	mutate func(*domain.QualitySnapshot) (*domain.QualityMutation, error),
) (*domain.QualityMutation, error) {
	return s.mutateQualityInMemory(mutate)
}

func (s *stubStore) MutateProjectQualityPhysical(
	_ context.Context,
	_ string,
	mutate func(*domain.QualitySnapshot) (*domain.QualityMutation, error),
) (*domain.QualityMutation, error) {
	return s.mutateQualityInMemory(mutate)
}

func (s *stubStore) MutateProjectCosting(
	_ context.Context,
	projectID string,
	mutate func(*domain.JobCostingSnapshot) (*domain.JobCostingMutation, error),
) (*domain.JobCostingMutation, error) {
	if s.costingProjectMissing {
		return nil, errors.New("project not found")
	}
	snap := &domain.JobCostingSnapshot{
		Costing:           s.jobCosting,
		PriceSnapshot:     s.costingPriceSnapshot,
		ProductionRelease: s.productionRelease,
		Quality:           s.qualityJob,
		Consumption:       append([]domain.MaterialConsumptionInput(nil), s.costingConsumption...),
	}
	mutation, err := mutate(snap)
	if err != nil {
		return nil, err
	}
	if mutation.Costing != nil {
		s.jobCosting = mutation.Costing
	}
	s.costingEvents = append(s.costingEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) MutateProjectSurvey(
	_ context.Context,
	_ string,
	mutate func(*domain.SiteSurvey) (*domain.SiteSurveyMutation, error),
) (*domain.SiteSurveyMutation, error) {
	mutation, err := mutate(s.siteSurvey)
	if err != nil {
		return nil, err
	}
	if mutation.Survey != nil {
		s.siteSurvey = mutation.Survey
	}
	s.siteSurveyEvents = append(s.siteSurveyEvents, mutation.Events...)
	return mutation, nil
}

func (s *stubStore) InsertProjectEvent(_ context.Context, ev domain.ProjectEvent) error {
	if s.insertProjectEventErr != nil {
		return s.insertProjectEventErr
	}
	s.projectEventWrites = append(s.projectEventWrites, ev)
	return nil
}

func (s *stubStore) ListProjectEvents(_ context.Context, _ string) ([]domain.ProjectEvent, error) {
	if s.listProjectEventsErr != nil {
		return nil, s.listProjectEventsErr
	}
	return s.projectEventsList, nil
}

func (s *stubStore) ListProjects(context.Context) ([]domain.Project, error) {
	if s.listProjects != nil {
		return s.listProjects, nil
	}
	return []domain.Project{}, nil
}

func (s *stubStore) GetProjectByID(context.Context, string) (*domain.Project, error) {
	if s.lastUpdatedProject != nil {
		if s.projectReadbackAfterUpdate != nil {
			return s.projectReadbackAfterUpdate, nil
		}
		return s.lastUpdatedProject, nil
	}
	return s.projectReturnedByID, s.projectGetByIDErr
}

func (s *stubStore) UpdateProject(_ context.Context, _ string, p *domain.Project) error {
	if s.updateProjectErr != nil {
		return s.updateProjectErr
	}
	cp := *p
	s.lastUpdatedProject = &cp
	return nil
}

// stubIdempotencyReceipt mirrors one api_idempotency_receipts row.

func (s *stubStore) UpdateProjectWithInlineCustomer(_ context.Context, _ string, p *domain.Project, inline *domain.Customer, baseCustomerID string, expectedProjectUpdatedAt time.Time) error {
	if s.updateProjectWithInlineErr != nil {
		return s.updateProjectWithInlineErr
	}
	s.updateProjectWithInlineCalls++
	s.updateProjectWithInlineBase = baseCustomerID
	s.updateProjectWithInlineExpectedUpdatedAt = expectedProjectUpdatedAt
	ic := *inline
	// Mirrors the real storage: the server mints the authoritative identity
	// and the project references exactly it.
	ic.ID = "70000000-0000-0000-0000-000000000714"
	ic.Active = true
	p.CustomerID = ic.ID
	inline.ID = ic.ID
	inline.Active = true
	s.lastInlineUpdateCustomer = &ic
	cp := *p
	s.lastUpdatedProject = &cp
	return nil
}

// ExecuteIdempotent replays sealed responses for the same scope+fingerprint
// and refuses key reuse with another payload — the in-memory counterpart of
// the durable receipts the real store commits with the mutation.

func (s *stubStore) DeleteProject(context.Context, string) error {
	s.deleteProjectCalled = true
	return nil
}
