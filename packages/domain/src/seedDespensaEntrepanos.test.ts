import { describe, expect, it } from 'vitest';
import { evaluateFurnitureParameters } from './furnitureParameters';
import { applyEvaluatedComponentBindings } from './engine/componentBindings';
import { resolveBom } from './engine/bom';
import { IDS, plantillaCatalogWithModules, seedModDespensa } from './__fixtures__/plantillaDemo';

// #1389: the demo seed must offer «Entrepaños» on its despensa exactly like
// the real catalog (COM-ENT-REG v25 + MOD-DES v194 binding). Same resolution
// chain the server uses: evaluate → apply bindings → resolveBom.
const SHELF_COMPONENT_ID = 'comp-despensa-entrepano';
const SHELF_DESCRIPTION = 'Entrepaño Despensa';
const CHOICES = { INTERIOR: IDS.matArauco, BISAGRA: IDS.hwBisagra };
const PH = seedModDespensa.externalDims?.height ?? 0;
const PW = seedModDespensa.externalDims?.width ?? 0;
const PD = seedModDespensa.externalDims?.depth ?? 0;
// INTERIOR resolves ARAUCO BLANCO (15 mm): T for the formulas, H in spatial ones.
const T = 15;

function resolveDespensa(values: Record<string, number>) {
  const definitions = seedModDespensa.parameterDefinitions ?? [];
  const evaluation = evaluateFurnitureParameters(definitions, values);
  expect(evaluation.issues).toEqual([]);
  const prepared = applyEvaluatedComponentBindings(seedModDespensa, definitions, evaluation.normalized);
  const bom = resolveBom(prepared, CHOICES, plantillaCatalogWithModules, 'des-preset-2100');
  const shelves = bom.boardParts.filter((part) => part.description === SHELF_DESCRIPTION);
  const instance = (prepared.components ?? []).find((c) => c.componentId === SHELF_COMPONENT_ID);
  return { evaluation, prepared, bom, shelves, instance };
}

describe('demo seed despensa — entrepaños configurables (#1389)', () => {
  it('declares the same parameter + binding as the real catalog', () => {
    expect(seedModDespensa.externalDims).toEqual({ width: 600, height: 2100, depth: 600 });
    const [definition, ...rest] = seedModDespensa.parameterDefinitions ?? [];
    expect(rest).toEqual([]);
    expect(definition).toMatchObject({
      name: 'entrepanos',
      type: 'number',
      defaultValue: 4,
      min: 0,
      max: 8,
      integer: true,
      binding: { version: 1, kind: 'componentQuantity', componentId: SHELF_COMPONENT_ID },
    });
    expect(plantillaCatalogWithModules.components?.some((c) => c.id === SHELF_COMPONENT_ID)).toBe(true);
    expect(seedModDespensa.components).toEqual([{ componentId: SHELF_COMPONENT_ID, quantity: 4 }]);
  });

  it('defaults to 4 shelves when no value is given', () => {
    const { evaluation, shelves } = resolveDespensa({});
    expect(evaluation.normalized.entrepanos).toBe(4);
    expect(shelves).toHaveLength(4);
  });

  it.each([0, 4, 8])('resolves the demo despensa with %i shelves distributed by height', (count) => {
    const { instance, shelves, bom } = resolveDespensa({ entrepanos: count });
    expect(instance?.quantity ?? 0).toBe(count);
    expect(shelves).toHaveLength(count);
    // The body still resolves regardless of the shelf count.
    expect(bom.boardParts.length).toBeGreaterThan(count);

    const zs = shelves.map((part) => part.z ?? Number.NaN).sort((a, b) => a - b);
    // evaluatePartFormula rounds every spatial coordinate to whole mm.
    const expected = Array.from({ length: count }, (_, i) => Math.round((PH / (count + 1)) * (i + 1) - T / 2));
    expect(zs).toEqual(expected);
    for (const shelf of shelves) {
      // PW - 2*T / PD - 5 - T - 35 mirror COM-ENT-REG; H is the part thickness.
      expect(shelf.lengthMm).toBe(PW - 2 * T);
      expect(shelf.widthMm).toBe(PD - 5 - T - 35);
      expect(shelf.x).toBe(T);
      expect(shelf.y).toBe(T + 5);
      expect(shelf.rotateY).toBe(90);
      expect(shelf.quantity).toBe(1);
    }
    expect(new Set(shelves.map((part) => part.id)).size).toBe(count);
  });

  it('rejects values outside the declared range instead of clamping', () => {
    const definitions = seedModDespensa.parameterDefinitions ?? [];
    const over = evaluateFurnitureParameters(definitions, { entrepanos: 9 });
    expect(over.issues.length).toBeGreaterThan(0);
    const under = evaluateFurnitureParameters(definitions, { entrepanos: -1 });
    expect(under.issues.length).toBeGreaterThan(0);
  });
});
