package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// contracts/roles.json es el fixture de paridad TS↔Go (OC-004): el test de
// packages/domain/src/rbac.test.ts afirma contra el mismo archivo, así que
// cualquier divergencia rompe CI en algún lado (docs/architecture.md §7:
// no declarar paridad sólo por inspección manual).
type rolesContractFixture struct {
	CanonicalRoles []string `json:"canonicalRoles"`
	RejectedRoles  []string `json:"rejectedRoles"`
}

func loadRolesContract(t *testing.T) rolesContractFixture {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "roles.json"))
	if err != nil {
		t.Fatalf("read contracts/roles.json: %v", err)
	}
	var c rolesContractFixture
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatalf("parse contracts/roles.json: %v", err)
	}
	if len(c.CanonicalRoles) == 0 || len(c.RejectedRoles) == 0 {
		t.Fatal("contracts/roles.json debe definir canonicalRoles y rejectedRoles")
	}
	return c
}

func TestProductRolesValid(t *testing.T) {
	t.Parallel()
	contract := loadRolesContract(t)

	goRoles := []string{
		string(RoleAdmin), string(RoleUser), string(RoleVendedor), string(RoleGerenteVentas),
		string(RoleGerenteProduccion), string(RoleIngeniero), string(RoleProduccion), string(RoleAlmacen),
	}
	slices.Sort(goRoles)
	want := slices.Clone(contract.CanonicalRoles)
	slices.Sort(want)
	if !slices.Equal(goRoles, want) {
		t.Fatalf("el set de roles Go diverge del contrato: go=%v contrato=%v", goRoles, want)
	}

	for _, role := range contract.CanonicalRoles {
		if !IsValidUserRole(UserRole(role)) {
			t.Errorf("rol del contrato debe ser válido: %s", role)
		}
	}
	for _, role := range contract.RejectedRoles {
		if IsValidUserRole(UserRole(role)) {
			t.Errorf("rol debe ser rechazado: %s", role)
		}
	}
}

func TestRBAC_CatalogMutate(t *testing.T) {
	t.Parallel()
	if !RoleCanMutateCatalog(RoleAdmin) || !RoleCanMutateCatalog(RoleIngeniero) {
		t.Fatal("admin/ingeniero mutate catalog")
	}
	for _, role := range []UserRole{RoleVendedor, RoleProduccion, RoleGerenteVentas, RoleUser} {
		if RoleCanMutateCatalog(role) {
			t.Fatalf("%s must not mutate catalog", role)
		}
	}
}

func TestRBAC_ProjectDelete(t *testing.T) {
	t.Parallel()
	if !RoleCanDeleteProject(RoleAdmin) || !RoleCanDeleteProject(RoleGerenteVentas) {
		t.Fatal("admin/gerente delete")
	}
	if RoleCanDeleteProject(RoleVendedor) || RoleCanDeleteProject(RoleIngeniero) {
		t.Fatal("vendedor/ingeniero cannot delete project")
	}
}

func TestRBAC_ExportProduction(t *testing.T) {
	t.Parallel()
	if RoleCanExportProduction(RoleVendedor) {
		t.Fatal("vendedor cannot export production")
	}
	if !RoleCanExportProduction(RoleIngeniero) || !RoleCanExportProduction(RoleProduccion) {
		t.Fatal("ingeniero/produccion export production")
	}
	if !CanExportProductionForProject(RoleIngeniero, StatusAccepted) {
		t.Fatal("ingeniero accepted export")
	}
	if CanExportProductionForProject(RoleIngeniero, StatusDraft) {
		t.Fatal("ingeniero draft must not production-export")
	}
	if CanExportProductionForProject(RoleVendedor, StatusAccepted) {
		t.Fatal("vendedor accepted must not production-export")
	}
}

func TestRBAC_CustomersAccess(t *testing.T) {
	t.Parallel()
	if RoleCanAccessCustomers(RoleProduccion) || RoleCanAccessCustomers(RoleIngeniero) {
		t.Fatal("prod/engineer no CRM")
	}
	if !RoleCanAccessCustomers(RoleVendedor) {
		t.Fatal("vendedor CRM")
	}
}

func TestRBAC_ViewCosts(t *testing.T) {
	t.Parallel()
	if RoleCanViewCosts(RoleVendedor, false) {
		t.Fatal("vendedor no costs")
	}
	if !RoleCanViewCosts(RoleVendedor, true) {
		t.Fatal("vendedor costs when flag on")
	}
	if !RoleCanViewCosts(RoleGerenteVentas, false) {
		t.Fatal("gerente sees costs")
	}
	// Parity pin TS↔Go (COST-02 scopes the flag to vendedor/user): almacén is
	// denied even with the flag on (F094).
	if RoleCanViewCosts(RoleAlmacen, false) || RoleCanViewCosts(RoleAlmacen, true) {
		t.Fatal("almacen never sees costs")
	}
	// Union semantics: one cost-privileged role in the set is enough
	// (mirrors actorCanViewCosts in the API layer).
	if !AnyRole([]UserRole{RoleVendedor, RoleIngeniero}, func(r UserRole) bool {
		return RoleCanViewCosts(r, false)
	}) {
		t.Fatal("union: vendedor+ingeniero sees costs")
	}
	if AnyRole([]UserRole{RoleVendedor, RoleAlmacen}, func(r UserRole) bool {
		return RoleCanViewCosts(r, false)
	}) {
		t.Fatal("union: vendedor+almacen stays blocked without privileged roles")
	}
}

func TestRBAC_ReopenAndMarkProduced(t *testing.T) {
	t.Parallel()
	if !RoleCanReopenProject(RoleAdmin) || !RoleCanReopenProject(RoleGerenteVentas) {
		t.Fatal("admin/gerente reopen")
	}
	if RoleCanReopenProject(RoleVendedor) {
		t.Fatal("vendedor cannot reopen")
	}
	if !RoleCanMarkProduced(RoleProduccion) || !RoleCanMarkProduced(RoleIngeniero) {
		t.Fatal("prod/eng mark produced")
	}
	if RoleCanMarkProduced(RoleVendedor) {
		t.Fatal("vendedor cannot mark produced")
	}

	// ProjectAllowsReopenToDraft (#257)
	if ProjectAllowsReopenToDraft(StatusDraft, RoleAdmin) {
		t.Fatal("cannot reopen draft")
	}
	if !ProjectAllowsReopenToDraft(StatusQuoted, RoleVendedor) {
		t.Fatal("vendedor should be able to reopen quoted")
	}
	if !ProjectAllowsReopenToDraft(StatusQuoted, RoleAdmin) {
		t.Fatal("admin should be able to reopen quoted")
	}
	if ProjectAllowsReopenToDraft(StatusAccepted, RoleVendedor) {
		t.Fatal("vendedor cannot reopen accepted")
	}
	if !ProjectAllowsReopenToDraft(StatusAccepted, RoleAdmin) {
		t.Fatal("admin can reopen accepted")
	}
	if ProjectAllowsReopenToDraft(StatusProduced, RoleVendedor) {
		t.Fatal("vendedor cannot reopen produced")
	}
	if !ProjectAllowsReopenToDraft(StatusProduced, RoleGerenteVentas) {
		t.Fatal("gerente can reopen produced")
	}
}

func TestSectorsAllowedForRole(t *testing.T) {
	t.Parallel()

	// produccion: all 11 sectors
	prodSectors := SectorsAllowedForRole(RoleProduccion)
	if len(prodSectors) != 11 {
		t.Fatalf("produccion should have 11 sectors, got %d", len(prodSectors))
	}
	prodMap := make(map[ProductionSector]bool)
	for _, s := range prodSectors {
		prodMap[s] = true
	}
	for _, expected := range []ProductionSector{
		SectorWarehouse, SectorCutting, SectorCNC, SectorEdgeBanding,
		SectorAssembly, SectorPackaging, SectorShipping, SectorInstall,
		SectorHerrajes, SectorTableros, SectorCintillas,
	} {
		if !prodMap[expected] {
			t.Fatalf("produccion missing sector: %s", expected)
		}
	}

	// almacen: 3 material sectors (first-class, no sub-sector nesting)
	almacenSectors := SectorsAllowedForRole(RoleAlmacen)
	if len(almacenSectors) != 3 {
		t.Fatalf("almacen should have 3 sectors, got %d", len(almacenSectors))
	}
	almacenMap := make(map[ProductionSector]bool)
	for _, s := range almacenSectors {
		almacenMap[s] = true
	}
	for _, expected := range []ProductionSector{SectorHerrajes, SectorTableros, SectorCintillas} {
		if !almacenMap[expected] {
			t.Fatalf("almacen missing sector: %s", expected)
		}
	}

	// Supervisors: nil (no restriction)
	for _, role := range []UserRole{RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion, RoleIngeniero} {
		if s := SectorsAllowedForRole(role); s != nil {
			t.Fatalf("supervisor %s should have nil allowed sectors, got %v", role, s)
		}
	}
}

func TestSectorAllowedForRole(t *testing.T) {
	t.Parallel()

	// produccion: all sectors allowed
	if !SectorAllowedForRole(RoleProduccion, SectorCutting) {
		t.Fatal("produccion should be allowed cutting")
	}
	if !SectorAllowedForRole(RoleProduccion, SectorHerrajes) {
		t.Fatal("produccion should be allowed herrajes")
	}

	// almacen: only material sectors
	if !SectorAllowedForRole(RoleAlmacen, SectorHerrajes) {
		t.Fatal("almacen should be allowed herrajes")
	}
	if !SectorAllowedForRole(RoleAlmacen, SectorTableros) {
		t.Fatal("almacen should be allowed tableros")
	}
	if !SectorAllowedForRole(RoleAlmacen, SectorCintillas) {
		t.Fatal("almacen should be allowed cintillas")
	}
	if SectorAllowedForRole(RoleAlmacen, SectorCutting) {
		t.Fatal("almacen must NOT be allowed cutting")
	}
	if SectorAllowedForRole(RoleAlmacen, SectorAssembly) {
		t.Fatal("almacen must NOT be allowed assembly")
	}
	if SectorAllowedForRole(RoleAlmacen, SectorWarehouse) {
		t.Fatal("almacen must NOT be allowed warehouse")
	}

	// Supervisors: always allowed
	if !SectorAllowedForRole(RoleAdmin, SectorCutting) {
		t.Fatal("admin should be allowed any sector")
	}
	if !SectorAllowedForRole(RoleGerenteProduccion, SectorHerrajes) {
		t.Fatal("gerente_produccion should be allowed any sector")
	}
}

func TestRoleCanWorkSector_ProductionWithoutAssignmentsFailsClosed(t *testing.T) {
	if RoleCanWorkSector(RoleProduccion, SectorCutting, nil) {
		t.Fatal("production membership without sectors must not work a station")
	}
	if !RoleCanWorkSector(RoleProduccion, SectorCutting, []string{"cutting"}) {
		t.Fatal("assigned production membership must work its station")
	}
}

// #395 / DT-11: design approval and production release are distinct
// capabilities — publishing (RoleCanMutateProjects) never implies either.
// Parity with packages/domain/src/rbac.ts.
func TestRoleCanApproveDesignRevisions(t *testing.T) {
	t.Parallel()
	for _, role := range []UserRole{RoleAdmin, RoleGerenteVentas, RoleIngeniero} {
		if !RoleCanApproveDesignRevisions(role) {
			t.Errorf("%s must approve design revisions", role)
		}
	}
	for _, role := range []UserRole{RoleVendedor, RoleProduccion, RoleAlmacen, RoleUser, RoleGerenteProduccion} {
		if RoleCanApproveDesignRevisions(role) {
			t.Errorf("%s must not approve design revisions", role)
		}
	}
}

func TestRoleCanReleaseProduction(t *testing.T) {
	t.Parallel()
	for _, role := range []UserRole{RoleAdmin, RoleGerenteProduccion, RoleIngeniero} {
		if !RoleCanReleaseProduction(role) {
			t.Errorf("%s must release production", role)
		}
	}
	for _, role := range []UserRole{RoleVendedor, RoleGerenteVentas, RoleProduccion, RoleAlmacen, RoleUser} {
		if RoleCanReleaseProduction(role) {
			t.Errorf("%s must not release production", role)
		}
	}
	// The sales editor (vendedor) publishes designs but neither approves
	// production nor releases: three separate decisions.
	if !RoleCanMutateProjects(RoleVendedor) {
		t.Errorf("vendedor keeps design editing/publishing")
	}
}
