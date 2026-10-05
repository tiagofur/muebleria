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

  test('accepts sparse per-axis hardware rotationDeg and rejects unknown axes', () => {
    const scenarios = record(fixture).scenarios as unknown[];
    const rotationScenario = record(scenarios.find((value) => {
      const hardwarePlacements = record(record(record(value).request).furniture).hardwarePlacements;
      return Array.isArray(hardwarePlacements) && hardwarePlacements.some((placement) =>
        typeof placement === 'object' && placement !== null && 'rotationDeg' in placement,
      );
    }));
    expect(requestValidator!(rotationScenario.request), ajv.errorsText(requestValidator!.errors)).toBe(true);

    const sparse = structuredClone(rotationScenario.request);
    const sparseHardwarePlacements = record(record(sparse).furniture).hardwarePlacements;
    if (!Array.isArray(sparseHardwarePlacements) || sparseHardwarePlacements.length === 0) {
      throw new Error('fixture must contain hardware placements');
    }
    record(sparseHardwarePlacements.find((placement) => 'rotationDeg' in record(placement))).rotationDeg = { z: 90 };
    expect(requestValidator!(sparse), ajv.errorsText(requestValidator!.errors)).toBe(true);

    const malformed = structuredClone(rotationScenario.request);
    const hardwarePlacements = record(record(malformed).furniture).hardwarePlacements;
    if (!Array.isArray(hardwarePlacements) || hardwarePlacements.length === 0) {
      throw new Error('fixture must contain hardware placements');
    }
    record(hardwarePlacements.find((placement) => 'rotationDeg' in record(placement))).rotationDeg = { x: 5, y: 10, w: 90 };
    expect(requestValidator!(malformed)).toBe(false);
  });

  test('accepts resolved layout hardware optionRole and rejects non-strings', () => {
    const scenarios = record(fixture).scenarios as unknown[];
    const acceptedScenario = record(scenarios.find((value) => record(record(value).response).status === 'accepted'));
    const response = structuredClone(acceptedScenario.response);
    const layout = record(record(response).resolved).layout;
    const hardware = record(layout).hardware;
    if (!Array.isArray(hardware) || hardware.length === 0) throw new Error('fixture must contain resolved layout hardware');
    record(hardware[0]).optionRole = 'BISAGRA';
    expect(acceptedValidator!(response), ajv.errorsText(acceptedValidator!.errors)).toBe(true);

    const malformed = structuredClone(acceptedScenario.response);
    const malformedHardware = record(record(record(record(malformed).resolved).layout)).hardware;
    record((malformedHardware as unknown[])[0]).optionRole = 42;
    expect(acceptedValidator!(malformed)).toBe(false);
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

  test('accepts versioned per-contact recipes and rejects malformed rules', () => {
    const scenarios = record(fixture).scenarios as unknown[];
    const joineryScenario = record(scenarios.find((value) => {
      const relationships = record(record(record(value).request).furniture).relationships;
      return Array.isArray(relationships) && relationships.length > 0;
    }));
    const withRecipes = () => {
      const request = structuredClone(joineryScenario.request);
      const relationships = record(record(request).furniture).relationships as unknown[];
      const relationship = record(relationships[0]);
      relationship.kind = 'fixed-shelf-side';
      const relationshipId = record(relationship).relationshipId as string;
      const contactIds = (relationship.targets as unknown[]).map((target) =>
        `${relationshipId}:${record(target).componentInstanceId}`);
      relationship.recipes = contactIds.map((contactId) => ({
        contactId,
        recipeId: 'test:synthetic-fixed-shelf',
        recipeRevision: 'test-1',
        technicalProfileId: 'test:synthetic-shelf-profile',
        technicalProfileRevision: 'test-1',
        rules: [
          { ruleId: 'pilot', ruleRevision: 'test-1', participantRole: 'A', operationRole: 'pilot',
            entryFace: 'bottom', offsetMm: [0, 0, 0], axis: [0, -1, 0], diameterMm: 3, depthMm: 12 },
          { ruleId: 'counterbore', ruleRevision: 'test-1', participantRole: 'B', operationRole: 'counterbore',
            entryFace: 'back', offsetMm: [0, 18, 0], axis: [0, -1, 0], diameterMm: 6, depthMm: 9 },
        ],
      }));
      return request;
    };
    expect(requestValidator!(withRecipes()), ajv.errorsText(requestValidator!.errors)).toBe(true);

    const mutateFirstRule = (request: unknown, mutate: (rule: Record<string, unknown>) => void) => {
      const relationships = record(record(request).furniture).relationships as unknown[];
      const rules = record((record(relationships[0]).recipes as unknown[])[0]).rules as unknown[];
      mutate(record(rules[0]));
      return request;
    };
    expect(requestValidator!(mutateFirstRule(withRecipes(), (rule) => { rule.unexpected = true; }))).toBe(false);
    expect(requestValidator!(mutateFirstRule(withRecipes(), (rule) => { rule.participantRole = 'C'; }))).toBe(false);
    expect(requestValidator!(mutateFirstRule(withRecipes(), (rule) => { rule.offsetMm = [0, 0]; }))).toBe(false);
    expect(requestValidator!(mutateFirstRule(withRecipes(), (rule) => { rule.depthMm = 0; }))).toBe(false);
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
