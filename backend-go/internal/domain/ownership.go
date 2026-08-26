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

// --- Multi-role union semantics (ADR-0005): permissions are the union of the
// membership's roles. Single-role functions above stay as the primitives. ---

// AnyRole reports whether any of the roles satisfies can.
func AnyRole(roles []UserRole, can func(UserRole) bool) bool {
	for _, r := range roles {
		if can(r) {
			return true
		}
	}
	return false
}

// RolesSeesAllOwners: the actor sees every row when any of their roles does.
func RolesSeesAllOwners(roles []UserRole) bool {
	return AnyRole(roles, RoleSeesAllOwners)
}

// RolesCanAssignOwner: the actor may set/reassign owners when any role can.
func RolesCanAssignOwner(roles []UserRole) bool {
	return AnyRole(roles, RoleCanAssignOwner)
}

// ResolveOwnerOnCreateRoles applies OWN rules for multi-role actors:
// assigner behavior wins as soon as one role allows assigning owners.
func ResolveOwnerOnCreateRoles(actorID string, roles []UserRole, requestedOwner string) string {
	if !RolesCanAssignOwner(roles) {
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

// ResolveOwnerOnUpdateRoles: non-assigners keep the existing owner; assigners
// may set requested or keep existing.
func ResolveOwnerOnUpdateRoles(roles []UserRole, existingOwner, requestedOwner string) string {
	if !RolesCanAssignOwner(roles) {
		return existingOwner
	}
	if requestedOwner != "" {
		return requestedOwner
	}
	return existingOwner
}

// CanAccessOwnedResourceRoles: portfolio access for multi-role actors.
func CanAccessOwnedResourceRoles(actorID string, roles []UserRole, ownerUserID string) bool {
	if RolesSeesAllOwners(roles) {
		return true
	}
	return ownerUserID != "" && ownerUserID == actorID
}
