package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: ciclo comercial e industrial — reconciliación, QuoteRevision,
// aprobaciones, ProductionRelease y estado de ingeniería (#502/#571/#739).
type QuoteReleaseStore interface {
	// #393 / DT-9: QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance
	ReconcileProject(ctx context.Context, projectID, quoteRevisionID, designRevisionID string) (*domain.ReconciliationResult, error)
	// #500 / WEB-DT-1: immutable QuoteRevision read model with per-unit
	// commercial items for the Project Furniture matrix exact context.
	ListQuoteRevisionsByProject(ctx context.Context, projectID string) ([]domain.QuoteRevisionDetail, error)
	// #642 / 2A: authoritative commercial summaries for accessible projects
	// in the caller's organization, derived from the authoritative QuoteRevision.
	ListProjectCommercialSummaries(ctx context.Context) ([]domain.ProjectCommercialSummary, error)
	// #500 / WEB-DT-1: authoritative contextual projection of the Project
	// Furniture matrix.
	GetProjectFurnitureWorkspace(ctx context.Context, projectID string, query storage.FurnitureWorkspaceQuery) (*domain.FurnitureWorkspace, error)
	// #394 / DT-10: explicit re-quote — creates the next draft QuoteRevision
	// from an exact base quote revision and an exact design revision.
	RequoteProjectQuote(ctx context.Context, cmd storage.RequoteProjectQuoteCommand) (*storage.RequoteProjectQuoteResult, error)
	// #571 / WEB-DT-4: commercial QuoteRevision lifecycle — the canonical Q1
	// entry snapshotting the project's editable commercial state, the explicit
	// draft→published transition and the atomic published→accepted transition
	// that supersedes the previously accepted revision in one transaction.
	CreateInitialQuoteRevision(ctx context.Context, cmd storage.CreateInitialQuoteRevisionCommand) (*storage.CreateInitialQuoteRevisionResult, error)
	CreateInitialDesignQuoteRevision(ctx context.Context, cmd storage.CreateInitialDesignQuoteRevisionCommand) (*storage.CreateInitialQuoteRevisionResult, error)
	PublishQuoteRevision(ctx context.Context, cmd storage.QuoteRevisionLifecycleCommand) (*domain.QuoteRevision, error)
	AcceptQuoteRevision(ctx context.Context, cmd storage.QuoteRevisionLifecycleCommand) (*storage.AcceptQuoteRevisionResult, error)
	// #395 / DT-11: explicit DesignRevision approval (published→approved
	// exactly once; replay is an idempotent no-op).
	ApproveDesignRevision(ctx context.Context, cmd storage.ApproveDesignRevisionCommand) (*domain.DesignRevision, error)
	// #502 / WEB-DT-3: always-gated production approval — exact accepted
	// QuoteRevision required, release gate chain enforced before the
	// transition (no skip mode).
	ApproveDesignRevisionForProduction(ctx context.Context, cmd storage.ApproveDesignRevisionForProductionCommand) (*domain.DesignRevision, error)
	// #502 / WEB-DT-3: read-only evaluation of the authoritative release
	// manufacturing preflight (#466 parity: the exact gate the release
	// command enforces, without creating anything).
	EvaluateDesignRevisionPreflight(ctx context.Context, designID, revisionID, quoteRevisionID string) (*domain.ManufacturingPreflightResult, error)
	// #395 / DT-11: immutable ProductionRelease pinned to the exact approved
	// DesignRevision (+ optional exact accepted QuoteRevision) and the
	// server-computed manufacturing fingerprint; readback derives staleness.
	CreateProductionRelease(ctx context.Context, cmd storage.CreateProductionReleaseCommand) (*storage.ProductionReleaseReadback, error)
	ListProjectProductionReleases(ctx context.Context, projectID string) ([]storage.ProductionReleaseReadback, error)
	GetProjectProductionRelease(ctx context.Context, projectID, releaseID string) (*storage.ProductionReleaseReadback, error)
	// #739: frozen cutting demand projection of the exact release.
	GetProjectProductionReleaseCuttingDemand(ctx context.Context, projectID, releaseID string) (*storage.ReleaseCuttingDemandView, error)
	GetProjectWorkshopOccurrences(ctx context.Context, projectID, releaseID string) (*storage.WorkshopOccurrenceProjectionView, error)
	// #740: durable per-release Engineering state (nil row = pending) and
	// the idempotent start / version-guarded final completion commands.
	GetReleaseEngineeringState(ctx context.Context, projectID, releaseID string) (*domain.ReleaseEngineeringState, error)
	StartReleaseEngineering(ctx context.Context, cmd storage.StartReleaseEngineeringCommand) (*storage.ReleaseEngineeringOutcome, error)
	CompleteReleaseEngineering(ctx context.Context, cmd storage.CompleteReleaseEngineeringCommand) (*storage.ReleaseEngineeringOutcome, error)
	// GetLatestProjectProductionRelease resolves the ONE release authority:
	// the newest canonical release of the project (nil when none exists).
	GetLatestProjectProductionRelease(ctx context.Context, projectID string) (*domain.ProductionRelease, error)
	// ResolveProjectReleaseAuthority resolves the consumer-facing release
	// authority: canonical when it exists, legacy-adapted otherwise.
	ResolveProjectReleaseAuthority(ctx context.Context, projectID string, legacyBlob *domain.LegacyProductionRelease) (*domain.ResolvedProductionRelease, error)
}
