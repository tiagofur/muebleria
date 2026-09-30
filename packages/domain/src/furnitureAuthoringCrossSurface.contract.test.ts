import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  evaluateFurnitureParameters,
  validatePublishedFurnitureParameterDefinitions,
} from './furnitureParameters';
import type { FurnitureParameter } from './smartFurnitureDomain';

// #497 T8 — the TS mirror consumes the SAME golden artifact the Go chain
// test generates (contracts/furnitureAuthoringCrossSurface.fixture.json):
// the exact published parameter set a real PostgreSQL served (draft +
// synthesized dimension projections, sorted) must pass the published
// boundary validation and evaluate the cross-surface sample values with
// zero issues — explicit false and explicit empty string included. The
// server stays the identity authority; this proves the browser-side mirror
// agrees with the served truth rather than re-implementing it.
describe('furniture authoring cross-surface fixture (#497 T8)', () => {
  const fixture = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../contracts/furnitureAuthoringCrossSurface.fixture.json', import.meta.url)),
      'utf8',
    ),
  ) as {
    readonly samples: Record<string, unknown>;
    readonly expected: {
      readonly definitionHash: string;
      readonly publishedParameters: readonly FurnitureParameter[];
    };
  };

  it('serves a non-empty generated block', () => {
    expect(fixture.expected.definitionHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(fixture.expected.publishedParameters.length).toBe(8);
  });

  it('the published set passes the TS published-boundary mirror', () => {
    const issues = validatePublishedFurnitureParameterDefinitions(fixture.expected.publishedParameters);
    expect(issues).toEqual([]);
  });

  it('reserves the projected dimensions inside the published set', () => {
    const names = fixture.expected.publishedParameters.map((parameter) => parameter.name);
    expect(names).toContain('widthMm');
    expect(names).toContain('heightMm');
    expect(names).toContain('depthMm');
    for (const parameter of fixture.expected.publishedParameters) {
      if (['widthMm', 'heightMm', 'depthMm'].includes(parameter.name)) {
        expect(parameter.binding?.kind).toBe('dimensionColumn');
      }
    }
  });

  it('preserves the explicit false and empty-string defaults in the served set', () => {
    const softClose = fixture.expected.publishedParameters.find((p) => p.name === 'softClose');
    const clientNote = fixture.expected.publishedParameters.find((p) => p.name === 'clientNote');
    expect(softClose?.defaultValue).toBe(false);
    expect(clientNote?.defaultValue).toBe('');
  });

  it('evaluates the cross-surface samples with zero issues and typed values', () => {
    const { normalized, issues } = evaluateFurnitureParameters(
      fixture.expected.publishedParameters,
      fixture.samples,
    );
    expect(issues).toEqual([]);
    expect(normalized.shelfCount).toBe(3);
    expect(normalized.doorPresence).toBe(true);
    expect(normalized.softClose).toBe(false);
    expect(normalized.doorStyle).toBe('shaker');
    expect(normalized.clientNote).toBe('Entrega abril');
    // dimension projections evaluate from the module's served defaults
    expect(normalized.widthMm).toBe(600);
    expect(normalized.heightMm).toBe(720);
    expect(normalized.depthMm).toBe(590);
  });

  it('rejects a sample the served constraints forbid (mirror agrees with the server)', () => {
    const { issues } = evaluateFurnitureParameters(fixture.expected.publishedParameters, {
      ...fixture.samples,
      shelfCount: 99,
    });
    expect(issues.some((issue) => issue.code === 'PARAMETER_OUT_OF_RANGE')).toBe(true);
  });
});
