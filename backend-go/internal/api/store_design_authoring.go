package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: autoría hacia hosts — model binding (#388), pairing one-time
// (#499) y publish staged con artefactos (#392).
type DesignAuthoringStore interface {
	// Authoritative Project/Design working context for SketchUp model
	// binding validation (#388 / DT-4).
	GetModelBindingContext(ctx context.Context, projectID, designID string, baseRevisionID *string) (*storage.ModelBindingContext, error)
	// #499 / DT-SU-1: one-time Web-to-SketchUp pairing grants. Creation and
	// lifecycle are web-session commands over an exact Project/Design; the
	// exchange consumes the grant by code hash under the exchanging device's
	// own tenant scope (one-time, TTL'd, hash-only, audited without codes).
	CreateDesignPairingGrant(ctx context.Context, cmd storage.CreateDesignPairingGrantCommand) (*domain.DesignPairingGrant, error)
	ExchangeDesignPairingGrant(ctx context.Context, cmd storage.ExchangeDesignPairingGrantCommand) (*storage.ExchangeDesignPairingGrantResult, error)
	GetDesignPairingGrant(ctx context.Context, projectID, designID, grantID string) (*domain.DesignPairingGrant, error)
	CancelDesignPairingGrant(ctx context.Context, cmd storage.CancelDesignPairingGrantCommand) (*domain.DesignPairingGrant, error)
	// #499 Slice 3: device-only exchanged→confirmed transition proving the
	// canonical model binding was persisted with the exact pinned identity.
	ConfirmDesignPairingGrant(ctx context.Context, cmd storage.ConfirmDesignPairingGrantCommand) (*domain.DesignPairingGrant, error)
	// #392 / DT-8 staged publish flow: prepare validates the manifest v1
	// against the working copy and pins the base revision; artifact uploads
	// stage metadata; finalize re-validates and publishes the immutable
	// revision with its artifacts.
	PrepareDesignPublish(ctx context.Context, cmd storage.PrepareDesignPublishCommand) (*storage.PrepareResult, error)
	GetDesignPublishSession(ctx context.Context, designID, sessionID string) (*storage.DesignPublishSessionDetail, error)
	RecordDesignPublishArtifact(ctx context.Context, cmd storage.RecordDesignPublishArtifactCommand) (*domain.DesignRevisionArtifact, string, error)
	FinalizeDesignPublish(ctx context.Context, cmd storage.FinalizeDesignPublishCommand) (*domain.DesignRevision, error)
	ListDesignRevisionArtifacts(ctx context.Context, designID, revisionID string) ([]domain.DesignRevisionArtifact, error)
	GetDesignRevisionArtifact(ctx context.Context, designID, revisionID string, kind domain.DesignPublishArtifactKind) (*domain.DesignRevisionArtifact, error)
}
