/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog, CutPlan, Project } from '@granete/domain';
import { useExportHandlers, type ExportHandlersDeps } from './useExportHandlers';

const mocks = vi.hoisted(() => ({
  resolveProjectDrilling: vi.fn(),
  downloadCutPlanDxf: vi.fn(),
  setExportBusy: vi.fn(),
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DXF export hook after a project rerender', () => {
  it('downloads current drilling, not holes from the prior same-ID project and catalog', async () => {
    const oldProject = { id: 'project-1', name: 'old' } as Project;
    const currentProject = { id: 'project-1', name: 'current' } as Project;
    const oldCatalog = { version: 'old' } as unknown as Catalog;
    const currentCatalog = { version: 'current' } as unknown as Catalog;
    const oldDrilling = [{ pieceCode: 'A1', holes: [{ diameterMm: 5 }] }];
    const currentDrilling = [{ pieceCode: 'A1', holes: [{ diameterMm: 8 }] }];
    const toast = vi.fn();
    const cutPlan = { projectId: currentProject.id } as CutPlan;
    const container = document.createElement('div');
    const root = createRoot(container);
    let handle: ReturnType<typeof useExportHandlers>['handleExportCutPlanDxf'] | undefined;
    mocks.resolveProjectDrilling.mockImplementation(({ project, catalog }) => ({
      resolutionIssues: [],
      patterns: [{ pieceCode: 'A1', issues: [] }],
      data: { patterns: project === currentProject && catalog === currentCatalog
        ? currentDrilling : oldDrilling },
      links: [],
    }));

    function Harness({ project, catalog }: { project: Project; catalog: Catalog }) {
      const deps = { projects: [project], selectedProject: project, catalog, toast } as unknown as ExportHandlersDeps;
      handle = useExportHandlers(deps).handleExportCutPlanDxf;
      return null;
    }

    try {
      act(() => root.render(createElement(Harness, { project: oldProject, catalog: oldCatalog })));
      act(() => root.render(createElement(Harness, { project: currentProject, catalog: currentCatalog })));
      await act(async () => { await handle!(cutPlan, 'sheets'); });

      expect(mocks.resolveProjectDrilling).toHaveBeenCalledWith({ project: currentProject, catalog: currentCatalog });
      expect(mocks.downloadCutPlanDxf).toHaveBeenCalledTimes(1);
      expect(mocks.downloadCutPlanDxf).toHaveBeenCalledWith(
        cutPlan, 'sheets', undefined, undefined, { drilling: currentDrilling },
      );
      expect(mocks.downloadCutPlanDxf).not.toHaveBeenCalledWith(
        cutPlan, 'sheets', undefined, undefined, { drilling: oldDrilling },
      );
    } finally {
      act(() => root.unmount());
    }
  });
});
