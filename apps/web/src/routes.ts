/**
 * App section + entity detail URL paths.
 * Keep section keys in sync with AppNavId in @muebles/ui shell.
 */

import type { AppNavId } from '@muebles/ui';

/** Canonical path for each sidebar destination. */
export const NAV_PATHS: Readonly<Record<AppNavId, string>> = {
  home: '/',
  projects: '/projects',
  customers: '/customers',
  showcase: '/showcase',
  production: '/produccion',
  modules: '/modules',
  structures: '/structures',
  components: '/components',
  materials: '/materials',
  edges: '/edges',
  hardware: '/hardware',
  optionGroups: '/option-groups',
  settings: '/settings',
  users: '/users',
} as const;

/** Sections that support `/section/:id` deep links for entity rows. */
export type EntitySection = Exclude<
  AppNavId,
  'home' | 'users' | 'settings' | 'showcase' | 'production'
>;

const ENTITY_SECTIONS: readonly EntitySection[] = [
  'projects',
  'customers',
  'modules',
  'structures',
  'components',
  'materials',
  'edges',
  'hardware',
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
  return entityPath('projects', projectId);
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
  return entityIdFromPath(pathname, 'projects');
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
