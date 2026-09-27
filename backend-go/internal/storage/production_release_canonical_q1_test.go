package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// This proof deliberately does not construct a QuoteRevision or commercial
// snapshot in the test. The design working copy is the authoring input; the
// real Q1 command must freeze its effective base mode and retained choices.
func TestProductionRelease_CanonicalDesignQ1CarriesBaseChoiceToFrozenBOM(t *testing.T) {
	for _, tc := range []struct{ mode, role, choice string }{
		{"plinth_board", "ZOCLO", csMaterial},
		{"plinth_strip", "ZOCLO_PERFIL", "94000000-0000-0000-0000-0000000000c8"},
		{"legs", "PATAS", "94000000-0000-0000-0000-0000000000c8"},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			fx := setupDesignQuoteFixture(t)
			seedPresetPricingContext(t, fx.quoteLifecycleFixture)
			if tc.role != "ZOCLO" {
				multiOrgExec(t, fx.admin, `
			DELETE FROM project_level_choices WHERE project_id='`+csProject+`' AND option_group_code='ZOCLO';
			INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
			VALUES ('`+tc.choice+`', 'CS-BASE-HW', 'Base hardware', 'piece', 10, '`+rlsOrgA+`');
			INSERT INTO option_groups (id, code, name, kind, required, organization_id) VALUES
			 ('93000000-0000-0000-0000-0000000000c8', '`+tc.role+`', 'Base hardware', 'hardware', FALSE, '`+rlsOrgA+`');
			INSERT INTO option_group_members (option_group_id, entity_id, organization_id)
			VALUES ('93000000-0000-0000-0000-0000000000c8', '`+tc.choice+`', '`+rlsOrgA+`');`)
			}
			const secondLine = "62000000-0000-0000-0000-0000000000c2"
			for i, lineID := range []string{csLine, secondLine} {
				material := csMaterial
				if i == 1 {
					material = csMaterial2
				}
				if _, err := fx.admin.Exec(context.Background(), `
			INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, measure_preset_id, base_mode, organization_id)
			VALUES ($1, $2, $3, 1, '{"widthMm":600,"heightMm":720,"depthMm":560}'::jsonb, $4, $5, $6)`, lineID, csProject, csModule, csPreset, tc.mode, rlsOrgA); err != nil {
					t.Fatal(err)
				}
				if _, err := fx.admin.Exec(context.Background(), `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`, rlsOrgA, csProject, lineID, fx.instances[i]); err != nil {
					t.Fatal(err)
				}
				for role, choice := range map[string]string{"INTERIOR": material, tc.role: tc.choice} {
					if _, err := fx.admin.Exec(context.Background(), `
				INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
				VALUES ($1, $2, $3, $4)`, lineID, role, choice, rlsOrgA); err != nil {
						t.Fatal(err)
					}
				}
			}
			actor := fiActorA()
			var q1ID, revisionID string
			err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
				items := []storage.UpdateDesignWorkingCopyItemCommand{}
				for i, id := range fx.instances {
					material := csMaterial
					if i == 1 {
						material = csMaterial2
					}
					items = append(items, storage.UpdateDesignWorkingCopyItemCommand{
						FurnitureInstanceID: id, FurnitureDefinitionID: csModule,
						Parameters:      map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
						MaterialChoices: map[string]string{"INTERIOR": material, tc.role: tc.choice},
					})
				}
				if _, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
					DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup,
					ActorUserID: rlsUserA, Items: items,
				}); err != nil {
					return err
				}
				projection, err := fx.store.GetDesignCommercialProjection(ctx, csProject, fx.designID)
				if err != nil {
					return err
				}
				fx.version, fx.fingerprint = projection.WorkingVersion, projection.WorkingFingerprint
				q1, err := createDesignQuote(ctx, fx)
				if err != nil {
					return err
				}
				q1ID = q1.Revision.ID
				for _, unit := range q1.Revision.CommercialSnapshot.Units {
					if unit.PricingContext == nil || unit.PricingContext.BaseMode != tc.mode ||
						unit.PricingContext.BaseClearanceMm == nil || *unit.PricingContext.BaseClearanceMm != 120 {
						t.Fatalf("canonical Q1 lost effective base context: %+v", unit.PricingContext)
					}
					found := false
					for _, choice := range unit.Options {
						if choice.GroupCode == tc.role && choice.ChoiceID == tc.choice {
							found = true
						}
					}
					if !found {
						t.Fatalf("canonical Q1 dropped the authored %s choice: %+v", tc.role, unit.Options)
					}
				}
				if _, err := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{ProjectID: csProject, QuoteRevisionID: q1ID}); err != nil {
					return err
				}
				if _, err := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{ProjectID: csProject, QuoteRevisionID: q1ID}); err != nil {
					return err
				}
				published, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
					DesignID: fx.designID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
				})
				if err != nil {
					return err
				}
				revisionID = published.ID
				return nil
			})
			if err != nil {
				t.Fatalf("canonical Q1 publish/accept and design publish: %v", err)
			}
			var releaseID string
			err = fx.store.WithinTenantTx(storage.WithConsistentCatalogTx(context.Background()), actor, func(ctx context.Context) error {
				preflight, err := fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, revisionID, q1ID)
				if err != nil || preflight.Status != domain.ManufacturingPreflightReady {
					t.Fatalf("canonical Q1 quoted preflight: %+v err=%v", preflight, err)
				}
				if _, err := fx.store.ApproveDesignRevisionForProduction(ctx, storage.ApproveDesignRevisionForProductionCommand{
					ProjectID: csProject, DesignID: fx.designID, DesignRevisionID: revisionID,
					QuoteRevisionID: q1ID, ActorUserID: rlsUserA,
				}); err != nil {
					return err
				}
				release, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
					ProjectID: csProject, DesignRevisionID: revisionID, QuoteRevisionID: q1ID, ActorUserID: rlsUserA,
				})
				if err != nil {
					return err
				}
				releaseID = release.Release.ID
				return nil
			})
			if err != nil {
				t.Fatalf("canonical Q1 production flow: %v", err)
			}
			err = fiTx(t, fx.store, actor, func(ctx context.Context) error {
				snapshot, err := fx.store.GetProductionReleaseManufacturingSnapshot(ctx, csProject, releaseID)
				if err != nil {
					return err
				}
				if len(snapshot.Units) != len(fx.instances) {
					t.Fatalf("frozen unit count=%d, want %d", len(snapshot.Units), len(fx.instances))
				}
				for _, unit := range snapshot.Units {
					if tc.role == "ZOCLO" {
						part, ok := zocloPart(t, unit)
						if !ok || part.WidthMm != 120 || part.MaterialID != tc.choice {
							t.Fatalf("Q1 must govern frozen zócalo BOM, got %+v", unit.Resolved.BOM.BoardParts)
						}
						continue
					}
					found := false
					for _, line := range unit.Resolved.BOM.HardwareLines {
						if line.OptionRole == tc.role && line.HardwareID == tc.choice && line.Quantity > 0 {
							found = true
						}
					}
					if !found {
						t.Fatalf("Q1 must govern frozen %s hardware BOM, got %+v", tc.role, unit.Resolved.BOM.HardwareLines)
					}
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
