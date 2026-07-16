/**
 * Default workspace seed for first open (missing workspace.json).
 * Catalog + modules + demo project align with Plantilla_Muebles.xlsx.
 */

import type { Workspace } from '@muebles/domain';
import {
  createPlantillaDemoProject,
  plantillaCatalogWithModules,
} from '@muebles/domain/fixtures';

/** Persistence format version (NFR-10). Bump when migrations are required. */
export const SCHEMA_VERSION = 2 as const;

/**
 * Plantilla catalogs, MOD-GAB-01 + MOD-CAJ-01, and a draft demo quotation
 * (MOD-GAB-01 × 1 with plantilla option choices) for first-open UX (CAT-06).
 */
export function createSeedWorkspace(): Workspace {
  return {
    schemaVersion: SCHEMA_VERSION,
    catalog: plantillaCatalogWithModules,
    projects: [createPlantillaDemoProject()],
  };
}
