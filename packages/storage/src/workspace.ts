/**
 * Workspace persistence surface for F005 (re-exports port + adapter + seed).
 */

export type { WorkspaceRepository } from './workspaceRepository';
export { JSONFileStorage } from './jsonFileStorage';
export { SCHEMA_VERSION, createSeedWorkspace } from './seed';
