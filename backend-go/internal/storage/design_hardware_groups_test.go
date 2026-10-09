package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1252: DesignConsumedHardwareOptionGroups storage integration test proven
// on real PostgreSQL under the app role (with RLS).
//
// Verifies:
//   1. Design scope: a design whose placed modules consume hardware option
//      groups returns scope="design", the matching groups with their catalog
//      optionIds, and the design's authoring default as chosen_hardware_id.
//   2. Empty design default stays empty (honest "sin elegir").
//   3. Project fallback scope: when the design consumes no group, scope
//      flips to "project" and offers groups consumed by the project's models.
//   4. Unknown design returns domain.ErrDesignNotFound.

func TestGetDesignConsumedHardwareOptionGroups_Integration(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	// Seed hardware and option groups for Org A
	hwHinge1 := "72000000-0000-0000-0000-000000000001"
	hwHinge2 := "72000000-0000-0000-0000-000000000002"
	multiOrgExec(t, fx.admin, `
		INSERT INTO hardware (id, code, name, category, unit, organization_id) VALUES
		('`+hwHinge1+`', 'BIS-CL110', 'Bisagra Cierre Lento', 'hinge', 'piece', '`+rlsOrgA+`'),
		('`+hwHinge2+`', 'BIS-ECO', 'Bisagra Economica', 'hinge', 'piece', '`+rlsOrgA+`')
		ON CONFLICT (id) DO NOTHING;

		INSERT INTO option_groups (id, code, name, kind, required, organization_id) VALUES
		('93000000-0000-0000-0000-0000000000c1', 'BISAGRA', 'Bisagras', 'hardware', true, '`+rlsOrgA+`')
		ON CONFLICT (id) DO NOTHING;

		INSERT INTO option_group_members (option_group_id, entity_id) VALUES
		('93000000-0000-0000-0000-0000000000c1', '`+hwHinge1+`'),
		('93000000-0000-0000-0000-0000000000c1', '`+hwHinge2+`')
		ON CONFLICT DO NOTHING;
	`)

	// Module A consumes BISAGRA via a hardware line with option_role
	multiOrgExec(t, fx.admin, `
		INSERT INTO hardware_lines (id, module_id, quantity, option_role, organization_id) VALUES
		('73000000-0000-0000-0000-000000000001', '`+fiModuleA+`', 2, 'BISAGRA', '`+rlsOrgA+`')
		ON CONFLICT (id) DO NOTHING;
	`)

	// Create a design with fiModuleA in its working copy
	var designID string
	fiInst := "51000000-0000-0000-0000-000000000c01"
	multiOrgExec(t, fx.admin, `
		INSERT INTO furniture_instances (id, project_id, organization_id, origin)
		VALUES ('`+fiInst+`', '`+fiSharedProject+`', '`+rlsOrgA+`', 'manual')
		ON CONFLICT (id) DO NOTHING;
	`)

	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, txErr := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Diseño con bisagras",
			ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		designID = d.ID

		_, txErr = UpdateWorkingCopyCurrent(txCtx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			AuthoringDefaults: &domain.DesignAuthoringDefaults{
				MaterialChoices: map[string]string{
					"BISAGRA": hwHinge1,
				},
			},
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{
					FurnitureInstanceID:   fiInst,
					FurnitureDefinitionID: fiModuleA,
					Parameters:            map[string]any{"widthMm": 600.0},
					MaterialChoices:       map[string]string{},
					Transform:             domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}},
				},
			},
			ActorUserID: rlsUserA,
		})
		return txErr
	})
	if err != nil {
		t.Fatalf("create design & working copy: %v", err)
	}

	// 1. Design scope: returns scope="design" and BISAGRA group with chosen=hwHinge1
	groups, err := fiTxAnd(t, fx, actorA, func(txCtx context.Context) (*storage.DesignConsumedHardwareOptionGroups, error) {
		return fx.store.GetDesignConsumedHardwareOptionGroups(txCtx, designID)
	})
	if err != nil {
		t.Fatalf("get hardware option groups: %v", err)
	}

	if groups.Scope != "design" {
		t.Fatalf("scope = %q, want design", groups.Scope)
	}
	if len(groups.Groups) != 1 {
		t.Fatalf("groups count = %d, want 1", len(groups.Groups))
	}
	g := groups.Groups[0]
	if g.Code != "BISAGRA" || g.Name != "Bisagras" {
		t.Fatalf("group = %+v", g)
	}
	if g.ChosenHardwareID != hwHinge1 {
		t.Fatalf("chosen = %q, want %q", g.ChosenHardwareID, hwHinge1)
	}
	if len(g.OptionIDs) != 2 {
		t.Fatalf("optionIds = %v, want 2 members", g.OptionIDs)
	}
	if g.ConsumedBy != 1 {
		t.Fatalf("consumedBy = %d, want 1", g.ConsumedBy)
	}

	// 2. Project fallback scope: create a second design with an EMPTY working copy.
	// The project has project_items pointing to fiModuleA.
	multiOrgExec(t, fx.admin, `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id) VALUES
		('74000000-0000-0000-0000-000000000001', '`+fiSharedProject+`', '`+fiModuleA+`', 1, '`+rlsOrgA+`')
		ON CONFLICT (id) DO NOTHING;
	`)

	var emptyDesignID string
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, txErr := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Diseño vacío fallback",
			ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		emptyDesignID = d.ID
		return nil
	})
	if err != nil {
		t.Fatalf("create empty design: %v", err)
	}

	fallbackGroups, err := fiTxAnd(t, fx, actorA, func(txCtx context.Context) (*storage.DesignConsumedHardwareOptionGroups, error) {
		return fx.store.GetDesignConsumedHardwareOptionGroups(txCtx, emptyDesignID)
	})
	if err != nil {
		t.Fatalf("get fallback groups: %v", err)
	}

	if fallbackGroups.Scope != "project" {
		t.Fatalf("fallback scope = %q, want project", fallbackGroups.Scope)
	}
	if len(fallbackGroups.Groups) != 1 || fallbackGroups.Groups[0].Code != "BISAGRA" {
		t.Fatalf("fallback groups = %+v", fallbackGroups.Groups)
	}
	// No design default was configured for this empty design -> honest "sin elegir"
	if fallbackGroups.Groups[0].ChosenHardwareID != "" {
		t.Fatalf("chosen = %q, want empty (sin elegir)", fallbackGroups.Groups[0].ChosenHardwareID)
	}

	// 3. Not found
	_, err = fiTxAnd(t, fx, actorA, func(txCtx context.Context) (*storage.DesignConsumedHardwareOptionGroups, error) {
		return fx.store.GetDesignConsumedHardwareOptionGroups(txCtx, "00000000-0000-0000-0000-000000000404")
	})
	if err == nil {
		t.Fatal("expected ErrDesignNotFound for non-existent design")
	}
}
