/**
 * Canonical JSON Schema conformance for the #477 cross-runtime wire.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';

import {
  AUTHORING_RESOLVE_ISSUE_CODES,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION,
} from './sketchupAuthoringResolve';

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'contracts');
const schema = JSON.parse(readFileSync(join(CONTRACTS, 'sketchupAuthoringResolve.schema.json'), 'utf8')) as object;
const fixture = JSON.parse(readFileSync(join(CONTRACTS, 'sketchupAuthoringResolve.contract.json'), 'utf8')) as unknown;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object');
  return value as Record<string, unknown>;
}

describe('sketchupAuthoringResolve.schema.json', () => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    formats: { 'date-time': (value: string) => !Number.isNaN(Date.parse(value)) },
  });
  ajv.addSchema(schema);
  const schemaId = 'https://granete.app/contracts/sketchupAuthoringResolve.schema.json';
  const requestValidator = ajv.getSchema(`${schemaId}#/$defs/request`);
  const acceptedValidator = ajv.getSchema(`${schemaId}#/$defs/acceptedResponse`);
  const rejectedValidator = ajv.getSchema(`${schemaId}#/$defs/rejectedResponse`);

  test('pins runtime identity and the complete closed issue vocabulary', () => {
    const defs = record(record(schema).$defs);
    const request = record(defs.request);
    const properties = record(request.properties);
    expect(record(properties.schemaId).const).toBe(SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID);
    expect(record(properties.schemaName).const).toBe(SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME);
    expect(record(properties.schemaVersion).const).toBe(SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION);

    const issue = record(defs.issue);
    const issueCode = record(record(issue.properties).code);
    expect(issueCode.enum).toEqual(AUTHORING_RESOLVE_ISSUE_CODES);
  });

  test('validates every Go-authored request and accepted/rejected response', () => {
    expect(requestValidator).toBeDefined();
    expect(acceptedValidator).toBeDefined();
    expect(rejectedValidator).toBeDefined();
    const scenarios = record(fixture).scenarios;
    expect(Array.isArray(scenarios)).toBe(true);
    for (const value of scenarios as unknown[]) {
      const scenario = record(value);
      const response = record(scenario.response);
      const requestIsValid = requestValidator!(scenario.request);
      if (!requestIsValid) {
        expect(response.status, `${String(scenario.id)} invalid request: ${ajv.errorsText(requestValidator!.errors)}`).toBe('rejected');
      }
      const validator = response.status === 'accepted' ? acceptedValidator! : rejectedValidator!;
      expect(validator(response), `${String(scenario.id)} response: ${ajv.errorsText(validator.errors)}`).toBe(true);
    }
  });

  test('rejects optional occurrence definition IDs, nested parameters, and response union leakage', () => {
    const scenarios = record(fixture).scenarios as unknown[];
    const acceptedScenario = record(scenarios.find((value) => {
      const furniture = record(record(value).request).furniture;
      return typeof furniture === 'object' && furniture !== null &&
        Array.isArray(record(furniture).components) && (record(furniture).components as unknown[]).length > 0;
    }));
    const request = structuredClone(acceptedScenario.request);
    const requestRecord = record(request);
    const furniture = record(requestRecord.furniture);
    const components = furniture.components;
    if (!Array.isArray(components) || components.length === 0) throw new Error('fixture must contain authored components');
    delete record(components[0]).componentDefinitionId;
    expect(requestValidator!(request)).toBe(false);

    const nested = structuredClone(acceptedScenario.request);
    record(record(nested).furniture).parameters = { nested: { unsafe: true } };
    expect(requestValidator!(nested)).toBe(false);

    const rejected = structuredClone(record((record(fixture).scenarios as unknown[]).find((value) => record(record(value).response).status === 'rejected')).response);
    record(rejected).normalizedSnapshot = {};
    expect(rejectedValidator!(rejected)).toBe(false);
  });

  test('pins accepted correlation, rejected issues, hole bounds, and full material projection', () => {
    const scenarios = record(fixture).scenarios as unknown[];
    const material = record(scenarios.find((value) => record(value).id === '11-material-pbr-roundtrip'));
    const accepted = structuredClone(material.response);
    expect(acceptedValidator!(accepted)).toBe(true);
    for (const key of ['responseMessageId', 'inReplyToMessageId', 'idempotencyKey', 'catalogRevision']) {
      const missingCorrelation = structuredClone(accepted);
      record(missingCorrelation)[key] = '';
      expect(acceptedValidator!(missingCorrelation), key).toBe(false);
    }

    const rejected = structuredClone(record(scenarios.find((value) => record(record(value).response).status === 'rejected')).response);
    record(rejected).issues = [];
    expect(rejectedValidator!(rejected)).toBe(false);

    const machining = record(record(record(accepted).resolved).machining);
    const operations = machining.operations as unknown[];
    if (operations.length === 0) throw new Error('fixture must contain a machining operation');
    const holes = record(operations[0]).holes as unknown[];
    const invalidHole = structuredClone(accepted);
    const invalidOperations = record(record(record(invalidHole).resolved).machining).operations as unknown[];
    const invalidHoles = record(invalidOperations[0]).holes as unknown[];
    record(invalidHoles[0]).face = 'diagonal';
    record(invalidHoles[0]).xMm = -1;
    expect(acceptedValidator!(invalidHole)).toBe(false);

    expect(holes.length).toBeGreaterThan(0);
  });
});
