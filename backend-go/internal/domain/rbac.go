package domain

// Product RBAC matrix (F035 / #67). Ownership (F034) layers on top for vendedor.

// RoleCanManageUsers — admin panel (approve / role / reject).
func RoleCanManageUsers(role UserRole) bool {
	return role == RoleAdmin
}

// RoleCanManageProductionStaff — gerente_produccion can manage production operators.
func RoleCanManageProductionStaff(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteProduccion
}

// RoleCanManageSalesStaff — gerente_ventas can manage vendedores.
func RoleCanManageSalesStaff(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteVentas
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
	case RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero, RoleProduccion, RoleGerenteProduccion:
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

// ProjectAllowsReopenToDraft mirrors TS projectAllowsReopenToDraft (#257):
// quoted → any mutate role (vendedor, gerente_ventas, admin);
// accepted/produced → admin / gerente_ventas only.
func ProjectAllowsReopenToDraft(currentStatus ProjectStatus, role UserRole) bool {
	if currentStatus == StatusDraft {
		return false
	}
	if currentStatus == StatusQuoted {
		return RoleCanMutateProjects(role)
	}
	if currentStatus == StatusAccepted || currentStatus == StatusProduced {
		return RoleCanReopenProject(role)
	}
	return false
}

// RoleCanMarkProduced — accepted → produced (click-only; no export gate).
// Almacén NO: closing a factory order is a plant-supervisor call (F094).
func RoleCanMarkProduced(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion, RoleIngeniero, RoleProduccion:
		return true
	default:
		return false
	}
}

// RoleCanViewCosts — unit costs, margin, direct cost (COST-01 / F039 + COST-02 / F044).
// Vendedor and sin puesto only see sale price unless vendedorCanViewCosts is true.
// Almacén does not see costs (F094 parity with TS rbac.ts).
func RoleCanViewCosts(role UserRole, vendedorCanViewCosts bool) bool {
	switch role {
	case RoleVendedor, RoleUser, RoleAlmacen:
		return vendedorCanViewCosts
	default:
		return true
	}
}

// RoleCanExportProduction — Optimizer / hardware list (not vendedor, not
// almacén: warehouse works from the station queue, not the factory hub — F094).
func RoleCanExportProduction(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleIngeniero, RoleProduccion, RoleGerenteVentas, RoleGerenteProduccion:
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

// RoleCanAccessModulesNav — module templates in UI (parity with TS: admin / ingeniero).
func RoleCanAccessModulesNav(role UserRole) bool {
	return role == RoleAdmin || role == RoleIngeniero
}

// RoleCanAccessProductionDashboard — full production metrics, active jobs,
// damage reports. The manager dashboard belongs to gerente_produccion
// (F094 parity with TS rbac.ts — produccion works the floor, not the books).
func RoleCanAccessProductionDashboard(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteProduccion
}

// RoleCanClaimProductionJob — produccion/almacen can claim/finish jobs in their assigned sectors.
func RoleCanClaimProductionJob(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleProduccion, RoleAlmacen:
		return true
	default:
		return false
	}
}

// RoleIsScopedBySector — check if role is scoped by user_sectors (produccion or almacen).
func RoleIsScopedBySector(role UserRole) bool {
	return role == RoleProduccion || role == RoleAlmacen
}

// SectorsAllowedForRole returns the sectors a role may be assigned to (F094).
// Returns nil for roles not scoped by sector (supervisors manage via role, not membership).
func SectorsAllowedForRole(role UserRole) []ProductionSector {
	switch role {
	case RoleProduccion:
		// All sectors (full floor)
		return []ProductionSector{
			SectorWarehouse, SectorCutting, SectorCNC, SectorEdgeBanding,
			SectorAssembly, SectorPackaging, SectorShipping, SectorInstall,
			SectorHerrajes, SectorTableros, SectorCintillas,
		}
	case RoleAlmacen:
		// Material sectors — first-class, no sub-sector nesting
		return []ProductionSector{SectorHerrajes, SectorTableros, SectorCintillas}
	default:
		return nil
	}
}

// SectorAllowedForRole checks if a specific sector is valid for the given role.
// Supervisors (nil allowed sectors) are always allowed.
func SectorAllowedForRole(role UserRole, sector ProductionSector) bool {
	allowed := SectorsAllowedForRole(role)
	if allowed == nil {
		return true // supervisors: no restriction
	}
	for _, s := range allowed {
		if s == sector {
			return true
		}
	}
	return false
}

// RoleCanAdvanceStation — may `role` move an item INTO `targetStatus`,
// given the user's assigned sectors (F094, parity with TS rbac.ts)?
//
//   - Supervisors (admin / gerente_ventas / gerente_produccion / ingeniero):
//     full pipeline.
//   - produccion: assigned sectors only; NO assignments = legacy full access.
//   - almacen: only explicitly assigned sectors — never unrestricted.
//   - Everyone else: no floor advancement.
func RoleCanAdvanceStation(role UserRole, targetStatus string, assignedSectors []string) bool {
	sector := SectorForFloorStatus(targetStatus)
	// "pending" is the queue, not a station output.
	if sector == "" {
		return false
	}
	switch role {
	case RoleAdmin, RoleGerenteProduccion, RoleGerenteVentas, RoleIngeniero:
		return true
	case RoleProduccion:
		if len(assignedSectors) == 0 {
			return true
		}
		return containsSector(assignedSectors, sector)
	case RoleAlmacen:
		return containsSector(assignedSectors, sector)
	default:
		return false
	}
}

func containsSector(sectors []string, sector string) bool {
	for _, s := range sectors {
		if s == sector {
			return true
		}
	}
	return false
}
