/**
 * #1470 — Lee `contracts/formulaIWParity.contract.json` y afirma que el motor
 * TS evalúa la variable derivada IW (ancho interior) exactamente igual que el
 * motor Go
 * (backend-go/internal/domain/engine/formula_iw_parity_contract_test.go
 * consume el MISMO fixture). Expectativas congeladas: si un motor diverge, se
 * alinea el motor — nunca el expected.
 */
import { describe, expect, it } from 'vitest';
import contract from '../../../contracts/formulaIWParity.contract.json';
import { evaluatePartFormula } from './engine';

describe('formula IW parity — shared TS/Go fixture (#1470)', () => {
  it('freezes the fixture shape so a silent empty-contract pass is impossible', () => {
    expect(contract.schemaId).toBe('granete.formulaIWParity.v1');
    expect(contract.cases.length).toBeGreaterThanOrEqual(6);
  });

  it('evaluates every frozen case with the same results as Go', () => {
    for (const c of contract.cases) {
      expect(
        evaluatePartFormula(c.formula, { ...contract.dims, N: c.N, i: c.i }),
        `${c.name}: ${c.formula}`,
      ).toBe(c.expectedMm);
    }
  });
});
