package api

// Contrato: stub del stubStore espejo de store_design (store_design.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_design.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

// Design aggregate & revisions (#387 / DT-3).
func (s *stubStore) CreateDesign(_ context.Context, cmd storage.CreateDesignCommand) (*domain.Design, error) {
	s.createDesignCmd = &cmd
	if s.createDesignErr != nil {
		return nil, s.createDesignErr
	}
	if s.designsByID == nil {
		s.designsByID = map[string]domain.Design{}
	}
	d := &domain.Design{
		ID:                    "des-1",
		ProjectID:             cmd.ProjectID,
		Name:                  cmd.Name,
		SourceQuoteRevisionID: cmd.SourceQuoteRevisionID,
		Status:                domain.DesignStatusActive,
		CreatedAt:             time.Now(),
		UpdatedAt:             time.Now(),
	}
	s.designsByID[d.ID] = *d
	return d, nil
}

func (s *stubStore) PrepareDesignDraftUnits(_ context.Context, _ storage.PrepareDesignDraftUnitsCommand) error {
	return nil
}

func (s *stubStore) GetDesignByID(_ context.Context, id string) (*domain.Design, error) {
	if s.getDesignByIDErr != nil {
		return nil, s.getDesignByIDErr
	}
	if d, ok := s.designsByID[id]; ok {
		copy := d
		return &copy, nil
	}
	return nil, domain.ErrDesignNotFound
}

func (s *stubStore) ListDesignsByProject(_ context.Context, projectID string) ([]domain.Design, error) {
	if s.listDesignsByProjectErr != nil {
		return nil, s.listDesignsByProjectErr
	}
	var out []domain.Design
	for _, d := range s.designsByID {
		if d.ProjectID == projectID {
			out = append(out, d)
		}
	}
	return out, nil
}

func (s *stubStore) PublishDesignRevision(_ context.Context, cmd storage.PublishDesignRevisionCommand) (*domain.DesignRevision, error) {
	s.publishDesignRevisionCmd = &cmd
	if s.publishDesignRevisionErr != nil {
		return nil, s.publishDesignRevisionErr
	}
	if s.designRevisionsByID == nil {
		s.designRevisionsByID = map[string]domain.DesignRevision{}
	}
	revNum := 1
	var latestRevID string
	for _, r := range s.designRevisionsByID {
		if r.DesignID == cmd.DesignID && r.RevisionNumber >= revNum {
			revNum = r.RevisionNumber + 1
			latestRevID = r.ID
		}
	}
	rev := &domain.DesignRevision{
		ID:               "drev-" + string(rune('0'+revNum)),
		DesignID:         cmd.DesignID,
		RevisionNumber:   revNum,
		ParentRevisionID: latestRevID,
		SourceType:       cmd.SourceType,
		Status:           domain.DesignRevisionStatusPublished,
		CreatedAt:        time.Now(),
	}
	if wc, ok := s.designWorkingCopiesByID[cmd.DesignID]; ok {
		for i, item := range wc.Items {
			rev.Items = append(rev.Items, domain.DesignRevisionItem{
				ID:                     "ditem-" + string(rune('0'+i+1)),
				DesignRevisionID:       rev.ID,
				FurnitureInstanceID:    item.FurnitureInstanceID,
				FurnitureDefinitionID:  item.FurnitureDefinitionID,
				DefinitionVersion:      item.DefinitionVersion,
				Parameters:             item.Parameters,
				MaterialChoices:        item.MaterialChoices,
				Transform:              item.Transform,
				RoomID:                 item.RoomID,
				TechnicalClientLocator: item.TechnicalClientLocator,
				CreatedAt:              time.Now(),
			})
		}
	}
	s.designRevisionsByID[rev.ID] = *rev
	return rev, nil
}

func (s *stubStore) GetDesignRevision(_ context.Context, designID string, revisionID string) (*domain.DesignRevision, error) {
	if s.getDesignRevisionErr != nil {
		return nil, s.getDesignRevisionErr
	}
	if r, ok := s.designRevisionsByID[revisionID]; ok && r.DesignID == designID {
		copy := r
		return &copy, nil
	}
	return nil, domain.ErrDesignRevisionNotFound
}

func (s *stubStore) ListDesignRevisions(_ context.Context, designID string) ([]domain.DesignRevision, error) {
	if s.listDesignRevisionsErr != nil {
		return nil, s.listDesignRevisionsErr
	}
	var out []domain.DesignRevision
	for _, r := range s.designRevisionsByID {
		if r.DesignID == designID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *stubStore) ListDesignRevisionItems(_ context.Context, revisionID string) ([]domain.DesignRevisionItem, error) {
	if s.listDesignRevisionItemsErr != nil {
		return nil, s.listDesignRevisionItemsErr
	}
	if r, ok := s.designRevisionsByID[revisionID]; ok {
		return r.Items, nil
	}
	return nil, nil
}

func (s *stubStore) GetDesignWorkingCopy(_ context.Context, designID string) (*domain.DesignWorkingCopy, error) {
	if s.getDesignWorkingCopyErr != nil {
		return nil, s.getDesignWorkingCopyErr
	}
	if wc, ok := s.designWorkingCopiesByID[designID]; ok {
		c := wc
		return &c, nil
	}
	return &domain.DesignWorkingCopy{
		DesignID:   designID,
		ProjectID:  "proj-1",
		SourceType: domain.DesignRevisionSourceManual,
		Items:      []domain.DesignWorkingItem{},
		UpdatedAt:  time.Now(),
	}, nil
}

// #1137 — the surgical opening write: records the command and mutates the
// stubbed working copy's defaults so the readback observes the write.
func (s *stubStore) SetDesignWorkingCopyOpening(_ context.Context, cmd storage.SetDesignWorkingCopyOpeningCommand) (*domain.DesignAuthoringDefaults, error) {
	s.setOpeningCmd = &cmd
	if s.setOpeningErr != nil {
		return nil, s.setOpeningErr
	}
	wc, ok := s.designWorkingCopiesByID[cmd.DesignID]
	if !ok {
		wc = domain.DesignWorkingCopy{
			DesignID:   cmd.DesignID,
			ProjectID:  "proj-1",
			SourceType: domain.DesignRevisionSourceManual,
			Items:      []domain.DesignWorkingItem{},
			UpdatedAt:  time.Now(),
		}
	}
	defaults := wc.AuthoringDefaults.Normalize()
	defaults.Opening = cmd.Opening
	if err := domain.ValidateDesignAuthoringDefaults(defaults); err != nil {
		return nil, err
	}
	wc.AuthoringDefaults = defaults
	if s.designWorkingCopiesByID == nil {
		s.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{}
	}
	s.designWorkingCopiesByID[cmd.DesignID] = wc
	return &defaults, nil
}

func (s *stubStore) GetDesignCommercialProjection(_ context.Context, _, _ string) (*domain.CommercialProjection, error) {
	if s.commercialProjectionErr != nil {
		return nil, s.commercialProjectionErr
	}
	return s.commercialProjection, nil
}

func (s *stubStore) UpdateDesignWorkingCopy(_ context.Context, cmd storage.UpdateDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error) {
	s.updateDesignWorkingCopyCmd = &cmd
	if s.updateDesignWorkingCopyErr != nil {
		return nil, s.updateDesignWorkingCopyErr
	}
	if s.designWorkingCopiesByID == nil {
		s.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{}
	}
	wc := domain.DesignWorkingCopy{
		DesignID:       cmd.DesignID,
		ProjectID:      "proj-1",
		BaseRevisionID: cmd.BaseRevisionID,
		SourceType:     cmd.SourceType,
		UpdatedAt:      time.Now(),
	}
	for i, itm := range cmd.Items {
		itemTransform := itm.Transform
		wc.Items = append(wc.Items, domain.DesignWorkingItem{
			ID:                     "witem-" + string(rune('0'+i+1)),
			DesignID:               cmd.DesignID,
			FurnitureInstanceID:    itm.FurnitureInstanceID,
			FurnitureDefinitionID:  itm.FurnitureDefinitionID,
			DefinitionVersion:      itm.DefinitionVersion,
			Parameters:             itm.Parameters,
			MaterialChoices:        itm.MaterialChoices,
			Transform:              &itemTransform,
			RoomID:                 itm.RoomID,
			TechnicalClientLocator: itm.TechnicalClientLocator,
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
		})
	}
	s.designWorkingCopiesByID[cmd.DesignID] = wc
	return &wc, nil
}

func (s *stubStore) ResetDesignWorkingCopy(_ context.Context, cmd storage.ResetDesignWorkingCopyCommand) (*domain.DesignWorkingCopy, error) {
	s.resetDesignWorkingCopyCmd = &cmd
	if s.resetDesignWorkingCopyErr != nil {
		return nil, s.resetDesignWorkingCopyErr
	}
	if s.designWorkingCopiesByID == nil {
		s.designWorkingCopiesByID = map[string]domain.DesignWorkingCopy{}
	}
	baseRev := cmd.RevisionID
	wc := domain.DesignWorkingCopy{
		DesignID:       cmd.DesignID,
		ProjectID:      "proj-1",
		BaseRevisionID: &baseRev,
		SourceType:     domain.DesignRevisionSourceManual,
		UpdatedAt:      time.Now(),
	}
	s.designWorkingCopiesByID[cmd.DesignID] = wc
	return &wc, nil
}

func (s *stubStore) GetDesignWorkingCopyMaterialProvenance(_ context.Context, designID string) (*storage.DesignWorkingCopyMaterialProvenance, error) {
	if s.materialProvenanceErr != nil {
		return nil, s.materialProvenanceErr
	}
	if s.materialProvenance != nil {
		return s.materialProvenance, nil
	}
	return &storage.DesignWorkingCopyMaterialProvenance{
		DesignID:  designID,
		ProjectID: "proj-1",
		Items:     []storage.DesignWorkingItemMaterialProvenance{},
	}, nil
}

func (s *stubStore) GetDesignConsumedHardwareOptionGroups(_ context.Context, designID string) (*storage.DesignConsumedHardwareOptionGroups, error) {
	if s.hardwareOptionGroupsErr != nil {
		return nil, s.hardwareOptionGroupsErr
	}
	if s.hardwareOptionGroups != nil {
		return s.hardwareOptionGroups, nil
	}
	return &storage.DesignConsumedHardwareOptionGroups{
		DesignID:  designID,
		ProjectID: "proj-1",
		Scope:     "design",
		Groups:    []storage.ConsumedHardwareOptionGroup{},
	}, nil
}

func (s *stubStore) ReconcileDesignWorkingMaterials(_ context.Context, cmd storage.ReconcileDesignWorkingMaterialsCommand) (*storage.DesignWorkingMaterialsReconciliation, error) {
	s.reconcileMaterialsCmd = &cmd
	if s.reconcileMaterialsErr != nil {
		return nil, s.reconcileMaterialsErr
	}
	if s.reconcileMaterialsResult != nil {
		return s.reconcileMaterialsResult, nil
	}
	return &storage.DesignWorkingMaterialsReconciliation{
		DesignID:             cmd.DesignID,
		ProjectID:            "proj-1",
		FurnitureInstanceID:  cmd.FurnitureInstanceID,
		FilledChoices:        map[string]string{},
		PreservedChoices:     map[string]string{},
		WorkingCopyUpdatedAt: time.Now(),
	}, nil
}

// compile-time guard: stubStore must satisfy Store.
