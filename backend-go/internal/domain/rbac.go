package domain

// Product RBAC matrix (F035 / #67). Ownership (F034) layers on top for vendedor.

// RoleCanManageUsers — admin panel (approve / role / reject).
func RoleCanManageUsers(role UserRole) bool {
	return role == RoleAdmin
}

// RoleCanMutateCatalog — materials, edges, hardware, option groups, categories.
func RoleCanMutateCatalog(role UserRole) bool {
	return role == RoleAdmin || role == RoleIngeniero
}

// RoleCanMutateModules — module templates (muebles plantilla).
func RoleCanMutateModules(role UserRole) bool {
	return role == RoleAdmin || role == RoleIngeniero
}

// RoleCanAccessCustomers — CRM list/detail (not producción / sin puesto).
func RoleCanAccessCustomers(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleGerenteVentas, RoleVendedor:
		return true
	default:
		return false
	}
}

// RoleCanMutateCustomers — create/update/deactivate customers.
func RoleCanMutateCustomers(role UserRole) bool {
	return RoleCanAccessCustomers(role)
}

// RoleCanAccessProjects — quote / production project visibility.
func RoleCanAccessProjects(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero, RoleProduccion:
		return true
	default:
		return false
	}
}

// RoleCanMutateProjects — create/update project draft workflow.
func RoleCanMutateProjects(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleGerenteVentas, RoleVendedor:
		return true
	default:
		return false
	}
}

// RoleCanDeleteProject — hard delete; gerente/admin only (F036 reopen pairs with this).
func RoleCanDeleteProject(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteVentas
}

// RoleCanReopenProject — closed → draft (clears snapshot). Admin / gerente only.
func RoleCanReopenProject(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteVentas
}

// RoleCanMarkProduced — accepted → produced (click-only; no export gate).
func RoleCanMarkProduced(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleGerenteVentas, RoleIngeniero, RoleProduccion:
		return true
	default:
		return false
	}
}

// RoleCanViewCosts — unit costs, margin, direct cost (COST-01 / F039 + COST-02 / F044).
// Vendedor and sin puesto only see sale price unless vendedorCanViewCosts is true.
func RoleCanViewCosts(role UserRole, vendedorCanViewCosts bool) bool {
	switch role {
	case RoleVendedor, RoleUser:
		return vendedorCanViewCosts
	default:
		return true
	}
}

// RoleCanExportProduction — Optimizer / hardware list (not vendedor).
func RoleCanExportProduction(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleIngeniero, RoleProduccion, RoleGerenteVentas:
		return true
	default:
		return false
	}
}

// ProjectAllowsProductionExport is true for accepted/produced only (F041).
func ProjectAllowsProductionExport(status ProjectStatus) bool {
	return status == StatusAccepted || status == StatusProduced
}

// CanExportProductionForProject combines role + status gates (F041).
func CanExportProductionForProject(role UserRole, status ProjectStatus) bool {
	return RoleCanExportProduction(role) && ProjectAllowsProductionExport(status)
}

// RoleCanAccessSettings — workshop global defaults.
func RoleCanAccessSettings(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteVentas || role == RoleIngeniero
}

// RoleCanAccessCatalogNav — read catalog screens in UI (mutate still gated).
func RoleCanAccessCatalogNav(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleIngeniero, RoleGerenteVentas, RoleVendedor:
		return true
	default:
		return false
	}
}

// RoleCanAccessModulesNav — module templates in UI.
func RoleCanAccessModulesNav(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleIngeniero, RoleGerenteVentas, RoleVendedor:
		return true
	default:
		return false
	}
}
