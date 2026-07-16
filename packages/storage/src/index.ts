/**
 * Storage port/adapters — versioned JSON workspace (local-first).
 */

export const PACKAGE_NAME = '@muebles/storage' as const;

export type { WorkspaceRepository } from './workspaceRepository';
export { APIWorkspaceRepository } from './apiWorkspaceRepository';
export { LocalStorageWorkspaceRepository } from './localStorageWorkspaceRepository';
export { SCHEMA_VERSION, createSeedWorkspace } from './seed';
export { breakdownFromApi } from './apiMappers';
