/**
 * Product RBAC matrix (F035 / #67).
 * Portfolio ownership (F034) layers on top for vendedor.
 */

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
 * Admin, gerente, ingeniero, produccion, almacen (F036).
 */
export function roleCanMarkProduced(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'gerente_produccion' ||
    role === 'ingeniero' ||
    role === 'produccion' ||
    role === 'almacen'
  );
}

export function roleCanExportProduction(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'produccion' ||
    role === 'gerente_produccion' ||
    role === 'gerente_ventas' ||
    role === 'almacen'
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
  return role === 'admin' || role === 'gerente_produccion';
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
 * Production/warehouse workers can claim/finish jobs in their assigned sectors.
 * Distinct from gerente_produccion which sees everything.
 */
export function roleCanClaimProductionJob(
  role: string | null | undefined,
): boolean {
  return role === 'admin' || role === 'produccion' || role === 'almacen';
}

/** Check if role is scoped by user_sectors (produccion or almacen). */
export function roleIsScopedBySector(role: string | null | undefined): boolean {
  return role === 'produccion' || role === 'almacen';
}

/** Warehouse sub-sectors for material type separation. */
export type WarehouseSubSector =
  | 'herrajes'
  | 'tableros'
  | 'cintillas';

export const WAREHOUSE_SUB_SECTORS: readonly WarehouseSubSector[] = [
  'herrajes',
  'tableros',
  'cintillas',
] as const;

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
  // PROD-0.1: factory workspace nav for production-export roles.
  if (roleCanAccessProductionNav(role)) ids.add('production');
  // Production Manager Dashboard: full visibility for gerente_produccion
  if (roleCanAccessProductionDashboard(role)) ids.add('productionDashboard');
  return ids;
}

export function roleCanAccessNav(
  role: string | null | undefined,
  navId: string,
): boolean {
  return navIdsForRole(role).has(navId);
}
