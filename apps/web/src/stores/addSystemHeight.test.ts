import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agregado, Catalog, Hardware } from '@granete/domain';

import { createCatalogStore, type CatalogStoreDeps } from './catalogStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

// #1625 — «Añadir altura»: con sesión, UNA petición transaccional al servidor
// (juego + diseños + variante + insertos/selector); sin servidor, la misma
// mutación local. Nunca una petición por registro en sesión.

afterEach(() => {
  useUiStore.getState().disposeUi();
  useWorkspaceStore.setState({ session: null, activeOrg: null, workspaceSeq: 0 });
});

function systemCatalog(): Catalog {
  const kitM: Hardware = { id: 'kit-m', code: 'SYS-M', name: 'Sistema M', unit: 'set', costPerUnit: 200, active: true };
  const agregado: Agregado = {
    id: 'agr-sys',
    code: 'SYS-CAJON',
    name: 'Cajón Sistema',
    active: true,
    externalDims: { width: 570, height: 108, depth: 530 },
    commercialKitHardwareId: 'kit-m',
    variantSets: [
      { id: 'vs-h', dimension: 'height', variants: [{ nominalDimensionMm: 108, hardwareId: 'kit-m', commercialKitHardwareId: 'kit-m' }] },
    ],
  } as unknown as Agregado;
  return {
    materials: [],
    edges: [],
    hardware: [kitM],
    optionGroups: [],
    modules: [],
    agregados: [agregado],
  } as unknown as Catalog;
}

function setup(session: 'auth' | 'guest', overrides: Partial<CatalogStoreDeps> = {}) {
  const saved: Catalog[] = [];
  const toasts: Array<{ type: string; message: string }> = [];
  useUiStore.setState({ toast: (input) => { toasts.push(input); } });
  useWorkspaceStore.setState({ session, activeOrg: null, workspaceSeq: 0 });
  let n = 0;
  const deps: CatalogStoreDeps = {
    newId: () => `id-${++n}`,
    saveCatalog: async (c) => { saved.push(c); },
    getAuthToken: () => null,
    getSession: () => session,
    getDraftProjectsCount: () => 0,
    fetchImpl: vi.fn() as unknown as typeof fetch,
    baseUrl: 'http://test/api',
    ...overrides,
  };
  const store = createCatalogStore({ deps });
  store.getState().setCatalog(systemCatalog());
  return { store, saved, toasts };
}

const galeria = {
  suffix: 'GAL',
  name: 'Galería',
  anchors: ['left', 'right'] as const,
  pieceOffsets: { left: { x: 1, y: 2, z: 3 }, right: { x: 1, y: 2, z: 3 } },
  actorMembership: 'actor:drawer' as const,
};

describe('#1625 addSystemHeight — con sesión: una transacción del servidor', () => {
  it('manda juego, diseños, variante, insertos y selector en UNA petición y adopta la respuesta', async () => {
    const server = vi.fn().mockResolvedValue({
      created_codes: [],
      agregado_id: 'agr-sys',
      agregado_version: 7,
      variant_set_id: 'vs-h',
      height_mm: 209,
    });
    const { store, saved } = setup('auth', { addHardwareKitSystemHeight: server });

    await store.getState().addSystemHeight({
      agregadoId: 'agr-sys', heightCode: 'E', kitCostPerUnit: 300, widthMm: 570, depthMm: 530, insertos: [galeria],
    });

    expect(server).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(0); // nunca el guardado registro por registro
    const [agregadoId, body] = server.mock.calls[0]!;
    expect(agregadoId).toBe('agr-sys');
    const kit = body.hardware.find((h: { code: string }) => h.code === 'SYS-E');
    expect(kit.unit).toBe('set');
    expect(body.variant).toEqual({ nominalDimensionMm: 209, kit_hardware_id: kit.id });
    const inserto = body.hardware.find((h: { code: string }) => h.code === 'SYS-E-GAL');
    expect(inserto.kit_hardware_id).toBeNull();
    expect(inserto.pieces[0].offsetMm).toEqual({ x: 1, y: 2, z: 3 });
    expect(inserto.design_parts[0].actor_membership).toBe('actor:drawer');
    expect(body.option_group).toMatchObject({ code: 'SYS_LATERAL_E', kind: 'hardware', kit_hardware_id: kit.id, option_ids: [inserto.id] });
    expect(body.hardware.every((h: { code: string; kit_hardware_id: string | null; unit: string }) =>
      h.unit === 'set' || h.code === 'SYS-E-GAL' || h.kit_hardware_id === kit.id)).toBe(true);

    const catalog = store.getState().catalog!;
    const agr = catalog.agregados!.find((a) => a.id === 'agr-sys')!;
    expect(agr.variantSets![0]!.variants.map((v) => v.nominalDimensionMm)).toEqual([108, 209]);
    expect(agr.externalDims!.height).toBe(209);
    expect(catalog.optionGroups!.some((g) => g.code === 'SYS_LATERAL_E' && g.kitHardwareId === kit.id)).toBe(true);
    expect(catalog.hardware!.some((h) => h.code === 'SYS-E-GAL')).toBe(true);
  });

  it('un fallo del servidor no cambia el catálogo local ni cae al guardado registro por registro', async () => {
    const server = vi.fn().mockRejectedValue(new Error('409 código tomado'));
    const { store, saved } = setup('auth', { addHardwareKitSystemHeight: server });
    const before = store.getState().catalog;

    await expect(
      store.getState().addSystemHeight({ agregadoId: 'agr-sys', heightCode: 'E', kitCostPerUnit: 300, widthMm: 570, depthMm: 530 }),
    ).rejects.toThrow('409');
    expect(saved).toHaveLength(0);
    expect(store.getState().catalog).toBe(before);
  });

  it('los insertos sólo aplican a la altura E', async () => {
    const server = vi.fn().mockResolvedValue({
      created_codes: [], agregado_id: 'agr-sys', agregado_version: 7, variant_set_id: 'vs-h', height_mm: 146,
    });
    const { store } = setup('auth', { addHardwareKitSystemHeight: server });
    await store.getState().addSystemHeight({
      agregadoId: 'agr-sys', heightCode: 'K', kitCostPerUnit: 250, widthMm: 570, depthMm: 530, insertos: [galeria],
    });
    const body = server.mock.calls[0]![1];
    expect(body.option_group).toBeNull();
    expect(body.hardware.some((h: { code: string }) => h.code.endsWith('-GAL'))).toBe(false);
  });
});

describe('#1625 addSystemHeight — sin servidor (invitado)', () => {
  it('aplica la misma mutación local, insertos y selector incluidos', async () => {
    const server = vi.fn();
    const { store, saved } = setup('guest', { addHardwareKitSystemHeight: server });
    await store.getState().addSystemHeight({
      agregadoId: 'agr-sys', heightCode: 'E', kitCostPerUnit: 300, widthMm: 570, depthMm: 530, insertos: [galeria],
    });
    expect(server).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    const catalog = store.getState().catalog!;
    const kit = catalog.hardware!.find((h) => h.code === 'SYS-E')!;
    expect(catalog.optionGroups!.find((g) => g.code === 'SYS_LATERAL_E')?.kitHardwareId).toBe(kit.id);
    expect(catalog.agregados![0]!.variantSets![0]!.variants).toHaveLength(2);
  });
});
