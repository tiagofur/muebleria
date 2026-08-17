package domain

import "testing"

func TestProductRolesValid(t *testing.T) {
	t.Parallel()
	for _, role := range []UserRole{
		RoleAdmin, RoleUser, RoleVendedor, RoleGerenteVentas, RoleIngeniero, RoleProduccion,
	} {
		if !IsValidUserRole(role) {
			t.Fatalf("expected valid: %s", role)
		}
	}
	if IsValidUserRole("disenador") || IsValidUserRole("carpintero") {
		t.Fatal("legacy roles must not be valid after F035")
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

