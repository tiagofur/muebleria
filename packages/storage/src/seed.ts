/**
 * Default workspace seed for first open (missing workspace.json).
 * Catalog + modules + demo project align with Plantilla_Muebles.xlsx.
 */

import type { Workspace } from '@granete/domain';
import {
  DEFAULT_WORKSHOP_SETTINGS,
  buildPerfReferenceProject,
  createCocinaLopezDemoProject,
  createPlantillaDemoProject,
  seedCatalogExpandedLatAm,
  seedCocinaEstandarTemplate,
} from '@granete/domain';

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
 * F147 / #312 — flag local (localStorage) que agrega la escena de referencia
 * de performance al seed. Lo setea el smoke de performance antes de cargar la
 * app; los seeds normales (tests, primer arranque) quedan intactos.
 */
export const SEED_PERF_REFERENCE_FLAG = 'muebles_seed_perf_reference';

function wantsPerfReferenceScene(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(SEED_PERF_REFERENCE_FLAG) === '1'
    );
  } catch {
    return false;
  }
}

/**
 * Seed workspace with expanded LatAm catalog (17 modules), demo L-shaped kitchen project
 * ("Cocina López") pre-positioned in 3D with ambient floor/wall materials, plus golden demo project.
 */
export function createSeedWorkspace(): Workspace {
  const projects = [
    createPlantillaDemoProject(),
    createCocinaLopezDemoProject(),
  ];
  if (wantsPerfReferenceScene()) {
    projects.push(buildPerfReferenceProject());
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    catalog: seedCatalogExpandedLatAm,
    projects,
    projectTemplates: [seedCocinaEstandarTemplate],
    settings: { ...DEFAULT_WORKSHOP_SETTINGS },
  };
}
