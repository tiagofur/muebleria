import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { FurnitureParameter } from './smartFurnitureDomain';
import {
  evaluateFurnitureParameters,
  FurnitureParameterDefinitionsError,
  parseFurnitureParameterDefinitions,
  parseFurnitureCatalogDefinition,
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
    readonly rawDefinitionJson?: string;
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
      maxLength: 64,
      required: true,
      category: 'metadata',
    }], {});

    expect(evaluated.normalized).toEqual({});
    expect(evaluated.issues).toEqual([{
      code: 'PARAMETER_REQUIRED',
      parameter: 'requiredLabel',
      details: { expectedType: 'string', maxLength: 64, receivedValue: null },
    }]);
  });

  test.each([undefined, 0, 513, 1.5])('rejects invalid versioned string maxLength %s', (maxLength) => {
    expect(() => evaluateFurnitureParameters([{
      name: 'label',
      label: 'Label',
      type: 'string',
      maxLength,
      category: 'metadata',
    }], {})).toThrow(FurnitureParameterDefinitionsError);

    try {
      evaluateFurnitureParameters([{
        name: 'label',
        label: 'Label',
        type: 'string',
        maxLength,
        category: 'metadata',
      }], {});
    } catch (error) {
      expect((error as FurnitureParameterDefinitionsError).issues.map((issue) => issue.field)).toContain('maxLength');
    }
  });

  test('evaluates defaults and every scalar family exactly like the Go-authored fixture', () => {
    for (const id of [
      '01-params-materials-parity',
      '13-definition-driven-typed-parameters',
      '14-component-condition-true',
      '15-component-condition-false',
      '16-string-max-length-boundary',
    ]) {
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
    ['neg-parameter-string-too-long', 'PARAMETER_STRING_TOO_LONG'],
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
      let rejected: unknown;
      try {
        if (scenario.rawDefinitionJson) {
          parseFurnitureCatalogDefinition(scenario.rawDefinitionJson);
        } else {
          const rawJson = scenario.rawJson ?? JSON.stringify(scenario.definitions);
          parseFurnitureParameterDefinitions(rawJson, { persisted: scenario.boundary === 'persisted' });
        }
      } catch (error) {
        rejected = error;
      }

      expect(rejected, scenario.id).toBeInstanceOf(FurnitureParameterDefinitionsError);
      const definitionError = rejected as FurnitureParameterDefinitionsError;
      expect(definitionError.code, scenario.id).toBe(scenario.expectedCode);
      const fields = [...new Set(definitionError.issues.map((issue) => issue.field))].sort();
      if (scenario.expectedTsFields) {
        expect(fields, scenario.id).toEqual([...scenario.expectedTsFields].sort());
      } else if ((scenario.rawJson || scenario.rawDefinitionJson) && scenario.expectedFields[0] === 'definitions') {
        expect(fields.length, scenario.id).toBeGreaterThan(0);
      } else {
        expect(fields, scenario.id).toEqual([...scenario.expectedFields].sort());
      }
    }
  });
});
