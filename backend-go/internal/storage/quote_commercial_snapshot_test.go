package storage_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #642 / QUOTE-AUTH Slice 1: the immutable commercial snapshot authority
// against real PostgreSQL under the app role (digital-thread §16A).
//
// Proofs required by the issue:
//  1. Q1 commercial snapshot created.
//  2. Exact line values/totals persisted (deterministic fixture).
//  3. publish/accept freezes them (real lifecycle timestamps).
//  4. Mutating the Project afterwards.
//  5. Renaming module/material afterwards.
//  6. Changing current pricing/settings afterwards.
//  7. Q1 snapshot remains identical (stored bytes included).
//  8. Q2 (requote) with different values.
//  9. Q1 and Q2 independently reproducible.
//  10. Cross-tenant denied.
//  11. Missing required snapshot fails closed (command + DB trigger).
//  12. Accepted revision immutable (snapshot/timestamps).
//  13. Retry/idempotency behavior.
//  14. Concurrent lifecycle commands do not double-publish/accept/audit.

const (
	csProject   = "42000000-0000-0000-0000-0000000000c1" // org A only, customer A
	csModule    = "52000000-0000-0000-0000-0000000000c1"
	csMaterial  = "92000000-0000-0000-0000-0000000000c1" // 1000x1000 sheet, $200 → $200/m²
	csMaterial2 = "92000000-0000-0000-0000-0000000000c2" // 1000x1000 sheet, $400 → $400/m²
	csLine      = "62000000-0000-0000-0000-0000000000c1" // quantity 2
	csCustomerA = "30000000-0000-0000-0000-00000000000a"
)

// setupCommercialSnapshotFixture builds a deterministic priceable project:
// one plain module with ONE 800x600 board part (0.48 m², no edges, no
// hardware), base labor 50, priced through an explicit INTERIOR material
// choice. Project levers: margin 1.5, fixed labor 100, MXN.
//
// Expected Q1 (2 units): materials 2*0.48*200 = 192; direct 192;
// laborModular 2*50 = 100; sale 192*1.5 + 100 + 100 = 488.
func setupCommercialSnapshotFixture(t *testing.T) *quoteLifecycleFixture {
	t.Helper()
	fx := setupDesignsTestFixture(t)

	multiOrgExec(t, fx.admin, `
		INSERT INTO projects (id, name, customer_id, status, currency, margin_factor, labor_fixed_cost, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('`+csProject+`', 'Obra Comercial CS', '`+csCustomerA+`', 'draft', 'MXN', 1.5, 100, '`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`');
		INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price, waste_percent, organization_id)
		VALUES
		 ('`+csMaterial+`', 'CS-MAT', 'Tablero Roble', 1000, 1000, 18, 200, 0, '`+rlsOrgA+`'),
		 ('`+csMaterial2+`', 'CS-MAT-2', 'Tablero Nogal', 1000, 1000, 18, 400, 0, '`+rlsOrgA+`');
		INSERT INTO option_groups (id, code, name, kind, required, organization_id)
		VALUES ('93000000-0000-0000-0000-0000000000c1', 'INTERIOR', 'Acabado interior', 'board', TRUE, '`+rlsOrgA+`');
		INSERT INTO option_group_members (option_group_id, entity_id, organization_id)
		VALUES ('93000000-0000-0000-0000-0000000000c1', '`+csMaterial+`', '`+rlsOrgA+`'),
		 ('93000000-0000-0000-0000-0000000000c1', '`+csMaterial2+`', '`+rlsOrgA+`');
		INSERT INTO modules (id, code, name, base_labor_cost, organization_id)
		VALUES ('`+csModule+`', 'CS-MOD', 'Gabinete CS', 50, '`+rlsOrgA+`');
		INSERT INTO board_parts (id, module_id, code, description, quantity, length_mm, width_mm, option_role, organization_id)
		VALUES ('53000000-0000-0000-0000-0000000000c1', '`+csModule+`', 'P1', 'Panel', 1, 800, 600, 'INTERIOR', '`+rlsOrgA+`');
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ('`+csLine+`', '`+csProject+`', '`+csModule+`', 2, '`+rlsOrgA+`');
		INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
		VALUES ('`+csLine+`', 'INTERIOR', '`+csMaterial+`', '`+rlsOrgA+`');`)

	return &quoteLifecycleFixture{rlsFixture: fx, projectID: csProject}
}

func readStoredSnapshotBytes(t *testing.T, fx *quoteLifecycleFixture, revisionID string) string {
	t.Helper()
	var payload []byte
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT commercial_snapshot::text FROM quote_revisions WHERE id = $1`, revisionID,
	).Scan(&payload); err != nil {
		t.Fatalf("read stored snapshot: %v", err)
	}
	return string(payload)
}

func requireSnapshotFrozen(t *testing.T, fx *quoteLifecycleFixture, revisionID, wantBytes string, want *domain.QuoteCommercialSnapshot) {
	t.Helper()
	if got := readStoredSnapshotBytes(t, fx, revisionID); got != wantBytes {
		t.Fatalf("stored commercial snapshot mutated:\nwant %s\ngot  %s", wantBytes, got)
	}
	details := listRevisions(t, fx)
	for _, d := range details {
		if d.ID != revisionID {
			continue
		}
		if d.CommercialSnapshot == nil {
			t.Fatalf("revision %s lost its commercial snapshot in the read model", revisionID)
		}
		if d.CommercialSnapshot.Breakdown.SalePrice != want.Breakdown.SalePrice ||
			d.CommercialSnapshot.Breakdown.MaterialsCost != want.Breakdown.MaterialsCost ||
			d.CommercialSnapshot.Currency != want.Currency ||
			d.CommercialSnapshot.Customer.Name != want.Customer.Name ||
			d.CommercialSnapshot.Project.Name != want.Project.Name ||
			len(d.CommercialSnapshot.Units) != len(want.Units) {
			t.Fatalf("read model snapshot diverged from frozen truth:\nwant %+v\ngot  %+v", want, d.CommercialSnapshot)
		}
		for i, unit := range d.CommercialSnapshot.Units {
			if unit.ModuleName != want.Units[i].ModuleName || unit.ModuleCode != want.Units[i].ModuleCode {
				t.Fatalf("unit %d descriptors diverged: want %q/%q got %q/%q", i, want.Units[i].ModuleCode, want.Units[i].ModuleName, unit.ModuleCode, unit.ModuleName)
			}
			if len(unit.Options) != len(want.Units[i].Options) {
				t.Fatalf("unit %d option count diverged: want %d got %d", i, len(want.Units[i].Options), len(unit.Options))
			}
			for j, option := range unit.Options {
				if option.GroupLabel != want.Units[i].Options[j].GroupLabel ||
					option.ChoiceID != want.Units[i].Options[j].ChoiceID ||
					option.ChoiceLabel != want.Units[i].Options[j].ChoiceLabel {
					t.Fatalf("unit %d option %d diverged: want %+v got %+v", i, j, want.Units[i].Options[j], option)
				}
			}
		}
		return
	}
	t.Fatalf("revision %s missing from list", revisionID)
}

// Proofs 1–2: Q1 freezes the exact authoritative amounts and customer-facing
// descriptors computed once from the editable commercial state.
func TestQuoteCommercialSnapshot_Q1_FreezesExactValues(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	result := createInitialRevision(t, fx)

	details := listRevisions(t, fx)
	if len(details) != 1 {
		t.Fatalf("expected exactly Q1, got %d revisions", len(details))
	}
	snapshot := details[0].CommercialSnapshot
	if snapshot == nil {
		t.Fatal("Q1 has no commercial snapshot")
	}
	if snapshot.Schema != domain.QuoteCommercialSnapshotSchema {
		t.Fatalf("schema = %q, want %q", snapshot.Schema, domain.QuoteCommercialSnapshotSchema)
	}
	if snapshot.Currency != "MXN" {
		t.Fatalf("currency = %q, want MXN", snapshot.Currency)
	}
	if snapshot.Customer.ID != csCustomerA || snapshot.Customer.Name != "Customer A" {
		t.Fatalf("customer identity = %+v", snapshot.Customer)
	}
	if snapshot.Project.ID != csProject || snapshot.Project.Name != "Obra Comercial CS" {
		t.Fatalf("project identity = %+v", snapshot.Project)
	}
	if snapshot.Breakdown.MaterialsCost != 192 || snapshot.Breakdown.EdgeTotal != 0 || snapshot.Breakdown.HardwareTotal != 0 {
		t.Fatalf("breakdown materials/edge/hardware = %+v, want 192/0/0", snapshot.Breakdown)
	}
	if snapshot.Breakdown.DirectCost != 192 || snapshot.Breakdown.LaborModular != 100 || snapshot.Breakdown.LaborFixedCost != 100 {
		t.Fatalf("breakdown direct/labor = %+v, want 192/100/100", snapshot.Breakdown)
	}
	if snapshot.Breakdown.MarginFactor != 1.5 || snapshot.Breakdown.SalePrice != 488 {
		t.Fatalf("breakdown margin/sale = %+v, want 1.5/488", snapshot.Breakdown)
	}
	if len(snapshot.Units) != 2 {
		t.Fatalf("expected 2 frozen unit descriptors, got %d", len(snapshot.Units))
	}
	for _, unit := range snapshot.Units {
		if unit.ModuleCode != "CS-MOD" || unit.ModuleName != "Gabinete CS" {
			t.Fatalf("unit descriptor = %q/%q, want CS-MOD/Gabinete CS", unit.ModuleCode, unit.ModuleName)
		}
		if len(unit.Options) != 1 {
			t.Fatalf("unit options = %+v, want exactly the INTERIOR choice", unit.Options)
		}
		if unit.Options[0].GroupCode != "INTERIOR" || unit.Options[0].GroupLabel != "Acabado interior" {
			t.Fatalf("option group descriptor = %+v", unit.Options[0])
		}
		if unit.Options[0].ChoiceID != csMaterial || unit.Options[0].ChoiceLabel != "Tablero Roble" {
			t.Fatalf("option choice descriptor = %+v", unit.Options[0])
		}
	}
	if result.Revision.PublishedAt != nil || result.Revision.AcceptedAt != nil {
		t.Fatal("a draft must not carry lifecycle timestamps")
	}
}

// Proofs 3–7: publish/accept freeze everything; project, catalog and pricing
// mutations afterwards never rewrite Q1's frozen commercial meaning.
func TestQuoteCommercialSnapshot_MutationsNeverRewriteHistory(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	result := createInitialRevision(t, fx)
	q1 := result.Revision

	published := publishRevision(t, fx, q1.ID)
	if published.PublishedAt == nil || published.AcceptedAt != nil {
		t.Fatalf("publish must set publishedAt exactly: %+v", published)
	}
	accepted := acceptRevision(t, fx, q1.ID)
	if accepted.Revision.AcceptedAt == nil {
		t.Fatal("accept must set acceptedAt")
	}
	if accepted.Revision.PublishedAt == nil || !accepted.Revision.PublishedAt.Equal(*published.PublishedAt) {
		t.Fatal("accept must not rewrite publishedAt")
	}

	frozenBytes := readStoredSnapshotBytes(t, fx, q1.ID)
	want := listRevisions(t, fx)[0].CommercialSnapshot

	// Mutate the mutable commercial world: project identity/levers/status…
	multiOrgExec(t, fx.admin, `
		UPDATE projects SET name='Obra Renombrada', currency='USD', margin_factor=3.0, labor_fixed_cost=999, status='accepted'
		WHERE id = '`+csProject+`';
		UPDATE customers SET name='Cliente Renombrado' WHERE id = '`+csCustomerA+`';`)

	// …catalog descriptors and current pricing…
	multiOrgExec(t, fx.admin, `
		UPDATE modules SET name='Gabinete Renombrado', base_labor_cost=999 WHERE id = '`+csModule+`';
		UPDATE material_boards SET name='Tablero Caro', board_price=9999, waste_percent=50 WHERE id = '`+csMaterial+`';
		UPDATE option_groups SET name='Acabado premium' WHERE code = 'INTERIOR' AND organization_id = '`+rlsOrgA+`';`)

	requireSnapshotFrozen(t, fx, q1.ID, frozenBytes, want)
}

// Proofs 8–9: Q2 (requote) freezes different values; Q1 and Q2 stay
// independently reproducible side by side.
func TestQuoteCommercialSnapshot_Q2Requote_IndependentTruth(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	q1 := createInitialRevision(t, fx).Revision
	publishRevision(t, fx, q1.ID)
	acceptRevision(t, fx, q1.ID)
	q1Bytes := readStoredSnapshotBytes(t, fx, q1.ID)
	q1Want := listRevisions(t, fx)[0].CommercialSnapshot

	// Design truth: unit 1 synced, unit 2 switched to the more expensive
	// material — a commercial change justifying Q2.
	var q2 *domain.QuoteRevision
	var units []string
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   csProject,
			Name:        "Diseño CS",
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		unitRows, err := fx.store.ListQuoteLineFurnitureInstances(ctx, csProject, csLine)
		if err != nil {
			return err
		}
		for _, unit := range unitRows {
			units = append(units, unit.FurnitureInstanceID)
		}
		if len(units) != 2 {
			return errors.New("expected 2 materialized units")
		}
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   design.ID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: units[0], FurnitureDefinitionID: csModule, MaterialChoices: map[string]string{"INTERIOR": csMaterial}},
				{FurnitureInstanceID: units[1], FurnitureDefinitionID: csModule, MaterialChoices: map[string]string{"INTERIOR": csMaterial2}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		published, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    design.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		requote, err := fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID:           csProject,
			BaseQuoteRevisionID: q1.ID,
			DesignRevisionID:    published.ID,
			ActorUserID:         rlsUserA,
		})
		if err != nil {
			return err
		}
		q2 = requote.Revision
		return nil
	})
	if err != nil {
		t.Fatalf("requote Q2: %v", err)
	}
	if q2.RevisionNumber != 2 || q2.Status != "draft" || q2.SourceType != "requote" {
		t.Fatalf("Q2 = {number:%d status:%s source:%s}", q2.RevisionNumber, q2.Status, q2.SourceType)
	}

	details := listRevisions(t, fx)
	if len(details) != 2 {
		t.Fatalf("expected Q1+Q2, got %d revisions", len(details))
	}
	q2Snapshot := details[1].CommercialSnapshot
	if q2Snapshot == nil {
		t.Fatal("Q2 (requote) has no commercial snapshot")
	}
	// unit1: 0.48*200 = 96; unit2: 0.48*400 = 192 → materials 288, sale 288*1.5+100+100 = 632.
	if q2Snapshot.Breakdown.MaterialsCost != 288 || q2Snapshot.Breakdown.SalePrice != 632 {
		t.Fatalf("Q2 breakdown = %+v, want materials 288 / sale 632", q2Snapshot.Breakdown)
	}
	if q2Snapshot.Breakdown.SalePrice == q1Want.Breakdown.SalePrice {
		t.Fatal("Q2 must freeze different commercial values than Q1")
	}
	unitLabels := map[string]string{}
	for _, unit := range q2Snapshot.Units {
		unitLabels[unit.FurnitureInstanceID] = unit.Options[0].ChoiceLabel
	}
	if unitLabels[units[0]] != "Tablero Roble" || unitLabels[units[1]] != "Tablero Nogal" {
		t.Fatalf("Q2 per-unit frozen choices = %v", unitLabels)
	}

	// Both revisions stay independently reproducible after further mutation.
	multiOrgExec(t, fx.admin, `UPDATE material_boards SET name='Otro Nombre', board_price=1 WHERE id = '`+csMaterial+`';`)
	requireSnapshotFrozen(t, fx, q1.ID, q1Bytes, q1Want)
	q2Bytes := readStoredSnapshotBytes(t, fx, q2.ID)
	q2Want := func() *domain.QuoteCommercialSnapshot {
		details := listRevisions(t, fx)
		return details[1].CommercialSnapshot
	}()
	requireSnapshotFrozen(t, fx, q2.ID, q2Bytes, q2Want)
}

// Proof 10: commercial truth stays tenant-isolated (API read + direct SQL).
func TestQuoteCommercialSnapshot_CrossTenantDenied(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	q1 := createInitialRevision(t, fx).Revision
	publishRevision(t, fx, q1.ID)

	err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.ListQuoteRevisionsByProject(ctx, csProject)
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("org B list must answer the uniform 404, got %v", err)
	}
	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       csProject,
			QuoteRevisionID: q1.ID,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionNotFound) {
		t.Fatalf("org B publish must answer the uniform 404, got %v", err)
	}

	// Direct SQL under the app role with org B tenant context: the RLS
	// read policy must hide org A's private project revisions.
	ctx := context.Background()
	tx, err := fx.app.Begin(ctx)
	if err != nil {
		t.Fatalf("begin app-role tx: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true)`,
		rlsOrgB, rlsUserB); err != nil {
		t.Fatalf("set org B tenant context: %v", err)
	}
	var visible int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM quote_revisions WHERE id = $1`, q1.ID).Scan(&visible); err != nil {
		t.Fatalf("direct sql under org B: %v", err)
	}
	if visible != 0 {
		t.Fatalf("org B must not see org A revisions via direct SQL, saw %d", visible)
	}
}

// Proof 11: a legacy revision without the required snapshot fails closed —
// at the command level AND at the DB trigger backstop. Never recalculated.
func TestQuoteCommercialSnapshot_MissingFailsClosed(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)

	// Legacy-style draft (pre-#642 row shape: no commercial snapshot).
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		VALUES ('54000000-0000-0000-0000-0000000000c1', '`+rlsOrgA+`', '`+csProject+`', 'manual', 'active')`); err != nil {
		t.Fatalf("seed legacy furniture instance: %v", err)
	}
	var legacy *domain.QuoteRevision
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		legacy, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: csProject,
			Status:    "draft",
			Items: []storage.CreateQuoteRevisionItemCommand{
				{FurnitureInstanceID: "54000000-0000-0000-0000-0000000000c1", FurnitureDefinitionID: csModule, LifecycleStatus: "active"},
			},
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed legacy draft: %v", err)
	}

	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       csProject,
			QuoteRevisionID: legacy.ID,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteCommercialSnapshotMissing) {
		t.Fatalf("publishing a snapshot-less draft must fail closed, got %v", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: legacy.ID,
			Status:          "published",
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteCommercialSnapshotMissing) {
		t.Fatalf("direct transition owner must fail closed too, got %v", err)
	}

	// DB backstop: even a privileged UPDATE bypassing the command is rejected.
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE quote_revisions SET status='published' WHERE id = $1`, legacy.ID); err == nil {
		t.Fatal("direct SQL publish of snapshot-less draft succeeded, want trigger rejection")
	}
	var status string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT status FROM quote_revisions WHERE id = $1`, legacy.ID).Scan(&status); err != nil || status != "draft" {
		t.Fatalf("legacy draft must remain draft, got %q (err %v)", status, err)
	}
}

// Proof 12: the frozen snapshot and lifecycle timestamps are immutable at the
// database level — commercial change means a NEW revision, never a mutation.
func TestQuoteCommercialSnapshot_AcceptedImmutableAtDatabase(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	q1 := createInitialRevision(t, fx).Revision
	publishRevision(t, fx, q1.ID)
	acceptRevision(t, fx, q1.ID)
	ctx := context.Background()

	attempts := []string{
		`UPDATE quote_revisions SET commercial_snapshot = '{"schema":"granete.quote-commercial-snapshot.v1"}'::jsonb WHERE id = $1`,
		`UPDATE quote_revisions SET commercial_snapshot = NULL WHERE id = $1`,
		`UPDATE quote_revisions SET published_at = NOW() WHERE id = $1`,
		`UPDATE quote_revisions SET accepted_at = NOW() WHERE id = $1`,
		`UPDATE quote_revisions SET accepted_at = NULL WHERE id = $1`,
	}
	for _, statement := range attempts {
		if _, err := fx.admin.Exec(ctx, statement, q1.ID); err == nil || !strings.Contains(err.Error(), "quote_revision") {
			t.Fatalf("mutation must be rejected by the trigger: %s → %v", statement, err)
		}
	}

	// Accepted → superseded is the ONLY remaining transition and preserves the
	// frozen commercial truth and timestamps verbatim.
	before := readStoredSnapshotBytes(t, fx, q1.ID)
	var publishedAt, acceptedAt time.Time
	if err := fx.admin.QueryRow(ctx,
		`SELECT commercial_snapshot::text, published_at, accepted_at FROM quote_revisions WHERE id = $1`, q1.ID,
	).Scan(&before, &publishedAt, &acceptedAt); err != nil {
		t.Fatalf("read frozen row: %v", err)
	}
	if _, err := fx.admin.Exec(ctx,
		`UPDATE quote_revisions SET status='superseded' WHERE id = $1`, q1.ID); err != nil {
		t.Fatalf("accepted → superseded must stay legitimate: %v", err)
	}
	var afterStatus string
	var afterPublished, afterAccepted *time.Time
	var after []byte
	if err := fx.admin.QueryRow(ctx,
		`SELECT status, published_at, accepted_at, commercial_snapshot::text FROM quote_revisions WHERE id = $1`, q1.ID,
	).Scan(&afterStatus, &afterPublished, &afterAccepted, &after); err != nil {
		t.Fatalf("read superseded row: %v", err)
	}
	if afterStatus != "superseded" || afterPublished == nil || !afterPublished.Equal(publishedAt) ||
		afterAccepted == nil || !afterAccepted.Equal(acceptedAt) || string(after) != before {
		t.Fatal("superseding must preserve the frozen commercial truth and lifecycle timestamps")
	}
}

// Proof 13: a retry of the initial command never mints a second revision nor
// disturbs the frozen snapshot.
func TestQuoteCommercialSnapshot_RetryDoesNotDuplicate(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	result := createInitialRevision(t, fx)
	before := readStoredSnapshotBytes(t, fx, result.Revision.ID)

	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:   csProject,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("retry must fail typed as conflict, got %v", err)
	}
	var count int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM quote_revisions WHERE project_id = $1`, csProject).Scan(&count); err != nil || count != 1 {
		t.Fatalf("retry left %d revisions (err %v), want 1", count, err)
	}
	if after := readStoredSnapshotBytes(t, fx, result.Revision.ID); after != before {
		t.Fatal("retry mutated the frozen snapshot")
	}
}

// Proof 14: concurrent publish/accept on the exact revision serialize — one
// winner, one typed rejection, exactly one audit event each, and acceptance
// superseding keeps the superseded timestamps.
func TestQuoteCommercialSnapshot_ConcurrentLifecycleSingleAudit(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	q1 := createInitialRevision(t, fx).Revision

	publish := func() error {
		return fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			_, err := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
				ProjectID:       csProject,
				QuoteRevisionID: q1.ID,
			})
			return err
		})
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			errs[slot] = publish()
		}(i)
	}
	wg.Wait()
	winners := 0
	for _, err := range errs {
		switch {
		case err == nil:
			winners++
		case errors.Is(err, domain.ErrQuoteRevisionInvalidTransition):
		default:
			t.Fatalf("concurrent publish produced unexpected verdict: %v", err)
		}
	}
	if winners != 1 {
		t.Fatalf("concurrent publish winners = %d, want exactly 1", winners)
	}
	if count := countAuditEvents(t, fx, "quote_revision_published", q1.ID); count != 1 {
		t.Fatalf("quote_revision_published audit events = %d, want 1", count)
	}

	accept := func() error {
		return fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			_, err := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
				ProjectID:       csProject,
				QuoteRevisionID: q1.ID,
			})
			return err
		})
	}
	errs = make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			errs[slot] = accept()
		}(i)
	}
	wg.Wait()
	winners = 0
	for _, err := range errs {
		switch {
		case err == nil:
			winners++
		case errors.Is(err, domain.ErrQuoteRevisionInvalidTransition):
		default:
			t.Fatalf("concurrent accept produced unexpected verdict: %v", err)
		}
	}
	if winners != 1 {
		t.Fatalf("concurrent accept winners = %d, want exactly 1", winners)
	}
	if count := countAuditEvents(t, fx, "quote_revision_accepted", q1.ID); count != 1 {
		t.Fatalf("quote_revision_accepted audit events = %d, want 1", count)
	}
}

// Corrupt stored history is rejected fail-closed — never partially loaded or
// guessed. (Seeded by raw INSERT: the immutability trigger only guards
// UPDATE/DELETE, and injection at insert time is the honest corruption path.)
func TestQuoteCommercialSnapshot_CorruptPayloadFailsClosed(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO furniture_instances (id, organization_id, project_id, origin, lifecycle_status)
		VALUES ('54000000-0000-0000-0000-0000000000c2', '`+rlsOrgA+`', '`+csProject+`', 'manual', 'active')`); err != nil {
		t.Fatalf("seed furniture instance: %v", err)
	}
	if _, err := fx.admin.Exec(context.Background(), `
		INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, commercial_snapshot)
		VALUES ('74000000-0000-0000-0000-0000000000c1', '`+rlsOrgA+`', '`+csProject+`', 1, 'draft', '{"schema":"wrong"}'::jsonb)`); err != nil {
		t.Fatalf("seed corrupt snapshot: %v", err)
	}

	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.ListQuoteRevisionsByProject(ctx, csProject)
		return err
	})
	if !errors.Is(err, domain.ErrInvalidRevisionSnapshot) {
		t.Fatalf("corrupt snapshot must fail closed, got %v", err)
	}
}
