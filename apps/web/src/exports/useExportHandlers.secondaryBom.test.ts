import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CutPlan, ProjectDrillingResult } from '@granete/domain';
import { IDS, plantillaCatalogWithModules, plantillaProject } from '@granete/domain/fixtures';
import { useExportHandlers, type ExportHandlersDeps } from './useExportHandlers';

const state = vi.hoisted(() => ({
  bomCalls: 0,
  failAt: 0,
  primaryReturned: false,
  resolved: null as ProjectDrillingResult | null,
  download: vi.fn(),
  setExportBusy: vi.fn(),
}));

vi.mock('../../../../packages/domain/src/engine/bom', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/domain/src/engine/bom')>();
  return {
    ...original,
    resolveBom: (...args: Parameters<typeof original.resolveBom>) => {
      state.bomCalls++;
      if (state.bomCalls === state.failAt) throw new Error('Injected secondary BOM failure');
      const result = original.resolveBom(...args);
      state.primaryReturned = result.boardParts.length > 0;
      return result;
    },
  };
});
vi.mock('@granete/domain', async (importOriginal) => {
  const original = await importOriginal<typeof import('@granete/domain')>();
  return {
    ...original,
    resolveProjectDrilling: (params: Parameters<typeof original.resolveProjectDrilling>[0]) => {
      const result = original.resolveProjectDrilling(params);
      state.resolved = result;
      return result;
    },
  };
});
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: (selector: (value: { setExportBusy: typeof state.setExportBusy }) => unknown) =>
    selector({ setExportBusy: state.setExportBusy }),
}));
vi.mock('../exportCutPlanDxf', () => ({ downloadCutPlanDxf: state.download }));

describe('project DXF with an injected secondary BOM failure', () => {
  beforeEach(() => {
    state.bomCalls = 0;
    state.failAt = 0;
    state.primaryReturned = false;
    state.resolved = null;
    vi.clearAllMocks();
  });

  it.each([
    { variant: 'sheets', multipleItems: false, failAt: 2, failedItem: IDS.itemGab },
    { variant: 'pieces', multipleItems: false, failAt: 2, failedItem: IDS.itemGab },
    { variant: 'sheets', multipleItems: true, failAt: 4, failedItem: IDS.itemCaj },
  ] as const)(
    'retains the real resolver issue and does not download $variant DXF (multiple items: $multipleItems)',
    async ({ variant, multipleItems, failAt, failedItem }) => {
      state.failAt = failAt;
      const project = multipleItems ? plantillaProject : {
        ...plantillaProject,
        items: plantillaProject.items.filter((item) => item.id === IDS.itemGab),
      };
      const toast = vi.fn();
      const deps = {
        projects: [project], selectedProject: project,
        catalog: plantillaCatalogWithModules, toast,
      } as unknown as ExportHandlersDeps;

      await useExportHandlers(deps).handleExportCutPlanDxf(
        { projectId: project.id } as CutPlan, variant,
      );

      expect(state.primaryReturned).toBe(true);
      expect(state.bomCalls).toBe(failAt);
      expect(state.resolved?.links.length).toBeGreaterThan(0);
      expect(state.resolved?.resolutionIssues).toEqual([
        expect.objectContaining({
          code: 'DRILLING_BOM_RESOLUTION_FAILED',
          projectId: project.id,
          projectItemId: failedItem,
          stage: 'secondary-bom',
          blocking: true,
        }),
      ]);
      expect(state.download).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    },
  );
});
