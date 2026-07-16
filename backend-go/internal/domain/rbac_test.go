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
}
