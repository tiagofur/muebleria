package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

// Contrato: proyectos CRUD + estado operativo bajo lock (piso, ejecuciones,
// instalación, material planning, calidad, costing, survey) y eventos.
type ProjectStore interface {
	// Projects
	ListProjects(ctx context.Context) ([]domain.Project, error)
	GetProjectByID(ctx context.Context, id string) (*domain.Project, error)
	CreateProject(ctx context.Context, p *domain.Project) error
	// CreateProjectWithInlineCustomer is the atomic "nueva cotización + nuevo
	// cliente" transition (#712): one transaction, server-owned customer id,
	// rollback of both on any failure.
	CreateProjectWithInlineCustomer(ctx context.Context, p *domain.Project, inline *domain.Customer) error
	// BootstrapProjectDesign is the atomic SketchUp-first Customer?/Project/Design
	// transition (#718). Business IDs are server-owned and the surrounding
	// RequireIdempotency transaction owns commit + replay receipt.
	BootstrapProjectDesign(ctx context.Context, cmd storage.BootstrapProjectDesignCommand) (*storage.BootstrapProjectDesignResult, error)
	UpdateProject(ctx context.Context, id string, p *domain.Project) error
	// UpdateProjectWithInlineCustomer is the atomic "editar cotización + nuevo
	// cliente" transition (#714): row lock + base-view verification, then the
	// customer insert and the project update in one transaction. A moved base
	// fails with storage.ErrProjectConcurrentUpdate.
	UpdateProjectWithInlineCustomer(ctx context.Context, id string, p *domain.Project, inline *domain.Customer, baseCustomerID string, expectedProjectUpdatedAt time.Time) error
	DeleteProject(ctx context.Context, id string) error
	// Floor scan (PROD-3.1 / F089-RN): atomic single-item floor status write.
	SetProjectItemFloorStatus(ctx context.Context, projectID, itemID, status string) error
	// #740 operational gate: the legacy item floor writers advance physical
	// state, so the release authority is resolved and the gate evaluated
	// under the project row lock with the status + F092 event written in ONE
	// transaction; gate blockers return with zero writes.
	SetProjectItemFloorStatusGated(ctx context.Context, adv storage.ItemFloorAdvance) error
	// Floor event log (F092): immutable who/when/how audit trail.
	InsertFloorEvent(ctx context.Context, ev domain.FloorStatusEvent) error
	ListFloorEvents(ctx context.Context, projectID string) ([]domain.FloorStatusEvent, error)
	// Physical part/unit execution (OC-030..034): locked read-modify-write of
	// part_instances/module_units with derived legacy statuses + audit events.
	MutateProjectPartExecutions(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error),
	) (*domain.PartExecutionsMutation, error)
	// #577 canonical execution generation: derives parts/units exclusively
	// from the exact frozen snapshot + schema-v2 routing under the project
	// lock; fail-closed when the frozen routing evidence is missing.
	GenerateCanonicalPartExecutions(
		ctx context.Context,
		projectID string,
		force bool,
	) ([]domain.PartInstance, []domain.ModuleUnitExecution, error)
	// #577 read-side routing evidence probe: whether the exact release
	// carries a valid frozen routing program (never authorizes writes).
	HasFrozenReleaseRouting(ctx context.Context, projectID, releaseID string) bool
	// Installation job (OC-070..074): locked read-modify-write of the
	// installation JSONB (visits, field issues, punch, closeout) with the
	// audit lifecycle events appended in the same transaction.
	MutateProjectInstallation(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.InstallationSnapshot) (*domain.InstallationMutation, error),
	) (*domain.InstallationMutation, error)
	// Material planning (OC-050..054): locked read-modify-write of the
	// material_planning JSONB with the warehouse context (stock, plannings,
	// POs), the evidence gates and the audit lifecycle events.
	MutateProjectMaterialPlanning(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
	) (*domain.MaterialPlanningMutation, error)
	// OPS-DT-1 (#577): the derive variant resolving the EXACT canonical
	// ProductionRelease id the command targeted as the release authority —
	// never an implicit latest, never the legacy blob.
	MutateProjectMaterialPlanningForRelease(
		ctx context.Context,
		projectID, releaseID string,
		mutate func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error),
	) (*domain.MaterialPlanningMutation, error)
	// Quality job (OC-060..062): locked read-modify-write of the quality JSONB
	// (issues, rework actions, unit QC) plus the physical executions a rework
	// action may touch, with audit events in the same transaction.
	MutateProjectQuality(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error),
	) (*domain.QualityMutation, error)
	// #740: the execution variant for rework actions and unit QC — the
	// operational physical work gate runs under the same lock before the
	// mutator (observation flows keep using MutateProjectQuality).
	MutateProjectQualityPhysical(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.QualitySnapshot) (*domain.QualityMutation, error),
	) (*domain.QualityMutation, error)
	// Job costing (OC-080..084): locked read-modify-write of the costing JSONB
	// (baseline, time entries, other costs) with the valuation context (quote
	// snapshot, release, rework, job consumption) and audit events.
	MutateProjectCosting(
		ctx context.Context,
		projectID string,
		mutate func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error),
	) (*domain.JobCostingMutation, error)
	// Structured site survey (OC-040/OC-041): locked read-modify-write of the
	// site_survey JSONB (spaces, field measures, verification, freeze) with
	// audit events.
	MutateProjectSurvey(
		ctx context.Context,
		projectID string,
		mutate func(survey *domain.SiteSurvey) (*domain.SiteSurveyMutation, error),
	) (*domain.SiteSurveyMutation, error)
	// Project lifecycle events log (OC-010): immutable append-only events.
	InsertProjectEvent(ctx context.Context, ev domain.ProjectEvent) error
	ListProjectEvents(ctx context.Context, projectID string) ([]domain.ProjectEvent, error)
}
