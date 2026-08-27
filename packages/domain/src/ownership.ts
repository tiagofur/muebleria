/**
 * Portfolio ownership helpers (F034 / #66 + F035 gerente).
 */

import { anyRole } from './rbac';

/** Vendedor (and sin puesto) are portfolio-scoped; sales managers and ops see all. */
export function roleSeesAllOwners(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'ingeniero' ||
    role === 'produccion'
  );
}

/** Admin and gerente can assign/reassign ownerUserId. */
export function roleCanAssignOwner(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas';
}

export function resolveOwnerOnCreate(
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
  requestedOwner?: string | null,
): string | undefined {
  if (!roleCanAssignOwner(actorRole)) {
    return actorId || undefined;
  }
  const requested = requestedOwner?.trim();
  if (requested) return requested;
  return actorId || undefined;
}

export function resolveOwnerOnUpdate(
  actorRole: string | null | undefined,
  existingOwner: string | undefined,
  requestedOwner?: string | null,
): string | undefined {
  if (!roleCanAssignOwner(actorRole)) {
    return existingOwner;
  }
  const requested = requestedOwner?.trim();
  if (requested) return requested;
  return existingOwner;
}

export function canAccessOwnedResource(
  actorId: string | null | undefined,
  actorRole: string | null | undefined,
  ownerUserId: string | undefined,
): boolean {
  if (roleSeesAllOwners(actorRole)) return true;
  return Boolean(actorId && ownerUserId && ownerUserId === actorId);
}

// --- Multi-role union semantics (ADR-0005): permissions are the union of the
// membership's roles; the single-role functions above stay as primitives.
// Mirrors backend-go/internal/domain/ownership.go — see rbacUnion.test.ts. ---

/** The actor sees every row when any of their roles does. */
export function rolesSeesAllOwners(
  roles: readonly (string | null | undefined)[],
): boolean {
  return anyRole(roles, roleSeesAllOwners);
}

/** The actor may set/reassign owners when any role can. */
export function rolesCanAssignOwner(
  roles: readonly (string | null | undefined)[],
): boolean {
  return anyRole(roles, roleCanAssignOwner);
}

/** Assigner behavior wins as soon as one role allows assigning owners. */
export function resolveOwnerOnCreateRoles(
  actorId: string | null | undefined,
  roles: readonly (string | null | undefined)[],
  requestedOwner?: string | null,
): string | undefined {
  if (!rolesCanAssignOwner(roles)) {
    return actorId || undefined;
  }
  const requested = requestedOwner?.trim();
  if (requested) return requested;
  return actorId || undefined;
}

/** Non-assigners keep the existing owner; assigners may set or keep it. */
export function resolveOwnerOnUpdateRoles(
  roles: readonly (string | null | undefined)[],
  existingOwner: string | undefined,
  requestedOwner?: string | null,
): string | undefined {
  if (!rolesCanAssignOwner(roles)) {
    return existingOwner;
  }
  const requested = requestedOwner?.trim();
  if (requested) return requested;
  return existingOwner;
}

/** Portfolio access for multi-role actors (own rows, or everything). */
export function canAccessOwnedResourceRoles(
  actorId: string | null | undefined,
  roles: readonly (string | null | undefined)[],
  ownerUserId: string | undefined,
): boolean {
  if (rolesSeesAllOwners(roles)) return true;
  return Boolean(ownerUserId && actorId && ownerUserId === actorId);
}
