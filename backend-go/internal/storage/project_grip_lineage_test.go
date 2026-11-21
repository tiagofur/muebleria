package storage_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1680 — ProjectGripLineageChoices: the design-lineage statements a resolve
// outside the commercial truth composes from, proven on real PostgreSQL
// under the app role. The LATEST working item of an instance wins across
// designs; the project-level choices (F029) ride along for every unit;
// another tenant's project reads nothing.

func TestProjectGripLineageChoicesLatestWorkingItemWins(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	// One design with authoring defaults, a second design without them.
	const (
		designWithDefaults = "a1000000-0000-0000-0000-000000000001"
		designNewer        = "a1000000-0000-0000-0000-000000000002"
	)
	for _, statement := range []string{
		`INSERT INTO designs (id, project_id, name, organization_id) VALUES
		 ('` + designWithDefaults + `', '` + fiSharedProject + `', 'Diseño con defaults', '` + rlsOrgA + `'),
		 ('` + designNewer + `', '` + fiSharedProject + `', 'Diseño nuevo', '` + rlsOrgA + `')`,
		`INSERT INTO design_working_copies (design_id, project_id, organization_id, authoring_defaults) VALUES
		 ('` + designWithDefaults + `', '` + fiSharedProject + `', '` + rlsOrgA + `',
		  '{"materialChoices": {"JALADERA": "70000000-0000-0000-0000-0000000000d1"}}')`,
	} {
		if _, err := fx.admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed lineage fixture: %v\n%s", err, statement)
		}
	}

	const overrideChoice = `{"JALADERA": "70000000-0000-0000-0000-0000000000e1"}`
	seedWorkingItem := func(design, instanceID, choices string, ageSeconds int) {
		t.Helper()
		if _, err := fx.admin.Exec(ctx, `
			INSERT INTO design_working_items (design_id, project_id, organization_id, furniture_instance_id, transform, material_choices, updated_at)
			VALUES ($1, $2, '`+rlsOrgA+`', $3, '{"translationMm": [0, 0, 0]}', $4, NOW() - $5::interval)`,
			design, fiSharedProject, instanceID, choices, fmt.Sprintf("%d seconds", ageSeconds)); err != nil {
			t.Fatalf("seed working item: %v", err)
		}
	}
	createInstance := func(projectID, requestID string) string {
		t.Helper()
		var instance *domain.FurnitureInstance
		if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			var err error
			instance, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
				ProjectID: projectID, Origin: domain.FurnitureInstanceOriginDesign,
				ActorUserID: rlsUserA, IP: "203.0.113.11", RequestID: requestID,
			})
			return err
		}); err != nil {
			t.Fatalf("create instance: %v", err)
		}
		return instance.ID
	}

	// instanceSingle: one working item in the design with defaults — both
	// the explicit override and the design's authoring defaults ride with it.
	instanceSingle := createInstance(fiSharedProject, "grip-lineage-0001")
	seedWorkingItem(designWithDefaults, instanceSingle, overrideChoice, 0)

	// instanceTwo: an OLDER working item in the design with defaults, then a
	// LATEST one in the design without them — the latest row wins, so the
	// lineage carries neither the old override nor the old design's defaults.
	instanceTwo := createInstance(fiSharedProject, "grip-lineage-0002")
	seedWorkingItem(designWithDefaults, instanceTwo, overrideChoice, 7200)
	seedWorkingItem(designNewer, instanceTwo, `{}`, 0)

	var lineage map[string]storage.GripLineageChoices
	var level map[string]string
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		lineage, level, err = fx.store.ProjectGripLineageChoices(ctx, fiSharedProject)
		return err
	}); err != nil {
		t.Fatalf("lineage choices: %v", err)
	}

	if len(lineage) != 2 {
		t.Fatalf("both instances carry lineage, got %d: %+v", len(lineage), lineage)
	}
	single, ok := lineage[instanceSingle]
	if !ok {
		t.Fatalf("instanceSingle missing from lineage")
	}
	if got := single.Overrides["JALADERA"]; got != "70000000-0000-0000-0000-0000000000e1" {
		t.Fatalf("instanceSingle overrides = %+v", single.Overrides)
	}
	if got := single.Defaults.MaterialChoices["JALADERA"]; got != "70000000-0000-0000-0000-0000000000d1" {
		t.Fatalf("instanceSingle design defaults = %+v", single.Defaults.MaterialChoices)
	}
	two, ok := lineage[instanceTwo]
	if !ok {
		t.Fatalf("instanceTwo missing from lineage")
	}
	if len(two.Overrides) != 0 || len(two.Defaults.MaterialChoices) != 0 {
		t.Fatalf("instanceTwo's latest working item is the empty one in the design without defaults, got %+v %+v",
			two.Overrides, two.Defaults.MaterialChoices)
	}

	// The fixture's F029 row rides along for every unit.
	if level["RLS"] != "choice-a" {
		t.Fatalf("project level choices = %+v", level)
	}

	// Another tenant reads nothing of a project it does not share: the
	// fixture's shared project (sales A / manufacturing B) is legible to B by
	// design, so the isolation probe uses org A's private project.
	const privateDesign = "a1000000-0000-0000-0000-000000000003"
	for _, statement := range []string{
		`INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		 VALUES ('` + fiProjectAOnly + `', 'Org A private project', '30000000-0000-0000-0000-00000000000a', 'draft',
			'` + rlsOrgA + `', '` + rlsOrgA + `', '` + rlsOrgA + `')`,
		`INSERT INTO designs (id, project_id, name, organization_id)
		 VALUES ('` + privateDesign + `', '` + fiProjectAOnly + `', 'Diseño privado', '` + rlsOrgA + `')`,
	} {
		if _, err := fx.admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed private fixture: %v\n%s", err, statement)
		}
	}
	privateInstance := createInstance(fiProjectAOnly, "grip-lineage-0003")
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO design_working_items (design_id, project_id, organization_id, furniture_instance_id, transform, material_choices)
		VALUES ($1, $2, '`+rlsOrgA+`', $3, '{"translationMm": [0, 0, 0]}', '{}')`,
		privateDesign, fiProjectAOnly, privateInstance); err != nil {
		t.Fatalf("seed private working item: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		private, _, err := fx.store.ProjectGripLineageChoices(ctx, fiProjectAOnly)
		if err != nil {
			return err
		}
		if len(private) != 1 {
			t.Fatalf("org A must read its private project's lineage, got %+v", private)
		}
		return nil
	}); err != nil {
		t.Fatalf("owner read of private project: %v", err)
	}
	if err := fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		foreign, foreignLevel, err := fx.store.ProjectGripLineageChoices(ctx, fiProjectAOnly)
		if err != nil {
			return err
		}
		if len(foreign) != 0 || len(foreignLevel) != 0 {
			t.Fatalf("cross-tenant lineage leaked: %+v %+v", foreign, foreignLevel)
		}
		return nil
	}); err != nil {
		t.Fatalf("cross-tenant read: %v", err)
	}
}
