/**
 * Storage port/adapters — versioned JSON workspace (local-first).
 */

export const PACKAGE_NAME = '@granete/storage' as const;

export type { WorkspaceRepository } from './workspaceRepository';
export type { JobCostingView, SiteSurveyView } from './workspaceRepository';
export { APIWorkspaceRepository } from './apiWorkspaceRepository';
export {
  LocalStorageWorkspaceRepository,
  GUEST_WORKSPACE_STORAGE_KEY,
} from './localStorageWorkspaceRepository';
export { SCHEMA_VERSION, createSeedWorkspace } from './seed';
export { migrateLegacyStorageKeys } from './legacyStorageKeys';
export { GraneteApiClient, newIdempotencyKey } from './apiClient';
export { GeneratedGraneteApiClient } from './openapi/generated/client';
export { GraneteApiError, GraneteNetworkError, parseApiError } from './apiErrors';
export type * from './openapi/generated/types';
export { parseGenerated, parseGeneratedArray } from './openapi/generated/types';
export {
  breakdownFromApi,
  catalogFromApi,
  projectToApi,
  projectFromApi,
  projectEventToApi,
  projectEventFromApi,
} from './apiMappers';
