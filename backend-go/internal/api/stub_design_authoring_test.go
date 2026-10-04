package api

// Contrato: stub del stubStore espejo de store_design_authoring (store_design_authoring.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_design_authoring.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

func (s *stubStore) GetModelBindingContext(_ context.Context, projectID, designID string, baseRevisionID *string) (*storage.ModelBindingContext, error) {
	if s.modelBindingContextErr != nil {
		return nil, s.modelBindingContextErr
	}
	if s.modelBindingContext != nil {
		return s.modelBindingContext, nil
	}
	return nil, domain.ErrDesignNotFound
}

func (s *stubStore) PrepareDesignPublish(_ context.Context, cmd storage.PrepareDesignPublishCommand) (*storage.PrepareResult, error) {
	s.prepareDesignPublishCmd = &cmd
	if s.prepareDesignPublishErr != nil {
		return nil, s.prepareDesignPublishErr
	}
	if s.prepareDesignPublishResult != nil {
		return s.prepareDesignPublishResult, nil
	}
	return &storage.PrepareResult{
		Session: &domain.DesignPublishSession{
			ID:        "dps-1",
			DesignID:  cmd.DesignID,
			Status:    "prepared",
			ExpiresAt: time.Now().Add(time.Hour),
			Manifest:  &cmd.Manifest,
		},
	}, nil
}

func (s *stubStore) GetDesignPublishSession(_ context.Context, designID, sessionID string) (*storage.DesignPublishSessionDetail, error) {
	if s.getPublishSessionErr != nil {
		return nil, s.getPublishSessionErr
	}
	if s.publishSessionDetail != nil {
		return s.publishSessionDetail, nil
	}
	return nil, domain.ErrPublishSessionNotFound
}

func (s *stubStore) RecordDesignPublishArtifact(_ context.Context, cmd storage.RecordDesignPublishArtifactCommand) (*domain.DesignRevisionArtifact, string, error) {
	s.recordDesignPublishArtifactCmd = &cmd
	if s.recordDesignPublishArtifactErr != nil {
		return nil, "", s.recordDesignPublishArtifactErr
	}
	if s.recordDesignPublishArtifact != nil {
		return s.recordDesignPublishArtifact, s.recordDesignPublishArtifactReplaced, nil
	}
	return &domain.DesignRevisionArtifact{
		ID:               "dpa-1",
		DesignRevisionID: cmd.SessionID,
		Kind:             cmd.Kind,
		StorageKey:       cmd.StorageKey,
		ContentType:      cmd.ContentType,
		SizeBytes:        cmd.SizeBytes,
		SHA256:           cmd.SHA256,
		CreatedAt:        time.Now(),
	}, "", nil
}

func (s *stubStore) FinalizeDesignPublish(_ context.Context, cmd storage.FinalizeDesignPublishCommand) (*domain.DesignRevision, error) {
	s.finalizeDesignPublishCmd = &cmd
	if s.finalizeDesignPublishErr != nil {
		return nil, s.finalizeDesignPublishErr
	}
	rev := &domain.DesignRevision{
		ID:             "drev-pub",
		DesignID:       cmd.DesignID,
		RevisionNumber: 8,
		SourceType:     domain.DesignRevisionSourceSketchup,
		Status:         domain.DesignRevisionStatusPublished,
		CreatedAt:      time.Now(),
	}
	return rev, nil
}

func (s *stubStore) ListDesignRevisionArtifacts(_ context.Context, designID, revisionID string) ([]domain.DesignRevisionArtifact, error) {
	if s.listDesignRevisionArtifactsErr != nil {
		return nil, s.listDesignRevisionArtifactsErr
	}
	return s.listDesignRevisionArtifactsResult, nil
}

func (s *stubStore) GetDesignRevisionArtifact(_ context.Context, designID, revisionID string, kind domain.DesignPublishArtifactKind) (*domain.DesignRevisionArtifact, error) {
	if s.getDesignRevisionArtifactErr != nil {
		return nil, s.getDesignRevisionArtifactErr
	}
	if s.getDesignRevisionArtifactResult != nil {
		return s.getDesignRevisionArtifactResult, nil
	}
	return nil, domain.ErrDesignRevisionNotFound
}
