/**
 * Storage port/adapters — versioned JSON workspace (local-first).
 */

export const PACKAGE_NAME = '@muebles/storage' as const;

export type { WorkspaceRepository } from './workspaceRepository';
export { APIWorkspaceRepository } from './apiWorkspaceRepository';
export {
  LocalStorageWorkspaceRepository,
  GUEST_WORKSPACE_STORAGE_KEY,
} from './localStorageWorkspaceRepository';
export { SCHEMA_VERSION, createSeedWorkspace } from './seed';
export {
  breakdownFromApi,
  catalogFromApi,
  projectToApi,
  projectFromApi,
  projectEventToApi,
  projectEventFromApi,
} from './apiMappers';
