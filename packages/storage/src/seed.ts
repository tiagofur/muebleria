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
export const SEED_PERF_REFERENCE_FLAG = 'granete_seed_perf_reference';

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
    // #738 review: local projects are born with the POSITIVE pre-Digital
    // Thread signal — the local tool is DT-free by construction (no designs,
    // quote revisions or releases exist locally). Stage helpers fail closed
    // on unknown provenance, so every local producer must vouch for its own
    // context instead of leaving the field absent.
    projects: projects.map((project) => ({
      ...project,
      hasDigitalThreadContext: false,
    })),
    projectTemplates: [seedCocinaEstandarTemplate],
    settings: { ...DEFAULT_WORKSHOP_SETTINGS },
  };
}
