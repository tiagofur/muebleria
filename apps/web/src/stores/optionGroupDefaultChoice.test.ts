import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Catalog } from '@granete/domain';

import { createCatalogStore, type CatalogStoreDeps } from './catalogStore';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';

// #1627 — el default de un selector de insertos sólo cambia cuando el draft
// lo trae; la pantalla de Grupos (draft sin defaultChoice) lo conserva.

afterEach(() => {
  useUiStore.getState().disposeUi();
  useWorkspaceStore.setState({ session: null, activeOrg: null, workspaceSeq: 0 });
});

function setup() {
  useUiStore.setState({ toast: () => {} });
  useWorkspaceStore.setState({ session: 'guest', activeOrg: null, workspaceSeq: 0 });
  let n = 0;
  const deps: CatalogStoreDeps = {
    newId: () => `id-${++n}`,
    saveCatalog: async () => {},
    getAuthToken: () => null,
    getSession: () => 'guest',
    getDraftProjectsCount: () => 0,
    fetchImpl: vi.fn() as unknown as typeof fetch,
    baseUrl: 'http://test/api',
  };
  const store = createCatalogStore({ deps });
  store.getState().setCatalog({
    materials: [],
    edges: [],
    hardware: [],
    modules: [],
    optionGroups: [
      { id: 'og-ins', code: 'INS', name: 'Insertos', kind: 'hardware', required: false, optionIds: [], kitHardwareId: 'kit-m', defaultChoice: 'none' },
    ],
  } as unknown as Catalog);
  return store;
}

describe('#1627 updateOptionGroup — default del selector', () => {
  it('un draft sin defaultChoice conserva el «ninguno» guardado; uno con valor lo cambia', async () => {
    const store = setup();
    const draft = { code: 'INS', name: 'Insertos editado', kind: 'hardware' as const, required: false, optionIds: [], kitHardwareId: 'kit-m' };
    store.getState().updateOptionGroup('og-ins', draft);
    await vi.waitFor(() => expect(store.getState().catalog!.optionGroups[0]!.name).toBe('Insertos editado'));
    expect(store.getState().catalog!.optionGroups[0]!.defaultChoice).toBe('none');

    store.getState().updateOptionGroup('og-ins', { ...draft, defaultChoice: 'first_active' });
    await vi.waitFor(() => expect(store.getState().catalog!.optionGroups[0]!.defaultChoice).toBeUndefined());
  });
});
