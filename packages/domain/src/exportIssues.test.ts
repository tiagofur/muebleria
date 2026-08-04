import { describe, expect, it } from 'vitest';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
} from './__fixtures__/plantillaDemo';
import { collectExportIssues, collectModuleOptionRoles, domainErrorToExportIssue } from './exportIssues';
import { ValidationError } from './errors';
import type { Catalog, Component, Module, Project, Structure } from './types';
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

  it('F029: empty line inherits project-level choices for export validation', () => {
    const level = gabOnlyProject.items[0]!.optionChoices;
    const project: Project = {
      ...gabOnlyProject,
      projectLevelChoices: level,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: {},
        },
      ],
    };
    expect(collectExportIssues(project, plantillaCatalogWithModules)).toEqual(
      [],
    );
  });

  it('VAL-05: empty project items', () => {
    const project: Project = { ...gabOnlyProject, items: [] };
    const issues = collectExportIssues(project, plantillaCatalogWithModules);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/no hay piezas de tablero/i);
    expect(issues[0]?.field).toBe('boardParts');
  });

  it('VAL-05: module without board parts', () => {
    // A module that composes no structure and no components yields zero board
    // parts (components/hardware only). The export path must flag this as a
    // "no hay piezas de tablero" issue — the new equivalent of boardParts: [].
    const emptyModule: Module = {
      id: 'mod-empty',
      code: 'MOD-EMPTY',
      name: 'Empty',
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
    // Reproduces the old lengthMm:0 scenario at the composed-module level: a
    // component with valid static geometry but a lengthFormula that resolves to
    // 0 at the module's preset (W - 300 with W = 300). validateBoardPart then
    // flags the expanded part with field 'lengthMm/widthMm'.
    const badComponent: Component = {
      id: 'comp-bad-dim',
      code: 'COM-BAD',
      name: 'Bad',
      placement: 'interno',
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 100,
        widthMm: 100,
        thicknessMm: 18,
        lengthFormula: 'W - 300',
      },
      defaultEdges: [
        { side: 'L1', enabled: false },
        { side: 'L2', enabled: false },
        { side: 'W1', enabled: false },
        { side: 'W2', enabled: false },
      ],
      optionRoles: ['INTERIOR'],
      active: true,
    };
    const badStructure: Structure = {
      id: 'struct-bad-dim',
      code: 'EST-BAD',
      name: 'Bad Body',
      externalDims: { width: 300, height: 720, depth: 590 },
      components: [{ componentId: 'comp-bad-dim', quantity: 1 }],
      presets: [{ id: 'preset-bad', width: 300, height: 720, depth: 590 }],
      active: true,
    };
    const badModule: Module = {
      id: 'mod-bad-dims',
      code: 'MOD-BAD',
      name: 'Bad Dims',
      structureId: badStructure.id,
      externalDims: { width: 300, height: 720, depth: 590 },
      hardwareLines: [],
    };
    const catalog: Catalog = {
      ...plantillaCatalogWithModules,
      structures: [...(plantillaCatalogWithModules.structures ?? []), badStructure],
      components: [...(plantillaCatalogWithModules.components ?? []), badComponent],
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
    // Expanded part id is `${componentId}-copy-${i}` (see expandComponentInstances).
    expect(issues.some((i) => i.partId === 'comp-bad-dim-copy-0')).toBe(true);
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

describe('collectModuleOptionRoles (gap #5 — accurate delete warnings)', () => {
  // Regression: countModulesUsingGroup used to only check hardwareLines, so a
  // board/edge group used via a composed component (INTERIOR role on a lateral
  // component) was invisible. collectModuleOptionRoles resolves all three
  // sources: module components, structure components, and hardware lines.
  it('resolves option roles from composed components + structure + hardware', () => {
    const lateralComp: Component = {
      id: 'comp-lateral',
      code: 'LAT',
      name: 'Lateral',
      optionRoles: ['INTERIOR'],
      geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18 },
      active: true,
    };
    const doorComp: Component = {
      id: 'comp-door',
      code: 'PTA',
      name: 'Puerta',
      optionRoles: ['FRENTE'],
      geometry: { kind: 'rectangular_board', lengthMm: 600, widthMm: 400, thicknessMm: 18 },
      active: true,
    };
    const structure: Structure = {
      id: 'struct-base',
      code: 'BASE',
      name: 'Cuerpo base',
      components: [{ componentId: 'comp-lateral', quantity: 2 }],
      presets: [],
    };
    const moduleWithStructureAndHardware: Module = {
      id: 'mod-1',
      code: 'MOD-1',
      name: 'Test module',
      structureId: 'struct-base',
      components: [{ componentId: 'comp-door', quantity: 1 }],
      hardwareLines: [{ optionRole: 'BISAGRA', quantity: 4 }],
    };
    const catalog: Pick<Catalog, 'components' | 'structures'> = {
      components: [lateralComp, doorComp],
      structures: [structure],
    };

    const roles = collectModuleOptionRoles(moduleWithStructureAndHardware, catalog);

    // INTERIOR comes from the structure's lateral component.
    expect(roles.has('INTERIOR')).toBe(true);
    // FRENTE comes from the module's own door component.
    expect(roles.has('FRENTE')).toBe(true);
    // BISAGRA comes from the hardware line.
    expect(roles.has('BISAGRA')).toBe(true);
    // No phantom roles.
    expect(roles.size).toBe(3);
  });

  it('returns only hardware roles when module has no components or structure', () => {
    const module: Module = {
      id: 'mod-2',
      code: 'MOD-2',
      name: 'Hardware only',
      hardwareLines: [{ optionRole: 'CORREDERA', quantity: 2 }],
    };
    const roles = collectModuleOptionRoles(module, { components: [], structures: [] });
    expect(roles.has('CORREDERA')).toBe(true);
    expect(roles.size).toBe(1);
  });
});
