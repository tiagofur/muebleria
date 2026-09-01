import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSeedWorkspace } from '@granete/storage';
import type { Catalog } from '@granete/domain';

import { createCatalogStore, type CatalogStoreDeps } from './catalogStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

afterEach(() => {
  useUiStore.getState().disposeUi();
  // F118 S2 tests: restore the no-session default.
  useWorkspaceStore.setState({ session: null });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<CatalogStoreDeps> = {}): {
  deps: CatalogStoreDeps;
  saved: Catalog[];
  toasts: Array<{ type: string; message: string }>;
} {
  const saved: Catalog[] = [];
  const toasts: Array<{ type: string; message: string }> = [];
  // F064: catalogStore reads toast from uiStore. Replace the action with a
  // capture mock for the duration of this test run. Restored by afterEach
  // calling disposeUi() (which resets state) — we restore manually here too.
  useUiStore.setState({
    toast: (input) => {
      toasts.push(input);
    },
  });
  // F118 S2: the patch error-toast guard silences saves that raced a logout
  // (session === null). Simulate an active session for these tests.
  useWorkspaceStore.setState({ session: 'guest' });
  const deps: CatalogStoreDeps = {
    newId: () => `id-${Math.random().toString(36).slice(2, 8)}`,
    saveCatalog: async (c) => {
      saved.push(c);
    },
    getAuthToken: () => null,
    getSession: () => 'guest',
    getDraftProjectsCount: () => 0,
    fetchImpl: vi.fn() as unknown as typeof fetch,
    baseUrl: 'http://test/api',
    ...overrides,
  };
  return { deps, saved, toasts };
}

function seedCatalog(): Catalog {
  return createSeedWorkspace().catalog;
}

const materialDraft = {
  code: 'MAT-NEW',
  name: 'New Material',
      manufacturer: 'Arauco',
      categoryId: '',
  widthMm: 2440,
  lengthMm: 1220,
  thicknessMm: 18,
  grainDefault: false,
  boardPrice: 100,
  wastePercent: 10,
  // costPerM2 is required by MaterialDraft type even though the store
  // recomputes it from boardPrice + wastePercent.
  costPerM2: 0,
  defaultEdgeBandId: '',
  imageUrl: '',
  previewColor: '',
  previewTextureUrl: '',
      previewTextureTileWidthMm: 0,
      previewTextureTileLengthMm: 0,
  notes: '',
} as const;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('catalogStore — setCatalog', () => {
  it('replaces the catalog', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    expect(store.getState().catalog).toBeNull();
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    expect(store.getState().catalog).toBe(cat);
  });
});

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

describe('catalogStore — materials', () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('createMaterial appends + persists + toasts success', async () => {
    const { deps, saved, toasts } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    const before = store.getState().catalog!.materials.length;

    store.getState().createMaterial(materialDraft);
    await flush();

    expect(store.getState().catalog!.materials).toHaveLength(before + 1);
    const added = store.getState().catalog!.materials[before]!;
    expect(added.code).toBe('MAT-NEW');
    expect(added.active).toBe(true);
    // costPerM2 derived from formula (issue #14)
    expect(added.costPerM2).toBeGreaterThan(0);
    expect(saved).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ type: 'success' });
    expect(toasts[0]!.message).toContain('MAT-NEW');
  });

  it('updateMaterial persists texture tile X/Y mm into catalog + save payload', async () => {
    const { deps, saved } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.materials[0]!;

    store.getState().updateMaterial(first.id, {
      ...materialDraft,
      code: first.code,
      name: first.name,
      manufacturer: 'Arauco',
      categoryId: '',
      widthMm: first.widthMm,
      lengthMm: first.lengthMm,
      thicknessMm: first.thicknessMm,
      grainDefault: true,
      boardPrice: first.boardPrice ?? 100,
      wastePercent: first.wastePercent ?? 0,
      defaultEdgeBandId: first.defaultEdgeBandId ?? '',
      imageUrl: '/api/media/wood.webp',
      previewColor: '#C4A574',
      previewTextureUrl: '/api/media/wood.webp',
      previewTextureTileWidthMm: 400,
      previewTextureTileLengthMm: 600,
      notes: '',
    });
    await flush();

    const updated = store
      .getState()
      .catalog!.materials.find((m) => m.id === first.id)!;
    expect(updated.previewTextureTileWidthMm).toBe(400);
    expect(updated.previewTextureTileLengthMm).toBe(600);
    expect(updated.previewTextureUrl).toBe('/api/media/wood.webp');

    // Last saveCatalog call includes the tile sizes on the material.
    const last = saved[saved.length - 1]!;
    const savedMat = last.materials.find((m) => m.id === first.id)!;
    expect(savedMat.previewTextureTileWidthMm).toBe(400);
    expect(savedMat.previewTextureTileLengthMm).toBe(600);
  });

  it('createMaterial is a no-op when catalog is null', () => {
    const { deps, saved, toasts } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().createMaterial(materialDraft);
    expect(saved).toHaveLength(0);
    expect(toasts).toHaveLength(0);
  });

  it('updateMaterial #138: emits info toast when price changed AND drafts > 0', async () => {
    const { deps, toasts } = makeDeps({
      getDraftProjectsCount: () => 3,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.materials[0]!;

    store.getState().updateMaterial(first.id, {
      ...materialDraft,
      code: first.code,
      name: first.name,
      manufacturer: 'Arauco',
      categoryId: '',
      widthMm: first.widthMm,
      lengthMm: first.lengthMm,
      thicknessMm: first.thicknessMm,
      grainDefault: first.grainDefault ?? false,
      boardPrice: (first.boardPrice ?? 0) + 1000, // big price change
      wastePercent: first.wastePercent ?? 0,
      defaultEdgeBandId: first.defaultEdgeBandId ?? '',
      imageUrl: '',
      previewColor: '',
      previewTextureUrl: '',
      previewTextureTileWidthMm: 0,
      previewTextureTileLengthMm: 0,
      notes: '',
    });
    await flush();

    const infoToast = toasts.find((t) => t.type === 'info');
    expect(infoToast).toBeDefined();
    expect(infoToast!.message).toContain('3 cotizaciones');
  });

  it('updateMaterial #138: NO info toast when no drafts', async () => {
    const { deps, toasts } = makeDeps({
      getDraftProjectsCount: () => 0,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.materials[0]!;

    store.getState().updateMaterial(first.id, {
      ...materialDraft,
      code: first.code,
      name: first.name,
      manufacturer: 'Arauco',
      categoryId: '',
      widthMm: first.widthMm,
      lengthMm: first.lengthMm,
      thicknessMm: first.thicknessMm,
      grainDefault: first.grainDefault ?? false,
      boardPrice: (first.boardPrice ?? 0) + 1000,
      wastePercent: first.wastePercent ?? 0,
      defaultEdgeBandId: '',
      imageUrl: '',
      previewColor: '',
      previewTextureUrl: '',
      previewTextureTileWidthMm: 0,
      previewTextureTileLengthMm: 0,
      notes: '',
    });
    await flush();

    expect(toasts.find((t) => t.type === 'info')).toBeUndefined();
  });

  it('setMaterialActive toggles + toasts info with arrow', async () => {
    const { deps, toasts } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.materials[0]!;

    store.getState().setMaterialActive(first.id, false);
    await flush();

    const updated = store.getState().catalog!.materials.find((m) => m.id === first.id)!;
    expect(updated.active).toBe(false);
    // F116 C7: the info toast fires only after the save resolves.
    expect(toasts[0]).toMatchObject({ type: 'info' });
    expect(toasts[0]!.message).toContain('↓');
  });

  it('saveCatalog failure emits error toast and NO success toast', async () => {
    const { deps, toasts } = makeDeps({
      saveCatalog: async () => {
        throw new Error('disk full');
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = createCatalogStore({ deps });
      store.getState().setCatalog(seedCatalog());
      store.getState().createMaterial(materialDraft);
      await flush();
      expect(toasts.find((t) => t.type === 'error')).toBeDefined();
      expect(toasts.find((t) => t.type === 'success')).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Edges — createEdge returns id
// ---------------------------------------------------------------------------

describe('catalogStore — edges', () => {
  it('createEdge returns the new id', () => {
    const { deps } = makeDeps({ newId: () => 'edge-1' });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    const id = store.getState().createEdge({
      code: 'EDG-1',
      name: 'Canto 1',
      thicknessMm: 1,
      costPerMl: 5,
      previewColor: '',
      notes: '',
    });
    expect(id).toBe('edge-1');
    expect(store.getState().catalog!.edges.some((e) => e.id === 'edge-1')).toBe(true);
  });

  it('setEdgeActive toggles active', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.edges[0]!;
    store.getState().setEdgeActive(first.id, false);
    expect(
      store.getState().catalog!.edges.find((e) => e.id === first.id)!.active,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hardware + option groups + components
// ---------------------------------------------------------------------------

describe('catalogStore — hardware / optionGroups / components', () => {
  it('createHardware appends', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    store.getState().createHardware({
      code: 'HW-1',
      name: 'Bisagra',
      unit: 'piece',
      costPerUnit: 5,
      packageSize: '',
      imageUrl: '',
      notes: '',
      previewShape: '',
      previewColor: '',
      previewSizeMm: '',
      previewDiameterMm: '',
      previewProjectionMm: '',
      previewRoughness: '',
      previewMetalness: '',
      previewClearcoat: '',
      partFinishes: { body: '', base: '', grip: '' },
      machining: null,
    });
    expect(
      store.getState().catalog!.hardware.some((h) => h.code === 'HW-1'),
    ).toBe(true);
  });

  it('createHardware preserva el perfil de maquinado del draft (F127)', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    store.getState().createHardware({
      code: 'HW-MIN',
      name: 'Minifix demo',
      unit: 'set',
      costPerUnit: 4.5,
      packageSize: '',
      imageUrl: '',
      notes: '',
      previewShape: '',
      previewColor: '',
      previewSizeMm: '',
      previewDiameterMm: '',
      previewProjectionMm: '',
      previewRoughness: '',
      previewMetalness: '',
      previewClearcoat: '',
      partFinishes: { body: '', base: '', grip: '' },
      machining: {
        parts: [
          {
            id: 'cam',
            role: 'cam',
            operations: [
              {
                id: 'cam-15',
                kind: 'blind_hole',
                diameterMm: 15,
                depthMm: 13,
                xMm: 0,
                yMm: 0,
                face: 'anchor',
              },
            ],
          },
        ],
      },
    });
    const created = store
      .getState()
      .catalog!.hardware.find((h) => h.code === 'HW-MIN');
    expect(created?.machining).toEqual({
      parts: [
        {
          id: 'cam',
          role: 'cam',
          operations: [
            { id: 'cam-15', kind: 'blind_hole', diameterMm: 15, depthMm: 13, xMm: 0, yMm: 0, face: 'anchor' },
          ],
        },
      ],
    });
  });

  it('deleteOptionGroup removes by id (guest, no backend DELETE)', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { deps } = makeDeps({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.optionGroups[0]!;
    const before = cat.optionGroups.length;
    await store.getState().deleteOptionGroup(first.id);
    expect(store.getState().catalog!.optionGroups).toHaveLength(before - 1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('deleteOptionGroup (auth) calls backend DELETE with token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const { deps } = makeDeps({
      getSession: () => 'auth',
      getAuthToken: () => 'jwt-xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.optionGroups[0]!;

    await store.getState().deleteOptionGroup(first.id);

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://test/api/catalog/option-groups/${first.id}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-xyz',
        }),
      }),
    );
    expect(
      store.getState().catalog!.optionGroups.some((g) => g.id === first.id),
    ).toBe(false);
  });

  it('toggleComponentActive flips active (silent, no toast)', () => {
    const { deps, toasts } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.components?.[0];
    if (!first) return; // seed may not include components
    const prevActive = first.active;
    store.getState().toggleComponentActive(first.id);
    const updated = store.getState().catalog!.components?.find((c) => c.id === first.id);
    expect(updated?.active).toBe(!prevActive);
    expect(toasts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Categories — atypical: validation + module cleanup
// ---------------------------------------------------------------------------

describe('catalogStore — categories (atypical)', () => {
  it('deleteCategory blocked when has subcategories', async () => {
    const { deps, toasts } = makeDeps({ newId: () => 'cat-1' });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    // Seed has no categories by default — create a parent first.
    store.getState().createCategory({
      name: 'Parent',
      parentId: '',
      sortOrder: '0',
    });
    // Add a child category pointing at parent
    store.getState().createCategory({
      name: 'Child',
      parentId: 'cat-1',
      sortOrder: '0',
    });

    await store.getState().deleteCategory('cat-1');

    // Parent still there
    expect(
      store.getState().catalog!.categories?.some((c) => c.id === 'cat-1'),
    ).toBe(true);
    const warning = toasts.find((t) => t.type === 'warning');
    expect(warning).toMatchObject({
      message: 'No se puede eliminar: tiene subcategorías',
    });
  });

  it('deleteCategory clears categoryId from modules pointing at it', async () => {
    const { deps } = makeDeps({ newId: () => 'cat-1' });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    store.getState().createCategory({
      name: 'Solo',
      parentId: '',
      sortOrder: '0',
    });
    // Force a module to point at this category
    const target = cat.modules[0]!;
    store.getState().updateModule(target.id, {
      code: target.code,
      name: target.name,
      notes: target.notes ?? '',
      categoryId: 'cat-1',
      furnitureType: target.furnitureType ?? 'inferior',
      baseMode: '',
      baseClearanceMm: '',
      baseLaborCost: String(target.baseLaborCost ?? ''),
      imageUrl: target.imageUrl ?? '',
      externalWidth: '',
      externalHeight: '',
      externalDepth: '',
      hardwareLines: [],
      structureId: '',
      components: [],
      agregados: [],
      presets: [],
    });

    await store.getState().deleteCategory('cat-1');

    const updatedModule = store
      .getState()
      .catalog!.modules.find((m) => m.id === target.id)!;
    expect(updatedModule.categoryId).toBeUndefined();
  });

  it('deleteCategory (auth) calls backend DELETE with token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const { deps } = makeDeps({
      newId: () => 'cat-auth-1',
      getSession: () => 'auth',
      getAuthToken: () => 'jwt-xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    store.getState().createCategory({
      name: 'ToDelete',
      parentId: '',
      sortOrder: '0',
    });

    await store.getState().deleteCategory('cat-auth-1');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/catalog/categories/cat-auth-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-xyz',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Modules — deleteModule callback
// ---------------------------------------------------------------------------

describe('catalogStore — modules', () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('deleteModule invokes onModuleDeleted callback (guest, no backend DELETE)', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { deps } = makeDeps({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.modules[0]!;
    const spy = vi.fn();

    await store.getState().deleteModule(first.id, spy);

    expect(spy).toHaveBeenCalledWith(first.id);
    expect(
      store.getState().catalog!.modules.some((m) => m.id === first.id),
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('deleteModule (auth) calls backend DELETE with token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const { deps } = makeDeps({
      getSession: () => 'auth',
      getAuthToken: () => 'jwt-xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.modules[0]!;

    await store.getState().deleteModule(first.id);

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://test/api/catalog/modules/${first.id}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-xyz',
        }),
      }),
    );
    expect(
      store.getState().catalog!.modules.some((m) => m.id === first.id),
    ).toBe(false);
  });

  it('duplicateModuleById creates a copy with suggested code', async () => {
    const { deps, toasts } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.modules[0]!;
    const before = cat.modules.length;

    store.getState().duplicateModuleById(first.id);
    await flush();

    expect(store.getState().catalog!.modules).toHaveLength(before + 1);
    const copy = store.getState().catalog!.modules[before]!;
    expect(copy.id).not.toBe(first.id);
    expect(copy.code).toContain(first.code);
    expect(toasts[0]!.message).toContain('Duplicado');
  });
});

// ---------------------------------------------------------------------------
// Structures — async deleteStructure
// ---------------------------------------------------------------------------

describe('catalogStore — structures', () => {
  it('deleteStructure (auth) calls backend DELETE with token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const { deps } = makeDeps({
      getSession: () => 'auth',
      getAuthToken: () => 'jwt-xyz',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.structures?.[0];
    if (!first) {
      // Seed without structures — skip this assertion path.
      return;
    }

    await store.getState().deleteStructure(first.id);

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://test/api/catalog/structures/${first.id}`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-xyz',
        }),
      }),
    );
    expect(
      store.getState().catalog!.structures?.some((s) => s.id === first.id),
    ).toBe(false);
  });

  it('deleteStructure (guest) skips backend call', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { deps } = makeDeps({
      getSession: () => 'guest',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.structures?.[0];
    if (!first) return;

    await store.getState().deleteStructure(first.id);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('updateStructure bumps revision (#108)', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const first = cat.structures?.[0];
    if (!first) return;
    const prevRevision = first.revision ?? 1;

    store.getState().updateStructure(first.id, {
      code: first.code,
      name: first.name + ' (edited)',
      notes: first.notes ?? '',
      active: first.active ?? true,
      widthMm: first.externalDims?.width ?? 0,
      heightMm: first.externalDims?.height ?? 0,
      depthMm: first.externalDims?.depth ?? 0,
      presets: [],
      components: [],
      agregados: [],
    });

    const updated = store.getState().catalog!.structures?.find((s) => s.id === first.id);
    expect(updated?.revision).toBe(prevRevision + 1);
  });
});

// ---------------------------------------------------------------------------
// Customers — cross-store upsert
// ---------------------------------------------------------------------------

describe('catalogStore — customers', () => {
  it('createCustomer resolves owner via actor + appends', () => {
    const { deps } = makeDeps({ newId: () => 'cust-1' });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());

    store.getState().createCustomer(
      {
        name: 'Juan',
        email: 'j@x',
        phone: '',
        address: '',
        notes: '',
        ownerUserId: '',
      },
      { id: 'user-1', role: 'admin' },
    );

    const added = store.getState().catalog!.customers?.find((c) => c.id === 'cust-1');
    expect(added?.name).toBe('Juan');
    expect(added?.ownerUserId).toBe('user-1');
  });

  it('upsertCustomers replaces entire customers list (cross-store from projects)', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());

    store.getState().upsertCustomers([
      {
        id: 'new-cust',
        name: 'From Project',
        active: true,
      },
    ]);

    expect(store.getState().catalog!.customers).toHaveLength(1);
    expect(store.getState().catalog!.customers?.[0]?.id).toBe('new-cust');
  });
});

// ---------------------------------------------------------------------------
// Ambient materials
// ---------------------------------------------------------------------------

describe('catalogStore — ambient materials', () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('createAmbientMaterial appends + persists + toasts', async () => {
    const { deps, saved, toasts } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog({
      ...seedCatalog(),
      ambientMaterials: [],
    });
    store.getState().createAmbientMaterial({
      code: 'CERAMIC',
      name: 'Cerámica negra',
      surfaceType: 'floor',
      previewColor: '#222222',
      previewTextureUrl: '',
      previewTextureTileWidthMm: 0,
      previewTextureTileLengthMm: 0,
    });
    await flush();
    const cat = store.getState().catalog!;
    const added = cat.ambientMaterials ?? [];
    expect(added).toHaveLength(1);
    expect(added[0]!.code).toBe('CERAMIC');
    expect(added[0]!.surfaceType).toBe('floor');
    expect(added[0]!.active).toBe(true);
    expect(saved).toHaveLength(1);
    expect(toasts.some((t) => /CERAMIC/.test(t.message))).toBe(true);
  });

  it('createAmbientMaterial coerces empty-string PBR to undefined and clamps', async () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog({
      ...seedCatalog(),
      ambientMaterials: [],
    });
    // Form inputs yield `number | ''`: empty string, valid, and out-of-range.
    store.getState().createAmbientMaterial({
      code: 'PBR',
      name: 'Pbr test',
      surfaceType: 'floor',
      previewColor: '',
      previewTextureUrl: '',
      previewTextureTileWidthMm: 0,
      previewTextureTileLengthMm: 0,
      previewRoughness: '',
      previewMetalness: 0.5,
      previewClearcoat: 2,
    });
    await flush();
    const added = store.getState().catalog!.ambientMaterials![0]!;
    // Empty-string form value excluded (no "" persisted to domain type).
    expect(added.previewRoughness).toBeUndefined();
    // Valid number passed through.
    expect(added.previewMetalness).toBe(0.5);
    // Out-of-range clamped to [0, 1].
    expect(added.previewClearcoat).toBe(1);
  });

  it('updateAmbientMaterial patches the matching id', async () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog({
      ...seedCatalog(),
      ambientMaterials: [
        {
          id: 'am-1',
          code: 'OLD',
          name: 'Viejo',
          active: true,
          surfaceType: 'wall',
        },
      ],
    });
    store.getState().updateAmbientMaterial('am-1', {
      code: 'NEW',
      name: 'Nuevo',
      surfaceType: 'wall',
      previewColor: '',
      previewTextureUrl: '',
      previewTextureTileWidthMm: 0,
      previewTextureTileLengthMm: 0,
    });
    await flush();
    const am = store.getState().catalog!.ambientMaterials!;
    expect(am[0]!.code).toBe('NEW');
    expect(am[0]!.name).toBe('Nuevo');
  });

  it('setAmbientMaterialActive toggles active', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog({
      ...seedCatalog(),
      ambientMaterials: [
        {
          id: 'am-1',
          code: 'CERAMIC',
          name: 'Cerámica',
          active: true,
          surfaceType: 'floor',
        },
      ],
    });
    store.getState().setAmbientMaterialActive('am-1', false);
    const am = store.getState().catalog!.ambientMaterials!;
    expect(am[0]!.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

describe('catalogStore — media helpers', () => {
  it('resolveMediaUrl returns undefined for empty input', () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    expect(store.getState().resolveMediaUrl(undefined)).toBeUndefined();
    expect(store.getState().resolveMediaUrl('')).toBeUndefined();
  });

  it('uploadCatalogImage throws when no auth token', async () => {
    const { deps } = makeDeps({ getAuthToken: () => null });
    const store = createCatalogStore({ deps });
    await expect(
      store.getState().uploadCatalogImage(new File([], 'x.png')),
    ).rejects.toThrow('no auth');
  });

  it('uploadCatalogImage POSTs and returns url', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: '/api/media/x.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { deps } = makeDeps({
      getAuthToken: () => 'jwt',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });

    const url = await store.getState().uploadCatalogImage(
      new File(['data'], 'x.png'),
    );

    expect(url).toBe('/api/media/x.png');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/media',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer jwt' },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// F116 — critical catalog bugfixes
// ---------------------------------------------------------------------------

describe('catalogStore — F116 bugfixes', () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('C1: createMaterial persists PBR finish fields (roughness/metalness/clearcoat)', async () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    const before = store.getState().catalog!.materials.length;

    store.getState().createMaterial({
      ...materialDraft,
      previewRoughness: 0.4,
      previewMetalness: 0.8,
      previewClearcoat: 1.5, // clamped to 1
    } as typeof materialDraft & { previewRoughness?: number; previewMetalness?: number; previewClearcoat?: number });
    await flush();

    const added = store.getState().catalog!.materials[before]!;
    expect(added.previewRoughness).toBe(0.4);
    expect(added.previewMetalness).toBe(0.8);
    expect(added.previewClearcoat).toBe(1);
  });

  it('C1: updateMaterial can set PBR fields on an existing material', async () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const target = cat.materials[0]!;

    store.getState().updateMaterial(target.id, {
      ...materialDraft,
      code: target.code,
      previewRoughness: 0.25,
    } as typeof materialDraft & { previewRoughness?: number });
    await flush();

    const updated = store
      .getState()
      .catalog!.materials.find((m) => m.id === target.id)!;
    expect(updated.previewRoughness).toBe(0.25);
  });

  it('C5: invalid previewColor is dropped, never stored raw', async () => {
    const { deps } = makeDeps();
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());
    const before = store.getState().catalog!.materials.length;

    store.getState().createMaterial({
      ...materialDraft,
      previewColor: 'not-a-color',
    });
    await flush();

    const added = store.getState().catalog!.materials[before]!;
    expect(added.previewColor).toBeUndefined();
  });

  it('C7: createEdge does not toast success when the save fails', async () => {
    const failing = makeDeps({
      saveCatalog: async () => {
        throw new Error('boom');
      },
    });
    const store = createCatalogStore({ deps: failing.deps });
    store.getState().setCatalog(seedCatalog());

    store.getState().createEdge({
      code: 'EDGE-X',
      name: 'Edge X',
      thicknessMm: 0.5,
      costPerMl: 10,
      notes: '',
      previewColor: '',
    });
    await flush();

    const messages = failing.toasts.map((t) => t.message);
    expect(messages.some((m) => m.includes('EDGE-X') && m.includes('✓'))).toBe(
      false,
    );
    expect(
      failing.toasts.some((t) => t.type === 'error'),
    ).toBe(true);
  });

  it('C4: deleteAgregado hits the REST endpoint when authenticated', async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({ ok: true, text: async () => '' }) as unknown as Response,
    );
    const { deps } = makeDeps({
      getSession: () => 'auth',
      getAuthToken: () => 'jwt',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const store = createCatalogStore({ deps });
    const cat = seedCatalog();
    store.getState().setCatalog(cat);
    const target = (cat.agregados ?? [])[0];
    if (!target) return; // seed without agregados: nothing to assert

    await store.getState().deleteAgregado(target.id);
    await flush();

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/api/catalog/agregados/' + target.id,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// P1-4 (pre-demo audit): save serialization
// ---------------------------------------------------------------------------

describe('catalogStore — save serialization (P1-4)', () => {
  it('rapid patches never interleave saveCatalog calls', async () => {
    let active = 0;
    let maxConcurrent = 0;
    const saved: Catalog[] = [];
    const { deps } = makeDeps({
      saveCatalog: async (c) => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise((r) => setTimeout(r, 0));
        active--;
        saved.push(c);
      },
    });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());

    // Triple-click: three mutations before any save settles.
    store.getState().createMaterial(materialDraft);
    store.getState().createMaterial({ ...materialDraft, code: 'MAT-NEW-2' });
    store.getState().createMaterial({ ...materialDraft, code: 'MAT-NEW-3' });

    // Poll for the serialized chain to settle instead of a fixed 10 ms
    // window: under a loaded CI runner the debounced saves legitimately
    // need longer, and asserting early turned this test flaky.
    const carriesAllThree = () => {
      const last = saved[saved.length - 1];
      return (
        last !== undefined &&
        last.materials.filter((m) => m.code.startsWith('MAT-NEW')).length === 3
      );
    };
    const deadline = Date.now() + 2000;
    while (!carriesAllThree() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(saved.length).toBeGreaterThan(0);
    expect(maxConcurrent).toBe(1);
    // The last save carries the whole accumulated catalog.
    expect(carriesAllThree()).toBe(true);
  });

  it('a failed save does not poison the chain — the next mutation still saves', async () => {
    let calls = 0;
    const saved: Catalog[] = [];
    const { deps } = makeDeps({
      saveCatalog: async (c) => {
        calls++;
        if (calls === 1) throw new Error('boom');
        saved.push(c);
      },
    });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());

    store.getState().createMaterial(materialDraft);
    await new Promise((r) => setTimeout(r, 0));
    store.getState().createMaterial({ ...materialDraft, code: 'MAT-NEW-2' });
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toBe(2);
    expect(saved.length).toBe(1);
  });

  it('keeps C behind B after A settles', async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxConcurrent = 0;
    let started = 0;
    const { deps } = makeDeps({
      saveCatalog: async () => {
        started++;
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
      },
    });
    const store = createCatalogStore({ deps });
    store.getState().setCatalog(seedCatalog());

    store.getState().createMaterial(materialDraft); // A starts.
    store.getState().createMaterial({ ...materialDraft, code: 'MAT-B' }); // B queues.
    expect(started).toBe(1);

    releases.shift()!();
    await vi.waitFor(() => expect(started).toBe(2)); // B is active after A settled.

    store.getState().createMaterial({ ...materialDraft, code: 'MAT-C' });
    expect(started).toBe(2); // C must stay queued, never overlap B.
    expect(maxConcurrent).toBe(1);

    releases.shift()!();
    await vi.waitFor(() => expect(started).toBe(3));
    expect(maxConcurrent).toBe(1);

    releases.shift()!();
    await Promise.resolve();
  });

  it('deduplicates an in-flight customer submission with production-like UUIDs', async () => {
    const known = new Set(seedCatalog().customers?.map((customer) => customer.id));
    let customerCreates = 0;
    let releaseSave: (() => void) | undefined;
    const generatedIds: string[] = [];
    const saveCatalog = vi.fn(async (catalog: Catalog) => {
      for (const customer of catalog.customers ?? []) {
        if (known.has(customer.id)) continue;
        customerCreates++;
        known.add(customer.id);
      }
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    });
    const { deps } = makeDeps({
      newId: () => {
        const id = `customer-${generatedIds.length + 1}`;
        generatedIds.push(id);
        return id;
      },
      saveCatalog,
    });
    const store = createCatalogStore({ deps });
    const initialCatalog = seedCatalog();
    const initialCount = initialCatalog.customers?.length ?? 0;
    store.getState().setCatalog(initialCatalog);
    const draft = {
      name: 'Cliente doble click',
      email: '',
      phone: '',
      address: '',
      notes: '',
      ownerUserId: '',
    };

    store.getState().createCustomer(draft, { id: 'seller-1', role: 'vendedor' });
    store.getState().createCustomer(draft, { id: 'seller-1', role: 'vendedor' });

    expect(generatedIds).toEqual(['customer-1', 'customer-2']);
    expect(store.getState().catalog?.customers).toHaveLength(initialCount + 1);
    expect(saveCatalog).toHaveBeenCalledTimes(1);
    expect(customerCreates).toBe(1);

    releaseSave?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(customerCreates).toBe(1);
  });
});
