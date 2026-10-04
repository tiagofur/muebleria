package api

// Contrato: stub del stubStore espejo de store_quote_release (store_quote_release.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_quote_release.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

func (s *stubStore) ReconcileProject(_ context.Context, projectID, quoteRevisionID, designRevisionID string) (*domain.ReconciliationResult, error) {
	s.reconcileProjectCalls++
	if s.reconcileProjectErr != nil {
		return nil, s.reconcileProjectErr
	}
	if s.reconcileProjectResult != nil {
		return s.reconcileProjectResult, nil
	}
	return &domain.ReconciliationResult{
		ProjectID:        projectID,
		QuoteRevisionID:  quoteRevisionID,
		DesignRevisionID: designRevisionID,
		Summary: domain.ReconciliationSummary{
			Total:  1,
			Synced: 1,
		},
		Items: []domain.ReconciliationItem{
			{
				FurnitureInstanceID: "FI-001",
				Status:              domain.ReconciliationStatusSynced,
				Differences:         []domain.StructuredDifference{},
			},
		},
	}, nil
}

func (s *stubStore) ListQuoteRevisionsByProject(_ context.Context, projectID string) ([]domain.QuoteRevisionDetail, error) {
	s.quoteRevisionsCalls++
	if s.quoteRevisionsErr != nil {
		return nil, s.quoteRevisionsErr
	}
	if s.quoteRevisionsList != nil {
		return s.quoteRevisionsList, nil
	}
	return []domain.QuoteRevisionDetail{
		{
			QuoteRevision: domain.QuoteRevision{
				ID:             "3f7b6c5d-0000-4000-8000-000000000010",
				OrganizationID: "00000000-0000-4000-8000-000000000001",
				ProjectID:      projectID,
				RevisionNumber: 1,
				Status:         "accepted",
				SourceType:     "manual",
			},
			CreatedAt: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC),
			Items: []domain.QuoteRevisionItem{
				{
					FurnitureInstanceID:   "f1000000-0000-4000-8000-000000000001",
					FurnitureDefinitionID: "d1000000-0000-4000-8000-000000000001",
					Parameters:            map[string]any{"widthMm": 600},
					MaterialChoices:       map[string]string{"carcass": "mat-blanco"},
					LifecycleStatus:       "active",
				},
			},
		},
	}, nil
}

func (s *stubStore) ListProjectCommercialSummaries(_ context.Context) ([]domain.ProjectCommercialSummary, error) {
	s.commercialSummariesCalls++
	if s.commercialSummariesErr != nil {
		return nil, s.commercialSummariesErr
	}
	if s.commercialSummariesList != nil {
		return s.commercialSummariesList, nil
	}
	return []domain.ProjectCommercialSummary{}, nil
}

func (s *stubStore) GetProjectFurnitureWorkspace(_ context.Context, projectID string, query storage.FurnitureWorkspaceQuery) (*domain.FurnitureWorkspace, error) {
	s.furnitureWorkspaceCalls++
	qCopy := query
	s.furnitureWorkspaceQuery = &qCopy
	if s.furnitureWorkspaceErr != nil {
		return nil, s.furnitureWorkspaceErr
	}
	if s.furnitureWorkspaceResult != nil {
		return s.furnitureWorkspaceResult, nil
	}
	return &domain.FurnitureWorkspace{
		ProjectID: projectID,
		DesignContext: domain.FurnitureWorkspaceDesignHeader{
			Kind: query.DesignContextKind,
		},
		Summary: domain.FurnitureWorkspaceSummary{},
		Units:   []domain.FurnitureWorkspaceUnit{},
	}, nil
}

func (s *stubStore) RequoteProjectQuote(_ context.Context, cmd storage.RequoteProjectQuoteCommand) (*storage.RequoteProjectQuoteResult, error) {
	s.requoteProjectQuoteCalls++
	cmdCopy := cmd
	s.requoteProjectQuoteCmd = &cmdCopy
	if s.requoteProjectQuoteErr != nil {
		return nil, s.requoteProjectQuoteErr
	}
	if s.requoteProjectQuoteResult != nil {
		return s.requoteProjectQuoteResult, nil
	}
	return &storage.RequoteProjectQuoteResult{
		Revision: &domain.QuoteRevision{
			ID:                     "8f7b6c5d-0000-4000-8000-000000000004",
			ProjectID:              cmd.ProjectID,
			RevisionNumber:         4,
			Status:                 "draft",
			SourceType:             "requote",
			BaseQuoteRevisionID:    cmd.BaseQuoteRevisionID,
			SourceDesignRevisionID: cmd.DesignRevisionID,
		},
		Classification: &domain.ImpactClassificationResult{
			ProjectID:        cmd.ProjectID,
			QuoteRevisionID:  cmd.BaseQuoteRevisionID,
			DesignRevisionID: cmd.DesignRevisionID,
			Summary: domain.ImpactClassificationSummary{
				RequiresRequote:   true,
				CanRequote:        true,
				CommercialChanges: 1,
			},
		},
	}, nil
}

func (s *stubStore) CreateInitialQuoteRevision(_ context.Context, cmd storage.CreateInitialQuoteRevisionCommand) (*storage.CreateInitialQuoteRevisionResult, error) {
	s.createInitialQuoteRevisionCalls++
	cmdCopy := cmd
	s.createInitialQuoteRevisionCmd = &cmdCopy
	if s.createInitialQuoteRevisionErr != nil {
		return nil, s.createInitialQuoteRevisionErr
	}
	if s.createInitialQuoteRevisionResult != nil {
		return s.createInitialQuoteRevisionResult, nil
	}
	return &storage.CreateInitialQuoteRevisionResult{
		Revision: &domain.QuoteRevision{
			ID:             "8f7b6c5d-0000-4000-8000-000000000011",
			ProjectID:      cmd.ProjectID,
			RevisionNumber: 1,
			Status:         "draft",
			SourceType:     "manual",
			Notes:          cmd.Notes,
		},
		CreatedInstanceIDs: []string{},
	}, nil
}

func (s *stubStore) CreateInitialDesignQuoteRevision(_ context.Context, cmd storage.CreateInitialDesignQuoteRevisionCommand) (*storage.CreateInitialQuoteRevisionResult, error) {
	s.createInitialDesignQuoteRevisionCalls++
	cmdCopy := cmd
	s.createInitialDesignQuoteRevisionCmd = &cmdCopy
	if s.createInitialDesignQuoteRevisionErr != nil {
		return nil, s.createInitialDesignQuoteRevisionErr
	}
	return &storage.CreateInitialQuoteRevisionResult{Revision: &domain.QuoteRevision{
		ID: "8f7b6c5d-0000-4000-8000-000000000012", ProjectID: cmd.ProjectID,
		RevisionNumber: 1, Status: "draft", SourceType: "manual", Notes: cmd.Notes,
		CommercialSnapshot: &domain.QuoteCommercialSnapshot{Breakdown: domain.QuoteBreakdown{MaterialsCost: 42, SalePrice: 100}},
	}}, nil
}

func (s *stubStore) PublishQuoteRevision(_ context.Context, cmd storage.QuoteRevisionLifecycleCommand) (*domain.QuoteRevision, error) {
	s.publishQuoteRevisionCalls++
	cmdCopy := cmd
	s.publishQuoteRevisionCmd = &cmdCopy
	if s.publishQuoteRevisionErr != nil {
		return nil, s.publishQuoteRevisionErr
	}
	if s.publishQuoteRevisionResult != nil {
		return s.publishQuoteRevisionResult, nil
	}
	return &domain.QuoteRevision{
		ID:             cmd.QuoteRevisionID,
		ProjectID:      cmd.ProjectID,
		RevisionNumber: 1,
		Status:         "published",
		SourceType:     "manual",
	}, nil
}

func (s *stubStore) AcceptQuoteRevision(_ context.Context, cmd storage.QuoteRevisionLifecycleCommand) (*storage.AcceptQuoteRevisionResult, error) {
	s.acceptQuoteRevisionCalls++
	cmdCopy := cmd
	s.acceptQuoteRevisionCmd = &cmdCopy
	if s.acceptQuoteRevisionErr != nil {
		return nil, s.acceptQuoteRevisionErr
	}
	if s.acceptQuoteRevisionResult != nil {
		return s.acceptQuoteRevisionResult, nil
	}
	return &storage.AcceptQuoteRevisionResult{
		Revision: &domain.QuoteRevision{
			ID:             cmd.QuoteRevisionID,
			ProjectID:      cmd.ProjectID,
			RevisionNumber: 2,
			Status:         "accepted",
			SourceType:     "requote",
		},
		SupersededRevisions: []domain.QuoteRevision{},
	}, nil
}

func (s *stubStore) ApproveDesignRevision(_ context.Context, cmd storage.ApproveDesignRevisionCommand) (*domain.DesignRevision, error) {
	s.approveDesignRevisionCalls++
	cmdCopy := cmd
	s.approveDesignRevisionCmd = &cmdCopy
	if s.approveDesignRevisionErr != nil {
		return nil, s.approveDesignRevisionErr
	}
	if s.approveDesignRevisionResult != nil {
		return s.approveDesignRevisionResult, nil
	}
	return &domain.DesignRevision{
		ID:             cmd.DesignRevisionID,
		DesignID:       cmd.DesignID,
		ProjectID:      "proj-1",
		RevisionNumber: 3,
		SourceType:     domain.DesignRevisionSourceSketchup,
		Status:         domain.DesignRevisionStatusApproved,
		ApprovedBy:     cmd.ActorUserID,
		ApprovedAt:     &[]time.Time{time.Now()}[0],
	}, nil
}

func (s *stubStore) ApproveDesignRevisionForProduction(_ context.Context, cmd storage.ApproveDesignRevisionForProductionCommand) (*domain.DesignRevision, error) {
	s.approveForProductionCalls++
	cmdCopy := cmd
	s.approveForProductionCmd = &cmdCopy
	if s.approveForProductionErr != nil {
		return nil, s.approveForProductionErr
	}
	return s.ApproveDesignRevision(context.Background(), storage.ApproveDesignRevisionCommand{
		DesignID:         cmd.DesignID,
		DesignRevisionID: cmd.DesignRevisionID,
		ActorUserID:      cmd.ActorUserID,
		IP:               cmd.IP,
		RequestID:        cmd.RequestID,
	})
}

func (s *stubStore) EvaluateDesignRevisionPreflight(_ context.Context, designID, revisionID, quoteRevisionID string) (*domain.ManufacturingPreflightResult, error) {
	s.evaluatePreflightCalls++
	s.evaluatePreflightDesignID = designID
	s.evaluatePreflightRevisionID = revisionID
	s.evaluatePreflightQuoteID = quoteRevisionID
	if s.evaluatePreflightErr != nil {
		return nil, s.evaluatePreflightErr
	}
	if s.evaluatePreflightResult != nil {
		return s.evaluatePreflightResult, nil
	}
	return &domain.ManufacturingPreflightResult{
		DesignRevisionID: revisionID,
		Scope:            domain.ManufacturingPreflightScope,
		Status:           domain.ManufacturingPreflightReady,
		Items:            []domain.ManufacturingPreflightItem{},
		Issues:           []domain.ManufacturingPreflightIssue{},
	}, nil
}

func (s *stubStore) CreateProductionRelease(_ context.Context, cmd storage.CreateProductionReleaseCommand) (*storage.ProductionReleaseReadback, error) {
	s.createProductionReleaseCalls++
	cmdCopy := cmd
	s.createProductionReleaseCmd = &cmdCopy
	if s.createProductionReleaseErr != nil {
		return nil, s.createProductionReleaseErr
	}
	if s.createProductionReleaseResult != nil {
		return s.createProductionReleaseResult, nil
	}
	return &storage.ProductionReleaseReadback{
		Release: domain.ProductionRelease{
			ID:                       "0a1b2c3d-0000-4000-8000-000000000001",
			ProjectID:                cmd.ProjectID,
			DesignRevisionID:         cmd.DesignRevisionID,
			QuoteRevisionID:          cmd.QuoteRevisionID,
			ReleaseNumber:            1,
			DesignRevisionNumber:     3,
			ManufacturingFingerprint: "sha256-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
			Status:                   domain.ProductionReleaseStatusActive,
			ReleasedBy:               cmd.ActorUserID,
			ReleasedAt:               time.Now(),
		},
		Staleness: domain.ProductionReleaseStaleness{},
	}, nil
}

func (s *stubStore) ListProjectProductionReleases(_ context.Context, _ string) ([]storage.ProductionReleaseReadback, error) {
	if s.listProductionReleasesErr != nil {
		return nil, s.listProductionReleasesErr
	}
	return s.listProductionReleasesResult, nil
}

func (s *stubStore) GetProjectProductionRelease(_ context.Context, _, _ string) (*storage.ProductionReleaseReadback, error) {
	if s.getProductionReleaseErr != nil {
		return nil, s.getProductionReleaseErr
	}
	if s.getProductionReleaseResult != nil {
		return s.getProductionReleaseResult, nil
	}
	return nil, domain.ErrReleaseNotFound
}

func (s *stubStore) GetProjectProductionReleaseCuttingDemand(_ context.Context, _, _ string) (*storage.ReleaseCuttingDemandView, error) {
	if s.cuttingDemandErr != nil {
		return nil, s.cuttingDemandErr
	}
	return s.cuttingDemandResult, nil
}

func (s *stubStore) GetProjectWorkshopOccurrences(_ context.Context, _, _ string) (*storage.WorkshopOccurrenceProjectionView, error) {
	if s.workshopOccurrencesErr != nil {
		return nil, s.workshopOccurrencesErr
	}
	return s.workshopOccurrencesResult, nil
}

func (s *stubStore) GetReleaseEngineeringState(_ context.Context, _, _ string) (*domain.ReleaseEngineeringState, error) {
	if s.engineeringStateErr != nil {
		return nil, s.engineeringStateErr
	}
	return s.engineeringStateResult, nil
}

func (s *stubStore) StartReleaseEngineering(_ context.Context, _ storage.StartReleaseEngineeringCommand) (*storage.ReleaseEngineeringOutcome, error) {
	if s.engineeringStartErr != nil {
		return nil, s.engineeringStartErr
	}
	return s.engineeringStartOutcome, nil
}

func (s *stubStore) CompleteReleaseEngineering(_ context.Context, _ storage.CompleteReleaseEngineeringCommand) (*storage.ReleaseEngineeringOutcome, error) {
	if s.engineeringCompleteErr != nil {
		return nil, s.engineeringCompleteErr
	}
	return s.engineeringCompleteOutcome, nil
}

func (s *stubStore) GetLatestProjectProductionRelease(_ context.Context, _ string) (*domain.ProductionRelease, error) {
	if s.latestProductionReleaseErr != nil {
		return nil, s.latestProductionReleaseErr
	}
	return s.latestProductionRelease, nil
}

func (s *stubStore) ResolveProjectReleaseAuthority(_ context.Context, _ string, legacyBlob *domain.LegacyProductionRelease) (*domain.ResolvedProductionRelease, error) {
	if s.latestProductionRelease != nil {
		return domain.ResolvedFromCanonicalRelease(s.latestProductionRelease), nil
	}
	return domain.ResolveLegacyProductionRelease(legacyBlob), nil
}

// --- #667 M1: hardware 3D asset stubs (no behavior; API tests use the real
// PostgreSQL store for the asset flow) ---
