import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { FurnitureParameter } from './smartFurnitureDomain';
import {
  evaluateFurnitureParameters,
  FurnitureParameterDefinitionsError,
  parseFurnitureParameterDefinitions,
} from './furnitureParameters';

type FixtureScenario = {
  readonly id: string;
  readonly request: { readonly furniture: { readonly parameters?: Readonly<Record<string, unknown>> } };
  readonly response: {
    readonly normalizedSnapshot?: { readonly parameters: Readonly<Record<string, string | number | boolean>> };
    readonly issues: readonly { readonly code: string }[];
  };
};

type Fixture = {
  readonly parameterDefinitions: readonly FurnitureParameter[];
  readonly scenarios: readonly FixtureScenario[];
};

type InvalidDefinitionCorpus = {
  readonly schemaVersion: 1;
  readonly cases: readonly {
    readonly id: string;
    readonly boundary: 'both' | 'persisted' | 'published';
    readonly definitions?: readonly FurnitureParameter[];
    readonly rawJson?: string;
    readonly expectedCode: 'PARAMETER_DEFINITION_INVALID';
    readonly expectedFields: readonly string[];
    readonly expectedTsFields?: readonly string[];
  }[];
};

const fixture = JSON.parse(readFileSync(
  join(import.meta.dirname, '../../../contracts/sketchupAuthoringResolve.contract.json'),
  'utf8',
)) as Fixture;
const invalidDefinitionCorpus = JSON.parse(readFileSync(
  join(import.meta.dirname, '../../../contracts/furnitureParameterDefinitions.invalid.json'),
  'utf8',
)) as InvalidDefinitionCorpus;

describe('definition-driven furniture parameter parity', () => {
  test('reports a required parameter when its definition has no default', () => {
    const evaluated = evaluateFurnitureParameters([{
      name: 'requiredLabel',
      label: 'Required label',
      type: 'string',
      required: true,
      category: 'metadata',
    }], {});

    expect(evaluated.normalized).toEqual({});
    expect(evaluated.issues).toEqual([{
      code: 'PARAMETER_REQUIRED',
      parameter: 'requiredLabel',
      details: { expectedType: 'string' },
    }]);
  });

  test('evaluates defaults and every scalar family exactly like the Go-authored fixture', () => {
    for (const id of ['01-params-materials-parity', '13-definition-driven-typed-parameters']) {
      const scenario = fixture.scenarios.find((candidate) => candidate.id === id);
      expect(scenario, id).toBeDefined();
      const evaluated = evaluateFurnitureParameters(
        fixture.parameterDefinitions,
        scenario!.request.furniture.parameters ?? {},
      );
      expect(evaluated.issues, id).toEqual([]);
      expect(evaluated.normalized, id).toEqual(scenario!.response.normalizedSnapshot!.parameters);
    }
  });

  test.each([
    ['neg-adhoc-body-parameter', 'PARAMETER_UNKNOWN'],
    ['neg-parameter-wrong-type', 'PARAMETER_TYPE_INVALID'],
    ['neg-parameter-out-of-range', 'PARAMETER_OUT_OF_RANGE'],
    ['neg-parameter-invalid-step', 'PARAMETER_STEP_INVALID'],
    ['neg-parameter-invalid-enum', 'PARAMETER_ENUM_INVALID'],
  ])('%s fails with stable parity code %s', (id, expectedCode) => {
    const scenario = fixture.scenarios.find((candidate) => candidate.id === id)!;
    const evaluated = evaluateFurnitureParameters(
      fixture.parameterDefinitions,
      scenario.request.furniture.parameters ?? {},
    );
    expect(evaluated.issues.map((issue) => issue.code)).toContain(expectedCode);
    expect(scenario.response.issues.map((issue) => issue.code)).toContain(expectedCode);
  });

  test('fails closed against the shared invalid-definition corpus', () => {
    expect(invalidDefinitionCorpus.schemaVersion).toBe(1);
    for (const scenario of invalidDefinitionCorpus.cases) {
      const rawJson = scenario.rawJson ?? JSON.stringify(scenario.definitions);
      let rejected: unknown;
      try {
        parseFurnitureParameterDefinitions(rawJson, { persisted: scenario.boundary === 'persisted' });
      } catch (error) {
        rejected = error;
      }

      expect(rejected, scenario.id).toBeInstanceOf(FurnitureParameterDefinitionsError);
      const definitionError = rejected as FurnitureParameterDefinitionsError;
      expect(definitionError.code, scenario.id).toBe(scenario.expectedCode);
      expect(
        [...new Set(definitionError.issues.map((issue) => issue.field))].sort(),
        scenario.id,
      ).toEqual([...(scenario.expectedTsFields ?? scenario.expectedFields)].sort());
    }
  });
});
