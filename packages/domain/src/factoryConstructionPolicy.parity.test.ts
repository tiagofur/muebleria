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

import { overlayOverridesToPolicy, type ComponentConstructionOverride, type FactoryConstructionPolicy } from './factoryConstructionPolicy';

interface ParityRule {
  stationsCount: number;
  startMarginMm: number;
  endMarginMm: number;
  maxSpacingMm?: number;
}

interface ParityComponentOverride {
  stationsCount?: number;
  startMarginMm?: number;
  endMarginMm?: number;
  maxSpacingMm?: number;
}

interface ParityCase {
  name: string;
  overrides: Record<string, unknown>;
  expected: {
    floorToSide: ParityRule | null;
    shelfToSide: ParityRule | null;
    componentOverrides?: Record<string, ComponentConstructionOverride>;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, '../../..', 'contracts', 'factoryConstructionPolicyParity.contract.json'), 'utf8'),
) as { cases: ParityCase[] };

function effectiveRule(rule: {
  stationsCount: number;
  startMarginMm: number;
  endMarginMm: number;
  maxSpacingMm?: number;
  provenance?: string;
} | null | undefined): ParityRule | null {
  if (!rule || rule.provenance !== 'factory') {
    return null;
  }
  return {
    stationsCount: rule.stationsCount,
    startMarginMm: rule.startMarginMm,
    endMarginMm: rule.endMarginMm,
    ...(rule.maxSpacingMm !== undefined ? { maxSpacingMm: rule.maxSpacingMm } : {}),
  };
}

/**
 * The readers keep the stored component entries verbatim (both sides drop
 * entries with no station scalar); resolving them against the factory family
 * rule happens where the relationship kind is known.
 */
function storedComponentOverrides(
  overrides: FactoryConstructionPolicy['componentOverrides'],
): Record<string, Pick<ComponentConstructionOverride, 'stationsCount' | 'startMarginMm' | 'endMarginMm' | 'maxSpacingMm'>> | undefined {
  if (!overrides) return undefined;
  const out: Record<string, Pick<ComponentConstructionOverride, 'stationsCount' | 'startMarginMm' | 'endMarginMm' | 'maxSpacingMm'>> = {};
  for (const [id, entry] of Object.entries(overrides)) {
    out[id] = {
      stationsCount: entry.stationsCount,
      startMarginMm: entry.startMarginMm,
      endMarginMm: entry.endMarginMm,
      maxSpacingMm: entry.maxSpacingMm,
    };
  }
  return out;
}

describe('#875 factory construction policy TS/Go parity', () => {
  test.each(fixture.cases)('$name', ({ overrides, expected }) => {
    const policy = overlayOverridesToPolicy(overrides);
    expect({
      floorToSide: effectiveRule(policy.floorToSide),
      shelfToSide: effectiveRule(policy.shelfToSide),
      componentOverrides: storedComponentOverrides(policy.componentOverrides),
    }).toEqual({
      floorToSide: expected.floorToSide,
      shelfToSide: expected.shelfToSide,
      componentOverrides: expected.componentOverrides,
    });
  });
});
