import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/componentBindings.contract.json';
import base from '../../../contracts/plinthBaseParity.contract.json';
import { evaluateFurnitureParameters } from './furnitureParameters';
import { applyEvaluatedComponentBindings } from './engine/componentBindings';
import { resolveBom } from './engine/bom';
import type { FurnitureParameter } from './smartFurnitureDomain';
import type { Catalog } from './types';

const definitions = fixture.parameters as readonly FurnitureParameter[];

describe('evaluated component binding Go/TS parity', () => {
  const catalog = structuredClone(base.catalog) as unknown as Catalog;
  const component = catalog.components![0]!;
  const source = {
    ...catalog,
    components: [component, { ...component, id: 'comp-back', code: 'BACK' }],
    structures: catalog.structures!.map((structure) => ({ ...structure, components: [] })),
  };
  const module = {
    ...catalog.modules[0]!, baseMode: 'none' as const, hardwareLines: [],
    components: [{ componentId: component.id, quantity: 1 }, { componentId: 'comp-back', quantity: 1 }],
  };
  const original = JSON.stringify({ source, module, definitions });
  for (const scenario of fixture.cases) {
    it(scenario.name, () => {
      const values = structuredClone(scenario.values);
      const evaluation = evaluateFurnitureParameters(definitions, values);
      if ('issue' in scenario) {
        expect(evaluation.issues.map((issue) => issue.code)).toContain(scenario.issue);
        return;
      }
      expect(evaluation.issues).toEqual([]);
      const prepared = applyEvaluatedComponentBindings(module, definitions, evaluation.normalized);
      const bom = resolveBom(prepared, { INTERIOR: 'mat-body' }, source,
        undefined, undefined, undefined, { widthMm: 600, heightMm: 750, depthMm: 500 });
      expect(prepared.id).toBe(module.id);
      expect(bom.boardParts.map((part) => part.id)).toEqual(scenario.pieceIds!.map((id) => fixture.tsPiecePrefix + id));
      expect((prepared.components ?? []).map((part) => part.quantity)).toEqual(scenario.quantities);
      expect(bom.boardParts).toHaveLength(scenario.quantities!.reduce((sum, quantity) => sum + quantity, 0));
      expect(new Set(bom.boardParts.map((part) => part.id)).size).toBe(bom.boardParts.length);
      expect(bom.boardParts.every((part) => part.quantity === 1)).toBe(true);
      for (const part of bom.boardParts) {
        expect([part.lengthMm, part.widthMm, part.materialId]).toEqual([750, 500, 'mat-body']);
      }
      expect(JSON.stringify({ source, module, definitions })).toBe(original);
      expect(values).toEqual(scenario.values);
      expect(applyEvaluatedComponentBindings(module, definitions, evaluation.normalized)).toEqual(prepared);
    });
  }
});
