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


describe('#995 K2 frozen drilling layer', () => {
  beforeEach(vi.clearAllMocks);

  it('#995 K2: composes the DXF drilling layer from the frozen routing when the canonical release governs', async () => {
    const project = { id: 'project-1' } as Project;
    const toast = vi.fn();
    mocks.resolveProjectDrilling.mockReturnValue({
      patterns: [
        {
          pieceCode: 'A1', moduleCode: 'MOD', partName: 'Lateral',
          lengthMm: 720, widthMm: 560, materialName: 'MDF', issues: [], fallbackUsed: false,
          holes: [{ face: 'top', xMm: 100, yMm: 100, diameterMm: 5, depthMm: 12, type: 'through' }],
        },
      ],
      resolutionIssues: [],
      links: [
        { partId: 'part-1', labelRef: 'A1', partCode: 'L1', moduleCode: 'MOD', part: { description: 'Lateral' } },
      ],
      data: { patterns: [{ pieceCode: 'A1', holes: [] }] },
    });
    const frozenDrillingFetcher = vi.fn(async () => ({
      releaseId: 'rel-1',
      manufacturingFingerprint: 'fp-1',
      snapshot: {
        schemaVersion: 2,
        release: { id: 'rel-1', releaseNumber: 1, status: 'approved', manufacturingFingerprint: 'fp-1' },
        routing: {
          contract: 'granete.release-manufacturing-program.v1',
          industrialRulesRevision: 'rr-1',
          units: [
            {
              furnitureInstanceId: 'unit-1',
              furnitureDefinitionId: 'mod-1',
              machiningFingerprint: 'mf-1',
              parts: [
                {
                  partId: 'part-1',
                  cut: true,
                  cncRequired: true,
                  operations: [
                    {
                      operationId: 'op-1',
                      provenance: { sourceKind: 'relationship', relationshipId: 'rel-shelf', technicalProfileId: 'prof-1', technicalProfileRevision: 'rev-1' },
                      operation: 'drill',
                      holes: [
                        { face: 'side', xMm: 40, yMm: 100, diameterMm: 15, depthMm: 13, type: 'housing' },
                        { face: 'side', xMm: 40, yMm: 200, diameterMm: 8, depthMm: 17, type: 'dowel' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    }));
    const deps = {
      projects: [project], selectedProject: project, catalog: {} as Catalog, toast,
      frozenDrillingFetcher,
    } as unknown as ExportHandlersDeps;

    await useExportHandlers(deps).handleExportCutPlanDxf({ projectId: project.id } as CutPlan, 'sheets');

    expect(mocks.downloadCutPlanDxf).toHaveBeenCalledTimes(1);
    const call = mocks.downloadCutPlanDxf.mock.calls[0];
    if (!call) throw new Error('downloadCutPlanDxf was not called');
    const options = call[4] as {
      drilling: { pieceCode: string; holes: { diameterMm: number }[] }[];
    };
    expect(options.drilling[0]?.holes.map((hole) => hole.diameterMm)).toEqual([15, 8]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('#995 K2: a frozen transport failure blocks the DXF (no unverifiable holes)', async () => {
    const project = { id: 'project-1' } as Project;
    const toast = vi.fn();
    mocks.resolveProjectDrilling.mockReturnValue({
      patterns: [{ pieceCode: 'A1', issues: [], fallbackUsed: false, holes: [] }],
      resolutionIssues: [],
      links: [{ partId: 'part-1', labelRef: 'A1', partCode: 'L1', moduleCode: 'MOD', part: { description: 'L' } }],
      data: { patterns: [{ pieceCode: 'A1', holes: [] }] },
    });
    const deps = {
      projects: [project], selectedProject: project, catalog: {} as Catalog, toast,
      frozenDrillingFetcher: vi.fn(async () => {
        throw new Error('backend down');
      }),
    } as unknown as ExportHandlersDeps;

    await useExportHandlers(deps).handleExportCutPlanDxf({ projectId: project.id } as CutPlan, 'pieces');

    expect(mocks.downloadCutPlanDxf).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('#995 K2: without canonical authority the legacy drilling is unchanged', async () => {
    const project = { id: 'project-1' } as Project;
    const toast = vi.fn();
    const legacyHoles = [{ face: 'top', xMm: 100, yMm: 100, diameterMm: 5, depthMm: 12, type: 'through' }];
    mocks.resolveProjectDrilling.mockReturnValue({
      patterns: [
        {
          pieceCode: 'A1', moduleCode: 'MOD', partName: 'Lateral',
          lengthMm: 720, widthMm: 560, materialName: 'MDF', issues: [], fallbackUsed: false,
          holes: legacyHoles,
        },
      ],
      resolutionIssues: [],
      links: [],
      data: { patterns: [{ pieceCode: 'A1', holes: legacyHoles }] },
    });
    const deps = {
      projects: [project], selectedProject: project, catalog: {} as Catalog, toast,
      frozenDrillingFetcher: vi.fn(async () => null),
    } as unknown as ExportHandlersDeps;

    await useExportHandlers(deps).handleExportCutPlanDxf({ projectId: project.id } as CutPlan, 'sheets');

    expect(mocks.downloadCutPlanDxf).toHaveBeenCalledTimes(1);
    const call = mocks.downloadCutPlanDxf.mock.calls[0];
    if (!call) throw new Error('downloadCutPlanDxf was not called');
    const options = call[4] as {
      drilling: { holes: unknown[] }[];
    };
    expect(options.drilling[0]?.holes).toEqual(legacyHoles);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });
});
