/**
 * #477 resolve contract client-side validation: the TS validator mirrors the
 * Go gateway's fail-closed checks and produces the same stable codes, so
 * callers get structured rejections before spending a round-trip. Catalog
 * membership and manufacturability stay server-side.
 */

import { describe, expect, test } from 'vitest';

import type {
  AuthoringFurnitureIntentV1,
  AuthoringResolveRequestV1,
} from './sketchupAuthoringResolve';
import {
  AUTHORING_RESOLVE_ISSUE_CODES,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID,
  isAuthoringResolveIssueCode,
  validateAuthoringResolveRequest,
} from './sketchupAuthoringResolve';

function request(furniture: Partial<AuthoringFurnitureIntentV1> = {}): AuthoringResolveRequestV1 {
  return {
    schemaId: SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID,
    schemaName: 'granete.sketchup-authoring-resolve',
    schemaVersion: '1.0',
    messageId: 'msg-1',
    idempotencyKey: 'test:resolve:1',
    sentAt: '2026-08-29T12:00:00Z',
    source: { client: 'granete-for-sketchup', clientVersion: '0.1.0', host: 'sketchup', hostVersion: '2026.2' },
    units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
    coordinateSystem: { handedness: 'right', upAxis: 'z', projectFrameId: 'frame-1' },
    furniture: { furnitureDefinitionId: 'mod-1', catalogRevision: 'workshop-test', ...furniture },
  };
}

const codes = (issues: readonly { code: string }[]) => issues.map((issue) => issue.code);

describe('validateAuthoringResolveRequest', () => {
  test('accepts a minimal parameters/materials request', () => {
    expect(validateAuthoringResolveRequest(request())).toEqual([]);
    expect(
      validateAuthoringResolveRequest(
        request({ parameters: { widthMm: 600, heightMm: 720, depthMm: 560 }, materialChoices: { FRENTE: 'mat-1' } }),
      ),
    ).toEqual([]);
  });

  test('fails closed on schema identity drift before anything else', () => {
    const mismatch = { ...request(), schemaId: 'granete.sketchup-authoring.v1' };
    expect(codes(validateAuthoringResolveRequest(mismatch))).toEqual(['SCHEMA_ID_MISMATCH']);

    const future = { ...request(), schemaVersion: '2.0' };
    const issues = validateAuthoringResolveRequest(future);
    expect(codes(issues)).toEqual(['SCHEMA_VERSION_UNSUPPORTED']);
    expect(issues[0]?.remediation).toContain('Update the extension');
  });

  test('rejects invalid envelope correlation/units/frames', () => {
    const broken = {
      ...request(),
      messageId: ' ',
      units: { length: 'in' as 'mm', angle: 'deg' as const, precisionMm: 0.01 },
      coordinateSystem: { handedness: 'left' as 'right', upAxis: 'y' as 'z', projectFrameId: '' },
    };
    const issueCodes = codes(validateAuthoringResolveRequest(broken));
    for (const code of ['REQUEST_INVALID']) {
      expect(issueCodes).toContain(code);
    }
    expect(issueCodes.filter((code) => code === 'REQUEST_INVALID').length).toBeGreaterThanOrEqual(3);
  });

  test('precisionMm outside (0,1] is invalid', () => {
    expect(codes(validateAuthoringResolveRequest(request()))).toEqual([]);
    const coarse = { ...request(), units: { length: 'mm' as const, angle: 'deg' as const, precisionMm: 5 } };
    expect(codes(validateAuthoringResolveRequest(coarse))).toEqual(['REQUEST_INVALID']);
  });

  test('unknown or non-integer furniture parameters fail closed', () => {
    expect(
      codes(validateAuthoringResolveRequest(request({ parameters: { shelf2Z: 520 } }))),
    ).toEqual(['PARAMETER_INVALID']);
    expect(
      codes(validateAuthoringResolveRequest(request({ parameters: { widthMm: 600.5 } }))),
    ).toEqual(['PARAMETER_INVALID']);
    expect(
      codes(validateAuthoringResolveRequest(request({ parameters: { widthMm: -1 } }))),
    ).toEqual(['PARAMETER_INVALID']);
  });

  test('occurrences: duplicate ids, wrong frame and non-finite translations', () => {
    const duplicate = request({
      components: [
        { componentInstanceId: 'shelf-01', componentDefinitionId: 'mod-comp-shelf' },
        { componentInstanceId: 'shelf-01', componentDefinitionId: 'mod-comp-shelf' },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(duplicate))).toContain('OCCURRENCE_DUPLICATE_ID');

    const wrongFrame = request({
      components: [
        {
          componentInstanceId: 'shelf-01',
          componentDefinitionId: 'mod-comp-shelf',
          transform: { frame: 'project' as 'assembly', translationMm: [18, 18, 350] },
        },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(wrongFrame))).toContain('TRANSFORM_INVALID');

    const nonFinite = request({
      components: [
        {
          componentInstanceId: 'shelf-01',
          componentDefinitionId: 'mod-comp-shelf',
          transform: { frame: 'assembly', translationMm: [18, Number.NaN, 350] },
        },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(nonFinite))).toContain('TRANSFORM_INVALID');
  });

  test('relationships: orphaned anchors and missing targets are structural', () => {
    const orphaned = request({
      components: [{ componentInstanceId: 'shelf-01', componentDefinitionId: 'mod-comp-shelf' }],
      relationships: [
        {
          relationshipId: 'rel-1',
          kind: 'shelf-support',
          source: { componentInstanceId: 'shelf-ghost', role: 'shelf-edge' },
          targets: [{ componentInstanceId: 'shelf-01', role: 'inside-face' }],
        },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(orphaned))).toContain('RELATIONSHIP_ORPHANED');

    const noTargets = request({
      relationships: [
        {
          relationshipId: 'rel-1',
          kind: 'shelf-support',
          source: { componentInstanceId: 'shelf-01', role: 'shelf-edge' },
          targets: [],
        },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(noTargets))).toContain('RELATIONSHIP_INVALID');
  });

  test('hardware placements: host, face, offsets and removed v1 fields', () => {
    const invalid = request({
      components: [{ componentInstanceId: 'door-01', componentDefinitionId: 'mod-comp-door' }],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'hp-1',
          catalogHardwareId: 'hw-ghost',
          hostComponentInstanceId: 'door-ghost',
          anchorFace: 'diagonal',
          offsetMm: [Number.POSITIVE_INFINITY, 0],
          rotationDeg: 17,
          handedness: 'left',
        } as never,
      ],
    });
    const issueCodes = codes(validateAuthoringResolveRequest(invalid));
    // Catalog membership (HARDWARE_REFERENCE_INVALID) is decided
    // server-side; the client validator catches shape/reference problems.
    for (const expected of ['HARDWARE_HOST_INVALID', 'HARDWARE_PLACEMENT_INVALID']) {
      expect(issueCodes).toContain(expected);
    }
    // rotationDeg/handedness are NOT part of resolve v1: sending them (even
    // with valid values) is an apparent-capability error.
    expect(issueCodes.filter((code) => code === 'HARDWARE_PLACEMENT_INVALID').length).toBeGreaterThanOrEqual(3);

    const valid = request({
      components: [{ componentInstanceId: 'door-01', componentDefinitionId: 'mod-comp-door' }],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'hp-1',
          catalogHardwareId: 'hw-hinge',
          hostComponentInstanceId: 'door-01',
          anchorFace: 'front',
          offsetMm: [298, 100],
        },
      ],
    });
    expect(validateAuthoringResolveRequest(valid)).toEqual([]);
  });

  test('missing furniture definition is a catalog reference error', () => {
    const missing = request({ furnitureDefinitionId: '' } as never);
    expect(codes(validateAuthoringResolveRequest(missing))).toEqual(['CATALOG_REFERENCE_MISSING']);
  });

  test('issue codes are a closed stable set', () => {
    for (const code of AUTHORING_RESOLVE_ISSUE_CODES) {
      expect(isAuthoringResolveIssueCode(code)).toBe(true);
    }
    expect(isAuthoringResolveIssueCode('SHELF2Z_UNSUPPORTED')).toBe(false);
    expect(AUTHORING_RESOLVE_ISSUE_CODES).toContain('QUERY_PARAMETERS_UNSUPPORTED');
  });
});
