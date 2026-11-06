/**
 * #1529 — TS parity of the opening front contract v2 (A3). The SAME fixture
 * is consumed by the Go engine (opening_edge_stack_contract_test.go).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPENING_FRONT_CONTRACT_V2,
  resolveOpeningEdgeStack,
  type OpeningEdgeStackInput,
  type OpeningEdgeStackResolution,
} from './openingEdgeStack';

interface Fixture {
  readonly contract: string;
  readonly resolutionCases: readonly {
    readonly name: string;
    readonly input: OpeningEdgeStackInput;
    readonly expected: Omit<OpeningEdgeStackResolution, 'contract'>;
  }[];
  readonly invalidCases: readonly {
    readonly name: string;
    readonly input: OpeningEdgeStackInput;
    readonly expectedErrorCode: string;
  }[];
  readonly widthCase: { readonly catalogFrontWidthMm: number; readonly expectedFrontWidthMm: number };
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../contracts/openingFrontEdgeStack.contract.json'), 'utf8'),
) as Fixture;

describe('opening front contract v2 — A3 (#1529)', () => {
  it('usa el contrato v2 y trae los 7 casos de la ficha', () => {
    expect(fixture.contract).toBe(OPENING_FRONT_CONTRACT_V2);
    expect(fixture.resolutionCases.length).toBeGreaterThanOrEqual(7);
    expect(fixture.widthCase.expectedFrontWidthMm).toBe(fixture.widthCase.catalogFrontWidthMm);
  });

  for (const tc of fixture.resolutionCases) {
    it(`resuelve: ${tc.name}`, () => {
      const result = resolveOpeningEdgeStack(tc.input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resolution).toEqual({ contract: OPENING_FRONT_CONTRACT_V2, ...tc.expected });
    });
  }

  for (const tc of fixture.invalidCases) {
    it(`falla cerrado: ${tc.name}`, () => {
      const result = resolveOpeningEdgeStack(tc.input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorCode).toBe(tc.expectedErrorCode);
    });
  }
});
