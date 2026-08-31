import { describe, expect, it } from 'vitest';

import {
  anyRole,
  effectivePermissionPreviewForRoles,
  navIdsForRoles,
  navIdsForRole,
  rolesAllScopedBySector,
  rolesCanAccessNav,
  rolesCanViewCosts,
  rolesOfUser,
  roleCanAccessCustomers,
  roleCanMutateCatalog,
  roleIsScopedBySector,
} from './rbac';
import {
  canAccessOwnedResourceRoles,
  resolveOwnerOnCreateRoles,
  resolveOwnerOnUpdateRoles,
  rolesCanAssignOwner,
  rolesSeesAllOwners,
} from './ownership';

// ADR-0005 multi-role union semantics — mirrors backend-go
// internal/domain/rbac_union_test.go (the "hace todo" membership profile).
describe('anyRole — unión de roles', () => {
  const haceTodo = ['vendedor', 'ingeniero'];

  it('hereda permisos de ambos lados', () => {
    expect(anyRole(haceTodo, roleCanMutateCatalog)).toBe(true);
    expect(anyRole(haceTodo, roleCanAccessCustomers)).toBe(true);
  });

  it('no otorga lo que ningún rol tiene', () => {
    expect(anyRole(['vendedor'], roleCanMutateCatalog)).toBe(false);
    expect(anyRole([], roleCanMutateCatalog)).toBe(false);
    expect(anyRole([null, undefined], roleCanMutateCatalog)).toBe(false);
  });
});

describe('navIdsForRoles — unión de navegación', () => {
  it('une los navs de cada rol', () => {
    const union = navIdsForRoles(['vendedor', 'ingeniero']);
    for (const id of navIdsForRole('vendedor')) expect(union.has(id)).toBe(true);
    for (const id of navIdsForRole('ingeniero')) expect(union.has(id)).toBe(true);
  });

  it('guest (set vacío o null) mantiene la herramienta completa', () => {
    expect(navIdsForRoles([]).has('quotes')).toBe(true);
    expect(navIdsForRoles([null]).has('quotes')).toBe(true);
    expect(rolesCanAccessNav([], 'quotes')).toBe(true);
  });
});

describe('rolesAllScopedBySector', () => {
  it('gate aplica sólo si TODOS los roles son sector-scoped', () => {
    expect(rolesAllScopedBySector(['produccion', 'almacen'])).toBe(true);
    expect(rolesAllScopedBySector(['produccion', 'ingeniero'])).toBe(false);
    expect(rolesAllScopedBySector([])).toBe(false);
    expect(roleIsScopedBySector('produccion')).toBe(true);
  });
});

describe('rolesOfUser — fallback a rol único', () => {
  it('usa el set explícito cuando existe', () => {
    expect(rolesOfUser({ role: 'vendedor', roles: ['vendedor', 'ingeniero'] })).toEqual([
      'vendedor',
      'ingeniero',
    ]);
  });

  it('cae al rol único (sesiones previas al multi-rol)', () => {
    expect(rolesOfUser({ role: 'admin', roles: null })).toEqual(['admin']);
    expect(rolesOfUser({ role: null })).toEqual([]);
  });
});

// Mirrors backend-go rbac_union_test.go TestOwnershipUnion_MultiRole: the
// "hace todo" profile inherits portfolio visibility without the combination
// granting anything neither role has.
describe('ownership union (multi-role)', () => {
  const haceTodo = ['vendedor', 'gerente_ventas'] as const;
  const solo = ['vendedor'] as const;

  it('rolesSeesAllOwners: one supervising role in the set sees all', () => {
    expect(rolesSeesAllOwners([...haceTodo])).toBe(true);
    expect(rolesSeesAllOwners([...solo])).toBe(false);
    expect(rolesSeesAllOwners([])).toBe(false);
  });

  it('rolesCanAssignOwner: gerente in the set enables assigning', () => {
    expect(rolesCanAssignOwner([...haceTodo])).toBe(true);
    expect(rolesCanAssignOwner([...solo])).toBe(false);
  });

  it('canAccessOwnedResourceRoles: supervisor reaches foreign rows', () => {
    expect(canAccessOwnedResourceRoles('u1', [...haceTodo], 'u2')).toBe(true);
    expect(canAccessOwnedResourceRoles('u1', [...solo], 'u2')).toBe(false);
    expect(canAccessOwnedResourceRoles('u1', [...solo], 'u1')).toBe(true);
  });

  it('resolveOwnerOnCreateRoles: assigner behavior wins', () => {
    expect(resolveOwnerOnCreateRoles('u1', [...haceTodo], 'u9')).toBe('u9');
    expect(resolveOwnerOnCreateRoles('u1', [...solo], 'u9')).toBe('u1');
  });

  it('resolveOwnerOnUpdateRoles: non-assigners keep the existing owner', () => {
    expect(resolveOwnerOnUpdateRoles([...solo], 'u2', 'u9')).toBe('u2');
    expect(resolveOwnerOnUpdateRoles([...haceTodo], 'u2', 'u9')).toBe('u9');
  });
});

// Mirrors the server-side actorCanViewCosts: one cost-privileged role in the
// set is enough (COST-01/COST-02 with union semantics, parity pin with Go's
// TestRBAC_ViewCosts union cases).
describe('rolesCanViewCosts (union)', () => {
  it('vendedor+ingeniero sees costs even with the flag off', () => {
    expect(rolesCanViewCosts(['vendedor', 'ingeniero'])).toBe(true);
  });

  it('vendedor+almacen stays blocked even with the flag on (F094)', () => {
    expect(
      rolesCanViewCosts(['vendedor', 'almacen'], { vendedorCanViewCosts: true }),
    ).toBe(true); // flag ON unlocks vendedor
    expect(
      rolesCanViewCosts(['almacen'], { vendedorCanViewCosts: true }),
    ).toBe(false); // almacen never
    expect(
      rolesCanViewCosts(['vendedor', 'almacen'], { vendedorCanViewCosts: false }),
    ).toBe(false);
  });

  it('empty set fails closed', () => {
    expect(rolesCanViewCosts([])).toBe(false);
  });
});

describe('effectivePermissionPreviewForRoles', () => {
  it('projects union permissions and sensitive combinations from canonical rules', () => {
    const preview = effectivePermissionPreviewForRoles(['vendedor', 'ingeniero'], 'factory');
    expect(preview.permissions).toMatchObject({ quotes: true, catalog_mutation: true, costs: true, assign_admin: false });
    expect(preview.warnings).toEqual(['sales_cost_visibility']);
  });

  it('fails closed for a role set without the requested permissions', () => {
    const preview = effectivePermissionPreviewForRoles(['user'], 'factory');
    expect(preview.permissions).toMatchObject({ sales_team: false, catalog_mutation: false, costs: false, transfer_admin: false });
    expect(preview.warnings).toEqual([]);
  });
});
