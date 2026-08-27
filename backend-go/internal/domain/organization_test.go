package domain_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// contracts/roles.json → rolesByOrganizationType es el fixture de paridad
// TS↔Go (#326): packages/domain/src/organization.test.ts afirma contra el
// mismo archivo, así que una divergencia rompe CI en algún lado.
type orgRolesContractFixture struct {
	RolesByOrganizationType map[string][]string `json:"rolesByOrganizationType"`
}

func TestAllowedRolesForOrgType_MatchesContract(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "roles.json"))
	if err != nil {
		t.Fatalf("read contracts/roles.json: %v", err)
	}
	var c orgRolesContractFixture
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatalf("parse contracts/roles.json: %v", err)
	}
	if len(c.RolesByOrganizationType) == 0 {
		t.Fatal("contracts/roles.json debe definir rolesByOrganizationType")
	}

	for orgType, contractRoles := range c.RolesByOrganizationType {
		got := domain.AllowedRolesForOrgType(domain.OrganizationType(orgType))
		if len(got) != len(contractRoles) {
			t.Fatalf("org type %s: Got %d roles, contract wants %d", orgType, len(got), len(contractRoles))
		}
		set := make(map[string]bool, len(contractRoles))
		for _, r := range contractRoles {
			set[r] = true
		}
		for _, r := range got {
			if !set[string(r)] {
				t.Fatalf("org type %s: role %s not in contract", orgType, r)
			}
		}
	}
}

func TestRolesAllowedInOrg_StoreRestrictsOperators(t *testing.T) {
	t.Parallel()
	if !domain.RolesAllowedInOrg([]domain.UserRole{domain.RoleVendedor, domain.RoleGerenteVentas}, domain.OrganizationTypeStore) {
		t.Fatal("commercial set must be allowed in store")
	}
	if domain.RolesAllowedInOrg([]domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero}, domain.OrganizationTypeStore) {
		t.Fatal("ingeniero must be rejected in store")
	}
	if domain.RolesAllowedInOrg([]domain.UserRole{domain.RoleIngeniero}, domain.OrganizationTypeFactory) != true {
		t.Fatal("factory allows the full canonical set")
	}
	if domain.RolesAllowedInOrg(nil, domain.OrganizationTypeFactory) {
		t.Fatal("empty role set is invalid (fail-closed)")
	}
}
