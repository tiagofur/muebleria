// Ownership & idempotency (F179 / #327): newly created resources always land
// in the CALLER's organization, and a public payload can never choose
// organization_id — neither by injecting unknown fields nor through the
// documented project ownership fields, which are validated against the
// caller's memberships.

package pilotreadiness

import (
	"net/http"
	"testing"
)

func TestPilotReadiness_NewResourcesGetCallerOrg(t *testing.T) {
	// Customer: organization_id sent in the payload is not a real field —
	// the row must still land in A.
	var cust struct {
		ID string `json:"id"`
	}
	fx.decode(t, http.MethodPost, "/api/customers", fx.a.admin.token, map[string]any{
		"name": "Cliente Extra Alfa", "email": "extra-a@pilot-readiness.test",
		"organization_id": fx.b.id, // injection attempt
	}, http.StatusCreated, &cust)
	if org := fx.customerOrgID(t, cust.ID); org != fx.a.id {
		t.Fatalf("customer created by A landed in org %s (want %s) — payload organization_id was honored", org, fx.a.id)
	}

	// Material board: same injection attempt.
	var mat struct {
		ID string `json:"id"`
	}
	fx.decode(t, http.MethodPost, "/api/catalog/materials", fx.a.admin.token, map[string]any{
		"code": "PLOT-A-EXTRA-15", "name": "Tablero Extra Alfa", "manufacturer": "Maderas Fixture",
		"width_mm": 2750, "length_mm": 1850, "thickness_mm": 15,
		"organization_id": fx.b.id,
	}, http.StatusCreated, &mat)
	row := fx.queryRow(t, `SELECT organization_id::text FROM material_boards WHERE id = $1`, mat.ID)
	if row["organization_id"] != fx.a.id {
		t.Fatalf("material created by A landed in org %v (want %s)", row["organization_id"], fx.a.id)
	}

	// Project created without ownership fields defaults everything to the
	// caller's org (pilot semantics: one factory acting as both).
	var proj struct {
		ID string `json:"id"`
	}
	fx.decode(t, http.MethodPost, "/api/projects", fx.a.admin.token, map[string]any{
		"name": "Obra Extra Alfa", "customer_id": fx.a.customer.id,
		"margin_factor": 1.35, "labor_fixed_cost": 100, "currency": "MXN",
		"organization_id": fx.b.id, // unknown-field injection
	}, http.StatusCreated, &proj)
	prow := fx.queryRow(t, `
		SELECT organization_id::text AS org, sales_organization_id::text AS sales,
		       manufacturing_organization_id::text AS mfg
		FROM projects WHERE id = $1`, proj.ID)
	for col, want := range map[string]string{"org": fx.a.id, "sales": fx.a.id, "mfg": fx.a.id} {
		if prow[col] != want {
			t.Fatalf("project created by A has %s=%v (want %s)", col, prow[col], want)
		}
	}
}

func TestPilotReadiness_ProjectOwnershipCannotTargetForeignOrg(t *testing.T) {
	// sales_organization_id of B → rejected before any write.
	fx.want(t, http.MethodPost, "/api/projects", fx.a.admin.token, map[string]any{
		"name": "Obra Hack Alfa", "customer_id": fx.a.customer.id,
		"margin_factor": 1.35, "labor_fixed_cost": 100, "currency": "MXN",
		"sales_organization_id": fx.b.id,
	}, http.StatusForbidden)

	// manufacturing_organization_id of B → rejected too.
	fx.want(t, http.MethodPost, "/api/projects", fx.a.admin.token, map[string]any{
		"name": "Obra Hack Alfa", "customer_id": fx.a.customer.id,
		"margin_factor": 1.35, "labor_fixed_cost": 100, "currency": "MXN",
		"manufacturing_organization_id": fx.b.id,
	}, http.StatusForbidden)

	// Nothing was persisted by the rejected attempts.
	row := fx.queryRow(t, `SELECT COUNT(*) AS n FROM projects WHERE name = 'Obra Hack Alfa'`)
	if n, _ := toInt(row["n"]); n != 0 {
		t.Fatalf("rejected ownership attempts persisted %d rows", n)
	}

	// A valid create then resists reassignment through the update endpoint
	// (organization ownership is server-authoritative, #327).
	var proj struct {
		ID                string `json:"id"`
		SalesOrganization string `json:"sales_organization_id"`
	}
	fx.decode(t, http.MethodPost, "/api/projects", fx.a.admin.token, map[string]any{
		"name": "Obra Sólida Alfa", "customer_id": fx.a.customer.id,
		"margin_factor": 1.35, "labor_fixed_cost": 100, "currency": "MXN",
	}, http.StatusCreated, &proj)
	if proj.SalesOrganization != fx.a.id {
		t.Fatalf("created project sales org = %q (want %s)", proj.SalesOrganization, fx.a.id)
	}

	var updated struct {
		SalesOrganization         string `json:"sales_organization_id"`
		ManufacturingOrganization string `json:"manufacturing_organization_id"`
	}
	fx.decode(t, http.MethodPut, "/api/projects/"+proj.ID, fx.a.admin.token, map[string]any{
		"name": "Obra Sólida Alfa", "customer_id": fx.a.customer.id,
		"margin_factor": 1.35, "labor_fixed_cost": 100, "currency": "MXN", "status": "draft",
		"sales_organization_id":         fx.b.id, // reassignment attempt
		"manufacturing_organization_id": fx.b.id,
	}, http.StatusOK, &updated)
	if updated.SalesOrganization != fx.a.id || updated.ManufacturingOrganization != fx.a.id {
		t.Fatalf("PUT reassigned project ownership: sales=%q mfg=%q (both must stay %s)",
			updated.SalesOrganization, updated.ManufacturingOrganization, fx.a.id)
	}

	prow := fx.queryRow(t, `
		SELECT sales_organization_id::text AS sales, manufacturing_organization_id::text AS mfg
		FROM projects WHERE id = $1`, proj.ID)
	if prow["sales"] != fx.a.id || prow["mfg"] != fx.a.id {
		t.Fatalf("PUT persisted foreign ownership: sales=%v mfg=%v", prow["sales"], prow["mfg"])
	}
}

// toInt normalizes the numeric types pgx may return (int32/int64/float64).
func toInt(v any) (int64, bool) {
	switch n := v.(type) {
	case int16:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case float64:
		return int64(n), true
	default:
		return 0, false
	}
}
