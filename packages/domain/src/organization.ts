/**
 * Multi-organization identity mirrors (ADR-0005 / #325): organization types
 * and the membership roles each type may assign. Mirrors
 * backend-go/internal/domain/organization.go; both sides pin
 * contracts/roles.json → rolesByOrganizationType so a divergence breaks CI.
 */

import { isValidUserRole } from './rbac';

export type OrganizationType = 'factory' | 'store' | 'dealer';

export const ORGANIZATION_TYPES: readonly OrganizationType[] = [
  'factory',
  'store',
  'dealer',
];

export function isValidOrganizationType(
  type: string | null | undefined,
): type is OrganizationType {
  return type === 'factory' || type === 'store' || type === 'dealer';
}

/** Commercial + coordination roles store/dealer orgs may use (#326). */
const COMMERCIAL_ROLE_SET: ReadonlySet<string> = new Set([
  'admin',
  'user',
  'vendedor',
  'gerente_ventas',
]);

/** All canonical roles in a stable display order (mirrors Go ordering). */
const ALL_ROLES: readonly string[] = [
  'admin',
  'user',
  'vendedor',
  'gerente_ventas',
  'gerente_produccion',
  'ingeniero',
  'produccion',
  'almacen',
];

/**
 * Roles each organization type may assign: factories use the full canonical
 * set; store/dealer are commercial-only (#326 "Store roles are restricted to
 * allowed roles").
 */
export function allowedRolesForOrgType(
  type: OrganizationType | string | null | undefined,
): readonly string[] {
  if (type === 'store' || type === 'dealer') {
    return ALL_ROLES.filter((r) => COMMERCIAL_ROLE_SET.has(r));
  }
  return ALL_ROLES;
}

/** Whether a single role may be assigned in the org type. */
export function roleAllowedInOrg(
  role: string,
  type: OrganizationType | string | null | undefined,
): boolean {
  if (type === 'store' || type === 'dealer') {
    return COMMERCIAL_ROLE_SET.has(role);
  }
  return true;
}

/** Validates a whole role set for the org type (non-empty + canonical + all allowed). */
export function rolesAllowedInOrg(
  roles: readonly (string | null | undefined)[],
  type: OrganizationType | string | null | undefined,
): boolean {
  const clean = roles.filter((r): r is string => r != null);
  if (clean.length === 0) return false;
  if (!clean.every((r) => isValidUserRole(r))) return false;
  return clean.every((r) => roleAllowedInOrg(r, type));
}
