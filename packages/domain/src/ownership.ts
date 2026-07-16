/**
 * Portfolio ownership helpers (F034 / #66 + F035 gerente).
 */

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
