/**
 * Product RBAC matrix (F035 / #67).
 * Portfolio ownership (F034) layers on top for vendedor.
 */

import type { ItemFloorStatus } from './types';
import {
  PRODUCTION_SECTORS,
  sectorForFloorStatus,
  type ProductionSector,
} from './productionSectors';

export type ProductRole =
  | 'admin'
  | 'user'
  | 'vendedor'
  | 'gerente_ventas'
  | 'gerente_produccion'
  | 'ingeniero'
  | 'produccion'
  | 'almacen';

export const PRODUCT_ROLES: readonly ProductRole[] = [
  'admin',
  'user',
  'vendedor',
  'gerente_ventas',
  'gerente_produccion',
  'ingeniero',
  'produccion',
  'almacen',
] as const;

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
 * May open Embarques (despacho + instalación board).
 *
 * The shipping/logistics stations belong to the production floor and its
 * supervisors; almacen does NOT advance floor status (F094) and its world
 * is Compras/Almacén, so it stays out.
 */
export function roleCanAccessShippingNav(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_produccion' || role === 'produccion';
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
    // guest / local mode — full tool (no `production` nav, no RBAC to plant queue)
    return new Set([
      'home',
      'projects',
      'customers',
      'showcase',
      'plantBoard',
      'modules',
      'structures',
      'components',
      'agregados',
      'materials',
      'edges',
      'hardware',
      'ambientMaterials',
      'optionGroups',
      'settings',
      'users',
    ]);
  }
  const ids = new Set<string>(['home']);
  // F093 — Estado de Planta: factory progress is visible to EVERY role
  // (sales answers "where is my project"); read-only board.
  ids.add('plantBoard');
  if (roleCanAccessProjects(role)) ids.add('projects');
  if (roleCanAccessCustomers(role)) ids.add('customers');
  if (roleCanAccessShowcaseNav(role)) ids.add('showcase');
  // Ingeniería: Muebles + Estructuras + Componentes + Agregados + Acabados (admin / ingeniero)
  if (roleCanAccessModulesNav(role)) ids.add('modules');
  if (roleCanMutateModules(role)) {
    ids.add('structures');
    ids.add('components');
    ids.add('agregados');
    ids.add('ambientMaterials');
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
  if (roleCanAccessFabricNav(role)) ids.add('fabric');
  // Embarques: despacho + instalación board (production floor + supervisors).
  if (roleCanAccessShippingNav(role)) ids.add('embarques');
  // PROD-0.1: factory workspace nav for production-export roles.
  if (roleCanAccessProductionNav(role)) ids.add('production');
  // Production Manager Dashboard: full visibility for gerente_produccion
  if (roleCanAccessProductionDashboard(role)) ids.add('productionDashboard');
  // Ingeniería: documentation workspace for engineers and admins.
  if (roleCanAccessEngineeringNav(role)) ids.add('engineering');
  // Dashboard Ventas: pipeline + summary for sales roles.
  if (roleCanAccessSalesDashboard(role)) ids.add('salesDashboard');
  // Compras/Almacén: picking lists for warehouse + supervisors (Fase 3).
  if (roleCanAccessPurchasingNav(role)) ids.add('purchasing');
  return ids;
}

export function roleCanAccessNav(
  role: string | null | undefined,
  navId: string,
): boolean {
  return navIdsForRole(role).has(navId);
}
