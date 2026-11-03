/**
 * #1472 — Lee `contracts/agregadoRoleResolution.contract.json` y afirma que el motor
 * TS resuelve el agregado efectivo por rol exactamente igual que el motor Go
 * (backend-go/internal/domain/engine/agregado_role_resolution_contract_test.go
 * consume el MISMO fixture).
 */
import { describe, expect, it } from 'vitest';
import contract from '../../../contracts/agregadoRoleResolution.contract.json';
import { resolveEffectiveAgregadoId } from './agregados';
import type { ModuleAgregadoInstance, OptionChoices } from './types';

describe('agregado role resolution parity — shared TS/Go fixture (#1472)', () => {
  it('freezes the fixture shape so a silent empty-contract pass is impossible', () => {
    expect(contract.schemaId).toBe('granete.agregadoRoleResolution.v1');
    expect(contract.cases.length).toBeGreaterThanOrEqual(7);
  });

  it('evaluates every frozen case with the exact expectedAgregadoId', () => {
    for (const c of contract.cases) {
      const inst = c.instance as unknown as ModuleAgregadoInstance;
      const choices = c.optionChoices as unknown as OptionChoices;
      expect(
        resolveEffectiveAgregadoId(inst, choices),
        c.name,
      ).toBe(c.expectedAgregadoId);
    }
  });
});
