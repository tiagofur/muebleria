/**
 * #875 slice 2 contract parity: the shared fixture at
 * contracts/factoryConstructionPolicyParity.contract.json pins the TS client
 * overlay reading (overlayOverridesToPolicy) and the Go resolver's
 * ParseFactoryConstructionPolicy to the same effective factory station rules.
 * Go enforces engine usability beyond this reading (see the contract
 * description); these cases pin the shared value semantics so the UI badges
 * and the industrial resolve can never diverge.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { overlayOverridesToPolicy } from './factoryConstructionPolicy';

interface ParityRule {
  stationsCount: number;
  startMarginMm: number;
  endMarginMm: number;
}

interface ParityCase {
  name: string;
  overrides: Record<string, unknown>;
  expected: { floorToSide: ParityRule | null; shelfToSide: ParityRule | null };
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, '../../..', 'contracts', 'factoryConstructionPolicyParity.contract.json'), 'utf8'),
) as { cases: ParityCase[] };

function effectiveRule(rule: {
  stationsCount: number;
  startMarginMm: number;
  endMarginMm: number;
  provenance?: string;
} | null | undefined): ParityRule | null {
  if (!rule || rule.provenance !== 'factory') {
    return null;
  }
  return {
    stationsCount: rule.stationsCount,
    startMarginMm: rule.startMarginMm,
    endMarginMm: rule.endMarginMm,
  };
}

describe('#875 factory construction policy TS/Go parity', () => {
  test.each(fixture.cases)('$name', ({ overrides, expected }) => {
    const policy = overlayOverridesToPolicy(overrides);
    expect({
      floorToSide: effectiveRule(policy.floorToSide),
      shelfToSide: effectiveRule(policy.shelfToSide),
    }).toEqual(expected);
  });
});
