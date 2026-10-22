import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/hardwareComponentScaling.contract.json';
import { applyEvaluatedComponentBindings } from './engine/componentBindings';
import { resolveBom } from './engine/bom';
import { evaluateFurnitureParameters } from './furnitureParameters';
import type { FurnitureParameter } from './smartFurnitureDomain';
import type { Catalog, Module } from './types';

// #1394 — contrato de paridad TS/Go: la línea de herraje vinculada a un
// componente (componentId) es POR COPIA — escala ×N (copias efectivas tras
// bindings, el mismo N de #1383/#1384); copias 0 la descarta; las líneas sin
// vínculo quedan fijas. Consume el MISMO contracts/hardwareComponentScaling.contract.json
// que el gemelo Go (hardware_component_scaling_contract_test.go). Expected
// congelados: si un motor diverge, se alinea el motor — nunca el fixture.
const definitions = fixture.parameters as readonly FurnitureParameter[];
const catalog = fixture.catalog as unknown as Catalog;
const source = structuredClone(catalog);
const module = {
  ...catalog.modules[0]!,
  parameterDefinitions: definitions,
} as unknown as Module;

function resolveDespensa(values: Record<string, number>) {
  const evaluation = evaluateFurnitureParameters(definitions, values);
  expect(evaluation.issues).toEqual([]);
  const prepared = applyEvaluatedComponentBindings(
    module,
    definitions,
    evaluation.normalized,
  );
  const bom = resolveBom(
    prepared,
    fixture.optionChoices,
    source,
    undefined,
    undefined,
    undefined,
    {
      widthMm: fixture.dims.widthMm,
      heightMm: fixture.dims.heightMm,
      depthMm: fixture.dims.depthMm,
    },
  );
  return { evaluation, prepared, bom };
}

describe('hardware component-link scaling Go/TS parity (#1394)', () => {
  it('freezes the N=0/1/4/8 cases', () => {
    expect(fixture.schemaId).toBe('granete.hardwareComponentScaling.v1');
    expect(
      fixture.cases.map((c: { values: { entrepanos: number } }) => c.values.entrepanos),
    ).toEqual([0, 1, 4, 8]);
  });

  for (const scenario of fixture.cases) {
    it(scenario.name, () => {
      const original = JSON.stringify({
        module,
        definitions,
        values: scenario.values,
      });
      const { prepared, bom } = resolveDespensa(scenario.values);

      // The shelf copies scale the physical pieces too (same N as #1383).
      expect(bom.boardParts).toHaveLength(scenario.expectedBoardParts);

      const resolved = bom.hardwareLines
        .map((line) => ({ hardwareId: line.hardwareId, quantity: line.quantity }))
        .sort((a, b) =>
          a.hardwareId! === b.hardwareId!
            ? a.quantity - b.quantity
            : a.hardwareId!.localeCompare(b.hardwareId!),
        );
      const expected = [...scenario.expectedHardware]
        .map((line) => ({ ...line }))
        .sort((a, b) =>
          a.hardwareId === b.hardwareId
            ? a.quantity - b.quantity
            : a.hardwareId.localeCompare(b.hardwareId),
        );
      expect(resolved).toEqual(expected);

      // Deterministic bindings; inputs never mutate.
      const evaluation = evaluateFurnitureParameters(definitions, scenario.values);
      expect(evaluation.issues).toEqual([]);
      expect(applyEvaluatedComponentBindings(module, definitions, evaluation.normalized)).toEqual(
        prepared,
      );
      expect(
        JSON.stringify({ module, definitions, values: scenario.values }),
      ).toBe(original);
    });
  }
});
