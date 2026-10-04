package api

// Contrato: stub del stubStore espejo de store_hardware_assets (store_hardware_assets.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_hardware_assets.go
import (
	"context"
	"errors"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func (s *stubStore) CreateHardwareAssetUploadSession(_ context.Context, cmd storage.CreateHardwareAssetUploadSessionCommand) (*storage.HardwareAssetUploadSessionResult, error) {
	if s.assetSessionResult == nil {
		return nil, errors.New("not configured in stubStore")
	}
	if s.assetSessionResult.Session != nil && cmd.DisplayName != "" {
		s.assetSessionResult.Session.DisplayName = cmd.DisplayName
	}
	return s.assetSessionResult, s.assetSessionErr
}

func (s *stubStore) GetHardwareAssetUploadSession(_ context.Context, _ string) (*domain.HardwareAssetUploadSession, error) {
	if s.assetSession == nil {
		return nil, domain.ErrHardwareAssetSessionNotFound
	}
	return s.assetSession, nil
}

func (s *stubStore) PromoteHardwareAssetSessionBytes(_ context.Context, cmd storage.PromoteHardwareAssetSessionBytesCommand) (string, error) {
	if !s.recordAssetBytesArmed {
		return "", errors.New("not configured in stubStore")
	}
	s.promoteAssetBytesCmd = &cmd
	if cmd.Promote != nil {
		if err := cmd.Promote(); err != nil {
			return "", err
		}
	}
	return s.assetPreviousStagedKey, s.promoteAssetBytesErr
}

func (s *stubStore) FinalizeHardwareAssetUpload(_ context.Context, cmd storage.FinalizeHardwareAssetUploadCommand) (*domain.HardwareAsset, error) {
	s.assetFinalizeCmd = &cmd
	if s.assetFinalized == nil {
		return nil, errors.New("not configured in stubStore")
	}
	return s.assetFinalized, s.assetFinalizeErr
}

func (s *stubStore) CancelHardwareAssetUploadSession(_ context.Context, cmd storage.CancelHardwareAssetUploadSessionCommand) error {
	s.assetCancelledCmd = &cmd
	return nil
}

func (s *stubStore) ListHardwareAssets(_ context.Context) ([]domain.HardwareAsset, error) {
	return s.listHardwareAssets, nil
}

func (s *stubStore) GetHardwareAsset(_ context.Context, _ string) (*domain.HardwareAsset, error) {
	if s.assetFinalized == nil {
		return nil, domain.ErrHardwareAssetNotFound
	}
	return s.assetFinalized, nil
}

func (s *stubStore) GetHardwareAssetRevision(_ context.Context, _, _ string) (*domain.HardwareAssetRevision, error) {
	if s.assetRevisionResult == nil {
		return nil, domain.ErrHardwareAssetRevisionNotFound
	}
	return s.assetRevisionResult, nil
}

func (s *stubStore) RetireHardwareAsset(_ context.Context, _ storage.RetireHardwareAssetCommand) error {
	return nil
}

func (s *stubStore) DeriveHardwareAssetRevision(_ context.Context, cmd storage.DeriveHardwareAssetRevisionCommand) (*domain.HardwareAssetRevision, error) {
	s.deriveRevisionCalls++
	s.deriveRevisionCmd = &cmd
	if s.assetRevisionResult == nil {
		return nil, errors.New("not configured in stubStore")
	}
	return s.assetRevisionResult, nil
}

func (s *stubStore) ResolveHardwareVisualAssetBinding(_ context.Context, assetID, revisionID string) (*domain.HardwareVisualAssetBinding, error) {
	if s.assetResolveBindingCmd != nil {
		(*s.assetResolveBindingCmd) = [2]string{assetID, revisionID}
	}
	if s.assetResolvedBinding == nil {
		return nil, domain.ErrHardwareAssetBindingInvalid
	}
	return s.assetResolvedBinding, nil
}

func (s *stubStore) RecordHardwareAssetValidation(_ context.Context, cmd storage.RecordHardwareAssetValidationCommand) error {
	if s.recordValidationCmd != nil {
		*s.recordValidationCmd = cmd
	}
	return s.recordValidationErr
}

func (s *stubStore) CollectHardwareAssetStagedFile(_ context.Context, _, _, _ string, remove func() error) (bool, error) {
	// Handler-level stub: conservative retention without reference checks.
	if remove != nil {
		if err := remove(); err != nil {
			return false, err
		}
	}
	return true, nil
}
