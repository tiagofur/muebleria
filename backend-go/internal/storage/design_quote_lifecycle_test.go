package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type designQuoteFixture struct {
	*quoteLifecycleFixture
	designID      string
	instances     []string
	version       string
	fingerprint   string
	projectedSale float64
}

func setupDesignQuoteFixture(t *testing.T) *designQuoteFixture {
	t.Helper()
	fx := setupCommercialSnapshotFixture(t)
	multiOrgExec(t, fx.admin, `
		DELETE FROM project_item_choices WHERE project_item_id = '`+csLine+`';
		DELETE FROM project_items WHERE project_id = '`+csProject+`';
		UPDATE modules SET width_mm=800,height_mm=720,depth_mm=560 WHERE id='`+csModule+`';`)
	out := &designQuoteFixture{quoteLifecycleFixture: fx}
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		for range 2 {
			instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
				ProjectID: csProject, FurnitureDefinitionID: csModule,
				Origin: domain.FurnitureInstanceOriginDesign, ActorUserID: rlsUserA,
			})
			if err != nil {
				return err
			}
			out.instances = append(out.instances, instance.ID)
		}
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{ProjectID: csProject, Name: "Design first", ActorUserID: rlsUserA})
		if err != nil {
			return err
		}
		out.designID = design.ID
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID: design.ID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: out.instances[0], FurnitureDefinitionID: csModule, DefinitionVersion: intPtr(3), Parameters: map[string]any{}, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
				{FurnitureInstanceID: out.instances[1], FurnitureDefinitionID: csModule, DefinitionVersion: intPtr(4), Parameters: map[string]any{}, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			},
		})
		if err != nil {
			return err
		}
		projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, design.ID)
		if err != nil {
			return err
		}
		if projection.Amounts == nil || projection.Amounts.SaleTotal == nil {
			return errors.New("fixture projection is not priceable")
		}
		out.version, out.fingerprint = projection.WorkingVersion, projection.WorkingFingerprint
		out.projectedSale = *projection.Amounts.SaleTotal
		return nil
	})
	if err != nil {
		t.Fatalf("setup design-first quote: %v", err)
	}
	return out
}

func intPtr(v int) *int { return &v }

func createDesignQuote(ctx context.Context, fx *designQuoteFixture) (*storage.CreateInitialQuoteRevisionResult, error) {
	return fx.store.CreateInitialDesignQuoteRevision(ctx, storage.CreateInitialDesignQuoteRevisionCommand{
		ProjectID: csProject, DesignID: fx.designID,
		WorkingVersion: fx.version, WorkingFingerprint: fx.fingerprint,
		ActorUserID: rlsUserA, RequestID: "design-first-q1",
	})
}

func TestCreateInitialDesignQuoteRevision_PreservesExactWorkingIdentityAndConfiguration(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	var result *storage.CreateInitialQuoteRevisionResult
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		result, err = createDesignQuote(ctx, fx)
		return err
	})
	if err != nil {
		t.Fatalf("create design Q1: %v", err)
	}
	if result.Revision.RevisionNumber != 1 || result.Revision.CommercialSnapshot == nil {
		t.Fatalf("revision=%+v", result.Revision)
	}
	if result.Revision.CommercialSnapshot.Breakdown.SalePrice != fx.projectedSale {
		t.Fatalf("Q1 sale=%v projection=%v", result.Revision.CommercialSnapshot.Breakdown.SalePrice, fx.projectedSale)
	}
	if result.Revision.CommercialSnapshot.DesignSource == nil || result.Revision.CommercialSnapshot.DesignSource.DesignID != fx.designID ||
		result.Revision.CommercialSnapshot.DesignSource.WorkingVersion != fx.version || result.Revision.CommercialSnapshot.DesignSource.WorkingFingerprint != fx.fingerprint {
		t.Fatalf("source provenance=%+v", result.Revision.CommercialSnapshot.DesignSource)
	}
	details := listRevisions(t, fx.quoteLifecycleFixture)
	if len(details) != 1 || len(details[0].Items) != 2 {
		t.Fatalf("details=%+v", details)
	}
	got := map[string]domain.QuoteRevisionItem{}
	for _, item := range details[0].Items {
		got[item.FurnitureInstanceID] = item
	}
	for i, id := range fx.instances {
		item, ok := got[id]
		if !ok {
			t.Fatalf("original furniture identity %s missing", id)
		}
		if item.DefinitionVersion == nil || *item.DefinitionVersion != i+3 || len(item.Parameters) != 0 || item.MaterialChoices["INTERIOR"] == "" {
			t.Fatalf("frozen working item %s=%+v", id, item)
		}
	}
	var physical, lines, links int
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM furniture_instances WHERE project_id=$1`, csProject).Scan(&physical); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM project_items WHERE project_id=$1`, csProject).Scan(&lines); err != nil {
		t.Fatal(err)
	}
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM quote_line_furniture_instances WHERE project_id=$1 AND state='current'`, csProject).Scan(&links); err != nil {
		t.Fatal(err)
	}
	if physical != 2 || lines != 2 || links != 2 {
		t.Fatalf("physical/lines/links=%d/%d/%d", physical, lines, links)
	}
	frozen := readStoredSnapshotBytes(t, fx.quoteLifecycleFixture, result.Revision.ID)
	down, err := os.ReadFile("../../db/migration/000133_quote_design_working_source.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, err := os.ReadFile("../../db/migration/000133_quote_design_working_source.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = fx.admin.Exec(context.Background(), string(down)); err != nil {
		t.Fatalf("migration 133 down: %v", err)
	}
	if _, err = fx.admin.Exec(context.Background(), string(up)); err != nil {
		t.Fatalf("migration 133 upgrade: %v", err)
	}
	multiOrgExec(t, fx.admin, `UPDATE material_boards SET board_price=999 WHERE id='`+csMaterial+`';`)
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{DesignID: fx.designID, ActorUserID: rlsUserA, Items: []storage.UpdateDesignWorkingCopyItemCommand{
			{FurnitureInstanceID: fx.instances[0], FurnitureDefinitionID: csModule, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			{FurnitureInstanceID: fx.instances[1], FurnitureDefinitionID: csModule, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
		}})
		return err
	})
	if err != nil {
		t.Fatalf("change design after Q1: %v", err)
	}
	if got := readStoredSnapshotBytes(t, fx.quoteLifecycleFixture, result.Revision.ID); got != frozen {
		t.Fatal("later catalog/design changes mutated Q1")
	}
	invalid := mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
		payload["designSource"] = map[string]any{"designId": fx.designID, "workingVersion": fx.version, "workingFingerprint": "bad"}
	})
	if _, err := fx.admin.Exec(context.Background(), `INSERT INTO quote_revisions (organization_id,project_id,revision_number,status,commercial_snapshot) VALUES ($1,$2,2,'draft',$3::jsonb)`, rlsOrgA, csProject, invalid); err == nil || !strings.Contains(err.Error(), "quote_revisions_design_working_source_valid") {
		t.Fatalf("direct SQL malformed provenance accepted: %v", err)
	}
}

func TestCreateInitialDesignQuoteRevision_StaleAndCrossTenantLeaveNoCommercialWrites(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	fx.fingerprint = "sha256-" + strings.Repeat("0", 64)
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error { _, err := createDesignQuote(ctx, fx); return err })
	if !errors.Is(err, domain.ErrDesignRevisionConflict) {
		t.Fatalf("stale err=%v", err)
	}
	multiOrgExec(t, fx.admin, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership; UPDATE projects SET manufacturing_organization_id='`+rlsOrgB+`' WHERE id='`+csProject+`'; ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error { _, err := createDesignQuote(ctx, fx); return err })
	if !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("manufacturing-only err=%v", err)
	}
	err = fiTx(t, fx.store, storage.TenantActor{OrganizationID: rlsOrgC, UserID: rlsUserA}, func(ctx context.Context) error { _, err := createDesignQuote(ctx, fx); return err })
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("cross-tenant err=%v", err)
	}
	var revisions, lines int
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM quote_revisions WHERE project_id=$1`, csProject).Scan(&revisions)
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM project_items WHERE project_id=$1`, csProject).Scan(&lines)
	if revisions != 0 || lines != 0 {
		t.Fatalf("rollback revisions/lines=%d/%d", revisions, lines)
	}
}

func TestCreateInitialDesignQuoteRevision_AdoptsOnlyExactCanonicalLine(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	lineID := "62000000-0000-0000-0000-0000000000d1"
	multiOrgExec(t, fx.admin, `INSERT INTO project_items (id,project_id,module_id,quantity,organization_id) VALUES ('`+lineID+`','`+csProject+`','`+csModule+`',1,'`+rlsOrgA+`'); INSERT INTO project_item_choices (project_item_id,option_group_code,choice_entity_id,organization_id) VALUES ('`+lineID+`','INTERIOR','`+csMaterial+`','`+rlsOrgA+`'); INSERT INTO quote_line_furniture_instances (organization_id,project_id,quote_line_id,furniture_instance_id) VALUES ('`+rlsOrgA+`','`+csProject+`','`+lineID+`','`+fx.instances[0]+`');`)
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error { _, err := createDesignQuote(ctx, fx); return err })
	if err != nil {
		t.Fatalf("adopt exact line: %v", err)
	}
	var lineCount, adopted int
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM project_items WHERE project_id=$1`, csProject).Scan(&lineCount)
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM quote_line_furniture_instances WHERE quote_line_id=$1 AND furniture_instance_id=$2`, lineID, fx.instances[0]).Scan(&adopted)
	if lineCount != 2 || adopted != 1 {
		t.Fatalf("line count/adopted=%d/%d", lineCount, adopted)
	}
}

func TestCreateInitialDesignQuoteRevision_ConcurrentCreatesAtMostQ1(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error { _, err := createDesignQuote(ctx, fx); return err })
		}()
	}
	wg.Wait()
	close(errs)
	var success, conflict int
	for err := range errs {
		if err == nil {
			success++
		} else if errors.Is(err, domain.ErrQuoteRevisionConflict) {
			conflict++
		} else {
			t.Fatalf("unexpected err=%v", err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success/conflict=%d/%d", success, conflict)
	}
	var count int
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM quote_revisions WHERE project_id=$1`, csProject).Scan(&count)
	if count != 1 {
		t.Fatalf("revisions=%d want 1", count)
	}
}

func TestCreateInitialDesignQuoteRevision_RejectsTerminalStatusCommittedWhileWaitingForLock(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	lock, err := fx.admin.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(context.Background())
	var status string
	if err = lock.QueryRow(context.Background(), `SELECT status FROM projects WHERE id=$1 FOR UPDATE`, csProject).Scan(&status); err != nil || status != "draft" {
		t.Fatalf("lock project status=%q err=%v", status, err)
	}
	const applicationName = "design-q1-status-race"
	tracingStore := newNamedRuntimeOrganizationStore(t, applicationName)
	result := make(chan error, 1)
	go func() {
		result <- fiTx(t, tracingStore, fiActorA(), func(ctx context.Context) error {
			_, err := tracingStore.CreateInitialDesignQuoteRevision(ctx, storage.CreateInitialDesignQuoteRevisionCommand{ProjectID: csProject, DesignID: fx.designID, WorkingVersion: fx.version, WorkingFingerprint: fx.fingerprint, ActorUserID: rlsUserA})
			return err
		})
	}()
	waitForOrganizationLockWait(t, fx.admin, applicationName)
	if _, err = lock.Exec(context.Background(), `UPDATE projects SET status='accepted' WHERE id=$1`, csProject); err != nil {
		t.Fatal(err)
	}
	if err = lock.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = awaitSectorRaceResult(t, result); !errors.Is(err, domain.ErrQuoteRevisionAccepted) {
		t.Fatalf("terminal transition err=%v", err)
	}
	var revisions, lines int
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*), (SELECT count(*) FROM project_items WHERE project_id=$1) FROM quote_revisions WHERE project_id=$1`, csProject).Scan(&revisions, &lines)
	if revisions != 0 || lines != 0 {
		t.Fatalf("terminal rollback revisions/lines=%d/%d", revisions, lines)
	}
}

func TestCreateInitialDesignQuoteRevision_RemoveWinsWhileQuoteWaitsForInstanceLock(t *testing.T) {
	fx := setupDesignQuoteFixture(t)
	locked, release, removed := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	releaseRemove := sync.OnceFunc(func() { close(release) })
	defer releaseRemove()
	go func() {
		removed <- fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			_, err := fx.store.RemoveFurnitureInstance(ctx, storage.RemoveFurnitureInstanceCommand{FurnitureInstanceID: fx.instances[0], ExpectedVersion: 1, ActorUserID: rlsUserA})
			if err == nil {
				close(locked)
				<-release
			}
			return err
		})
	}()
	select {
	case <-locked:
	case err := <-removed:
		t.Fatalf("remove before lock barrier: %v", err)
	}

	const applicationName = "design-q1-instance-race"
	quoteStore := newNamedRuntimeOrganizationStore(t, applicationName)
	quoted := make(chan error, 1)
	go func() {
		quoted <- fiTx(t, quoteStore, fiActorA(), func(ctx context.Context) error {
			_, err := quoteStore.CreateInitialDesignQuoteRevision(ctx, storage.CreateInitialDesignQuoteRevisionCommand{ProjectID: csProject, DesignID: fx.designID, WorkingVersion: fx.version, WorkingFingerprint: fx.fingerprint, ActorUserID: rlsUserA})
			return err
		})
	}()
	waitForOrganizationLockWait(t, fx.admin, applicationName)
	releaseRemove()
	if err := awaitSectorRaceResult(t, removed); err != nil {
		t.Fatalf("remove commit: %v", err)
	}
	if err := awaitSectorRaceResult(t, quoted); !errors.Is(err, domain.ErrFurnitureInstanceLifecycleConflict) {
		t.Fatalf("quote after remove err=%v", err)
	}
	var revisions, lines int
	_ = fx.admin.QueryRow(context.Background(), `SELECT count(*), (SELECT count(*) FROM project_items WHERE project_id=$1) FROM quote_revisions WHERE project_id=$1`, csProject).Scan(&revisions, &lines)
	if revisions != 0 || lines != 0 {
		t.Fatalf("remove-wins rollback revisions/lines=%d/%d", revisions, lines)
	}
}
