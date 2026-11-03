import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveBom } from './engine/bom';
import type { Catalog, Module, OptionChoices } from './types';

interface ContractFixture {
  schemaId: string;
  catalog: Catalog;
  scenarios: Array<{
    name: string;
    moduleAgregados: Module['agregados'];
    optionChoices: OptionChoices;
    expectedEffectiveAgregadoId: string;
    expectedPartIds: string[];
    expectedHardwareIds: string[];
  }>;
}

describe('agregadoEngineResolutionParity contract (#1473)', () => {
  const contractPath = path.resolve(
    __dirname,
    '../../../contracts/agregadoEngineResolutionParity.contract.json',
  );
  const fixture: ContractFixture = JSON.parse(
    fs.readFileSync(contractPath, 'utf8'),
  );

  it('verifies contract schema', () => {
    expect(fixture.schemaId).toBe('granete.agregadoEngineResolutionParity.v1');
  });

  for (const scenario of fixture.scenarios) {
    it(`[TS] BOM resolution: ${scenario.name}`, () => {
      const module: Module = {
        id: 'mod-test',
        code: 'MOD-TEST',
        name: 'Módulo de Prueba',
        structureId: 'st-base',
        agregados: scenario.moduleAgregados,
        hardwareLines: [],
        externalDims: { width: 600, height: 720, depth: 560 },
      };

      const bom = resolveBom(module, scenario.optionChoices, fixture.catalog);
      const partIds = bom.boardParts.map((p) => p.id);
      expect(partIds).toEqual(scenario.expectedPartIds);

      const hardwareIds = bom.hardwareLines.map((h) => h.hardwareId);
      expect(hardwareIds).toEqual(scenario.expectedHardwareIds);
    });
  }

  it('[TS] fail-closed: throws ResolutionError when role has no choice and instance has no fallback', () => {
    const brokenModule: Module = {
      id: 'mod-broken',
      code: 'MOD-BROKEN',
      name: 'Módulo Roto',
      structureId: 'st-base',
      agregados: [
        {
          id: 'inst-1',
          agregadoId: '',
          optionRole: 'SISTEMA_CAJON',
          quantity: 1,
        },
      ],
      hardwareLines: [],
      externalDims: { width: 600, height: 720, depth: 560 },
    };

    expect(() =>
      resolveBom(brokenModule, { FRONT: 'mat-18' }, fixture.catalog),
    ).toThrowError(/Agregado role 'SISTEMA_CAJON' has no selection/);
  });
});
