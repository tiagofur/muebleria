package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func bootstrapCommand() storage.BootstrapProjectDesignCommand {
	return storage.BootstrapProjectDesignCommand{
		ProjectName:     "Cocina SketchUp",
		DesignName:      "Diseño principal",
		NewCustomerName: "Cliente SketchUp",
		ActorRoles:      []domain.UserRole{domain.RoleAdmin},
		RequestID:       "issue-718-storage-test",
	}
}

func TestBootstrapProjectDesignPostgres_AtomicCanonicalContextAndTenantIsolation(t *testing.T) {
	store, orgA, orgB := isolationSetup(t)
	ctx := context.Background()

	created, err := store.BootstrapProjectDesign(scoped(ctx, orgA), bootstrapCommand())
	if err != nil {
		t.Fatalf("bootstrap new customer: %v", err)
	}
	if created.Customer.ID == "" || created.Project.ID == "" || created.Design.ID == "" {
		t.Fatalf("server identities missing: %+v", created)
	}
	if created.Project.CustomerID != created.Customer.ID || created.Design.ProjectID != created.Project.ID {
		t.Fatalf("canonical links missing: %+v", created)
	}
	var workingCopyCount int
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM design_working_copies WHERE design_id=$1 AND organization_id=$2`, created.Design.ID, orgA).Scan(&workingCopyCount); err != nil || workingCopyCount != 1 {
		t.Fatalf("working copy count=%d err=%v", workingCopyCount, err)
	}
	binding, err := store.GetModelBindingContext(scoped(ctx, orgA), created.Project.ID, created.Design.ID, nil)
	if err != nil || binding.ProjectName != "Cocina SketchUp" {
		t.Fatalf("binding context=%+v err=%v", binding, err)
	}
	if _, err := store.GetModelBindingContext(scoped(ctx, orgB), created.Project.ID, created.Design.ID, nil); !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("cross-tenant binding err=%v", err)
	}
	var auditCount int
	if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type='sketchup_project_design_bootstrapped' AND organization_id=$1`, orgA).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("audit count=%d err=%v", auditCount, err)
	}

	existing := bootstrapCommand()
	existing.NewCustomerName = ""
	existing.ExistingCustomerID = "c1000000-0000-0000-0000-00000000000a"
	if _, err := store.BootstrapProjectDesign(scoped(ctx, orgA), existing); err != nil {
		t.Fatalf("bootstrap existing customer: %v", err)
	}
	existing.ExistingCustomerID = "c1000000-0000-0000-0000-00000000000b"
	if _, err := store.BootstrapProjectDesign(scoped(ctx, orgA), existing); !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("cross-tenant customer err=%v", err)
	}
}

func TestBootstrapProjectDesignPostgres_IdempotentReplayAndDifferentIntent(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := storage.WithTenantActorCtx(context.Background(), storage.TenantActor{OrganizationID: orgA})
	scope := fmt.Sprintf("project.bootstrap-design:test:%d", time.Now().UnixNano())
	command := bootstrapCommand()
	calls := 0
	execute := func(txCtx context.Context) (storage.IdempotencyResponse, error) {
		calls++
		created, err := store.BootstrapProjectDesign(txCtx, command)
		if err != nil {
			return storage.IdempotencyResponse{}, err
		}
		body, _ := json.Marshal(map[string]string{"customerId": created.Customer.ID, "projectId": created.Project.ID, "designId": created.Design.ID})
		return storage.IdempotencyResponse{Status: http.StatusCreated, Header: http.Header{}, Body: body}, nil
	}
	request := storage.IdempotencyRequest{ScopeKey: scope, Fingerprint: "intent-a", OrganizationID: orgA}
	first, replayed, err := store.ExecuteIdempotent(ctx, request, execute)
	if err != nil || replayed {
		t.Fatalf("first replay=%v err=%v", replayed, err)
	}
	second, replayed, err := store.ExecuteIdempotent(ctx, request, execute)
	if err != nil || !replayed || calls != 1 || string(first.Body) != string(second.Body) {
		t.Fatalf("replay=%v calls=%d err=%v", replayed, calls, err)
	}
	request.Fingerprint = "intent-b"
	if _, _, err := store.ExecuteIdempotent(ctx, request, execute); !errors.Is(err, storage.ErrIdempotencyConflict) {
		t.Fatalf("different intent err=%v", err)
	}
}

func TestBootstrapProjectDesignPostgres_AuditFailureRollsBackEverything(t *testing.T) {
	store, orgA, _ := isolationSetup(t)
	ctx := context.Background()
	if _, err := store.Pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION reject_sketchup_bootstrap_audit() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.event_type = 'sketchup_project_design_bootstrapped' THEN
				RAISE EXCEPTION 'required bootstrap audit unavailable';
			END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER reject_sketchup_bootstrap_audit BEFORE INSERT ON security_audit_events
		FOR EACH ROW EXECUTE FUNCTION reject_sketchup_bootstrap_audit()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = store.Pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS reject_sketchup_bootstrap_audit ON security_audit_events; DROP FUNCTION IF EXISTS reject_sketchup_bootstrap_audit()`)
	})

	if _, err := store.BootstrapProjectDesign(scoped(ctx, orgA), bootstrapCommand()); err == nil {
		t.Fatal("audit failure must abort bootstrap")
	}
	for table, name := range map[string]string{"customers": "Cliente SketchUp", "projects": "Cocina SketchUp", "designs": "Diseño principal"} {
		var count int
		if err := store.Pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE name=$1 AND organization_id=$2`, name, orgA).Scan(&count); err != nil || count != 0 {
			t.Fatalf("rollback %s count=%d err=%v", table, count, err)
		}
	}
}

func TestBootstrapProjectDesignPostgres_RuntimeRoleRLS(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := storage.WithTenantActorCtx(context.Background(), storage.TenantActor{
		OrganizationID: rlsOrgA, UserID: rlsUserA,
	})
	command := bootstrapCommand()
	command.ActorUserID = rlsUserA

	created, err := fx.store.BootstrapProjectDesign(ctx, command)
	if err != nil || created.Project.OrganizationID != rlsOrgA {
		t.Fatalf("runtime-role bootstrap=%+v err=%v", created, err)
	}
	command.NewCustomerName = ""
	command.ExistingCustomerID = "30000000-0000-0000-0000-00000000000b"
	if _, err := fx.store.BootstrapProjectDesign(ctx, command); !errors.Is(err, storage.ErrCustomerNotFound) {
		t.Fatalf("runtime role cross-tenant customer err=%v", err)
	}
}
