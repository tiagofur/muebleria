import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Catalog, HardwareKitSystemInput } from '@granete/domain';

import { createCatalogStore, type CatalogStoreDeps } from './catalogStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

// #1633 s2a — alta de la familia de cajón con alturas libres: precio por
// altura, un herraje por (inserto × altura) y un selector por altura con
// insertos, en UNA petición (option_groups) con sesión y en la misma
// mutación local sin servidor.

afterEach(() => {
  useUiStore.getState().disposeUi();
  useWorkspaceStore.setState({ session: null, activeOrg: null, workspaceSeq: 0 });
});

function emptyCatalog(): Catalog {
  return { materials: [], edges: [], hardware: [], optionGroups: [], modules: [], agregados: [] } as unknown as Catalog;
}

function setup(session: 'auth' | 'guest', overrides: Partial<CatalogStoreDeps> = {}) {
  const saved: Catalog[] = [];
  useUiStore.setState({ toast: () => {} });
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
  store.getState().setCatalog(emptyCatalog());
  return { store, saved };
}

const legrabox: HardwareKitSystemInput = {
  code: 'LGX',
  name: 'Legrabox',
  kitCostPerUnit: 500,
  widthMm: 560,
  depthMm: 500,
  brand: 'Blum',
  line: 'Legrabox',
  heights: [
    { code: 'N', labelEs: 'N', khMinMm: 70, include: true, kitCostPerUnit: 450 },
    { code: 'C', labelEs: 'C', khMinMm: 177, include: true, kitCostPerUnit: 610 },
  ],
  accessories: [
    { suffix: 'GAL', name: 'Galería', anchors: ['left', 'right'], heights: ['C'], costPerUnit: 120 },
    { suffix: 'BOX', name: 'Boxcover', anchors: ['left', 'right'], heights: ['C', 'N'] },
  ],
};

describe('#1633 createHardwareKitSystem — alturas libres e insertos por altura', () => {
  it('con sesión: una petición con precios por altura y un selector por juego (option_groups)', async () => {
    const server = vi.fn().mockResolvedValue({
      created_codes: [],
      reused_codes: [],
      agregado_id: 'agr-srv',
      agregado_code: 'LGX-CAJON',
      variant_set_ids: ['vs-srv'],
    });
    const { store } = setup('auth', { createHardwareKitSystem: server });
    await store.getState().createHardwareKitSystem({ input: legrabox });

    expect(server).toHaveBeenCalledTimes(1);
    const body = server.mock.calls[0]![0];
    const byCode = new Map(body.hardware.map((h: { code: string }) => [h.code, h]));
    expect((byCode.get('LGX-N') as { cost_per_unit: number }).cost_per_unit).toBe(450);
    expect((byCode.get('LGX-C') as { cost_per_unit: number }).cost_per_unit).toBe(610);
    expect((byCode.get('LGX-C-GAL') as { cost_per_unit: number }).cost_per_unit).toBe(120);
    expect(byCode.has('LGX-N-BOX')).toBe(true);
    expect(body.option_group).toBeUndefined();

    const kitN = byCode.get('LGX-N') as { id: string };
    const kitC = byCode.get('LGX-C') as { id: string };
    const idOf = (code: string) => (byCode.get(code) as { id: string }).id;
    expect(body.option_groups).toEqual([
      expect.objectContaining({ code: 'LGX_LATERAL_N', kit_hardware_id: kitN.id, option_ids: [idOf('LGX-N-BOX')] }),
      expect.objectContaining({
        code: 'LGX_LATERAL_C',
        kit_hardware_id: kitC.id,
        option_ids: [idOf('LGX-C-GAL'), idOf('LGX-C-BOX')],
      }),
    ]);
    expect(body.agregado.drawer_system).toEqual({ brand: 'Blum', line: 'Legrabox' });
    expect(body.agregado.variant_sets[0].variants.map((v: { label: string }) => v.label)).toEqual(['N', 'C']);

    const groups = store.getState().catalog?.optionGroups ?? [];
    expect(groups.map((g) => g.code)).toEqual(['LGX_LATERAL_N', 'LGX_LATERAL_C']);
  });

  it('sin servidor: los mismos selectores entran en la mutación local', async () => {
    const { store, saved } = setup('guest');
    await store.getState().createHardwareKitSystem({ input: legrabox });
    const catalog = saved.at(-1)!;
    const hw = new Map((catalog.hardware ?? []).map((h) => [h.code, h]));
    expect(hw.get('LGX-C')?.costPerUnit).toBe(610);
    const groups = (catalog.optionGroups ?? []).filter((g) => g.code.startsWith('LGX_LATERAL_'));
    expect(groups.map((g) => [g.code, g.kitHardwareId])).toEqual([
      ['LGX_LATERAL_N', hw.get('LGX-N')?.id],
      ['LGX_LATERAL_C', hw.get('LGX-C')?.id],
    ]);
    expect(groups[1]?.optionIds).toEqual([hw.get('LGX-C-GAL')?.id, hw.get('LGX-C-BOX')?.id]);
  });
});
