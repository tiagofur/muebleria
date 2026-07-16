package domain

// RoleSeesAllOwners reports whether the role may list/read every customer and project.
// Vendedor is portfolio-scoped; user (sin puesto) sees none of others' rows.
func RoleSeesAllOwners(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleGerenteVentas, RoleIngeniero, RoleProduccion:
		return true
	default:
		return false
	}
}

// RoleCanAssignOwner reports whether the role may set or reassign ownerUserId.
func RoleCanAssignOwner(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteVentas
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

// CanAccessOwnedResource is true when the actor may read/mutate the row (portfolio layer).
func CanAccessOwnedResource(actorID string, actorRole UserRole, ownerUserID string) bool {
	if RoleSeesAllOwners(actorRole) {
		return true
	}
	return ownerUserID != "" && ownerUserID == actorID
}
