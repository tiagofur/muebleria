package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// TestProjectDigitalThreadContextProjection (#697 review) pins the ONE
// server-owned signal separating modern Digital Thread projects from true
// pre-Digital-Thread ones. Legacy accepted/produced status compatibility in
// the Web production surfaces is gated on this projection — a modern DT
// project with a residual accepted stamp and no canonical release must fail
// closed there, so the projection itself must be exact:
//
//	bare project (no DT roots)                     → HasDigitalThreadContext=false
//	project with a FurnitureInstance only          → HasDigitalThreadContext=true
//
// Both the list and the detail read models must agree, and the flag must
// never depend on the legacy project status.
func TestProjectDigitalThreadContextProjection(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	flagOf := func(t *testing.T, projectID string) bool {
		t.Helper()
		var flag bool
		err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			p, err := fx.store.GetProjectByID(ctx, projectID)
			if err != nil {
				return err
			}
			flag = p.HasDigitalThreadContext
			return nil
		})
		if err != nil {
			t.Fatalf("GetProjectByID(%s): %v", projectID, err)
		}
		return flag
	}

	listFlagOf := func(t *testing.T, projectID string) bool {
		t.Helper()
		var flag bool
		err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			list, err := fx.store.ListProjects(ctx)
			if err != nil {
				return err
			}
			for _, p := range list {
				if p.ID == projectID {
					flag = p.HasDigitalThreadContext
					return nil
				}
			}
			t.Errorf("project %s missing from org A list", projectID)
			return nil
		})
		if err != nil {
			t.Fatalf("ListProjects: %v", err)
		}
		return flag
	}

	// True pre-Digital-Thread: bare project, positively false on both read
	// models — this is the only case where legacy status compatibility may
	// apply downstream.
	if got := flagOf(t, fiProjectAOnly); got {
		t.Fatalf("bare project must project HasDigitalThreadContext=false, got true")
	}
	if got := listFlagOf(t, fiProjectAOnly); got {
		t.Fatalf("bare project list read must project HasDigitalThreadContext=false, got true")
	}

	// A residual legacy 'accepted' stamp on the bare project changes nothing:
	// the signal is DT participation, never the operational status.
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE projects SET status = 'accepted' WHERE id = $1`, fiProjectAOnly); err != nil {
		t.Fatalf("stamp legacy status: %v", err)
	}
	if got := flagOf(t, fiProjectAOnly); got {
		t.Fatalf("accepted stamp must not fabricate DT context on a bare project")
	}

	// FurnitureInstance is the Digital Thread root (migration 000111 / ADR-0003),
	// even before any quote revision, design or ProductionRelease exists.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:             fiProjectAOnly,
			Origin:                domain.FurnitureInstanceOriginManual,
			FurnitureDefinitionID: fiModuleA,
			ActorUserID:           rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("create FurnitureInstance on bare project: %v", err)
	}
	if got := flagOf(t, fiProjectAOnly); !got {
		t.Fatalf("FurnitureInstance-only project must project HasDigitalThreadContext=true")
	}
	if got := listFlagOf(t, fiProjectAOnly); !got {
		t.Fatalf("list read must agree with the detail read for DT context")
	}
}
