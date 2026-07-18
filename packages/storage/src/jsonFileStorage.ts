/**
 * Local-first adapter: single workspace JSON file with atomic write (PER-01, NFR-03).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Catalog, Project, Workspace } from '@muebles/domain';

import { createSeedWorkspace, SCHEMA_VERSION } from './seed';
import type { WorkspaceRepository } from './workspaceRepository';

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * Grain (veta) moved from piece to material: drop the stale `grain` field
 * stored on board parts in v1 workspaces. Keys are readonly at the type level
 * but workspace.json is untyped on disk, so we rebuild immutably.
 */
function migrateV1ToV2(workspace: Workspace): Workspace {
  // Workspace.json is untyped on disk; cast through unknown to drop the stale
  // `grain` key that v1 stored on each board part. Grain now lives on material.
  const modules = workspace.catalog.modules as unknown as {
    [k: string]: unknown;
    boardParts: { [k: string]: unknown }[];
  }[];

  const needsMigration = modules.some((mod) =>
    mod.boardParts.some((part) => part !== null && 'grain' in part),
  );
  if (!needsMigration) return { ...workspace, schemaVersion: SCHEMA_VERSION };

  const catalog: Catalog = {
    ...workspace.catalog,
    modules: modules.map((mod) => ({
      ...mod,
      boardParts: mod.boardParts.map((part) => {
        const { grain: _g, ...rest } = part;
        void _g;
        return rest;
      }),
    })) as unknown as Catalog['modules'],
  };
  return { ...workspace, schemaVersion: SCHEMA_VERSION, catalog };
}

/**
 * #108 (Slice 3) — `Structure` gained `revision` + `history` in Slice 1
 * (both optional on the type so legacy fixtures keep compiling). On-disk v2
 * workspaces predate the change, so we backfill defaults additively:
 * missing `revision` → 1, missing `history` → []. Existing values are
 * preserved verbatim (additive, never destructive).
 *
 * `project.items[].structureRevisionPin` is intentionally NOT migrated:
 * legacy items had no pin, and the absence of a pin means "use live revision"
 * (current behavior). Forcing a pin would freeze BOMs that were never frozen.
 */
function migrateV2ToV3(workspace: Workspace): Workspace {
  // Workspace.json is untyped on disk; read structures loosely so we can
  // detect missing fields without the readonly tuple types getting in the way.
  type LooseStructure = {
    revision?: number;
    history?: readonly unknown[];
  };
  const structures = workspace.catalog.structures as unknown as
    | readonly LooseStructure[]
    | undefined;

  if (!structures || structures.length === 0) {
    return { ...workspace, schemaVersion: SCHEMA_VERSION };
  }

  const needsBackfill = structures.some(
    (s) => s && (s.revision === undefined || s.history === undefined),
  );
  if (!needsBackfill) {
    return { ...workspace, schemaVersion: SCHEMA_VERSION };
  }

  const migratedStructures = structures.map((s) => {
    if (!s) return s;
    return {
      ...s,
      revision: s.revision ?? 1,
      history: s.history ?? [],
    };
  });

  const catalog: Catalog = {
    ...workspace.catalog,
    structures: migratedStructures as unknown as Catalog['structures'],
  };
  return { ...workspace, schemaVersion: SCHEMA_VERSION, catalog };
}

/**
 * Forward-compatible loader: applies versioned migrations to on-disk payloads.
 * Unknown future versions pass through unchanged (best-effort).
 */
function migrateWorkspace(workspace: Workspace): Workspace {
  const version = workspace.schemaVersion ?? 0;
  let current = workspace;
  if (version < 2) {
    current = migrateV1ToV2(current);
  }
  if (version < 3) {
    current = migrateV2ToV3(current);
  }
  return current;
}

/**
 * File-backed workspace repository.
 * Save path: write `{filePath}.tmp` then rename over target (atomic on same volume).
 */
export class JSONFileStorage implements WorkspaceRepository {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Workspace> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return migrateWorkspace(JSON.parse(raw) as Workspace);
    } catch (error) {
      if (isNotFoundError(error)) {
        return createSeedWorkspace();
      }
      throw error;
    }
  }

  async save(workspace: Workspace): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(workspace, null, 2)}\n`;
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, this.filePath);
  }

  async getCatalog(): Promise<Catalog> {
    const workspace = await this.load();
    return workspace.catalog;
  }

  async saveCatalog(catalog: Catalog): Promise<void> {
    const workspace = await this.load();
    await this.save({ ...workspace, catalog });
  }

  async getProjects(): Promise<readonly Project[]> {
    const workspace = await this.load();
    return workspace.projects;
  }

  async createProject(project: Project): Promise<void> {
    return this.saveProject(project);
  }

  async saveProject(project: Project): Promise<void> {
    const workspace = await this.load();
    const index = workspace.projects.findIndex((p) => p.id === project.id);
    const projects =
      index === -1
        ? [...workspace.projects, project]
        : workspace.projects.map((p, i) => (i === index ? project : p));
    await this.save({ ...workspace, projects });
  }

  async deleteProject(projectId: string): Promise<void> {
    const workspace = await this.load();
    await this.save({
      ...workspace,
      projects: workspace.projects.filter((p) => p.id !== projectId),
    });
  }
}
