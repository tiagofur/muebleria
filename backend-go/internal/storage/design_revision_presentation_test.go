package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestDesignRevisionPresentationFrozenAtPublicationAndApproval(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actor := fiActorA()
	ctx := context.Background()
	statements := []struct {
		query string
		args  []any
	}{
		{`UPDATE modules SET code='MOD-GAB-01', name='Gabinete bajo' WHERE id=$1`, []any{fiModuleA}},
		{`INSERT INTO board_parts (module_id,code,description,quantity,length_mm,width_mm,option_role,organization_id) VALUES ($1,'P1','Panel',1,600,560,'INTERIOR',$2)`, []any{fiModuleA, rlsOrgA}},
		{`UPDATE material_boards SET code='MAT-BLA', name='Blanco premium' WHERE id=$1`, []any{releaseMaterial}},
		{`UPDATE projects SET site_survey='{"id":"survey-1","project_id":"40000000-0000-0000-0000-000000000001","revision":1,"spaces":[{"id":"kitchen","name":"Cocina","intent":"approved","elements":[]}],"created_at":"2026-09-09T00:00:00Z"}'::jsonb WHERE id=$1`, []any{fiSharedProject}},
	}
	for _, statement := range statements {
		if _, err := fx.admin.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}

	var revision *domain.DesignRevision
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		instance, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{ProjectID: fiSharedProject, Origin: domain.FurnitureInstanceOriginManual, FurnitureDefinitionID: fiModuleA, ActorUserID: rlsUserA})
		if err != nil {
			return err
		}
		design, err := fx.store.CreateDesign(ctx, storage.CreateDesignCommand{ProjectID: fiSharedProject, Name: "Frozen labels", ActorUserID: rlsUserA})
		if err != nil {
			return err
		}
		_, err = fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{DesignID: design.ID, ActorUserID: rlsUserA, Items: []storage.UpdateDesignWorkingCopyItemCommand{{FurnitureInstanceID: instance.ID, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0}, MaterialChoices: map[string]string{"INTERIOR": releaseMaterial}, RoomID: "kitchen"}}})
		if err != nil {
			return err
		}
		revision, err = fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{DesignID: design.ID, ActorUserID: rlsUserA})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	item := revision.Items[0]
	if item.PresentationSnapshot == nil || item.PresentationSnapshot.Definition.Name != "Gabinete bajo" || item.PresentationSnapshot.Materials[0].Name != "Blanco premium" || item.PresentationSnapshot.Materials[0].Provenance != domain.DesignMaterialProvenanceAuthored || item.PresentationSnapshot.Room.Label != "Cocina" {
		t.Fatalf("unexpected snapshot: %#v", item.PresentationSnapshot)
	}
	if revision.CreatedByDisplayName == "" {
		t.Fatal("publisher display name was not frozen")
	}

	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`UPDATE modules SET name='Renamed' WHERE id=$1`, []any{fiModuleA}},
		{`UPDATE material_boards SET name='Renamed' WHERE id=$1`, []any{releaseMaterial}},
		{`UPDATE users SET name='Renamed' WHERE id=$1`, []any{rlsUserA}},
	} {
		if _, err := fx.admin.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	err = fiTx(t, fx.store, actor, func(ctx context.Context) error {
		read, err := fx.store.GetDesignRevision(ctx, revision.DesignID, revision.ID)
		if err != nil {
			return err
		}
		if read.Items[0].PresentationSnapshot.Definition.Name != "Gabinete bajo" || read.Items[0].PresentationSnapshot.Materials[0].Name != "Blanco premium" || read.CreatedByDisplayName == "Renamed" {
			t.Fatalf("mutable lookup rewrote history: %#v", read)
		}
		approved, err := fx.store.ApproveDesignRevision(ctx, storage.ApproveDesignRevisionCommand{DesignID: revision.DesignID, DesignRevisionID: revision.ID, ActorUserID: rlsUserA})
		if err == nil && approved.ApprovedByDisplayName != "Renamed" {
			t.Fatalf("approval label not frozen at transition: %#v", approved)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDesignRevisionPresentationLegacyRowsRemainUnavailable(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	var nullable string
	if err := fx.admin.QueryRow(context.Background(), `SELECT is_nullable FROM information_schema.columns WHERE table_name='design_revision_items' AND column_name='presentation_snapshot'`).Scan(&nullable); err != nil || nullable != "YES" {
		t.Fatalf("legacy compatibility missing: %q %v", nullable, err)
	}
}
