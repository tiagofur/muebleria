package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #500 / WEB-DT-1: GetProjectFurnitureWorkspace against real PostgreSQL under the app role.
func TestGetProjectFurnitureWorkspace_ProvenanceAndProjection(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	// Seed two QuoteLines with the SAME definition (fiModuleA).
	line1 := "51000000-0000-0000-0000-000000000001"
	line2 := "51000000-0000-0000-0000-000000000002"
	seedQuoteLines(t, fx, fiSharedProject, map[string]int{
		line1: 2,
		line2: 2,
	})

	// Materialize both lines (qty=2 each).
	var mat1, mat2 *domain.QuoteLineMaterialization
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		mat1, txErr = fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: line1,
			ActorUserID: rlsUserA,
			RequestID:   "ws-mat-1",
		})
		if txErr != nil {
			return txErr
		}
		mat2, txErr = fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: line2,
			ActorUserID: rlsUserA,
			RequestID:   "ws-mat-2",
		})
		return txErr
	}); err != nil {
		t.Fatalf("materialize lines: %v", err)
	}

	if len(mat1.Instances) != 2 || len(mat2.Instances) != 2 {
		t.Fatalf("expected 2 instances per line, got %d and %d", len(mat1.Instances), len(mat2.Instances))
	}

	// Create a 5th instance with origin=design (not in any quote line).
	var designInst *domain.FurnitureInstance
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		designInst, txErr = fx.store.CreateFurnitureInstance(txCtx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiSharedProject,
			FurnitureDefinitionID: fiModuleA,
			Origin:                domain.FurnitureInstanceOriginDesign,
			ActorUserID:           rlsUserA,
			RequestID:             "ws-inst-design",
		})
		return txErr
	}); err != nil {
		t.Fatalf("create design instance: %v", err)
	}

	// Create design and place 1 instance from line1, 1 from line2, and designInst in working copy.
	var design *domain.Design
	placedInst1 := mat1.Instances[0].FurnitureInstanceID
	placedInst2 := mat2.Instances[0].FurnitureInstanceID
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		design, txErr = fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Main Design",
			ActorUserID: rlsUserA,
			RequestID:   "ws-create-design",
		})
		if txErr != nil {
			return txErr
		}
		_, txErr = fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:    design.ID,
			ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: placedInst1},
				{FurnitureInstanceID: placedInst2},
				{FurnitureInstanceID: designInst.ID},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("create and update design: %v", err)
	}

	// Query workspace for working copy.
	var ws *domain.FurnitureWorkspace
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		ws, txErr = fx.store.GetProjectFurnitureWorkspace(txCtx, fiSharedProject, storage.FurnitureWorkspaceQuery{
			DesignID:          design.ID,
			DesignContextKind: "working",
		})
		return txErr
	}); err != nil {
		t.Fatalf("get furniture workspace: %v", err)
	}

	if len(ws.Units) != 5 {
		t.Fatalf("expected 5 units in workspace, got %d", len(ws.Units))
	}

	unitsByID := make(map[string]domain.FurnitureWorkspaceUnit)
	for _, u := range ws.Units {
		unitsByID[u.Instance.ID] = u
	}

	// Invariant 1: Line 1 instances have UnitTotal=2 and unitIndex 1, 2.
	u1a := unitsByID[mat1.Instances[0].FurnitureInstanceID]
	u1b := unitsByID[mat1.Instances[1].FurnitureInstanceID]
	if u1a.CommercialGrouping == nil || u1a.CommercialGrouping.QuoteLineID != line1 || u1a.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("line 1 inst 0 grouping invalid: %+v", u1a.CommercialGrouping)
	}
	if u1b.CommercialGrouping == nil || u1b.CommercialGrouping.QuoteLineID != line1 || u1b.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("line 1 inst 1 grouping invalid: %+v", u1b.CommercialGrouping)
	}

	// Invariant 2: Line 2 instances have UnitTotal=2 and unitIndex 1, 2 (never merged with Line 1).
	u2a := unitsByID[mat2.Instances[0].FurnitureInstanceID]
	u2b := unitsByID[mat2.Instances[1].FurnitureInstanceID]
	if u2a.CommercialGrouping == nil || u2a.CommercialGrouping.QuoteLineID != line2 || u2a.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("line 2 inst 0 grouping invalid: %+v", u2a.CommercialGrouping)
	}
	if u2b.CommercialGrouping == nil || u2b.CommercialGrouping.QuoteLineID != line2 || u2b.CommercialGrouping.UnitTotal != 2 {
		t.Fatalf("line 2 inst 1 grouping invalid: %+v", u2b.CommercialGrouping)
	}

	// Invariant 3: Design-origin unit has NO commercial grouping.
	uD := unitsByID[designInst.ID]
	if uD.CommercialGrouping != nil {
		t.Fatalf("design unit must not have commercialGrouping, got %+v", uD.CommercialGrouping)
	}

	// Invariant 4: Placed vs Pending server projection.
	if u1a.Design.Presence != "placed" {
		t.Errorf("u1a expected placed, got %s", u1a.Design.Presence)
	}
	if u1b.Design.Presence != "pending" {
		t.Errorf("u1b expected pending, got %s", u1b.Design.Presence)
	}
	if u1b.ActionRequired == nil || u1b.ActionRequired.Code != "pending_placement" {
		t.Errorf("u1b expected actionRequired pending_placement, got %+v", u1b.ActionRequired)
	}
	if u2a.Design.Presence != "placed" {
		t.Errorf("u2a expected placed, got %s", u2a.Design.Presence)
	}
	if u2b.Design.Presence != "pending" {
		t.Errorf("u2b expected pending, got %s", u2b.Design.Presence)
	}
	if uD.Design.Presence != "placed" {
		t.Errorf("uD expected placed, got %s", uD.Design.Presence)
	}

	// Invariant 5: Working copy must NEVER have a contextual release.
	if ws.Release != nil {
		t.Errorf("working copy must not have contextual release, got %+v", ws.Release)
	}
}

func TestGetProjectFurnitureWorkspace_CrossTenantAndNotFound(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	actorC := storage.TenantActor{OrganizationID: rlsOrgC, UserID: rlsUserA}

	// Unrelated org C cannot view Org A's project workspace -> uniform ErrDesignNotFound (404 upstream).
	if err := fiTx(t, fx.store, actorC, func(txCtx context.Context) error {
		_, err := fx.store.GetProjectFurnitureWorkspace(txCtx, fiSharedProject, storage.FurnitureWorkspaceQuery{})
		return err
	}); !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("unrelated org C expected ErrDesignNotFound, got %v", err)
	}

	// Unknown project -> uniform ErrDesignNotFound.
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		_, err := fx.store.GetProjectFurnitureWorkspace(txCtx, "42000000-0000-0000-0000-00000000dead", storage.FurnitureWorkspaceQuery{})
		return err
	}); !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("unknown project expected ErrDesignNotFound, got %v", err)
	}
}

func TestGetProjectFurnitureWorkspace_HistoricalQuoteRevisionNoGrouping(t *testing.T) {
	fx := setupDesignsTestFixture(t)

	lineID := "51000000-0000-0000-0000-000000000099"
	seedQuoteLines(t, fx, fiSharedProject, map[string]int{
		lineID: 1,
	})

	var mat *domain.QuoteLineMaterialization
	var qRev *domain.QuoteRevision
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		mat, txErr = fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
			RequestID:   "ws-hist-mat",
		})
		if txErr != nil {
			return txErr
		}
		instID := mat.Instances[0].FurnitureInstanceID

		qRev, txErr = fx.store.CreateQuoteRevision(txCtx, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			CreatedBy: rlsUserA,
			Items: []storage.CreateQuoteRevisionItemCommand{
				{
					FurnitureInstanceID:   instID,
					FurnitureDefinitionID: fiModuleA,
					LifecycleStatus:       "active",
				},
			},
		})
		return txErr
	}); err != nil {
		t.Fatalf("setup line and quote revision: %v", err)
	}

	// Case 1: Live commercial state (QuoteRevisionID == "") -> loads grouping from quote_line_furniture_instances.
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		wsLive, err := fx.store.GetProjectFurnitureWorkspace(txCtx, fiSharedProject, storage.FurnitureWorkspaceQuery{})
		if err != nil {
			return err
		}
		if len(wsLive.Units) != 1 {
			t.Fatalf("expected 1 unit in live workspace, got %d", len(wsLive.Units))
		}
		if wsLive.Units[0].CommercialGrouping == nil {
			t.Fatalf("live workspace must load commercial grouping from current quote lines")
		}
		return nil
	}); err != nil {
		t.Fatalf("live workspace query: %v", err)
	}

	// Case 2: Historical QuoteRevision selected -> must NOT fabricate grouping from current links.
	if err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		wsHist, err := fx.store.GetProjectFurnitureWorkspace(txCtx, fiSharedProject, storage.FurnitureWorkspaceQuery{
			QuoteRevisionID: qRev.ID,
		})
		if err != nil {
			return err
		}
		if len(wsHist.Units) != 1 {
			t.Fatalf("expected 1 unit in historical workspace, got %d", len(wsHist.Units))
		}
		if wsHist.Units[0].CommercialGrouping != nil {
			t.Fatalf("historical quote revision must NOT fabricate grouping, got %+v", wsHist.Units[0].CommercialGrouping)
		}
		return nil
	}); err != nil {
		t.Fatalf("historical workspace query: %v", err)
	}
}
