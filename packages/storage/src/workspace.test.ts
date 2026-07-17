/**
 * Storage acceptance tests — real tempdir only (no fs mocks).
 */

import { mkdtemp, readFile, writeFile, access, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Project, Workspace } from '@muebles/domain';
import { describe, expect, it } from 'vitest';

import { JSONFileStorage } from './jsonFileStorage';
import { SCHEMA_VERSION, createSeedWorkspace } from './seed';

async function tempWorkspacePath(name = 'workspace.json'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'muebles-storage-'));
  return join(dir, name);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe('createSeedWorkspace', () => {
  it('includes schemaVersion, plantilla catalogs, MOD-GAB-01 and MOD-CAJ-01', () => {
    const seed = createSeedWorkspace();

    expect(seed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(seed.projects).toHaveLength(1);
    expect(seed.projects[0]?.name).toBe('Demo plantilla');
    expect(seed.catalog.materials.length).toBeGreaterThan(0);
    expect(seed.catalog.edges.length).toBeGreaterThan(0);
    expect(seed.catalog.hardware.length).toBeGreaterThan(0);
    expect(seed.catalog.optionGroups.length).toBeGreaterThan(0);

    const codes = seed.catalog.modules.map((m) => m.code);
    expect(codes).toContain('MOD-GAB-01');
    expect(codes).toContain('MOD-CAJ-01');
  });
});

describe('JSONFileStorage', () => {
  it('load() returns seed workspace when file is missing', async () => {
    const path = await tempWorkspacePath('missing.json');
    const storage = new JSONFileStorage(path);

    const loaded = await storage.load();
    const seed = createSeedWorkspace();

    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.catalog.modules.map((m) => m.code).sort()).toEqual(
      seed.catalog.modules.map((m) => m.code).sort(),
    );
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0]?.name).toBe('Demo plantilla');
    expect(await fileExists(path)).toBe(false);
  });

  it('save() writes schemaVersion and is atomic (no leftover .tmp)', async () => {
    const path = await tempWorkspacePath();
    const storage = new JSONFileStorage(path);
    const workspace = createSeedWorkspace();

    await storage.save(workspace);

    expect(await fileExists(path)).toBe(true);
    expect(await fileExists(`${path}.tmp`)).toBe(false);

    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Workspace;
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(raw).toContain('"schemaVersion"');
  });

  it('round-trip preserves catalog, modules, projects and UUID relations', async () => {
    const path = await tempWorkspacePath();
    const storage = new JSONFileStorage(path);
    const seed = createSeedWorkspace();
    const gab = seed.catalog.modules.find((m) => m.code === 'MOD-GAB-01');
    expect(gab).toBeDefined();

    const project: Project = {
      id: 'proj-roundtrip',
      name: 'Round trip',
      customerId: 'Test',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'item-1',
          moduleId: gab!.id,
          quantity: 1,
          optionChoices: { INTERIOR: seed.catalog.materials[0]!.id },
        },
      ],
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
    };

    const toSave: Workspace = {
      ...seed,
      projects: [project],
    };

    await storage.save(toSave);
    const loaded = await storage.load();

    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0]).toEqual(project);

    const moduleIds = new Set(loaded.catalog.modules.map((m) => m.id));
    for (const item of loaded.projects[0]!.items) {
      expect(moduleIds.has(item.moduleId)).toBe(true);
    }
  });

  it('save leaves original intact if tmp is written but rename would target same path semantics', async () => {
    // Pre-seed an existing file, then overwrite via atomic save and confirm final content.
    const path = await tempWorkspacePath('existing.json');
    const storage = new JSONFileStorage(path);

    const first: Workspace = {
      schemaVersion: SCHEMA_VERSION,
      catalog: createSeedWorkspace().catalog,
      projects: [],
    };
    await storage.save(first);

    const second: Workspace = {
      ...first,
      projects: [
        {
          id: 'p2',
          name: 'Second',
          customerId: 'C',
          currency: 'MXN',
          marginFactor: 1.2,
          laborFixedCost: 10,
          status: 'draft',
          items: [],
          createdAt: '2026-07-15T13:00:00.000Z',
          updatedAt: '2026-07-15T13:00:00.000Z',
        },
      ],
    };
    await storage.save(second);

    const loaded = await storage.load();
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0]?.id).toBe('p2');
    expect(await fileExists(`${path}.tmp`)).toBe(false);
  });

  it('getCatalog / saveCatalog operate on full workspace file', async () => {
    const path = await tempWorkspacePath();
    const storage = new JSONFileStorage(path);

    const catalog = await storage.getCatalog();
    expect(catalog.modules.some((m) => m.code === 'MOD-GAB-01')).toBe(true);

    const slim = { ...catalog, materials: catalog.materials.slice(0, 1) };
    await storage.saveCatalog(slim);

    const again = await storage.getCatalog();
    expect(again.materials).toHaveLength(1);
    const raw = JSON.parse(await readFile(path, 'utf8')) as Workspace;
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('saveProject upserts and deleteProject removes by id', async () => {
    const path = await tempWorkspacePath();
    const storage = new JSONFileStorage(path);

    // Missing file → seed with demo project already present
    const seedProjects = await storage.getProjects();
    expect(seedProjects.length).toBeGreaterThanOrEqual(1);

    const project: Project = {
      id: 'proj-upsert',
      name: 'A',
      customerId: 'C',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: '2026-07-15T14:00:00.000Z',
      updatedAt: '2026-07-15T14:00:00.000Z',
    };

    await storage.saveProject(project);
    expect(await storage.getProjects()).toHaveLength(seedProjects.length + 1);

    await storage.saveProject({ ...project, name: 'B' });
    const projects = await storage.getProjects();
    expect(projects).toHaveLength(seedProjects.length + 1);
    expect(projects.find((p) => p.id === 'proj-upsert')?.name).toBe('B');

    await storage.deleteProject('proj-upsert');
    expect(await storage.getProjects()).toHaveLength(seedProjects.length);
    expect(
      (await storage.getProjects()).some((p) => p.id === 'proj-upsert'),
    ).toBe(false);
  });

  it('load() returns existing corrupt-free JSON without rewriting seed', async () => {
    const path = await tempWorkspacePath('handwritten.json');
    const custom: Workspace = {
      schemaVersion: SCHEMA_VERSION,
      catalog: {
        materials: [],
        edges: [],
        hardware: [],
        optionGroups: [],
        modules: [],
      },
      projects: [],
    };
    await writeFile(path, JSON.stringify(custom), 'utf8');

    const storage = new JSONFileStorage(path);
    const loaded = await storage.load();
    expect(loaded.catalog.modules).toHaveLength(0);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('migrates v2 workspace → v3 (#108): backfills structure revision/history', async () => {
    // Hand-write a v2 workspace whose structures predate the `revision`/`history`
    // fields added in Slice 1. The migration must default them additively
    // (revision: 1, history: []) without dropping any other data, and bump
    // schemaVersion to 3. Legacy items without `structureRevisionPin` stay
    // unpinned (live revision) — that's the documented behavior.
    const path = await tempWorkspacePath('v2-migrate.json');
    // Cast through unknown: the on-disk shape intentionally omits the v3 fields.
    const v2Workspace = {
      schemaVersion: 2,
      catalog: {
        materials: [],
        edges: [],
        hardware: [],
        optionGroups: [],
        modules: [],
        structures: [
          {
            id: 'struct-legacy',
            code: 'EST-OLD',
            name: 'Legacy body',
            externalDims: { width: 300, height: 720, depth: 590 },
            components: [],
            presets: [],
            active: true,
            // no revision, no history
          },
          {
            id: 'struct-explicit',
            code: 'EST-NEW',
            name: 'Explicit body',
            externalDims: { width: 500, height: 720, depth: 590 },
            revision: 4,
            history: [{ revision: 3, code: 'EST-NEW', name: 'Old name' }],
            active: true,
          },
        ],
        categories: [],
        customers: [],
      },
      projects: [
        {
          id: 'proj-legacy',
          name: 'Legacy',
          customerId: 'c',
          currency: 'MXN',
          marginFactor: 1.35,
          laborFixedCost: 0,
          status: 'draft',
          items: [
            {
              id: 'i1',
              moduleId: 'm1',
              quantity: 1,
              optionChoices: {},
              // no structureRevisionPin — should stay undefined
            },
          ],
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
      ],
    } as unknown as Workspace;
    await writeFile(path, JSON.stringify(v2Workspace), 'utf8');

    const storage = new JSONFileStorage(path);
    const loaded = await storage.load();

    expect(loaded.schemaVersion).toBe(3);

    const structs = loaded.catalog.structures ?? [];
    expect(structs).toHaveLength(2);

    const legacy = structs.find((s) => s.id === 'struct-legacy');
    expect(legacy?.revision).toBe(1);
    expect(legacy?.history).toEqual([]);

    // Explicit revision/history must be preserved verbatim (additive migration).
    const explicit = structs.find((s) => s.id === 'struct-explicit');
    expect(explicit?.revision).toBe(4);
    expect(explicit?.history).toEqual([
      { revision: 3, code: 'EST-NEW', name: 'Old name' },
    ]);

    // Unpinned items stay unpinned — no forced freeze on legacy data.
    expect(loaded.projects[0]?.items[0]?.structureRevisionPin).toBeUndefined();
  });
});
