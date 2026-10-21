/**
 * #1393/#1383 — Lee `contracts/spatialNDistributionParity.contract.json` y
 * afirma que el motor TS evalúa la variable espacial N (cantidad de copias)
 * exactamente igual que el motor Go
 * (backend-go/internal/domain/engine/spatial_n_distribution_parity_contract_test.go
 * consume el MISMO fixture). Expectativas congeladas: si un motor diverge, se
 * alinea el motor — nunca el expected.
 */
import { describe, expect, it } from 'vitest';
import contract from '../../../contracts/spatialNDistributionParity.contract.json';
import { evaluatePartFormula } from './engine';

describe('spatial N distribution parity — shared TS/Go fixture (#1383)', () => {
  it('freezes the fixture shape so a silent empty-contract pass is impossible', () => {
    expect(contract.schemaId).toBe('granete.spatialNDistributionParity.v1');
    expect(contract.cases.length).toBeGreaterThanOrEqual(6);
  });

  it('evaluates every frozen case with the same positions as Go', () => {
    for (const c of contract.cases) {
      expect(
        evaluatePartFormula(c.formula, { ...contract.dims, N: c.N, i: c.i }),
        `${c.name}: ${c.formula} con N=${c.N}, i=${c.i}`,
      ).toBe(c.expectedMm);
    }
  });
});
