package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Issue #747: installation_scheduled_date is stored as a PostgreSQL DATE (OID 1082).
// Ensure binary driver scan into *time.Time correctly formats to "YYYY-MM-DD"
// and that null / empty values are safely accepted on read and write.
func TestProjects_InstallationScheduledDateScanAndPersist(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

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
		OrganizationID:            fixture.orgA,
	}

	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.CreateProject(txCtx, &project)
	}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	// 1. GetProjectByID scan in a new production-equivalent request transaction.
	got := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, projectID)
	})
	if got.InstallationScheduledDate == nil || *got.InstallationScheduledDate != scheduledDate {
		t.Fatalf("GetProjectByID InstallationScheduledDate = %v, want %q", got.InstallationScheduledDate, scheduledDate)
	}

	// 2. ListProjects scan (reproduces the /api/projects 500 regression)
	// in a separate production-equivalent request transaction.
	list := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) ([]domain.Project, error) {
		return store.ListProjects(txCtx)
	})
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
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProject(txCtx, projectID, got)
	}); err != nil {
		t.Fatalf("UpdateProject: %v", err)
	}
	updated := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, projectID)
	})
	if updated.InstallationScheduledDate == nil || *updated.InstallationScheduledDate != newDate {
		t.Fatalf("Updated InstallationScheduledDate = %v, want %q", updated.InstallationScheduledDate, newDate)
	}

	// 4. UpdateProject with cleared date (nil)
	updated.InstallationScheduledDate = nil
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateProject(txCtx, projectID, updated)
	}); err != nil {
		t.Fatalf("UpdateProject with nil date: %v", err)
	}
	cleared := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Project, error) {
		return store.GetProjectByID(txCtx, projectID)
	})
	if cleared.InstallationScheduledDate != nil {
		t.Fatalf("Cleared InstallationScheduledDate = %v, want nil", cleared.InstallationScheduledDate)
	}
}
