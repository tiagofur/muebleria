import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, CutPlan, Project } from '@granete/domain';
import { useExportHandlers, type ExportHandlersDeps } from './useExportHandlers';

const mocks = vi.hoisted(() => ({
  resolveProjectDrilling: vi.fn(),
  downloadCutPlanDxf: vi.fn(),
  setExportBusy: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock('@granete/domain', async (importOriginal) => ({
  ...await importOriginal<typeof import('@granete/domain')>(),
  resolveProjectDrilling: mocks.resolveProjectDrilling,
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: (selector: (state: { setExportBusy: typeof mocks.setExportBusy }) => unknown) =>
    selector({ setExportBusy: mocks.setExportBusy }),
}));
vi.mock('../exportCutPlanDxf', () => ({ downloadCutPlanDxf: mocks.downloadCutPlanDxf }));

describe('productive DXF export handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-throwing drilling issues instead of downloading geometry-only or unsafe DXF', async () => {
    const project = { id: 'project-1' } as Project;
    const cutPlan = { projectId: project.id } as CutPlan;
    const catalog = {} as Catalog;
    const toast = vi.fn();
    const issue = { code: 'HOLE_OUT_OF_BOUNDS', message: 'Invalid drilling', hole: {} };
    mocks.resolveProjectDrilling.mockReturnValue({
      patterns: [{ pieceCode: 'A1', issues: [issue], fallbackUsed: false }],
      resolutionIssues: [],
      data: { patterns: [{ pieceCode: 'A1', holes: [] }] },
      links: [],
    });
    const deps = {
      projects: [project], selectedProject: project, catalog, toast,
    } as unknown as ExportHandlersDeps;

    await useExportHandlers(deps).handleExportCutPlanDxf(cutPlan, 'sheets');

    expect(mocks.downloadCutPlanDxf).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it.each(['sheets', 'pieces'] as const)(
    'blocks %s DXF before download when secondary BOM resolution failed',
    async (variant) => {
      const project = { id: 'project-1' } as Project;
      const toast = vi.fn();
      mocks.resolveProjectDrilling.mockReturnValue({
        resolutionIssues: [{
          code: 'DRILLING_BOM_RESOLUTION_FAILED',
          message: 'No se pudo resolver el BOM secundario para las perforaciones del ítem del proyecto.',
          projectId: project.id, projectItemId: 'item-2', moduleId: 'module-2',
          stage: 'secondary-bom', blocking: true,
        }],
        patterns: [{ pieceCode: 'A1', issues: [], fallbackUsed: true }],
        data: { patterns: [{ pieceCode: 'A1', holes: [] }] },
        links: [],
      });
      const deps = {
        projects: [project], selectedProject: project, catalog: {} as Catalog, toast,
      } as unknown as ExportHandlersDeps;

      await useExportHandlers(deps).handleExportCutPlanDxf({ projectId: project.id } as CutPlan, variant);

      expect(mocks.downloadCutPlanDxf).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    },
  );

  it.each(['sheets', 'pieces'] as const)(
    'allows %s DXF when a valid fallback has zero holes and no resolution issues',
    async (variant) => {
      const project = { id: 'project-1' } as Project;
      const cutPlan = { projectId: project.id } as CutPlan;
      const toast = vi.fn();
      const drilling = [{ pieceCode: 'A1', holes: [] }];
      mocks.resolveProjectDrilling.mockReturnValue({
        resolutionIssues: [],
        patterns: [{ pieceCode: 'A1', issues: [], fallbackUsed: true, holes: [] }],
        data: { patterns: drilling },
        links: [],
      });
      const deps = {
        projects: [project], selectedProject: project, catalog: {} as Catalog, toast,
      } as unknown as ExportHandlersDeps;

      await useExportHandlers(deps).handleExportCutPlanDxf(cutPlan, variant);

      expect(mocks.downloadCutPlanDxf).toHaveBeenCalledWith(
        cutPlan, variant, undefined, undefined, { drilling },
      );
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    },
  );
});
