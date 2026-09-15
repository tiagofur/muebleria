package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Issue #747: installation_scheduled_date is stored as a PostgreSQL DATE (OID 1082).
// Ensure binary driver scan into *time.Time correctly formats to "YYYY-MM-DD"
// and that null / empty values are safely accepted on read and write.
func TestProjects_InstallationScheduledDateScanAndPersist(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := storage.WithOrgCtx(context.Background(), orgA)

	const projectID = "c2000000-0000-0000-0000-000000000077"
	scheduledDate := "2026-10-15"

	project := domain.Project{
		ID:                        projectID,
		Name:                      "Proyecto con Fecha de Instalacion",
		CustomerID:                "c1000000-0000-0000-0000-00000000000a",
		Currency:                  "MXN",
		MarginFactor:              1.5,
		LaborFixedCost:            100,
		Status:                    domain.StatusDraft,
		InstallationScheduledDate: &scheduledDate,
		OrganizationID:            orgA,
	}

	if err := store.CreateProject(ctx, &project); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	// 1. GetProjectByID scan
	got, err := store.GetProjectByID(ctx, projectID)
	if err != nil {
		t.Fatalf("GetProjectByID: %v", err)
	}
	if got.InstallationScheduledDate == nil || *got.InstallationScheduledDate != scheduledDate {
		t.Fatalf("GetProjectByID InstallationScheduledDate = %v, want %q", got.InstallationScheduledDate, scheduledDate)
	}

	// 2. ListProjects scan (reproduces the /api/projects 500 regression)
	list, err := store.ListProjects(ctx)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	found := false
	for _, p := range list {
		if p.ID == projectID {
			found = true
			if p.InstallationScheduledDate == nil || *p.InstallationScheduledDate != scheduledDate {
				t.Fatalf("ListProjects InstallationScheduledDate = %v, want %q", p.InstallationScheduledDate, scheduledDate)
			}
		}
	}
	if !found {
		t.Fatalf("ListProjects did not return project %s", projectID)
	}

	// 3. UpdateProject with modified date
	newDate := "2026-11-20"
	got.InstallationScheduledDate = &newDate
	if err := store.UpdateProject(ctx, projectID, got); err != nil {
		t.Fatalf("UpdateProject: %v", err)
	}
	updated, err := store.GetProjectByID(ctx, projectID)
	if err != nil {
		t.Fatalf("GetProjectByID after update: %v", err)
	}
	if updated.InstallationScheduledDate == nil || *updated.InstallationScheduledDate != newDate {
		t.Fatalf("Updated InstallationScheduledDate = %v, want %q", updated.InstallationScheduledDate, newDate)
	}

	// 4. UpdateProject with cleared date (nil)
	updated.InstallationScheduledDate = nil
	if err := store.UpdateProject(ctx, projectID, updated); err != nil {
		t.Fatalf("UpdateProject with nil date: %v", err)
	}
	cleared, err := store.GetProjectByID(ctx, projectID)
	if err != nil {
		t.Fatalf("GetProjectByID after clear: %v", err)
	}
	if cleared.InstallationScheduledDate != nil {
		t.Fatalf("Cleared InstallationScheduledDate = %v, want nil", cleared.InstallationScheduledDate)
	}
}
