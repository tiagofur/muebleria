package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1556 — the category link enforcement against REAL PostgreSQL, through the
// same tenant-transaction envelope the auth middleware provides. The FK
// cannot protect this path (referential checks bypass RLS), so the handler's
// org-scoped pre-check is the enforcement: a cross-org category_id must read
// as 422 HARDWARE_CATEGORY_INVALID and leave NO cross-tenant link behind
// (probed with the admin pool: no tenant scope can see both sides).

func TestHardwareCategoryLink_CrossOrg422AndNoLink_1556(t *testing.T) {
	store, migrationPool := hwAssetE2EStore(t)
	srv := &Server{Store: store}

	// hwAssetE2EStore leaves the initial org in its post-migration lifecycle
	// status; hardwares INSERT runs app_can_write_organization, which demands
	// 'active' — activate both fixture orgs (same step multi-org fixtures do).
	if _, err := migrationPool.Exec(context.Background(), `
		UPDATE organizations SET status='active', status_reason=NULL
		WHERE id IN ($1, $2)`, storage.InitialOrganizationID, hwAssetE2EForeignOrg); err != nil {
		t.Fatalf("activate fixture orgs: %v", err)
	}

	initialActor := hwAssetE2EActorFor(storage.InitialOrganizationID, hwAssetE2EInitialMembership)
	foreignActor := hwAssetE2EActorFor(hwAssetE2EForeignOrg, hwAssetE2EForeignMembership)

	// Org A (initial) authors its category.
	var categoryID string
	if err := store.WithinTenantTx(context.Background(), initialActor, func(ctx context.Context) error {
		c := &domain.HardwareCategory{Name: "Bisagras E2E 1556", SortOrder: 1}
		createErr := store.CreateHardwareCategory(ctx, c)
		categoryID = c.ID
		return createErr
	}); err != nil {
		t.Fatalf("seed org A category: %v", err)
	}

	post := func(actor storage.TenantActor, category string) *httptest.ResponseRecorder {
		body := `{"id":"c7000000-0000-0000-0000-0000000000e2","code":"HW-1556","name":"Herraje E2E","unit":"piece","cost_per_unit":1,"category_id":"` + category + `"}`
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/hardware", strings.NewReader(body)), hwAssetE2EActor, string(domain.RoleAdmin))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		if err := store.WithinTenantTx(req.Context(), actor, func(ctx context.Context) error {
			srv.HandleHardwares(rr, req.WithContext(ctx))
			if rr.Code >= http.StatusInternalServerError {
				return errTenantHandlerFailure
			}
			return nil
		}); err != nil && rr.Code < http.StatusInternalServerError {
			t.Fatalf("tenant tx failed but handler buffered %d: %v", rr.Code, err)
		}
		return rr
	}

	// Org B (foreign) posting org A's category: the org-scoped lookup reads
	// not-found → typed 422.
	rr := post(foreignActor, categoryID)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("cross-org category link = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "HARDWARE_CATEGORY_INVALID") {
		t.Fatalf("body must carry the typed code: %s", rr.Body.String())
	}

	// No cross-tenant link persisted (admin probe — no tenant scope can see
	// both sides of the join).
	var linked bool
	if err := migrationPool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM hardwares h JOIN hardware_categories c ON c.id = h.category_id
			WHERE h.id = 'c7000000-0000-0000-0000-0000000000e2' AND c.organization_id <> h.organization_id
		)`).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked {
		t.Fatal("a cross-tenant category link persisted — the enforcement failed")
	}

	// The same org CAN link its own category: 201 and the link reads back.
	rr = post(initialActor, categoryID)
	if rr.Code != http.StatusCreated {
		t.Fatalf("own-org category link = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	var readback struct {
		CategoryID string `json:"category_id"`
	}
	if err := store.WithinTenantTx(context.Background(), initialActor, func(ctx context.Context) error {
		h, err := store.GetHardwareByID(ctx, "c7000000-0000-0000-0000-0000000000e2")
		if err != nil {
			return err
		}
		readback.CategoryID = h.CategoryID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if readback.CategoryID != categoryID {
		t.Fatalf("category link readback = %q, want %q", readback.CategoryID, categoryID)
	}
}
