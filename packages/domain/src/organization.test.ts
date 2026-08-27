import { describe, expect, it } from 'vitest';
// Fixture de paridad TS↔Go: backend-go/internal/domain/organization_test.go
// afirma contra el mismo contracts/roles.json → rolesByOrganizationType, así
// que una divergencia de roles por tipo de organización rompe CI en algún
// lado (docs/architecture.md §7).
import rolesContract from '../../../contracts/roles.json';
import {
  ORGANIZATION_TYPES,
  allowedRolesForOrgType,
  isValidOrganizationType,
  roleAllowedInOrg,
  rolesAllowedInOrg,
} from './organization';

const contractByType = rolesContract.rolesByOrganizationType as Record<
  'factory' | 'store' | 'dealer',
  string[]
>;

describe('organization types', () => {
  it('valid types match the contract keys', () => {
    expect([...ORGANIZATION_TYPES].sort()).toEqual(
      Object.keys(contractByType).sort(),
    );
    expect(isValidOrganizationType('factory')).toBe(true);
    expect(isValidOrganizationType('store')).toBe(true);
    expect(isValidOrganizationType('dealer')).toBe(true);
    expect(isValidOrganizationType('installer')).toBe(false);
    expect(isValidOrganizationType(null)).toBe(false);
  });
});

describe('allowedRolesForOrgType (#326 store roles restriction)', () => {
  it('factory assigns the full canonical set (contract parity)', () => {
    expect([...allowedRolesForOrgType('factory')].sort()).toEqual(
      [...contractByType.factory].sort(),
    );
  });

  it('store/dealer are commercial-only (contract parity)', () => {
    for (const type of ['store', 'dealer'] as const) {
      const allowed = allowedRolesForOrgType(type);
      expect([...allowed].sort()).toEqual([...contractByType[type]].sort());
      // No engineering/production operators leak into sales organizations.
      expect(allowed).not.toContain('ingeniero');
      expect(allowed).not.toContain('produccion');
      expect(allowed).not.toContain('almacen');
      expect(allowed).not.toContain('gerente_produccion');
    }
  });

  it('unknown types fall back to the full set (fail-open only for factories)', () => {
    expect(allowedRolesForOrgType('factory')).toHaveLength(8);
  });
});

describe('roleAllowedInOrg / rolesAllowedInOrg', () => {
  it('single-role membership checks', () => {
    expect(roleAllowedInOrg('vendedor', 'store')).toBe(true);
    expect(roleAllowedInOrg('ingeniero', 'store')).toBe(false);
    expect(roleAllowedInOrg('ingeniero', 'factory')).toBe(true);
  });

  it('role sets: non-empty, canonical and all allowed (mirrors Go RolesAllowedInOrg)', () => {
    expect(rolesAllowedInOrg(['vendedor'], 'store')).toBe(true);
    expect(rolesAllowedInOrg(['vendedor', 'gerente_ventas'], 'store')).toBe(
      true,
    );
    expect(rolesAllowedInOrg(['vendedor', 'ingeniero'], 'store')).toBe(false);
    expect(rolesAllowedInOrg([], 'factory')).toBe(false);
    expect(rolesAllowedInOrg(['nope'], 'factory')).toBe(false);
  });
});
