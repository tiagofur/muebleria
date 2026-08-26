/**
 * App section + entity detail URL paths.
 * Keep section keys in sync with AppNavId in @granete/ui shell.
 */

import type { AppNavId } from '@granete/ui';
import { rolesCanAccessNav } from '@granete/domain';

/** Canonical path for each sidebar destination. URLs name the screen. */
export const NAV_PATHS: Readonly<Record<AppNavId, string>> = {
  home: '/',
  quotes: '/quotes',
  customers: '/customers',
  showcase: '/showcase',
  plantBoard: '/plant-board',
  production: '/production',
  shipments: '/shipments',
  installations: '/installations',
  orders: '/orders',
  productionDashboard: '/production-dashboard',
  salesDashboard: '/sales-dashboard',
  engineeringDashboard: '/engineering-dashboard',
  engineering: '/engineering',
  warehouseDashboard: '/warehouse-dashboard',
  warehouse: '/warehouse',
  modules: '/modules',
  structures: '/structures',
  components: '/components',
  addOns: '/add-ons',
  materials: '/materials',
  edges: '/edges',
  hardware: '/hardware',
  finishes: '/finishes',
  optionGroups: '/option-groups',
  settings: '/settings',
  users: '/users',
} as const;

/**
 * Deep-link guard (design.md §4.1): a route the current session can't open
 * must bounce to home instead of rendering an empty screen. Guest (local
 * mode) has a narrower nav set — no Órdenes/Fábrica workspace — so a guest
 * hitting /orders/* directly gets redirected, not a blank main.
 */
export function navBlockedForSession(
  session: 'guest' | 'auth',
  roles: readonly (string | null | undefined)[] | string | null | undefined,
  navId: AppNavId,
): boolean {
  // Multi-role union (ADR-0005): accept a legacy single role too.
  const roleSet =
    typeof roles === 'string' ? [roles] : session === 'auth' ? (roles ?? []) : [];
  return !rolesCanAccessNav(roleSet, navId);
}

/** Sections that support `/section/:id` deep links for entity rows. */
export type EntitySection = Exclude<
  AppNavId,
  | 'home'
  | 'users'
  | 'settings'
  | 'showcase'
  | 'plantBoard'
  | 'production'
  | 'shipments'
  | 'installations'
  | 'orders'
  | 'productionDashboard'
  | 'salesDashboard'
  | 'engineeringDashboard'
  | 'engineering'
  | 'warehouseDashboard'
  | 'warehouse'
>;

/**
 * Production order hub tabs (PROD-0.1). Kept local to routes so web shell
 * can deep-link without importing the full UI model at parse time.
 * URL slugs are English (i18n-ready); tab keys stay in sync with
 * PRODUCTION_ORDER_TABS in @granete/ui.
 */
export const PRODUCTION_PATH_TABS = [
  'resumen',
  'modulos',
  'piso',
  'despiece',
  'etiquetas',
  'herrajes',
  'vistas',
  'optimizacion',
  'documentos',
] as const;

export type ProductionPathTab = (typeof PRODUCTION_PATH_TABS)[number];

/** English URL slug for each hub tab. */
const TAB_URL_SLUGS: Readonly<Record<ProductionPathTab, string>> = {
  resumen: 'summary',
  modulos: 'modules',
  piso: 'floor',
  despiece: 'cutlist',
  etiquetas: 'labels',
  herrajes: 'hardware',
  vistas: 'views',
  optimizacion: 'optimization',
  documentos: 'documents',
};

const SLUG_TO_TAB = new Map<string, ProductionPathTab>(
  (Object.entries(TAB_URL_SLUGS) as [ProductionPathTab, string][]).map(
    ([tab, slug]) => [slug, tab],
  ),
);

/** Resolve an English URL segment to a hub tab. */
function productionTabFromSegment(segment: string): ProductionPathTab | null {
  return SLUG_TO_TAB.get(segment) ?? null;
}

const ENTITY_SECTIONS: readonly EntitySection[] = [
  'quotes',
  'customers',
  'modules',
  'structures',
  'components',
  'addOns',
  'materials',
  'edges',
  'hardware',
  'finishes',
  'optionGroups',
] as const;

export function pathForNav(id: AppNavId): string {
  return NAV_PATHS[id];
}

export function isEntitySection(id: AppNavId): id is EntitySection {
  return (ENTITY_SECTIONS as readonly string[]).includes(id);
}

/** `/projects/:id`, `/materials/:id`, … */
export function entityPath(section: EntitySection, id: string): string {
  return `${NAV_PATHS[section]}/${encodeURIComponent(id)}`;
}

export function projectPath(projectId: string): string {
  return entityPath('quotes', projectId);
}

export function modulePath(moduleId: string): string {
  return entityPath('modules', moduleId);
}

export function structurePath(structureId: string): string {
  return entityPath('structures', structureId);
}

/**
 * Editor paths `/section/:id/edit` (Fase 3 UI). Used for entities whose editor
 * is too big for a Modal LG (ModuleEditorForm, StructureEditorForm,
 * ComponentEditorForm). The "Nuevo" flow uses sentinel id `new`
 * (e.g. `/modules/new/edit`).
 */
export function moduleEditPath(moduleId: string): string {
  return `${entityPath('modules', moduleId)}/edit`;
}

export function structureEditPath(structureId: string): string {
  return `${entityPath('structures', structureId)}/edit`;
}

export function componentEditPath(componentId: string): string {
  return `${entityPath('components', componentId)}/edit`;
}

/**
 * Sentinel id used in editor URLs for "create new" flow (no real id yet).
 * `/modules/new/edit` → ModulesScreen renders an empty draft.
 */
export const NEW_ENTITY_ID = 'new';

/** Extract detail id from a `/section/:id` OR `/section/:id/edit` path. */
function entityRouteFromPath(
  pathname: string,
  section: EntitySection,
): { id: string; edit: boolean } | null {
  const base = NAV_PATHS[section];
  const normalized = normalizePathname(pathname);
  if (normalized === base) return null;
  if (!normalized.startsWith(`${base}/`)) return null;
  const rest = normalized.slice(base.length + 1);
  if (!rest) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = rest;
  }
  // Strip optional /edit suffix.
  const editMatch = decoded.match(/^(.*)\/edit$/);
  if (editMatch) {
    const id = editMatch[1];
    if (!id || id.includes('/')) return null;
    return { id, edit: true };
  }
  if (decoded.includes('/')) return null;
  return { id: decoded, edit: false };
}

/** True if the path is `/section/:id/edit` for the given section. */
export function isEntityEditPath(
  pathname: string,
  section: EntitySection,
): boolean {
  const route = entityRouteFromPath(pathname, section);
  return route !== null && route.edit;
}

/** Detail id when path is `/section/:id/edit` for an entity section. */
export function entityEditIdFromPath(
  pathname: string,
  section: EntitySection,
): string | null {
  const route = entityRouteFromPath(pathname, section);
  if (!route || !route.edit) return null;
  return route.id;
}

export function moduleEditIdFromPath(pathname: string): string | null {
  return entityEditIdFromPath(pathname, 'modules');
}

export function structureEditIdFromPath(pathname: string): string | null {
  return entityEditIdFromPath(pathname, 'structures');
}

export function componentEditIdFromPath(pathname: string): string | null {
  return entityEditIdFromPath(pathname, 'components');
}

/** True if path matches `/section/new/edit` (create-new editor route). */
export function isNewEntityEditPath(
  pathname: string,
  section: EntitySection,
): boolean {
  return entityEditIdFromPath(pathname, section) === NEW_ENTITY_ID;
}

function normalizePathname(pathname: string): string {
  const raw = pathname.split('?')[0]?.split('#')[0] ?? '/';
  return raw.replace(/\/+$/, '') === '' ? '/' : raw.replace(/\/+$/, '');
}

/** Detail id when path is `/section/:id` (view) for a known entity section. */
export function entityIdFromPath(
  pathname: string,
  section: EntitySection,
): string | null {
  const route = entityRouteFromPath(pathname, section);
  if (!route || route.edit) return null;
  return route.id;
}

export function projectIdFromPath(pathname: string): string | null {
  return entityIdFromPath(pathname, 'quotes');
}

export function moduleIdFromPath(pathname: string): string | null {
  return entityIdFromPath(pathname, 'modules');
}

export function structureIdFromPath(pathname: string): string | null {
  return entityIdFromPath(pathname, 'structures');
}

/**
 * Resolve sidebar id from a location pathname.
 * Nested routes (`/projects/:id`, `/materials/:id`, …) map to their section.
 */
export function navFromPath(pathname: string): AppNavId | null {
  const normalized = normalizePathname(pathname);

  if (normalized === '/' || normalized === '/home') {
    return 'home';
  }

  const entries = (Object.entries(NAV_PATHS) as [AppNavId, string][])
    .filter(([, path]) => path !== '/')
    .sort((a, b) => b[1].length - a[1].length);

  for (const [id, path] of entries) {
    if (normalized === path || normalized.startsWith(`${path}/`)) {
      return id;
    }
  }
  return null;
}

/**
 * Engineering project deep link: `/engineering/:projectId`.
 */
export function engineeringProjectPath(projectId: string): string {
  return `${NAV_PATHS.engineering}/${encodeURIComponent(projectId)}`;
}

export function engineeringProjectFromPath(pathname: string): string | null {
  const base = NAV_PATHS.engineering;
  const normalized = normalizePathname(pathname);
  if (normalized === base) return null;
  if (!normalized.startsWith(`${base}/`)) return null;
  const rest = normalized.slice(base.length + 1);
  if (!rest) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = rest;
  }
  if (decoded.includes('/')) return null;
  return decoded;
}

/**
 * Production order deep link: `/orders/:projectId` or
 * `/orders/:projectId/:tab` with English tab slugs (PROD-0.1).
 * (`/production` is the factory floor screen — nav id `fabric`.)
 */
export function productionOrderPath(
  projectId: string,
  tab?: ProductionPathTab | null,
): string {
  const base = `${NAV_PATHS.orders}/${encodeURIComponent(projectId)}`;
  if (!tab || tab === 'resumen') return base;
  return `${base}/${TAB_URL_SLUGS[tab]}`;
}

export function productionOrderFromPath(pathname: string): {
  readonly projectId: string;
  readonly tab: ProductionPathTab;
} | null {
  const base = NAV_PATHS.orders;
  const normalized = normalizePathname(pathname);
  if (normalized === base) return null;
  if (!normalized.startsWith(`${base}/`)) return null;
  const rest = normalized.slice(base.length + 1);
  if (!rest) return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(parts[0]!);
  } catch {
    projectId = parts[0]!;
  }
  if (!projectId || projectId.includes('/')) return null;
  const tabRaw = parts[1];
  const tab: ProductionPathTab | null = tabRaw
    ? productionTabFromSegment(tabRaw)
    : 'resumen';
  // Unknown second segment → treat as invalid (not an order route).
  if (tab === null) return null;
  return { projectId, tab };
}

/**
 * Embarques detail deep link: `/shipings/:projectId`.
 */
export function shipmentDetailPath(projectId: string): string {
  return `${NAV_PATHS.shipments}/${encodeURIComponent(projectId)}`;
}

export function shipmentDetailFromPath(pathname: string): string | null {
  const base = NAV_PATHS.shipments;
  const normalized = normalizePathname(pathname);
  if (normalized === base) return null;
  if (!normalized.startsWith(`${base}/`)) return null;
  const rest = normalized.slice(base.length + 1);
  if (!rest) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(rest);
  } catch {
    projectId = rest;
  }
  if (!projectId || projectId.includes('/')) return null;
  return projectId;
}

/**
 * Instalaciones detail deep link: `/installations/:projectId`.
 */
export function installationDetailPath(projectId: string): string {
  return `${NAV_PATHS.installations}/${encodeURIComponent(projectId)}`;
}

export function installationDetailFromPath(pathname: string): string | null {
  const base = NAV_PATHS.installations;
  const normalized = normalizePathname(pathname);
  if (normalized === base) return null;
  if (!normalized.startsWith(`${base}/`)) return null;
  const rest = normalized.slice(base.length + 1);
  if (!rest) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(rest);
  } catch {
    projectId = rest;
  }
  if (!projectId || projectId.includes('/')) return null;
  return projectId;
}
