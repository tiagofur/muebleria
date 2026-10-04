package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: ciclo de vida de assets 3D de herrajes (#667) — upload sessions,
// revisiones, retiro, validación y recolección de archivos staged.
type HardwareAssetStore interface {
	// Hardware 3D assets (#667 M1)
	CreateHardwareAssetUploadSession(ctx context.Context, cmd storage.CreateHardwareAssetUploadSessionCommand) (*storage.HardwareAssetUploadSessionResult, error)
	GetHardwareAssetUploadSession(ctx context.Context, sessionID string) (*domain.HardwareAssetUploadSession, error)
	PromoteHardwareAssetSessionBytes(ctx context.Context, cmd storage.PromoteHardwareAssetSessionBytesCommand) (string, error)
	FinalizeHardwareAssetUpload(ctx context.Context, cmd storage.FinalizeHardwareAssetUploadCommand) (*domain.HardwareAsset, error)
	CancelHardwareAssetUploadSession(ctx context.Context, cmd storage.CancelHardwareAssetUploadSessionCommand) error
	ListHardwareAssets(ctx context.Context) ([]domain.HardwareAsset, error)
	GetHardwareAsset(ctx context.Context, assetID string) (*domain.HardwareAsset, error)
	GetHardwareAssetRevision(ctx context.Context, assetID, revisionID string) (*domain.HardwareAssetRevision, error)
	RetireHardwareAsset(ctx context.Context, cmd storage.RetireHardwareAssetCommand) error
	DeriveHardwareAssetRevision(ctx context.Context, cmd storage.DeriveHardwareAssetRevisionCommand) (*domain.HardwareAssetRevision, error)
	ResolveHardwareVisualAssetBinding(ctx context.Context, assetID, revisionID string) (*domain.HardwareVisualAssetBinding, error)
	RecordHardwareAssetValidation(ctx context.Context, cmd storage.RecordHardwareAssetValidationCommand) error
	// CollectHardwareAssetStagedFile decides under the session row lock
	// whether a superseded staged key is still needed and, when not, runs the
	// caller's removal while the lock is held (#667 R5 residual).
	CollectHardwareAssetStagedFile(ctx context.Context, sessionID, organizationID, storageKey string, remove func() error) (bool, error)
}
