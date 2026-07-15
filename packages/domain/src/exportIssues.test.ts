import { describe, expect, it } from 'vitest';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
} from './__fixtures__/plantillaDemo';
import { collectExportIssues, domainErrorToExportIssue } from './exportIssues';
import { ValidationError } from './errors';
import type { Catalog, Module, Project } from './types';
import { generateCutRows } from './engine';

const gabOnlyProject: Project = {
  id: 'proj-gab-only',
  name: 'Gab only',
  customerId: 'cust-test',
  currency: 'MXN',
  marginFactor: 1.35,
  laborFixedCost: 0,
  status: 'draft',
  items: [
    {
      id: 'item-gab',
      moduleId: IDS.modGab,
      quantity: 1,
      optionChoices: plantillaChoices,
    },
  ],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

describe('collectExportIssues', () => {
  it('returns no issues for valid plantilla project', () => {
    const issues = collectExportIssues(
      plantillaProject,
      plantillaCatalogWithModules,
    );
    expect(issues).toEqual([]);
    expect(
      generateCutRows(plantillaProject, plantillaCatalogWithModules).length,
    ).toBeGreaterThan(0);
  });

  it('returns no issues for gab-only project with complete choices', () => {
    expect(
      collectExportIssues(gabOnlyProject, plantillaCatalogWithModules),
    ).toEqual([]);
  });

  it('blocks when required options are missing', () => {
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: {},
        },
      ],
    };
    const issues = collectExportIssues(project, plantillaCatalogWithModules);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.field === 'optionChoices')).toBe(true);
    expect(issues.some((i) => i.optionGroupCode === 'INTERIOR')).toBe(true);
    expect(issues.some((i) => i.moduleCode === 'MOD-GAB-01')).toBe(true);
  });

  it('VAL-05: empty project items', () => {
    const project: Project = { ...gabOnlyProject, items: [] };
    const issues = collectExportIssues(project, plantillaCatalogWithModules);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/no hay piezas de tablero/i);
    expect(issues[0]?.field).toBe('boardParts');
  });

  it('VAL-05: module without board parts', () => {
    const emptyModule: Module = {
      id: 'mod-empty',
      code: 'MOD-EMPTY',
      name: 'Empty',
      boardParts: [],
      hardwareLines: [],
    };
    const catalog: Catalog = {
      ...plantillaCatalogWithModules,
      modules: [...plantillaCatalogWithModules.modules, emptyModule],
    };
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-empty',
          moduleId: emptyModule.id,
          quantity: 1,
          optionChoices: {},
        },
      ],
    };
    const issues = collectExportIssues(project, catalog);
    expect(issues.some((i) => i.field === 'boardParts')).toBe(true);
  });

  it('VAL-01: invalid board dimensions surface as issues', () => {
    const badModule: Module = {
      ...plantillaCatalogWithModules.modules.find((m) => m.id === IDS.modGab)!,
      id: 'mod-bad-dims',
      code: 'MOD-BAD',
      boardParts: [
        {
          id: 'p-bad',
          code: 'P01',
          description: 'Bad',
          quantity: 1,
          lengthMm: 0,
          widthMm: 100,
          grain: 0,
          edges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    };
    const catalog: Catalog = {
      ...plantillaCatalogWithModules,
      modules: [...plantillaCatalogWithModules.modules, badModule],
    };
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-bad',
          moduleId: badModule.id,
          quantity: 1,
          optionChoices: plantillaChoices,
        },
      ],
    };
    const issues = collectExportIssues(project, catalog);
    expect(issues.some((i) => i.field === 'lengthMm/widthMm')).toBe(true);
    expect(issues.some((i) => i.partId === 'p-bad')).toBe(true);
  });

  it('VAL-06: inactive material choice is blocked', () => {
    const catalog: Catalog = {
      ...plantillaCatalogWithModules,
      materials: plantillaCatalogWithModules.materials.map((m) =>
        m.id === IDS.matArauco ? { ...m, active: false } : m,
      ),
    };
    const issues = collectExportIssues(gabOnlyProject, catalog);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.field === 'active')).toBe(true);
  });

  it('reports missing module id', () => {
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-x',
          moduleId: 'does-not-exist',
          quantity: 1,
          optionChoices: plantillaChoices,
        },
      ],
    };
    const issues = collectExportIssues(project, plantillaCatalogWithModules);
    expect(issues.some((i) => i.field === 'moduleId')).toBe(true);
    expect(issues.some((i) => i.field === 'boardParts')).toBe(true);
  });
});

describe('domainErrorToExportIssue', () => {
  it('maps context fields', () => {
    const err = new ValidationError('bad dim', {
      moduleCode: 'MOD-X',
      partId: 'p1',
      partCode: 'P01',
      field: 'lengthMm',
    });
    expect(domainErrorToExportIssue(err)).toEqual({
      message: 'bad dim',
      field: 'lengthMm',
      moduleCode: 'MOD-X',
      partId: 'p1',
      partCode: 'P01',
      projectItemId: undefined,
      optionGroupCode: undefined,
    });
  });
});
