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

// RoleCanAccessProductionDashboard — production workers and managers see the
// factory dashboard; admin retains full access (RBAC P2 parity update).
func RoleCanAccessProductionDashboard(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteProduccion || role == RoleProduccion
}

// RoleCanAccessPurchasingNav — Compras/Almacén workspace (Fase 3): admin
// (full), gerente_produccion (read-only) and almacen (own sectors).
func RoleCanAccessPurchasingNav(role UserRole) bool {
	return role == RoleAdmin || role == RoleGerenteProduccion || role == RoleAlmacen
}

// RoleCanMarkPicking — may write a project × material picking state.
// Gerente_produccion reads the workspace but does not dispatch (read-only in
// the UI — Fase 3 parity); admin and almacen mark despachado.
func RoleCanMarkPicking(role UserRole) bool {
	return role == RoleAdmin || role == RoleAlmacen
}

// RoleCanManageStock — may write stock (movements, mínimos) in Compras/Almacén
// (Fase 3b). Gerente_produccion reads the stock dashboard; almacen manages the
// materials it handles.
func RoleCanManageStock(role UserRole) bool {
	return role == RoleAdmin || role == RoleAlmacen
}

// RoleCanManagePurchasing — suppliers + purchase orders (Fase 3c): the same
// roles that manage stock. Gerente_produccion reads them.
func RoleCanManagePurchasing(role UserRole) bool {
	return role == RoleAdmin || role == RoleAlmacen
}

// RoleCanClaimProductionJob — produccion can claim/finish jobs in their assigned sectors.
// Almacén excluded pending Compras/Almacén module (RBAC P2 parity update).
func RoleCanClaimProductionJob(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleProduccion:
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

// projectEventAppendRoles mirrors TS rbac.ts PROJECT_EVENT_APPEND_ROLES
// (OC-010..OC-024): who may append which lifecycle event to the audit log.
var projectEventAppendRoles = map[string][]UserRole{
	// Commercial pipeline + real deposit (OC-011/OC-013).
	"quote_created":   {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"quote_sent":      {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"quote_won":       {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"quote_lost":      {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"quote_expired":   {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"quote_cancelled": {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"deposit_received": {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	// Survey: ventas or ingeniería can be on site.
	"survey_started":   {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"survey_completed": {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	// Design authoring/iteration.
	"design_revision_created":  {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"design_submitted":         {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"design_approved":          {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"design_changes_requested": {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	// Multi-role sign-offs (OC-021): each lane decides its own.
	"customer_approved":    {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"customer_rejected":    {RoleAdmin, RoleGerenteVentas, RoleVendedor},
	"engineering_approved": {RoleAdmin, RoleGerenteProduccion, RoleIngeniero},
	"engineering_rejected": {RoleAdmin, RoleGerenteProduccion, RoleIngeniero},
	"project_approved":     {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
	// Engineering execution + formal release gate (OC-022).
	"engineering_started":        {RoleAdmin, RoleGerenteProduccion, RoleIngeniero},
	"engineering_documented":     {RoleAdmin, RoleGerenteProduccion, RoleIngeniero},
	"production_released":        {RoleAdmin, RoleGerenteProduccion, RoleIngeniero},
	"production_release_revoked": {RoleAdmin, RoleGerenteProduccion, RoleIngeniero},
	// Materials / warehouse.
	"materials_required":           {RoleAdmin, RoleGerenteProduccion, RoleAlmacen, RoleIngeniero},
	"materials_reserved":           {RoleAdmin, RoleGerenteProduccion, RoleAlmacen, RoleIngeniero},
	"materials_shortage_detected":  {RoleAdmin, RoleGerenteProduccion, RoleAlmacen, RoleIngeniero},
	"materials_ready":              {RoleAdmin, RoleGerenteProduccion, RoleAlmacen, RoleIngeniero},
	"materials_release_overridden": {RoleAdmin, RoleGerenteProduccion, RoleAlmacen},
	// Physical milestones.
	"production_started":    {RoleAdmin, RoleGerenteProduccion, RoleProduccion},
	"production_completed":  {RoleAdmin, RoleGerenteProduccion, RoleProduccion},
	"shipment_loaded":       {RoleAdmin, RoleGerenteProduccion, RoleProduccion, RoleAlmacen},
	"shipment_departed":     {RoleAdmin, RoleGerenteProduccion, RoleProduccion, RoleAlmacen},
	"installation_started":  {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion, RoleProduccion},
	"installation_completed": {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion, RoleProduccion},
	// Closeout.
	"punch_opened":      {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
	"punch_closed":      {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
	"client_signed_off": {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
	"project_closed":    {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
	"warranty_opened":   {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion, RoleVendedor},
	// Change orders (OC-024): anyone in the deal can request; decisions are
	// gerente/admin because they carry price/schedule impact.
	"change_order_created":   {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"change_order_submitted": {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"change_order_cancelled": {RoleAdmin, RoleGerenteVentas, RoleVendedor, RoleIngeniero},
	"change_order_approved":  {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
	"change_order_rejected":  {RoleAdmin, RoleGerenteVentas, RoleGerenteProduccion},
}

// RoleCanAppendProjectEvent — server-side gate for the append-only lifecycle
// log (OC-010). Mirrors TS roleCanAppendProjectEvent; enforced on
// POST /api/projects/{id}/events and on new events arriving via
// PUT /api/projects/{id}.
func RoleCanAppendProjectEvent(role UserRole, eventType string) bool {
	allowed, ok := projectEventAppendRoles[eventType]
	if !ok {
		return false
	}
	for _, r := range allowed {
		if r == role {
			return true
		}
	}
	return false
}
