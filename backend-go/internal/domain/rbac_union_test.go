package domain_test

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ADR-0005 multi-role union semantics: the actor's permissions are the union
// of their membership roles. The "hace todo" profile of small workshops
// (vendedor + ingeniero, ADR-0005 §2) must inherit both sides without the
// combination granting anything neither role has.
func TestAnyRole_UnionSemantics(t *testing.T) {
	haceTodo := []domain.UserRole{domain.RoleVendedor, domain.RoleIngeniero}

	if !domain.AnyRole(haceTodo, domain.RoleCanMutateCatalog) {
		t.Fatal("vendedor+ingeniero debe poder mutar catálogo (hereda de ingeniero)")
	}
	if !domain.AnyRole(haceTodo, domain.RoleCanMutateCustomers) {
		t.Fatal("vendedor+ingeniero debe poder mutar clientes (hereda de vendedor)")
	}
	if domain.AnyRole([]domain.UserRole{domain.RoleVendedor}, domain.RoleCanMutateCatalog) {
		t.Fatal("vendedor solo NO muta catálogo")
	}
	if domain.AnyRole(nil, domain.RoleCanMutateCatalog) {
		t.Fatal("sin roles no hay permisos (fail-closed)")
	}
}

func TestOwnershipUnion_MultiRole(t *testing.T) {
	haceTodo := []domain.UserRole{domain.RoleVendedor, domain.RoleGerenteVentas}

	if !domain.RolesSeesAllOwners(haceTodo) {
		t.Fatal("vendedor+gerente_ventas ve todos los owners (hereda de gerente)")
	}
	if domain.RolesSeesAllOwners([]domain.UserRole{domain.RoleVendedor}) {
		t.Fatal("vendedor solo queda en su portafolio")
	}
	if !domain.CanAccessOwnedResourceRoles("u1", haceTodo, "u2") {
		t.Fatal("con rol gerente accede a fila de otro")
	}
	if domain.CanAccessOwnedResourceRoles("u1", []domain.UserRole{domain.RoleVendedor}, "u2") {
		t.Fatal("vendedor solo no accede a fila ajena")
	}

	// Assigner behavior wins as soon as one role allows it.
	if got := domain.ResolveOwnerOnCreateRoles("u1", haceTodo, "u9"); got != "u9" {
		t.Fatalf("assigner multi-rol respeta owner pedido, got %s", got)
	}
	if got := domain.ResolveOwnerOnCreateRoles("u1", []domain.UserRole{domain.RoleVendedor}, "u9"); got != "u1" {
		t.Fatalf("vendedor siempre es dueño de lo que crea, got %s", got)
	}
	if got := domain.ResolveOwnerOnUpdateRoles([]domain.UserRole{domain.RoleVendedor}, "u2", "u9"); got != "u2" {
		t.Fatalf("no-assigner conserva owner existente, got %s", got)
	}
}

func TestRolesAllScopedBySector_Union(t *testing.T) {
	if !domain.RolesAllScopedBySector([]domain.UserRole{domain.RoleProduccion, domain.RoleAlmacen}) {
		t.Fatal("produccion+almacen: todos sector-scoped")
	}
	if domain.RolesAllScopedBySector([]domain.UserRole{domain.RoleProduccion, domain.RoleIngeniero}) {
		t.Fatal("ingeniero en el set desactiva el gate de sectores")
	}
	if domain.RolesAllScopedBySector(nil) {
		t.Fatal("sin roles no aplica gate (fail-closed)")
	}
}
