import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveBom } from './engine/bom';
import type { Catalog, Component, Module, OptionChoices, ResolvedBoardPart } from './types';

const contractPath = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'contracts', 'materialThicknessParity.contract.json');

interface RoleExpectation { readonly materialId: string; readonly thicknessMm: number; readonly expectedCount: number }
interface Scenario {
  readonly choices?: OptionChoices;
  readonly beforeChoices?: OptionChoices;
  readonly afterChoices?: OptionChoices;
  readonly affectedRole?: string;
  readonly expectedAffectedCount?: number;
  readonly expectedUnaffectedRoles?: readonly string[];
  readonly expectedRoles?: Readonly<Record<string, RoleExpectation>>;
  readonly expectedFormulaResults?: Readonly<Record<string, number>>;
  readonly expectedRejectedRole?: string;
}
interface ParityContract {
  readonly nominalThicknessMm: Readonly<Record<string, number>>;
  readonly scenarios: Readonly<Record<string, Scenario>>;
}

const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as ParityContract;
const noEdges = [
  { side: 'L1' as const, enabled: false }, { side: 'L2' as const, enabled: false },
  { side: 'W1' as const, enabled: false }, { side: 'W2' as const, enabled: false },
];

function board(
  id: string,
  name: string,
  placement: Component['placement'],
  role: string,
  lengthFormula: string,
  widthFormula: string,
): Component {
  return {
    id, code: id.toUpperCase(), name, placement, optionRoles: [role], active: true,
    geometry: {
      kind: 'rectangular_board', lengthMm: 700, widthMm: 500,
      thicknessMm: contract.nominalThicknessMm[name]!, lengthFormula, widthFormula,
    },
    defaultEdges: noEdges,
  };
}

function referenceCabinet(): { module: Module; catalog: Catalog } {
  const components = [
    board('side-left', 'Lateral', 'lateral_izquierdo', 'BODY', 'PH - 2*T', 'PD'),
    board('side-right', 'Lateral Derecho', 'lateral_derecho', 'BODY', 'PH - 2*T', 'PD'),
    board('base', 'Piso', 'base', 'BODY', 'PW - 2*T', 'PD - T'),
    board('top', 'Techo', 'superior', 'BODY', 'PW - 2*T', 'PD - T'),
    board('shelf', 'Entrepaño', 'interno', 'BODY', 'PW - 2*T', 'PD - T'),
    board('door', 'Puerta', 'puerta', 'FRONT', 'PH - 4', 'PW - 4'),
    board('back', 'Fondo', 'trasera', 'BACK', 'PH - 2*T', 'PW - 2*T'),
    board('drawer-front', 'Frente Cajón', 'frente_cajon', 'FRONT', 'PH - 2', 'PW - 2*T'),
  ];
  const module: Module = {
    id: 'parity-cabinet', code: 'PARITY-600', name: 'Parity Cabinet',
    externalDims: { width: 600, height: 720, depth: 560 }, structureId: 'parity-structure',
    components: [{ componentId: 'shelf', quantity: 1 }, { componentId: 'door', quantity: 1 }],
    hardwareLines: [],
  };
  const catalog: Catalog = {
    components,
    structures: [{
      id: 'parity-structure', code: 'PARITY-STRUCTURE', name: 'Parity Structure', active: true,
      externalDims: { width: 600, height: 720, depth: 560 },
      components: ['side-left', 'side-right', 'base', 'top', 'back'].map((componentId) => ({ componentId, quantity: 1 })),
      agregados: [{ agregadoId: 'drawer', quantity: 3 }],
    }],
    agregados: [{ id: 'drawer', code: 'DRAWER', name: 'Drawer', active: true, components: [{ componentId: 'drawer-front', quantity: 1 }], hardwareLines: [] }],
    materials: [
      { id: 'mat-white16', code: 'WHITE16', name: 'White 16', thicknessMm: 16, widthMm: 2100, lengthMm: 2800, boardPrice: 1, wastePercent: 0, costPerM2: 1, grainDefault: false, active: true },
      { id: 'mat-oak18', code: 'FRONT18', name: 'Front 18', thicknessMm: 18, widthMm: 2100, lengthMm: 2800, boardPrice: 1, wastePercent: 0, costPerM2: 1, grainDefault: true, active: true },
      { id: 'mat-back6', code: 'BACK6', name: 'Back 6', thicknessMm: 6, widthMm: 2100, lengthMm: 2800, boardPrice: 1, wastePercent: 0, costPerM2: 1, grainDefault: false, active: true },
      { id: 'mat-ma-inactive', code: 'INACTIVE', name: 'Inactive', thicknessMm: 18, widthMm: 2100, lengthMm: 2800, boardPrice: 1, wastePercent: 0, costPerM2: 1, grainDefault: false, active: false },
    ],
    optionGroups: ['BODY', 'FRONT', 'BACK'].map((code) => ({ id: `role-${code}`, code, name: code, kind: 'board' as const, required: true, optionIds: ['mat-white16', 'mat-oak18', 'mat-back6'] })),
    edges: [], hardware: [], modules: [],
  };
  return { module, catalog };
}

function byRole(parts: readonly ResolvedBoardPart[], role: string): readonly ResolvedBoardPart[] {
  return parts.filter((part) => part.optionRole === role);
}

describe('#405 shared material thickness parity contract', () => {
  it('scenario A uses selected 16 mm for thickness, T formulas and PW-T placement', () => {
    const scenario = contract.scenarios.all16!;
    const { module, catalog } = referenceCabinet();
    const parts = resolveBom(module, scenario.choices!, catalog).boardParts;
    for (const [role, expected] of Object.entries(scenario.expectedRoles!)) {
      expect(byRole(parts, role).length, role).toBe(expected.expectedCount);
      for (const part of byRole(parts, role)) {
        expect({ materialId: part.materialId, thicknessMm: part.thicknessMm }, part.description).toEqual({
          materialId: expected.materialId,
          thicknessMm: expected.thicknessMm,
        });
      }
    }
    const named = (name: string) => parts.find((part) => part.description === name)!;
    expect(named('Lateral').lengthMm).toBe(scenario.expectedFormulaResults!['Lateral.lengthMm']);
    expect(named('Piso').lengthMm).toBe(scenario.expectedFormulaResults!['Piso.lengthMm']);
    expect(named('Piso').widthMm).toBe(scenario.expectedFormulaResults!['Piso.widthMm']);
    expect(named('Lateral Derecho').x).toBe(scenario.expectedFormulaResults!['Lateral Derecho.xMm']);
    expect(byRole(parts, 'FRONT').filter((part) => part.description === 'Frente Cajón')).toHaveLength(3);
    expect(parts.filter((part) => part.description === 'Frente Cajón').every((part) => part.widthMm === 568)).toBe(true);
  });

  it('scenario B isolates BODY 16, FRONT 18 and BACK 6 in one BOM', () => {
    const scenario = contract.scenarios.mixed!;
    const { module, catalog } = referenceCabinet();
    const parts = resolveBom(module, scenario.choices!, catalog).boardParts;
    for (const [role, expected] of Object.entries(scenario.expectedRoles!)) {
      const roleParts = byRole(parts, role);
      expect(roleParts).toHaveLength(expected.expectedCount);
      expect(roleParts.every((part) => part.materialId === expected.materialId && part.thicknessMm === expected.thicknessMm)).toBe(true);
    }
  });

  it('scenario C changes all four FRONT boards and no BODY/BACK boards', () => {
    const scenario = contract.scenarios.frontUpdate!;
    const { module, catalog } = referenceCabinet();
    const before = resolveBom(module, scenario.beforeChoices!, catalog).boardParts;
    const after = resolveBom(module, scenario.afterChoices!, catalog).boardParts;
    const changed = after.filter((part, index) => part.materialId !== before[index]!.materialId || part.thicknessMm !== before[index]!.thicknessMm);
    expect(changed).toHaveLength(scenario.expectedAffectedCount!);
    expect(changed.every((part) => part.optionRole === scenario.affectedRole)).toBe(true);
    for (const role of scenario.expectedUnaffectedRoles!) {
      expect(byRole(after, role)).toEqual(byRole(before, role));
    }
  });

  it('scenario D rejects an inactive explicit material', () => {
    const scenario = contract.scenarios.failure!;
    const { module, catalog } = referenceCabinet();
    expect(() => resolveBom(module, scenario.choices!, catalog)).toThrow(/Inactive material/i);
  });

  it('negative proof: nominal Component thickness cannot satisfy scenario A', () => {
    const scenario = contract.scenarios.all16!;
    const { module, catalog } = referenceCabinet();
    const parts = resolveBom(module, scenario.choices!, catalog).boardParts;
    const side = parts.find((part) => part.description === 'Lateral')!;
    const base = parts.find((part) => part.description === 'Piso')!;
    expect(contract.nominalThicknessMm.Lateral).toBe(15);
    expect(contract.nominalThicknessMm.Piso).toBe(18);
    expect(side.thicknessMm).toBe(16);
    expect(base.thicknessMm).toBe(16);
    expect([side.thicknessMm, base.thicknessMm]).not.toEqual([15, 18]);
  });
});
