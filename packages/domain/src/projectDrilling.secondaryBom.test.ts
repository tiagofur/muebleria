import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, plantillaCatalogWithModules, plantillaProject } from './__fixtures__/plantillaDemo';
import { resolveProjectDrilling } from './projectDrilling';

const bomCalls = vi.hoisted(() => ({ count: 0, failAt: 0, primaryReturned: false }));
vi.mock('./engine/bom', async (importOriginal) => {
  const original = await importOriginal<typeof import('./engine/bom')>();
  return {
    ...original,
    resolveBom: (...args: Parameters<typeof original.resolveBom>) => {
      bomCalls.count++;
      if (bomCalls.count === bomCalls.failAt) throw new Error('Injected secondary BOM failure');
      const result = original.resolveBom(...args);
      if (bomCalls.count === 1) bomCalls.primaryReturned = result.boardParts.length > 0;
      return result;
    },
  };
});

const project = {
  ...plantillaProject,
  items: plantillaProject.items.filter((item) => item.id === IDS.itemGab),
};

describe('project drilling secondary BOM resolution', () => {
  beforeEach(() => {
    bomCalls.count = 0;
    bomCalls.failAt = 0;
    bomCalls.primaryReturned = false;
  });

  it('retains a blocking internal issue when an injected secondary BOM call fails after primary links succeed', () => {
    bomCalls.failAt = 2;
    const projectBefore = JSON.stringify(project);
    const catalogBefore = JSON.stringify(plantillaCatalogWithModules);
    const result = resolveProjectDrilling({ project, catalog: plantillaCatalogWithModules });

    expect(bomCalls.primaryReturned).toBe(true);
    expect(bomCalls.count).toBe(2);
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.patterns).toHaveLength(result.links.length);
    expect(result.resolutionIssues).toEqual([
      expect.objectContaining({
        code: 'DRILLING_BOM_RESOLUTION_FAILED',
        projectId: project.id,
        projectItemId: IDS.itemGab,
        moduleId: IDS.modGab,
        stage: 'secondary-bom',
        blocking: true,
      }),
    ]);
    expect(result.resolutionIssues[0]!.message).not.toContain('Injected');
    expect(JSON.stringify(project)).toBe(projectBefore);
    expect(JSON.stringify(plantillaCatalogWithModules)).toBe(catalogBefore);
    expect(Object.keys(result.data).sort()).toEqual([
      'generatedAt', 'patterns', 'projectId', 'projectName', 'schema', 'totalHolesCount', 'totalPiecesCount',
    ]);
  });

  it('preserves a partial multi-item result, then starts the next invocation cleanly', () => {
    bomCalls.failAt = 4; // two primary BOM calls succeed; the second secondary call fails.
    const partial = resolveProjectDrilling({ project: plantillaProject, catalog: plantillaCatalogWithModules });

    expect(bomCalls.count).toBe(4);
    expect(partial.links.length).toBeGreaterThan(0);
    expect(partial.patterns).toHaveLength(partial.links.length);
    expect(partial.resolutionIssues).toEqual([
      expect.objectContaining({ projectItemId: IDS.itemCaj, blocking: true }),
    ]);

    bomCalls.count = 0;
    bomCalls.failAt = 0;
    const complete = resolveProjectDrilling({ project: plantillaProject, catalog: plantillaCatalogWithModules });
    expect(complete.resolutionIssues).toEqual([]);
    expect(complete.patterns).toHaveLength(complete.links.length);
    expect(complete.data.patterns).toHaveLength(complete.patterns.length);
    expect(Object.keys(complete.data).sort()).toEqual(Object.keys(partial.data).sort());
  });
});
