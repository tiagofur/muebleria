import { describe, expect, it, vi } from 'vitest';

import type { Workspace } from '@granete/domain';
import { createSeedWorkspace, type WorkspaceRepository } from '@granete/storage';

import { createWorkspaceStore, __setWorkspacePageUnloadingForTests } from './workspaceStore';

/**
 * La navegación (goto/recarga) cancela los fetch en vuelo: Chromium rechaza con
 * `TypeError: Failed to fetch`. Esa cancelación no es un fallo del workspace y
 * no debe gritar a consola — los journeys E2E fallan sobre ruido de unload.
 */
describe('workspaceStore — carga abortada por navegación (pagehide)', () => {
  it('no surfaza console.error ni workspaceLoadError cuando la página se descarga en pleno load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingRepo = {
      load(): Promise<Workspace> {
        return Promise.reject(new TypeError('Failed to fetch'));
      },
    } as unknown as WorkspaceRepository;
    const store = createWorkspaceStore({
      deps: { repositoryFactory: () => failingRepo },
    });
    store.getState().enterAsGuest();

    // El navegador marca la descarga (pagehide) antes de cancelar los fetch.
    __setWorkspacePageUnloadingForTests(true);
    await store.getState().loadWorkspace();

    expect(consoleError).not.toHaveBeenCalled();
    expect(store.getState().workspaceLoadError).toBeNull();
  });
});
