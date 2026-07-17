/**
 * Product RBAC matrix (F035 / #67).
 * Portfolio ownership (F034) layers on top for vendedor.
 */

export type ProductRole =
  | 'admin'
  | 'user'
  | 'vendedor'
  | 'gerente_ventas'
  | 'ingeniero'
  | 'produccion';

export const PRODUCT_ROLES: readonly ProductRole[] = [
  'admin',
  'user',
  'vendedor',
  'gerente_ventas',
  'ingeniero',
  'produccion',
] as const;

/** Assignable job titles from admin panel (includes sin puesto). */
export const ASSIGNABLE_ROLES: readonly ProductRole[] = PRODUCT_ROLES;

export function isValidUserRole(role: string | null | undefined): role is ProductRole {
  return (
    role === 'admin' ||
    role === 'user' ||
    role === 'vendedor' ||
    role === 'gerente_ventas' ||
    role === 'ingeniero' ||
    role === 'produccion'
  );
}

export function roleCanManageUsers(role: string | null | undefined): boolean {
  return role === 'admin';
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

/** Reopen closed quote to draft (clears snapshot). Admin / gerente only (F036). */
export function roleCanReopenProject(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'gerente_ventas';
}

/**
 * Mark accepted → produced (click-only, no export gate).
 * Admin, gerente, ingeniero, produccion (F036).
 */
export function roleCanMarkProduced(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'gerente_ventas' ||
    role === 'ingeniero' ||
    role === 'produccion'
  );
}

export function roleCanExportProduction(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'produccion' ||
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
  return role === 'admin' || role === 'gerente_ventas';
}

/** Home is the plant floor queue (F038). */
export function roleUsesProductionQueue(
  role: string | null | undefined,
): boolean {
  return role === 'produccion';
}

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

export function roleCanAccessModulesNav(role: string | null | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'ingeniero' ||
    role === 'gerente_ventas' ||
    role === 'vendedor'
  );
}

/** Spanish labels for taller UI. */
export function roleLabelEs(role: string | null | undefined): string {
  const map: Record<string, string> = {
    admin: 'Admin',
    user: 'Sin puesto',
    vendedor: 'Vendedor',
    gerente_ventas: 'Gerente de ventas',
    ingeniero: 'Ingeniero',
    produccion: 'Producción',
  };
  if (!role) return '—';
  return map[role] ?? role;
}

/** Nav section ids that a role may open (guest = all). */
export function navIdsForRole(role: string | null | undefined): ReadonlySet<string> {
  if (role == null) {
    // guest / local mode — full tool
    return new Set([
      'home',
      'projects',
      'customers',
      'modules',
      'structures',
      'components',
      'materials',
      'edges',
      'hardware',
      'optionGroups',
      'settings',
      'users',
    ]);
  }
  const ids = new Set<string>(['home']);
  if (roleCanAccessProjects(role)) ids.add('projects');
  if (roleCanAccessCustomers(role)) ids.add('customers');
  if (roleCanAccessModulesNav(role)) ids.add('modules');
  // F049/H06: Estructuras + Componentes only for ingeniero/admin (mutate modules)
  if (roleCanMutateModules(role)) {
    ids.add('structures');
    ids.add('components');
  }
  if (roleCanAccessCatalogNav(role)) {
    ids.add('materials');
    ids.add('edges');
    ids.add('hardware');
    ids.add('optionGroups');
  }
  if (roleCanAccessSettings(role)) ids.add('settings');
  if (roleCanManageUsers(role)) ids.add('users');
  return ids;
}

export function roleCanAccessNav(
  role: string | null | undefined,
  navId: string,
): boolean {
  return navIdsForRole(role).has(navId);
}
