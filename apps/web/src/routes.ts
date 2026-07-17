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
export type EntitySection = Exclude<AppNavId, 'home' | 'users' | 'settings'>;

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

function normalizePathname(pathname: string): string {
  const raw = pathname.split('?')[0]?.split('#')[0] ?? '/';
  return raw.replace(/\/+$/, '') === '' ? '/' : raw.replace(/\/+$/, '');
}

/** Detail id when path is `/section/:id` for a known entity section. */
export function entityIdFromPath(
  pathname: string,
  section: EntitySection,
): string | null {
  const base = NAV_PATHS[section];
  const normalized = normalizePathname(pathname);
  if (normalized === base) return null;
  if (!normalized.startsWith(`${base}/`)) return null;
  const rest = normalized.slice(base.length + 1);
  if (!rest || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
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
