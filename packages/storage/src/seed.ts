/**
 * Default workspace seed for first open (missing workspace.json).
 * Catalog + modules + demo project align with Plantilla_Muebles.xlsx.
 */

import type { Workspace } from '@muebles/domain';
import { DEFAULT_WORKSHOP_SETTINGS } from '@muebles/domain';
import {
  createPlantillaDemoProject,
  plantillaCatalogWithModules,
  seedCocinaEstandarTemplate,
} from '@muebles/domain/fixtures';

/**
 * Persistence format version (NFR-10). Bump when migrations are required.
 *
 * v3 (#108): `Structure` gained `revision` + `history` (Slice 1). Seed
 * structures are sourced from domain fixtures (no literal construction here),
 * so they ship without `revision` — the domain normalizes missing → 1
 * (`structureRevision`). Migration v2→v3 backfills `revision: 1` / `history: []`
 * on persisted workspaces so disk is explicit.
 *
 * No bump for #110 (project templates): `Workspace.projectTemplates` is optional;
 * older workspaces omit it and it's treated as []. The seed ships one demo
 * template but persisted files need no migration.
 */
export const SCHEMA_VERSION = 3 as const;

/**
 * Plantilla catalogs, MOD-GAB-01 + MOD-CAJ-01 + composed + alacena + despensa,
 * a draft demo quotation (MOD-GAB-01 × 1 with plantilla option choices), and a
 * reusable "Cocina estándar 3 m" template (#110) for first-open UX (CAT-06).
 */
export function createSeedWorkspace(): Workspace {
  return {
    schemaVersion: SCHEMA_VERSION,
    catalog: plantillaCatalogWithModules,
    projects: [createPlantillaDemoProject()],
    projectTemplates: [seedCocinaEstandarTemplate],
    settings: { ...DEFAULT_WORKSHOP_SETTINGS },
  };
}
