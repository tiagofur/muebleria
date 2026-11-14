import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBom } from './engine/bom';
import type { Catalog, Component, Module, Structure } from './types';

// #1493: paridad TS↔Go de las reglas de dimensión por variante sobre los
// componentes del agregado (BOM + preview — ambos consumen expandComponentInstances
// en engine/bom.ts). Autoridad única:
// contracts/fixtures/componentVariantRuleParity.contract.json. El espejo Go vive
// en backend-go/internal/domain/engine/component_variant_rule_parity_test.go.

interface VariantRuleFixture {
  agregado: { id: string; code: string; variantSetId: string };
  variants: { hardwareId: string; nominalDimensionMm: number }[];
  components: {
    id: string;
    code: string;
    name: string;
    lengthFormula: string;
    widthFormula: string;
    instanceOverrides?: {
      widthRule?: { source: 'selected_variant'; variantSetId: string; multiplier: number; offsetMm: number };
    };
  }[];
  module: { widthMm: number; heightMm: number; depthMm: number };
  bays: { id: string; heightFormula: string }[];
  expectedBoards: Record<string, Record<string, { lengthMm: number; widthMm: number }>>;
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/componentVariantRuleParity.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as VariantRuleFixture;

describe('#1493 — regla de dimensión por variante sobre componentes (paridad con Go)', () => {
  it('el respaldo se dimensiona por el nominal de la variante de cada bahía (la regla manda sobre la fórmula)', () => {
    const components: (Component & { id: string })[] = f.components.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      placement: 'interno',
      geometry: {
        kind: 'rectangular_board',
        lengthMm: 500,
        widthMm: 500,
        lengthFormula: c.lengthFormula,
        widthFormula: c.widthFormula,
      },
      thicknessMm: 15,
      optionRoles: ['LATERAL'],
      defaultEdges: [
        { side: 'L1' },
        { side: 'L2' },
        { side: 'W1' },
        { side: 'W2' },
      ],
      active: true,
    })) as unknown as (Component & { id: string })[];

    const module: Module = {
      id: 'mod-cajonera',
      code: 'CAJONERA',
      name: 'Cajonera',
      structureId: 'st-base',
      externalDims: { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
      agregados: f.bays.map((bay) => ({
        id: bay.id,
        agregadoId: f.agregado.id,
        quantity: 1,
        dimensions: { heightFormula: bay.heightFormula },
      })),
      hardwareLines: [],
    } as unknown as Module;

    const structure: Structure = {
      id: 'st-base',
      code: 'ST-BASE',
      name: 'Cuerpo',
      components: [],
      agregados: [],
      active: true,
    } as unknown as Structure;

    const catalog = {
      structures: [structure],
      agregados: [
        {
          id: f.agregado.id,
          code: f.agregado.code,
          name: f.agregado.code,
          active: true,
          variantSets: [
            {
              id: f.agregado.variantSetId,
              dimension: 'height',
              variants: f.variants.map((v) => ({
                hardwareId: v.hardwareId,
                nominalDimensionMm: v.nominalDimensionMm,
              })),
            },
          ],
          components: f.components.map((c) => ({
            componentId: c.id,
            quantity: 1,
            ...(c.instanceOverrides ? { overrides: c.instanceOverrides } : {}),
          })),
          hardwareLines: [],
        },
      ],
      components,
      materials: [
        {
          id: 'mat-caja',
          code: 'MAT-CAJA',
          name: 'Caja cajón',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 15,
          grainDefault: true,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      optionGroups: [
        {
          id: 'og-lateral',
          code: 'LATERAL',
          name: 'Lateral',
          kind: 'board',
          required: true,
          optionIds: ['mat-caja'],
        },
      ],
    } as unknown as Catalog;

    const bom = resolveBom(module, { LATERAL: 'mat-caja' }, catalog);

    // Cada bahía es una INSTANCIA propia del agregado (quantity 1) — el id de
    // pieza lleva `instance-<bayID>-`.
    for (const bay of f.bays) {
      for (const [compId, want] of Object.entries(f.expectedBoards[bay.id] ?? {})) {
        const part = bom.boardParts.find(
          (p) => p.id.includes(`instance-${bay.id}-`) && p.id.includes(`${compId}-copy-`),
        );
        expect(part, `${bay.id}/${compId} presente en el BOM`).toBeDefined();
        expect(part!.lengthMm, `${bay.id}/${compId} largo`).toBe(want.lengthMm);
        expect(part!.widthMm, `${bay.id}/${compId} ancho (regla por variante)`).toBe(want.widthMm);
      }
    }
  });
});
