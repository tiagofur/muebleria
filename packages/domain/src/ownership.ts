/**
 * Portfolio ownership helpers (F034 / #66).
 * Until F035 (gerente_ventas), only vendedor is scoped; admin assigns owners.
 */

/** Vendedor is portfolio-scoped; other roles see all owners. */
export function roleSeesAllOwners(role: string | null | undefined): boolean {
  return role !== 'vendedor';
}

/** Admin can assign/reassign ownerUserId (gerente arrives with F035). */
export function roleCanAssignOwner(role: string | null | undefined): boolean {
  return role === 'admin';
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
