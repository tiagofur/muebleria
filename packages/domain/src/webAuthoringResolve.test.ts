/**
 * #875 web resolve adapter tests: the builder produces a request the TS
 * validator (and therefore the Go gateway) accepts, carries honest web
 * identity, never synthesizes components/relationships, and the projection
 * reads the fail-closed response without recomputing anything.
 */

import { describe, expect, test } from 'vitest';

import {
  WEB_AUTHORING_RESOLVE_CLIENT,
  WEB_AUTHORING_RESOLVE_HOST,
  buildWebAuthoringResolveRequest,
  projectJoineryFromResolveResponse,
  validateWebAuthoringResolveRequest,
  WebAuthoringResolveError,
} from './webAuthoringResolve';
import type { AuthoringResolveResponseV1 } from './sketchupAuthoringResolve';

const baseInput = {
  furnitureDefinitionId: 'def-01',
  catalogRevision: 'workshop-50354d6c1473',
  parameters: { baseJointStations: 3 },
  materialChoices: { INTERIOR: 'mat-oak18' },
  messageId: 'web-resolve-fixed-01',
};

describe('buildWebAuthoringResolveRequest', () => {
  test('produces a validator-clean envelope with honest web identity', () => {
    const request = buildWebAuthoringResolveRequest(baseInput);
    expect(request.schemaId).toBe('granete.sketchup-authoring-resolve.v1');
    expect(request.source.client).toBe(WEB_AUTHORING_RESOLVE_CLIENT);
    expect(request.source.host).toBe(WEB_AUTHORING_RESOLVE_HOST);
    expect(request.source.host).not.toBe('sketchup');
    expect(request.furniture).toEqual({
      furnitureDefinitionId: 'def-01',
      catalogRevision: 'workshop-50354d6c1473',
      parameters: { baseJointStations: 3 },
      materialChoices: { INTERIOR: 'mat-oak18' },
    });
    expect(validateWebAuthoringResolveRequest(request)).toEqual([]);
  });

  test('never synthesizes component or relationship intent', () => {
    const request = buildWebAuthoringResolveRequest(baseInput);
    expect('components' in request.furniture).toBe(false);
    expect('relationships' in request.furniture).toBe(false);
    expect('hardwarePlacements' in request.furniture).toBe(false);
  });

  test('generates a fresh message identity per call when none is given', () => {
    const { messageId: _m, ...withoutMessageId } = baseInput;
    const a = buildWebAuthoringResolveRequest(withoutMessageId);
    const b = buildWebAuthoringResolveRequest(withoutMessageId);
    expect(a.messageId).not.toBe(b.messageId);
    expect(a.messageId).toBe(a.idempotencyKey);
    expect(a.messageId).toMatch(/^web-resolve-/u);
  });
});

const acceptedResponse = {
  schemaId: 'granete.sketchup-authoring-resolve.v1',
  schemaName: 'granete.sketchup-authoring-resolve',
  schemaVersion: '1.0',
  resolveContract: 'granete.sketchup-authoring-resolve.v1',
  responseMessageId: 'resolve-web-resolve-fixed-01',
  inReplyToMessageId: 'web-resolve-fixed-01',
  idempotencyKey: 'web-resolve-fixed-01',
  catalogRevision: 'workshop-50354d6c1473',
  status: 'accepted',
  normalizedSnapshot: {
    parameters: { baseJointStations: 3 },
    materialChoices: {},
    components: [{ componentInstanceId: 'floor-01', componentDefinitionId: 'def-floor', catalogComponentId: 'comp-floor', role: 'INTERIOR' }],
    relationships: [],
    hardwarePlacements: [],
  },
  resolved: {
    layout: {
      furnitureDefinitionId: 'def-01',
      definitionName: 'Gabinete',
      transformContract: 'granete.local-basis.v1',
      dimensionsMm: [600, 720, 560],
      components: [{
        componentInstanceId: 'floor-01', componentDefinitionId: 'def-floor', slotId: 's', role: 'INTERIOR',
        lengthMm: 564, widthMm: 542, thicknessMm: 18, transform: { translationMm: [18, 0, 0] },
      }],
      hardware: [],
    },
    machining: {
      operations: [{
        operationId: 'op-1', hostComponentInstanceId: 'floor-01',
        provenance: { sourceKind: 'relationship', relationshipId: 'rel-floor-sides-01' },
        holes: [],
      }],
      derivedHardwarePlacements: [],
      manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
      joineryStatuses: [{
        relationshipId: 'rel-floor-sides-01', kind: 'floor-side', stage: 'TECHNICAL_PROFILE_REQUIRED',
        contacts: [
          { contactId: 'rel-floor-sides-01:side-left-01', status: 'VALID', issueCodes: [] },
          { contactId: 'rel-floor-sides-01:side-right-01', status: 'VALID', issueCodes: [] },
        ],
        stations: {
          status: 'PLANNED', issueCodes: [],
          stationCounts: [{ contactId: 'rel-floor-sides-01:side-left-01', stationCount: 3 }],
          stationDistances: [{ contactId: 'rel-floor-sides-01:side-left-01', distancesMm: [30, 261, 492] }],
        },
        blockers: ['TECHNICAL_PROFILE_REQUIRED'],
      }],
    },
    preflight: { scope: 'authoring-resolve-subset', status: 'clear', issues: [], preflightContract: 'granete.manufacturing-preflight.v1' },
  },
  issues: [],
} as unknown as AuthoringResolveResponseV1;

describe('projectJoineryFromResolveResponse', () => {
  test('projects joinery statuses and relationship operation counts from the wire', () => {
    const request = buildWebAuthoringResolveRequest(baseInput);
    const projection = projectJoineryFromResolveResponse(acceptedResponse, request);
    expect(projection.joineryStatuses).toHaveLength(1);
    expect(projection.joineryStatuses[0]!.stage).toBe('TECHNICAL_PROFILE_REQUIRED');
    expect(projection.relationshipOperationCounts.get('rel-floor-sides-01')).toBe(1);
  });

  test('throws a structured error carrying the codes for rejected responses', () => {
    const request = buildWebAuthoringResolveRequest(baseInput);
    const { resolved: _resolved, normalizedSnapshot: _snapshot, ...rejectedBase } = acceptedResponse;
    const rejected = {
      ...rejectedBase,
      status: 'rejected',
      issues: [{ code: 'CATALOG_REVISION_STALE', message: 'stale', severity: 'error' }],
    } as unknown as AuthoringResolveResponseV1;
    expect(() => projectJoineryFromResolveResponse(rejected, request)).toThrow(WebAuthoringResolveError);
  });
});
