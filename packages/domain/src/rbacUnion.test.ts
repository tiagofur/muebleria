import { describe, expect, it } from 'vitest';

import {
  anyRole,
  navIdsForRoles,
  navIdsForRole,
  rolesAllScopedBySector,
  rolesCanAccessNav,
  rolesOfUser,
  roleCanAccessCustomers,
  roleCanMutateCatalog,
  roleIsScopedBySector,
} from './rbac';

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
