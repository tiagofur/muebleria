/**
 * Product RBAC matrix (F035 / #67).
 * Portfolio ownership (F034) layers on top for vendedor.
 */

import type { ItemFloorStatus, UserRole } from './types';
import {
  PRODUCTION_SECTORS,
  sectorForFloorStatus,
  type ProductionSector,
} from './productionSectors';

export type { UserRole };
export type ProductRole = UserRole;

export const USER_ROLES: readonly UserRole[] = [
  'admin',
  'user',
  'vendedor',
  'gerente_ventas',
  'gerente_produccion',
  'ingeniero',
  'produccion',
  'almacen',
] as const;

export const PRODUCT_ROLES: readonly ProductRole[] = USER_ROLES;

/** Assignable job titles from admin panel (includes sin puesto). */
export const ASSIGNABLE_ROLES: readonly ProductRole[] = PRODUCT_ROLES;

export function isValidUserRole(role: string | null | undefined): role is ProductRole {
  return (
    role === 'admin' ||
    role === 'user' ||
    role === 'vendedor' ||
    role === 'gerente_ventas' ||
    role === 'gerente_produccion' ||
    role === 'ingeniero' ||
    role === 'produccion' ||
    role === 'almacen'
  );
}

export function roleCanManageUsers(role: string | null | undefined): boolean {
  return role === 'admin';
}

export function roleCanManageProductionStaff(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_produccion';
}

export function roleCanManageSalesStaff(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas';
}

export function roleCanMutateCatalog(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'ingeniero';
}

export function roleCanMutateModules(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'ingeniero';
}

export function roleCanAccessCustomers(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas' || role === 'vendedor';
}

export function roleCanMutateCustomers(role: string | null | undefined): boolean {
  return roleCanAccessCustomers(role);
}

export function roleCanAccessProjects(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'gerente_produccion' ||
    role === 'vendedor' ||
    role === 'ingeniero' ||
    role === 'produccion'
  );
}

export function roleCanMutateProjects(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas' || role === 'vendedor';
}

export function roleCanDeleteProject(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas';
}

/**
 * Reopen **quoted** → draft (client wants changes before accept).
 * Vendedor (own portfolio) + gerente + admin. Not after accepted/produced
 * (that gate is status-based: `projectAllowsReopenToDraft`).
 * #257 refinement — previously gerente-only for all closed statuses.
 */
export function roleCanReopenProject(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'vendedor'
  );
}

/**
 * Mark accepted → produced (click-only, no export gate).
 * Admin, gerentes, ingeniero y produccion (F036). Almacén NO: closing a
 * factory order is a plant-supervisor call, not a warehouse one (F094).
 */
export function roleCanMarkProduced(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'gerente_produccion' ||
    role === 'ingeniero' ||
    role === 'produccion'
  );
}

/**
 * Factory exports / OP hub (F041 + F094). Almacén stays OUT of the hub:
 * their surface is the station queue (staging + assigned sectors), not
 * Optimizer/pack/documentos de fábrica.
 */
export function roleCanExportProduction(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'produccion' ||
    role === 'gerente_produccion' ||
    role === 'gerente_ventas'
  );
}

/**
 * Production Excel (Optimizer / herrajes) only for plant-ready statuses (F041).
 * Draft/quoted are commercial only — not production cut lists.
 */
export function projectAllowsProductionExport(
  status: string | null | undefined,
): boolean {
  return status === 'accepted' || status === 'produced';
}

/** Combined gate: role may export production AND project status allows it. */
export function canExportProductionForProject(
  role: string | null | undefined,
  status: string | null | undefined,
): boolean {
  return roleCanExportProduction(role) && projectAllowsProductionExport(status);
}

export function roleCanAccessSettings(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas' || role === 'ingeniero';
}

/**
 * Home portfolio dashboard: totals + breakdown by owner (F037).
 * Admin and gerente see all owners; others do not get the multi-owner table.
 */
export function roleCanViewPortfolioDashboard(
  role: string | null | undefined,
): boolean {
  return role === 'admin' || role === 'gerente_ventas' || role === 'gerente_produccion';
}

/**
 * Production Manager Dashboard: full visibility across all areas, operators,
 * machines, queues, and metrics. Distinct from the basic plant board (F093)
 * which is read-only for all roles.
 * 
 * The gerente_produccion can:
 * - See all queues and who is working on what
 * - Move items between queues
 * - Reassign items to different operators
 * - Change priorities
 * - View metrics and time tracking
 */
export function roleCanAccessProductionDashboard(
  role: string | null | undefined,
): boolean {
  return role === 'admin' || role === 'gerente_produccion' || role === 'produccion';
}

/**
 * Engineering workspace: documentation, optimization, and production prep.
 * Engineers and admins can access it; guest/local cannot.
 */
export function roleCanAccessEngineeringNav(
  role: string | null | undefined,
): boolean {
  return role === 'admin' || role === 'ingeniero';
}

/**
 * Engineering Dashboard: analytics, queue wait times, cycle times, workload.
 * Accessible by admin, ingeniero, and gerente_produccion.
 */
export function roleCanAccessEngineeringDashboard(
  role: string | null | undefined,
): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'gerente_produccion'
  );
}

/**
 * Sales dashboard: pipeline, summary cards, project list, alerts.
 * Vendedor sees own portfolio; gerente_ventas and admin see all.
 */
export function roleCanAccessSalesDashboard(
  role: string | null | undefined,
): boolean {
  return role === 'admin' || role === 'gerente_ventas' || role === 'vendedor';
}

/**
 * Role whose *project list* is plant-filtered (accepted/produced only).
 * Historically F038: only `produccion` works the floor queue as portfolio.
 * Do not expand this without revisiting `projectsForRole` filtering.
 */
export function roleUsesProductionQueue(
  role: string | null | undefined,
): boolean {
  return role === 'produccion' || role === 'gerente_produccion';
}

/**
 * Sidebar «Producción» + OP hub (PROD-0.1).
 * Export roles (F041) can open the factory workspace; guest/local stays off.
 * Distinct from `roleUsesProductionQueue` so ingeniero keeps full quote list.
 */
export function roleCanAccessProductionNav(
  role: string | null | undefined,
): boolean {
  return roleCanExportProduction(role);
}

/**
 * Compras / Almacén workspace (Fase 3): picking lists per active project.
 * - admin: full access (can mark despachado).
 * - gerente_produccion: read-only (no dispatch button).
 * - almacen: own assigned material sectors (herrajes/tableros/cintillas).
 * Everyone else stays out — engineering/sales work upstream of picking.
 */
export function roleCanAccessPurchasingNav(
  role: string | null | undefined,
): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_produccion' ||
    role === 'almacen'
  );
}

/**
 * Warehouse Dashboard: analytics, material demand, stock health, PO summary.
 * Accessible by admin, almacen, and gerente_produccion.
 */
export function roleCanAccessWarehouseDashboard(
  role: string | null | undefined,
): boolean {
  return (
    role === 'admin' ||
    role === 'almacen' ||
    role === 'gerente_produccion'
  );
}

/**
 * Production/warehouse workers can claim/finish jobs in their assigned sectors.
 * Distinct from gerente_produccion which sees everything.
 */
export function roleCanClaimProductionJob(
  role: string | null | undefined,
): boolean {
  return role === 'admin' || role === 'produccion';
}

/**
 * May write a project × material picking state (Fase 3 persistence).
 * Gerente_produccion reads the workspace but does not dispatch — the screen
 * shows it read-only; admin and almacen mark despachado.
 */
export function roleCanMarkPicking(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'almacen';
}

/**
 * May write stock (movements, mínimos) in Compras/Almacén (Fase 3b).
 * Gerente_produccion reads the stock dashboard; admin and almacen manage it.
 */
export function roleCanManageStock(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'almacen';
}

/**
 * May write suppliers + purchase orders (Fase 3c): the same roles that
 * manage stock. Gerente_produccion reads the directory and the orders.
 */
export function roleCanManagePurchasing(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'almacen';
}

/** Check if role is scoped by user_sectors (produccion or almacen). */
export function roleIsScopedBySector(role: string | null | undefined): boolean {
  return role === 'produccion' || role === 'almacen';
}

/**
 * May open Fábrica (roadmap-screens Fase 4.4 — cross-dashboard view).
 *
 * - Sector-scoped operators (produccion/almacen): their assigned tabs.
 * - admin / gerente_produccion: all tabs + the [Cola]/[Métricas] toggle
 *   (03-fabrica.md §1 — supervisors work the full floor).
 */
export function roleCanAccessFabricNav(role: string | null | undefined): boolean {
  return (
    roleIsScopedBySector(role) ||
    role === 'admin' ||
    role === 'gerente_produccion'
  );
}

/**
 * May open the logistics screens: Embarques (despacho/carga) and
 * Instalaciones (instalación en obra).
 *
 * Those stations belong to the production floor and its supervisors;
 */
export function roleCanAccessShippingNav(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_produccion' || role === 'produccion';
}

/**
 * Embarques — staging + loading of finished goods (moved to Almacén scope
 * 2026-08-18). Warehouse handles dispatch logistics.
 */
export function roleCanAccessEmbarquesNav(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_produccion' || role === 'almacen';
}

/**
 * Sectors a role may be assigned to (F094 — role↔sector binding).
 *
 * - `produccion`: all pipeline stations + warehouse + cnc (full floor).
 * - `almacen`: material sectors — herrajes, tableros, cintillas (each a
 *   first-class sector, no sub-sector nesting).
 * - Supervisors / others: not scoped by sector (return empty — they see
 *   everything via role, not sector membership).
 */
export function sectorsAllowedForRole(
  role: string | null | undefined,
): readonly ProductionSector[] {
  if (role === 'produccion') {
    return PRODUCTION_SECTORS; // all sectors
  }
  if (role === 'almacen') {
    return ['herrajes', 'tableros', 'cintillas'];
  }
  return [];
}

/**
 * May `role` advance an item INTO `target`, given the user's assigned
 * sectors (F094 — station separation)?
 *
 * - Supervisors (admin / gerente_ventas / gerente_produccion / ingeniero):
 *   full pipeline.
 * - `produccion`: only sectors assigned via user_sectors. NO assignments =
 *   legacy full access (existing operators keep working every station).
 * - `almacen`: ONLY explicitly assigned sectors — never unrestricted
 *   (warehouse staging produces no floor status of its own).
 * - Everyone else (vendedor / user / guest): no floor advancement.
 */
export function roleCanAdvanceStation(
  role: string | null | undefined,
  target: ItemFloorStatus,
  assignedSectors?: readonly string[] | null,
): boolean {
  const sector = sectorForFloorStatus(target);
  // 'pending' is nobody's station output — it is the queue, not a step.
  if (sector === null) return false;

  if (
    role === 'admin' ||
    role === 'gerente_produccion' ||
    role === 'gerente_ventas' ||
    role === 'ingeniero'
  ) {
    return true;
  }
  if (role === 'produccion') {
    if (!assignedSectors || assignedSectors.length === 0) return true;
    return assignedSectors.includes(sector);
  }
  if (role === 'almacen') {
    return (assignedSectors ?? []).includes(sector);
  }
  return false;
}

/** User-sector assignment for operators. */
export type UserSector = {
  readonly userId: string;
  readonly sector: string;
  readonly subSector?: string;
};

/**
 * Optional workshop setting for COST-02 (F044).
 * When true, vendedor/user may see the cost stack; default is hide (COST-01).
 */
export type CostVisibilityOptions = {
  readonly vendedorCanViewCosts?: boolean;
};

/**
 * Workshop cost structure (unit costs, margin, direct cost) — COST-01 / F039
 * + COST-02 / F044 workshop flag for vendedor.
 * Vendedor (and sin puesto) only see sale price unless `vendedorCanViewCosts`.
 */
export function roleCanViewCosts(
  role: string | null | undefined,
  options?: CostVisibilityOptions,
): boolean {
  if (role === 'vendedor' || role === 'user') {
    return options?.vendedorCanViewCosts === true;
  }
  // Guest / local shell passes null — full workshop tool.
  if (role == null) return true;
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'gerente_produccion' ||
    role === 'ingeniero' ||
    role === 'produccion'
  );
}

export function roleCanAccessCatalogNav(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'gerente_ventas' ||
    role === 'vendedor'
  );
}

/** Trabajo → Vitrina (catálogo comercial). */
export function roleCanAccessShowcaseNav(
  role: string | null | undefined,
): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'gerente_ventas' ||
    role === 'vendedor'
  );
}

/**
 * Ingeniería → Muebles (plantillas ABM).
 * Mutate is still gated by `roleCanMutateModules` on the screen.
 */
export function roleCanAccessModulesNav(role: string | null | undefined): boolean {
  return roleCanMutateModules(role);
}

/** Spanish labels for taller UI. */
export function roleLabelEs(role: string | null | undefined): string {
  const map: Record<string, string> = {
    admin: 'Admin',
    user: 'Sin puesto',
    vendedor: 'Vendedor',
    gerente_ventas: 'Gerente de ventas',
    gerente_produccion: 'Gerente de producción',
    ingeniero: 'Ingeniero',
    produccion: 'Producción',
    almacen: 'Almacén',
  };
  if (!role) return '—';
  return map[role] ?? role;
}

/** Nav section ids that a role may open (guest = all). */
export function navIdsForRole(role: string | null | undefined): ReadonlySet<string> {
  if (role == null) {
    // guest / local mode — full tool (no `orders` nav, no RBAC to plant queue).
    // F118 S5: NO 'users' — the screen requires an authenticated admin, so
    // the nav item was dead (click did nothing).
    return new Set([
      'home',
      'quotes',
      'customers',
      'showcase',
      'plantBoard',
      'modules',
      'structures',
      'components',
      'addOns',
      'materials',
      'edges',
      'hardware',
      'finishes',
      'optionGroups',
      'settings',
    ]);
  }
  const ids = new Set<string>(['home']);
  // F093 — Estado de Planta: factory progress is visible to EVERY role
  // (sales answers "where is my project"); read-only board.
  ids.add('plantBoard');
  if (roleCanAccessProjects(role)) ids.add('quotes');
  if (roleCanAccessCustomers(role)) ids.add('customers');
  if (roleCanAccessShowcaseNav(role)) ids.add('showcase');
  // Ingeniería: Muebles + Estructuras + Componentes + Agregados + Acabados (admin / ingeniero)
  if (roleCanAccessModulesNav(role)) ids.add('modules');
  if (roleCanMutateModules(role)) {
    ids.add('structures');
    ids.add('components');
    ids.add('addOns');
    ids.add('finishes');
  }
  if (roleCanAccessCatalogNav(role)) {
    ids.add('materials');
    ids.add('edges');
    ids.add('hardware');
    ids.add('optionGroups');
  }
  if (roleCanAccessSettings(role)) ids.add('settings');
  if (roleCanManageUsers(role)) ids.add('users');
  // Fábrica: work queue for sector-scoped operators and supervisors —
  // manufacturing stations only (corte→embalaje); despacho/instalación live
  // in Embarques.
  // Nav id `production` = Producción (factory floor screen).
  if (roleCanAccessFabricNav(role)) ids.add('production');
  // Embarques: staging + loading of finished goods (Almacén scope).
  if (roleCanAccessEmbarquesNav(role)) ids.add('shipments');
  // Instalaciones: last-mile delivery + installation (Producción scope).
  if (roleCanAccessShippingNav(role)) ids.add('installations');
  // PROD-0.1: Órdenes — per-project factory workspace for production-export roles.
  if (roleCanAccessProductionNav(role)) ids.add('orders');
  // Production Manager Dashboard: full visibility for gerente_produccion
  if (roleCanAccessProductionDashboard(role)) ids.add('productionDashboard');
  // Dashboard Ingeniería: analytics + cycle times for engineers and management.
  if (roleCanAccessEngineeringDashboard(role)) ids.add('engineeringDashboard');
  // Ingeniería: documentation workspace for engineers and admins.
  if (roleCanAccessEngineeringNav(role)) ids.add('engineering');
  // Dashboard Ventas: pipeline + summary for sales roles.
  if (roleCanAccessSalesDashboard(role)) ids.add('salesDashboard');
  // Dashboard Almacén: analytics, material demand, stock health for warehouse roles.
  if (roleCanAccessWarehouseDashboard(role)) ids.add('warehouseDashboard');
  // Compras/Almacén: picking lists for warehouse + supervisors (Fase 3).
  if (roleCanAccessPurchasingNav(role)) ids.add('warehouse');
  return ids;
}

export function roleCanAccessNav(
  role: string | null | undefined,
  navId: string,
): boolean {
  return navIdsForRole(role).has(navId);
}

/**
 * OC-010..OC-024 — who may append which lifecycle event to the audit log.
 * Server authority: mirrored in backend-go/internal/domain/rbac.go
 * (RoleCanAppendProjectEvent) and enforced on POST /api/projects/{id}/events
 * and on new events arriving via PUT /api/projects/{id}.
 *
 * Policy follows the same ownership split as the rest of the matrix:
 * - commercial staff (vendedor/gerente_ventas) own quote, deposit and
 *   customer-facing approval events;
 * - ingeniero owns technical/engineering gates and co-signs production release;
 * - plant roles (produccion/almacen/gerente_produccion) own physical
 *   milestones (materials, floor, shipping, installation);
 * - closeout and change-order decisions are gerente/admin calls.
 */
const PROJECT_EVENT_APPEND_ROLES: Readonly<Record<string, readonly UserRole[]>> = {
  // Commercial pipeline + real deposit (OC-011/OC-013).
  quote_created: ['admin', 'gerente_ventas', 'vendedor'],
  quote_sent: ['admin', 'gerente_ventas', 'vendedor'],
  quote_won: ['admin', 'gerente_ventas', 'vendedor'],
  quote_lost: ['admin', 'gerente_ventas', 'vendedor'],
  quote_expired: ['admin', 'gerente_ventas', 'vendedor'],
  quote_cancelled: ['admin', 'gerente_ventas', 'vendedor'],
  deposit_received: ['admin', 'gerente_ventas', 'vendedor'],
  // Survey: ventas or ingeniería can be on site.
  survey_started: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  survey_completed: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  // Structured site survey (OC-040/OC-041): field capture keeps the on-site
  // roles; verification is technical (no vendedor); approval for fabrication
  // is engineering's release authority (docs/architecture.md §11).
  survey_captured: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  survey_verified: ['admin', 'gerente_ventas', 'ingeniero'],
  survey_measures_approved: ['admin', 'ingeniero'],
  // Design authoring/iteration.
  design_revision_created: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  design_submitted: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  design_approved: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  design_changes_requested: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  // Multi-role sign-offs (OC-021): each lane decides its own.
  customer_approved: ['admin', 'gerente_ventas', 'vendedor'],
  customer_rejected: ['admin', 'gerente_ventas', 'vendedor'],
  engineering_approved: ['admin', 'gerente_produccion', 'ingeniero'],
  engineering_rejected: ['admin', 'gerente_produccion', 'ingeniero'],
  project_approved: ['admin', 'gerente_ventas', 'gerente_produccion'],
  // Engineering execution + formal release gate (OC-022).
  engineering_started: ['admin', 'gerente_produccion', 'ingeniero'],
  engineering_documented: ['admin', 'gerente_produccion', 'ingeniero'],
  production_released: ['admin', 'gerente_produccion', 'ingeniero'],
  production_release_revoked: ['admin', 'gerente_produccion', 'ingeniero'],
  // Materials / warehouse (OC-010 materials events).
  materials_required: ['admin', 'gerente_produccion', 'almacen', 'ingeniero'],
  materials_reserved: ['admin', 'gerente_produccion', 'almacen', 'ingeniero'],
  materials_shortage_detected: ['admin', 'gerente_produccion', 'almacen', 'ingeniero'],
  materials_ready: ['admin', 'gerente_produccion', 'almacen', 'ingeniero'],
  materials_release_overridden: ['admin', 'gerente_produccion', 'almacen'],
  // Physical milestones.
  production_started: ['admin', 'gerente_produccion', 'produccion'],
  production_completed: ['admin', 'gerente_produccion', 'produccion'],
  // Quality / rework (OC-060/061): supervisors and floor report damage.
  quality_issue_reported: ['admin', 'gerente_produccion', 'produccion'],
  rework_started: ['admin', 'gerente_produccion', 'produccion'],
  // Job costing (OC-080..084): gerencia freezes the baseline; anyone operating
  // logs labor time; supervisors void wrong entries.
  cost_baseline_captured: ['admin', 'gerente_ventas', 'gerente_produccion'],
  cost_time_recorded: [
    'admin',
    'gerente_ventas',
    'vendedor',
    'gerente_produccion',
    'ingeniero',
    'produccion',
    'almacen',
  ],
  cost_other_recorded: ['admin', 'gerente_ventas', 'gerente_produccion', 'almacen'],
  cost_entry_voided: ['admin', 'gerente_ventas', 'gerente_produccion'],
  shipment_loaded: ['admin', 'gerente_produccion', 'produccion', 'almacen'],
  shipment_departed: ['admin', 'gerente_produccion', 'produccion', 'almacen'],
  installation_started: ['admin', 'gerente_ventas', 'gerente_produccion', 'produccion'],
  installation_completed: ['admin', 'gerente_ventas', 'gerente_produccion', 'produccion'],
  // Closeout.
  punch_opened: ['admin', 'gerente_ventas', 'gerente_produccion'],
  punch_closed: ['admin', 'gerente_ventas', 'gerente_produccion'],
  client_signed_off: ['admin', 'gerente_ventas', 'gerente_produccion'],
  project_closed: ['admin', 'gerente_ventas', 'gerente_produccion'],
  warranty_opened: ['admin', 'gerente_ventas', 'gerente_produccion', 'vendedor'],
  // Change orders (OC-024): anyone in the deal can request; decisions are
  // gerente/admin because they carry price/schedule impact.
  change_order_created: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  change_order_submitted: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  change_order_cancelled: ['admin', 'gerente_ventas', 'vendedor', 'ingeniero'],
  change_order_approved: ['admin', 'gerente_ventas', 'gerente_produccion'],
  change_order_rejected: ['admin', 'gerente_ventas', 'gerente_produccion'],
};

/**
 * Supervisor-only floor actions (OC-032 assembly override, OC-061 rework,
 * OC-062 QC override): the unrestricted roles of roleCanAdvanceStation.
 * Scoped station operators (produccion/almacen) never qualify — parity with
 * Go RoleCanSuperviseFloor.
 */
export function roleCanSuperviseFloor(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas' || role === 'gerente_produccion' || role === 'ingeniero';
}

export function roleCanAppendProjectEvent(
  role: string | null | undefined,
  type: string,
): boolean {
  const allowed = PROJECT_EVENT_APPEND_ROLES[type];
  if (!allowed) return false;
  return allowed.includes(role as UserRole);
}

/**
 * Multi-role union semantics (ADR-0005): a membership may carry several
 * canonical roles and the effective permissions are the union — mirrored in
 * backend-go/internal/domain/rbac.go (AnyRole). Fail-closed on empty sets.
 */
export function anyRole(
  roles: readonly (string | null | undefined)[],
  can: (role: string) => boolean,
): boolean {
  for (const role of roles) {
    if (role != null && can(role)) return true;
  }
  return false;
}

/** Union of the nav sections each role may open (guest = all). */
export function navIdsForRoles(
  roles: readonly (string | null | undefined)[],
): ReadonlySet<string> {
  const hasNull = roles.length === 0 || roles.some((r) => r == null);
  if (hasNull) {
    // guest / local mode — full tool (same set as navIdsForRole(null)).
    return navIdsForRole(null);
  }
  const out = new Set<string>();
  for (const role of roles) {
    for (const id of navIdsForRole(role)) out.add(id);
  }
  return out;
}

/** Nav access for a multi-role actor (union). */
export function rolesCanAccessNav(
  roles: readonly (string | null | undefined)[],
  navId: string,
): boolean {
  return navIdsForRoles(roles).has(navId);
}

/**
 * Sector gates apply only when EVERY role is sector-scoped: a supervisor-style
 * role in the set bypasses the gate (mirrors domain.RolesAllScopedBySector).
 */
export function rolesAllScopedBySector(
  roles: readonly (string | null | undefined)[],
): boolean {
  const nonNull = roles.filter((r): r is string => r != null);
  if (nonNull.length === 0) return false;
  return nonNull.every((r) => roleIsScopedBySector(r));
}

/** The actor's effective role set: explicit multi-role or the single role. */
export function rolesOfUser(user: {
  role: string | null | undefined;
  roles?: readonly (string | null | undefined)[] | null;
}): readonly string[] {
  const explicit = (user.roles ?? []).filter((r): r is string => r != null);
  if (explicit.length > 0) return explicit;
  return user.role != null ? [user.role] : [];
}

/**
 * Cost visibility for a multi-role actor (COST-01/COST-02 with union
 * semantics): one cost-privileged role in the set is enough — mirrors the
 * server-side actorCanViewCosts / AnyRole(RoleCanViewCosts) in Go.
 */
export function rolesCanViewCosts(
  roles: readonly (string | null | undefined)[],
  opts?: { vendedorCanViewCosts?: boolean },
): boolean {
  return anyRole(roles, (r) => roleCanViewCosts(r, opts));
}
