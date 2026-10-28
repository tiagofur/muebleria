import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/agregadoBindings.contract.json';
import { evaluateFurnitureParameters } from './furnitureParameters';
import { applyEvaluatedAgregadoBindings } from './engine/componentBindings';
import { resolveBom } from './engine/bom';
import type { FurnitureParameter } from './smartFurnitureDomain';
import type { Catalog } from './types';

const definitions = fixture.parameters as readonly FurnitureParameter[];

// Mirrors Go TestAgregadoBindingsSharedContract: one authored cajon-std
// instance; piece ids carry the agr-<id>-u<idx>- prefix without the mod- one.
describe('evaluated agregado binding Go/TS parity (#1386)', () => {
  const source = {
    materials: [{
      id: 'mat-1', code: 'MAT', name: 'Melamina', thicknessMm: 18,
      widthMm: 1830, lengthMm: 2440, active: true, defaultEdges: [],
    }],
    edges: [],
    hardware: [],
    optionGroups: [{
      id: 'og-frente', code: 'FRENTE', name: 'Frente', kind: 'board' as const,
      required: true, optionIds: ['mat-1'],
    }],
    components: [{
      id: 'comp-frente', code: 'FCAJ', name: 'Frente Cajon', placement: 'frente_cajon',
      geometry: { kind: 'rectangular_board', lengthMm: 200, widthMm: 500, thicknessMm: 18 },
      optionRoles: ['FRENTE'], active: true,
      defaultEdges: [
        { side: 'L1', enabled: false }, { side: 'L2', enabled: false },
        { side: 'W1', enabled: false }, { side: 'W2', enabled: false },
      ],
    }],
    structures: [{ id: 'st-1', code: 'EST', name: 'Cuerpo', components: [], agregados: [] }],
    agregados: [{
      id: 'cajon-std', code: 'CAJ', name: 'Cajón',
      components: [{ componentId: 'comp-frente', quantity: 1 }],
    }],
  } as unknown as Catalog;
  const module = {
    id: 'mod-1', code: 'MOD', name: 'Cajonera', structureId: 'st-1', hardwareLines: [],
    agregados: [{ agregadoId: 'cajon-std', quantity: 1 }],
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
      const prepared = applyEvaluatedAgregadoBindings(module, definitions, evaluation.normalized);
      const bom = resolveBom(prepared, { FRENTE: 'mat-1' }, source,
        undefined, undefined, undefined, { widthMm: 600, heightMm: 720, depthMm: 500 });
      expect(prepared.id).toBe(module.id);
      expect(bom.boardParts.map((part) => part.id)).toEqual(scenario.pieceIds!.map((id) => fixture.piecePrefix + id));
      expect((prepared.agregados ?? []).map((instance) => instance.quantity)).toEqual(scenario.quantities);
      expect(bom.boardParts).toHaveLength(scenario.quantities!.reduce((sum, quantity) => sum + quantity, 0));
      const after = JSON.stringify({ source, module, definitions });
      expect(after).toBe(original);
    });
  }
});

// Mirrors Go TestAgregadoCopyPoseFormula: pose formulas using i/N position
// every copy BY FORMULA at full sub-space size; the layout_direction split
// stays off. Both engines add the frente placement's own +2 z offset on top
// of every unit pose — identical values on both sides.
describe('agregado copy pose formula (#1386)', () => {
  const source = {
    materials: [{
      id: 'mat-1', code: 'MAT', name: 'Melamina', thicknessMm: 18,
      widthMm: 1830, lengthMm: 2440, active: true, defaultEdges: [],
    }],
    edges: [],
    hardware: [],
    optionGroups: [{
      id: 'og-frente', code: 'FRENTE', name: 'Frente', kind: 'board' as const,
      required: true, optionIds: ['mat-1'],
    }],
    components: [{
      id: 'comp-frente', code: 'FCAJ', name: 'Frente Cajon', placement: 'frente_cajon',
      geometry: { kind: 'rectangular_board', lengthMm: 200, widthMm: 500, thicknessMm: 18 },
      optionRoles: ['FRENTE'], active: true,
      defaultEdges: [
        { side: 'L1', enabled: false }, { side: 'L2', enabled: false },
        { side: 'W1', enabled: false }, { side: 'W2', enabled: false },
      ],
    }],
    structures: [{ id: 'st-1', code: 'EST', name: 'Cuerpo', components: [], agregados: [] }],
    agregados: [{
      id: 'cajon-std', code: 'CAJ', name: 'Cajón',
      components: [{ componentId: 'comp-frente', quantity: 1 }],
    }],
  } as unknown as Catalog;

  it('i formula stacks copies 250mm apart at full size', () => {
    const definitions = [{
      name: 'cajones', label: 'Cajones', type: 'number', defaultValue: 1,
      category: 'configuration', integer: true,
      binding: { version: 1, kind: 'agregadoQuantity', agregadoId: 'cajon-std' },
    }] as unknown as readonly FurnitureParameter[];
    const module = {
      id: 'mod-1', code: 'MOD', name: 'Cajonera', structureId: 'st-1', hardwareLines: [],
      agregados: [{
        agregadoId: 'cajon-std', quantity: 1,
        position: { zFormula: 'i*250' },
      }],
    };
    const bound = applyEvaluatedAgregadoBindings(module, definitions, { cajones: 3 });
    const bom = resolveBom(bound, { FRENTE: 'mat-1' }, source,
      undefined, undefined, undefined, { widthMm: 600, heightMm: 720, depthMm: 500 });
    expect(bom.boardParts.map((part) => part.z)).toEqual([2, 252, 502]);
  });

  it('no i/N keeps the layout_direction split', () => {
    const definitions = [{
      name: 'cajones', label: 'Cajones', type: 'number', defaultValue: 1,
      category: 'configuration', integer: true,
      binding: { version: 1, kind: 'agregadoQuantity', agregadoId: 'cajon-std' },
    }] as unknown as readonly FurnitureParameter[];
    const module = {
      id: 'mod-1', code: 'MOD', name: 'Cajonera', structureId: 'st-1', hardwareLines: [],
      agregados: [{
        agregadoId: 'cajon-std', quantity: 1, layoutDirection: 'vertical',
      }],
    };
    const bound = applyEvaluatedAgregadoBindings(module, definitions, { cajones: 2 });
    const bom = resolveBom(bound, { FRENTE: 'mat-1' }, source,
      undefined, undefined, undefined, { widthMm: 600, heightMm: 720, depthMm: 500 });
    expect(bom.boardParts.map((part) => part.z)).toEqual([2, 362]);
  });
});
