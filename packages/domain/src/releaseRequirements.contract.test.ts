/** Shared planning-demand contract; no release capture or live-path change. */
import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/releaseRequirements.contract.json';
import base from '../../../contracts/plinthBaseParity.contract.json';
import { requirementLinesFromContext } from './releaseBomContext';
import type { Catalog } from './types';

const choices = { FRENTE: 'mat-front', INTERIOR: 'mat-body', ZOCLO_PERFIL: 'hw-perfil' };

describe('release requirement Go/TS parity', () => {
  for (const scenario of fixture.cases) {
    it(scenario.name, () => {
      const catalog = structuredClone(base.catalog) as unknown as Catalog;
      const materials = catalog.materials.map((m) => ({ ...m, wastePercent: scenario.wastePercent }));
      const context = {
        id: 'parity-project',
        items: Array.from({ length: scenario.units }, (_, i) => ({
          id: `unit-${i}`, moduleId: scenario.moduleId, quantity: 1, optionChoices: choices,
          customDims: 'customDims' in scenario ? scenario.customDims : undefined,
        })),
        globalChoices: choices,
      };
      const lines = requirementLinesFromContext(context, { ...catalog, materials }, materials,
        Object.fromEntries(catalog.edges.map((e) => [e.code, e.id])));
      expect(lines.map((line) => ({
        kind: line.kind, material_id: line.materialId, quantity: line.quantity,
      })).sort((a, b) => `${a.kind}:${a.material_id}`.localeCompare(`${b.kind}:${b.material_id}`)))
        .toEqual(scenario.expected);
    });
  }
});
