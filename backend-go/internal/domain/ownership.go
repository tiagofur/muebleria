package domain

// RoleSeesAllOwners reports whether the role may list/read every customer and project.
// Until F035 (gerente_ventas), only vendedor is portfolio-scoped.
func RoleSeesAllOwners(role UserRole) bool {
	return role != RoleVendedor
}

// RoleCanAssignOwner reports whether the role may set or reassign ownerUserId.
// Admin only until F035 introduces gerente_ventas.
func RoleCanAssignOwner(role UserRole) bool {
	return role == RoleAdmin
}

// ResolveOwnerOnCreate applies OWN rules for create payloads.
// Vendedor always owns as self; others default to actor when empty; assigners may pick.
func ResolveOwnerOnCreate(actorID string, actorRole UserRole, requestedOwner string) string {
	if !RoleCanAssignOwner(actorRole) {
		return actorID
	}
	if requestedOwner != "" {
		return requestedOwner
	}
	if actorID != "" {
		return actorID
	}
	return requestedOwner
}

// ResolveOwnerOnUpdate returns the owner to persist on update.
// Non-assigners cannot change ownership (keep existing). Assigners may set requested or keep existing.
func ResolveOwnerOnUpdate(actorRole UserRole, existingOwner, requestedOwner string) string {
	if !RoleCanAssignOwner(actorRole) {
		return existingOwner
	}
	if requestedOwner != "" {
		return requestedOwner
	}
	return existingOwner
}

// CanAccessOwnedResource is true when the actor may read/mutate the row.
func CanAccessOwnedResource(actorID string, actorRole UserRole, ownerUserID string) bool {
	if RoleSeesAllOwners(actorRole) {
		return true
	}
	return ownerUserID != "" && ownerUserID == actorID
}
