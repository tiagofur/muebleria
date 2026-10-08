package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: agregado Design y DesignRevision inmutable (#387 ADR-0003),
// working copy y materiales conciliados.
type DesignStore interface {
	// Design aggregate and immutable DesignRevision snapshots (#387 / DT-3, ADR-0003)
	CreateDesign(ctx context.Context, cmd storage.CreateDesignCommand) (*domain.Design, error)
	PrepareDesignDraftUnits(ctx context.Context, cmd storage.PrepareDesignDraftUnitsCommand) error
	GetDesignByID(ctx context.Context, id string) (*domain.Design, error)
	ListDesignsByProject(ctx context.Context, projectID string) ([]domain.Design, error)
	GetDesignWorkingCopy(ctx context.Context, designID string) (*domain.DesignWorkingCopy, error)
	GetDesignCommercialProjection(ctx context.Context, projectID, designID string) (*domain.CommercialProjection, error)
	UpdateDesignWorkingCopy(ctx context.Context, cmd storage.UpdateDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error)
	// SetDesignWorkingCopyOpening persists the design's opening intent
	// surgically (#1137): only the authoring defaults' opening selection
	// changes — never the working items.
	SetDesignWorkingCopyOpening(ctx context.Context, cmd storage.SetDesignWorkingCopyOpeningCommand) (*domain.DesignAuthoringDefaults, error)
	ResetDesignWorkingCopy(ctx context.Context, cmd storage.ResetDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error)
	// #637 / DT-MAT: quoted-material provenance detection (read-only) and
	// the explicit fill-only reconciliation into the mutable working copy.
	GetDesignWorkingCopyMaterialProvenance(ctx context.Context, designID string) (*storage.DesignWorkingCopyMaterialProvenance, error)
	ReconcileDesignWorkingMaterials(ctx context.Context, cmd storage.ReconcileDesignWorkingMaterialsCommand) (*storage.DesignWorkingMaterialsReconciliation, error)
	PublishDesignRevision(ctx context.Context, cmd storage.PublishDesignRevisionCommand) (*domain.DesignRevision, error)
	GetDesignRevision(ctx context.Context, designID string, revisionID string) (*domain.DesignRevision, error)
	ListDesignRevisions(ctx context.Context, designID string) ([]domain.DesignRevision, error)
	ListDesignRevisionItems(ctx context.Context, revisionID string) ([]domain.DesignRevisionItem, error)
}
