import { describe, expect, it } from 'vitest';

import { resolveBom } from './engine/bom';
import {
  expandHingeCountRulePositions,
  resolveAgregadoInstance,
} from './agregados';
import type {
  Agregado,
  HardwarePlacement,
  Catalog,
  Component,
  EdgeAssignment,
  Module,
  OptionChoices,
} from './types';
import type { HingeCountRuleContext } from './agregados';

// #1579 PR2 — la regla de cantidad en la receta de la puerta-agregado: el
// placement con countRule es un PATRÓN. El motor lo expande a N posiciones
// con las medidas reales de la bahía y compra por la línea de banda del
// agregado (exclusiva); perforado = comprado; sin patrón, byte-idéntico.

const NO_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
];

const STANDARD_TABLE = {
  bands: [
    { upToHeightMm: 900, hinges: 2 },
    { upToHeightMm: 1600, hinges: 3 },
    { upToHeightMm: 2000, hinges: 4 },
    { upToHeightMm: 2400, hinges: 5 },
  ],
  widthSurgeOverMm: 650,
};

const REINFORCED_TABLE = {
  bands: [
    { upToHeightMm: 900, hinges: 2 },
    { upToHeightMm: 1200, hinges: 3 },
    { upToHeightMm: 2000, hinges: 5 },
    { upToHeightMm: 2400, hinges: 5 },
  ],
  widthSurgeOverMm: 600,
};

describe('expandHingeCountRulePositions', () => {
  it('extremos en los offsets e intermedios repartidos uniformes', () => {
    expect(expandHingeCountRulePositions({ endOffsetBottomMm: 90, endOffsetTopMm: 90 }, 717, 2)).toEqual([90, 627]);
    expect(expandHingeCountRulePositions({ endOffsetBottomMm: 90, endOffsetTopMm: 90 }, 717, 3)).toEqual([90, 358.5, 627]);
    expect(expandHingeCountRulePositions({ endOffsetBottomMm: 90, endOffsetTopMm: 90 }, 2100, 5)).toEqual([90, 570, 1050, 1530, 2010]);
  });

  it('una sola bisagra se centra; puerta sin alto o conteo 0 no expansiona', () => {
    expect(expandHingeCountRulePositions({ endOffsetBottomMm: 90, endOffsetTopMm: 90 }, 717, 1)).toEqual([358.5]);
    expect(expandHingeCountRulePositions({ endOffsetBottomMm: 90, endOffsetTopMm: 90 }, 0, 2)).toEqual([]);
    expect(expandHingeCountRulePositions({ endOffsetBottomMm: 90, endOffsetTopMm: 90 }, 717, 0)).toEqual([]);
  });
});

/** Receta puerta-agregado con patrón (forma AGR-PUE-*): 1 placement countRule + jaladera fija. */
function doorFixture(doorHeightMm: number, options?: {
  reinforcedHinge?: boolean;
  bulkHingeLine?: boolean;
}): { module: Module; catalog: Catalog; choices: OptionChoices; context: HingeCountRuleContext } {
  const door: Component = {
    id: 'comp-door',
    code: 'PUERTA',
    name: 'Puerta',
    placement: 'puerta',
    geometry: {
      kind: 'rectangular_board',
      lengthMm: doorHeightMm,
      widthMm: 600,
      thicknessMm: 18,
      lengthFormula: 'PH - 3',
      widthFormula: 'PW - 3',
    },
    defaultEdges: NO_EDGES,
    optionRoles: ['FRENTES'],
    active: true,
  };
  const agregado: Agregado = {
    id: 'agr-pue',
    code: 'AGR-PUE-DER',
    name: 'Puerta Derecha',
    active: true,
    externalDims: { width: 597, height: doorHeightMm - 3, depth: 18 },
    components: [
      {
        componentId: 'comp-door',
        quantity: 1,
        placementOverride: 'puerta',
        overrides: {
          hardwarePlacements: [
            {
              optionRole: 'BISAGRA',
              anchorFace: 'back',
              countRule: { kind: 'hingeDemand', endOffsetBottomMm: 90, endOffsetTopMm: 90 },
              relativePosition: { xMm: 20.5, yMm: 90, xFormula: 'PW-20.5' },
            },
            {
              optionRole: 'JALADERA',
              anchorFace: 'front',
              relativePosition: { xMm: 0, yMm: 50, xFormula: 'PW-30' },
            },
          ],
        },
      },
    ],
    hardwareLines: options?.bulkHingeLine
      ? [{ id: 'agr-bulk', quantity: 2, optionRole: 'BISAGRA' }]
      : [],
  };
  const module: Module = {
    id: 'mod-1',
    code: 'MOD-PUE',
    name: 'Con puerta patrón',
    structureId: 'st-1',
    externalDims: { width: 600, height: doorHeightMm, depth: 560 },
    agregados: [{ id: 'inst-door', agregadoId: 'agr-pue', quantity: 1 }],
    hardwareLines: [],
  };
  const hingeId = options?.reinforcedHinge ? 'hw-reinforced' : 'hw-standard';
  const catalog: Catalog = {
    materials: [
      {
        id: 'mat-1',
        code: 'MEL-18',
        name: 'Melamina 18',
        widthMm: 1830,
        lengthMm: 2440,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 100,
        wastePercent: 0,
        costPerM2: 100,
        active: true,
      },
    ],
    edges: [],
    hardware: [
      {
        id: 'hw-standard',
        code: 'BIS-STD',
        name: 'Bisagra estándar',
        unit: 'piece',
        costPerUnit: 40,
        active: true,
        hingeDemand: STANDARD_TABLE,
      },
      {
        id: 'hw-reinforced',
        code: 'BIS-REF',
        name: 'Bisagra reforzada',
        unit: 'piece',
        costPerUnit: 45,
        active: true,
        hingeDemand: REINFORCED_TABLE,
      },
    ],
    optionGroups: [
      { id: 'og-frentes', code: 'FRENTES', name: 'Frentes', kind: 'board', required: true, optionIds: ['mat-1'] },
      { id: 'og-bisagra', code: 'BISAGRA', name: 'Bisagra', kind: 'hardware', required: true, optionIds: ['hw-standard', 'hw-reinforced'] },
    ],
    components: [door],
    structures: [
      {
        id: 'st-1',
        code: 'EST',
        name: 'Cuerpo',
        components: [],
        agregados: [],
        active: true,
      },
    ],
    agregados: [agregado],
    modules: [module],
  };
  const choices: OptionChoices = { FRENTES: 'mat-1', BISAGRA: hingeId };
  const context: HingeCountRuleContext = {
    doorDims: { heightMm: doorHeightMm - 3, widthMm: 597 },
    effectiveChoices: choices,
    catalogHardware: catalog.hardware,
    policySource: catalog.constructionPolicy,
  };
  return { module, catalog, choices, context };
}

const hingeLines = (lines: readonly { readonly id: string; readonly quantity: number; readonly notice?: string }[]) =>
  lines
    .filter((l) => l.id.includes('hw-'))
    .map((l) => `${l.id}×${l.quantity}${l.notice ? ' ⚠' : ''}`)
    .sort();

describe('resolveAgregadoInstance — patrón countRule (#1579 PR2)', () => {
  it('la demanda va en la línea de banda del agregado y las posiciones se expanden con las medidas reales', () => {
    const { catalog, choices, context } = doorFixture(2100);
    const res = resolveAgregadoInstance(
      { id: 'inst-door', agregadoId: 'agr-pue', quantity: 1 },
      catalog.agregados!,
      0,
      catalog.constructionPolicy?.doorHingeDemand,
      undefined,
      context,
    );

    // Puerta 2097 mm (PH-3) con la tabla estándar → banda ≤2400 → 5, sin
    // aviso (2097 no desborda la última banda).
    expect(hingeLines(res.hardwareLines)).toEqual(['hingeband-agr-inst-door-u0-hw-standard×5']);

    // Jaladera fija intacta (posición + sin duplicado).
    expect(hingeLines(res.hardwareLines)).toHaveLength(1);
    const doorComp = res.components[0]!;
    const placements = doorComp.overrides?.hardwarePlacements ?? [];
    const hinges = placements.filter((p) => p.optionRole === 'BISAGRA');
    expect(hinges).toHaveLength(5);
    expect(hinges[0]!.relativePosition.yMm).toBe(90);
    expect(hinges[4]!.relativePosition.yMm).toBe(2097 - 90);
    expect(hinges[2]!.relativePosition.yFormula).toBeUndefined();
    // El borde de bisagra se conserva.
    expect(hinges.every((p) => p.relativePosition.xFormula === 'PW-20.5')).toBe(true);
    // La jaladera fija pasa intacta.
    expect(placements.filter((p) => p.optionRole === 'JALADERA')).toHaveLength(1);
  });

  it('dos bisagras con tablas distintas en el mismo grupo: la MISMA puerta compra distinto', () => {
    const standard = doorFixture(1500);
    const reinforced = doorFixture(1500, { reinforcedHinge: true });

    const s = resolveAgregadoInstance(
      { id: 'i', agregadoId: 'agr-pue', quantity: 1 },
      standard.catalog.agregados!,
      0,
      undefined,
      undefined,
      standard.context,
    );
    const r = resolveAgregadoInstance(
      { id: 'i', agregadoId: 'agr-pue', quantity: 1 },
      reinforced.catalog.agregados!,
      0,
      undefined,
      undefined,
      reinforced.context,
    );

    // 1497 mm: estándar banda ≤1600 → 3; reforzada banda ≤2000 → 5.
    expect(hingeLines(s.hardwareLines)).toEqual(['hingeband-agr-i-u0-hw-standard×3']);
    expect(hingeLines(r.hardwareLines)).toEqual(['hingeband-agr-i-u0-hw-reinforced×5']);
  });

  it('la elección de la instancia (override) manda sobre la del grupo', () => {
    const { catalog, choices, context } = doorFixture(1500);
    const res = resolveAgregadoInstance(
      { id: 'i', agregadoId: 'agr-pue', quantity: 1, optionOverrides: { BISAGRA: 'hw-reinforced' } },
      catalog.agregados!,
      0,
      undefined,
      undefined,
      { ...context, effectiveChoices: choices },
    );
    expect(hingeLines(res.hardwareLines)).toEqual(['hingeband-agr-i-u0-hw-reinforced×5']);
  });

  it('posiciones fijas del mismo herraje ganan: el patrón no duplica ni demanda', () => {
    const { catalog, choices, context } = doorFixture(720);
    // Añadir 2 posiciones fijas de BISAGRA a la receta (por rol, resueltas
    // con la elección del grupo — la forma de autoría común).
    const agr = catalog.agregados![0]!;
    const compsF = agr.components! as Array<NonNullable<typeof agr.components>[number]>;
    (compsF[0]!.overrides!.hardwarePlacements as unknown as HardwarePlacement[]).unshift(
      { optionRole: 'BISAGRA', anchorFace: 'back', relativePosition: { xMm: 20.5, yMm: 90 } },
      { optionRole: 'BISAGRA', anchorFace: 'back', relativePosition: { xMm: 20.5, yMm: 100 } },
    );
    const res = resolveAgregadoInstance(
      { id: 'i', agregadoId: 'agr-pue', quantity: 1 },
      catalog.agregados!,
      0,
      undefined,
      undefined,
      { ...context, effectiveChoices: choices },
    );
    // Las fijas ganan: POSITIONED ×2, sin línea de banda ni patrón expandido.
    expect(hingeLines(res.hardwareLines)).toEqual(['placement-agr-i-u0-hw-standard×2']);
    const hinges = res.components[0]!.overrides?.hardwarePlacements?.filter((p) => p.optionRole === 'BISAGRA') ?? [];
    expect(hinges).toHaveLength(2);
  });

  it('sin contexto (caller legacy) el comportamiento es el de antes: la demanda del agregado no cambia', () => {
    const { catalog } = doorFixture(720);
    const res = resolveAgregadoInstance(
      { id: 'i', agregadoId: 'agr-pue', quantity: 1 },
      catalog.agregados!,
      0,
    );
    // Sin contexto el patrón no se expande ni demanda (la demanda de la
    // puerta la trae el colector de módulo en un resolve real — ver los pins
    // de caracterización). El placement por rol sin override de instancia
    // nunca contó posición en el agregado: ninguna línea nueva.
    expect(hingeLines(res.hardwareLines)).toEqual([]);
    expect(res.components[0]!.overrides?.hardwarePlacements?.filter((p) => p.optionRole === 'BISAGRA')).toHaveLength(1);
  });
});

describe('resolveBom — puerta-agregado con countRule (extremo a extremo)', () => {
  it('una sola línea de banda por herraje: el colector de módulo no la duplica', () => {
    const { module, catalog, choices, context } = doorFixture(2100);
    // El context del test usa la puerta PH-3; para el resolve end-to-end el
    // módulo provee las medidas (el motor evalúa las fórmulas).
    void context;
    const bom = resolveBom(module, choices, catalog);
    const lines = hingeLines(bom.hardwareLines);
    expect(lines).toEqual(['hingeband-agr-inst-door-u0-hw-standard×5']);
    // Sin la línea hingeband-hw-standard del colector de módulo (excluida) y
    // sin placement-agr-… (el patrón no cuenta posición).
    expect(lines.filter((l) => l.startsWith('hingeband-hw'))).toEqual([]);
    expect(lines.filter((l) => l.startsWith('placement-agr'))).toEqual([]);
  });

  it('sin countRule en la receta el resolve es el de siempre (pins de caracterización)', () => {
    const { module, catalog, choices } = doorFixture(2100);
    // Quitar el patrón: la receta vuelve a 2 posiciones fijas.
    const agr = catalog.agregados![0]!;
    const comps = agr.components! as Array<NonNullable<typeof agr.components>[number]>;
    const placements = comps[0]!.overrides!.hardwarePlacements as HardwarePlacement[];
    placements.splice(0, 1);
    placements.unshift(
      { optionRole: 'BISAGRA', anchorFace: 'back', relativePosition: { xMm: 20.5, yMm: 90, xFormula: 'PW-20.5' } },
      { optionRole: 'BISAGRA', anchorFace: 'back', relativePosition: { xMm: 20.5, yMm: 50, yFormula: 'PH-90', xFormula: 'PW-20.5' } },
    );
    const bom = resolveBom(module, choices, catalog);
    const lines = hingeLines(bom.hardwareLines);
    // La banda de módulo ve la puerta (colector por placement 'puerta') → ×5.
    expect(lines).toEqual(['hingeband-hw-standard×5']);
  });
});
