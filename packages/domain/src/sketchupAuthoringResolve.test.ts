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

  test('allows definition-driven finite scalar parameters and rejects non-scalars', () => {
    expect(
      validateAuthoringResolveRequest(request({ parameters: { shelfCount: 3, style: 'nórdico', softClose: true, widthMm: 600.5 } })),
    ).toEqual([]);
    expect(
      codes(validateAuthoringResolveRequest(request({ parameters: { nested: { value: 1 } } as never }))),
    ).toEqual(['PARAMETER_INVALID']);
  });

  test('requires componentDefinitionId and scalar relationship parameters', () => {
    const missingDefinition = request({ components: [{ componentInstanceId: 'shelf-01' } as never] });
    expect(codes(validateAuthoringResolveRequest(missingDefinition))).toContain('REQUEST_INVALID');

    const invalidRelationshipParameter = request({
      components: [{ componentInstanceId: 'shelf-01', componentDefinitionId: 'mod-comp-shelf' }],
      relationships: [{
        relationshipId: 'rel-1',
        kind: 'shelf-support',
        source: { componentInstanceId: 'shelf-01', role: 'edge' },
        targets: [{ componentInstanceId: 'shelf-01', role: 'face' }],
        parameters: { positions: [32, 64] } as never,
      }],
    });
    expect(codes(validateAuthoringResolveRequest(invalidRelationshipParameter))).toContain('RELATIONSHIP_INVALID');
  });

  test('validates RFC3339 and rejects unknown envelope fields', () => {
    expect(codes(validateAuthoringResolveRequest({ ...request(), sentAt: '2026-08-30' }))).toContain('REQUEST_INVALID');
    const extra = { ...request(), surprise: true } as AuthoringResolveRequestV1;
    expect(codes(validateAuthoringResolveRequest(extra))).toContain('REQUEST_INVALID');
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

  // #467 final cleanup: transport validation proves SHAPE only — exactly 3
  // finite numbers, NO furniture-range assumption. A coordinate above any
  // plausible furniture size passes to the server, where Go/domain evaluates
  // it against the ACTUAL resolved envelope.
  test('positions of any magnitude pass transport shape validation', () => {
    const large = request({
      components: [
        {
          componentInstanceId: 'shelf-01',
          componentDefinitionId: 'mod-comp-shelf',
          transform: { frame: 'assembly', translationMm: [5000, 5000, 5000] },
        },
      ],
    });
    expect(validateAuthoringResolveRequest(large)).toEqual([]);
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

  test('hardwarePlacementId is opaque: derived status comes only from placementKind, not ID prefix', () => {
    // 1. Derived-looking ID with manual placementKind is accepted
    const manualWithDerivedLookingId = request({
      components: [{ componentInstanceId: 'door-01', componentDefinitionId: 'mod-comp-door' }],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'derived-looking-placement-id-456',
          placementKind: 'manual',
          catalogHardwareId: 'hw-hinge',
          hostComponentInstanceId: 'door-01',
          anchorFace: 'front',
          offsetMm: [298, 100],
        },
      ],
    });
    const manualIssues = validateAuthoringResolveRequest(manualWithDerivedLookingId);
    expect(codes(manualIssues)).not.toContain('HARDWARE_DERIVED_EDIT');

    // 2. Arbitrary random opaque ID with derived placementKind is blocked
    const derivedWithRandomId = request({
      components: [{ componentInstanceId: 'door-01', componentDefinitionId: 'mod-comp-door' }],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'random-opaque-uuid-778899',
          placementKind: 'derived',
          catalogHardwareId: 'hw-hinge',
          hostComponentInstanceId: 'door-01',
          anchorFace: 'front',
          offsetMm: [298, 100],
        },
      ],
    });
    const derivedIssues = validateAuthoringResolveRequest(derivedWithRandomId);
    expect(codes(derivedIssues)).toContain('HARDWARE_DERIVED_EDIT');
  });

  test('data-driven hardware compatibility: CompatibleRoles matched against canonical role only', () => {
    const catalog = [
      {
        id: 'arbitrary-hinge-id-xyz',
        category: 'hinge',
        // No compatibleRoles declared — accepted on any host.
      },
      {
        id: 'drawer-slide-marked-compatible-name',
        category: 'slide',
        // Declares it is only compatible with lateral/drawer roles.
        compatibleRoles: ['LATERAL_IZQUIERDO', 'CAJON'],
      },
    ];

    // Slide on FRENTE host: CompatibleRoles does not include FRENTE → incompatible.
    // The component carries an explicit canonical role, NOT inferred from name or defID.
    const incompatibleRequest = request({
      components: [{ componentInstanceId: 'door-01', componentDefinitionId: 'mod-comp-door', role: 'FRENTE' }],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'hp-test-1',
          placementKind: 'manual',
          catalogHardwareId: 'drawer-slide-marked-compatible-name',
          hostComponentInstanceId: 'door-01',
          anchorFace: 'front',
          offsetMm: [298, 100],
        },
      ],
    });
    const issues1 = validateAuthoringResolveRequest(incompatibleRequest, { hardwareCatalog: catalog });
    expect(codes(issues1)).toContain('HARDWARE_INCOMPATIBLE');

    // Hinge on FRENTE host: no compatibleRoles constraint → compatible.
    const compatibleRequest = request({
      components: [{ componentInstanceId: 'door-01', componentDefinitionId: 'mod-comp-door', role: 'FRENTE' }],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'hp-test-2',
          placementKind: 'manual',
          catalogHardwareId: 'arbitrary-hinge-id-xyz',
          hostComponentInstanceId: 'door-01',
          anchorFace: 'front',
          offsetMm: [298, 100],
        },
      ],
    });
    const issues2 = validateAuthoringResolveRequest(compatibleRequest, { hardwareCatalog: catalog });
    expect(codes(issues2)).not.toContain('HARDWARE_INCOMPATIBLE');
  });

  test('display name does not affect compatibility — only canonical role matters', () => {
    const catalog = [
      { id: 'hw-slide', category: 'slide', compatibleRoles: ['CAJON'] },
    ];
    // Two components: same role 'FRENTE', different display names (one says "Puerta", other "Anything").
    // Both must yield the same compatibility result.
    for (const name of ['Puerta', 'Anything Else']) {
      const req = request({
        components: [{ componentInstanceId: 'c-01', componentDefinitionId: 'def-01', role: 'FRENTE' }],
        hardwarePlacements: [
          { hardwarePlacementId: 'hp-1', placementKind: 'manual', catalogHardwareId: 'hw-slide',
            hostComponentInstanceId: 'c-01', anchorFace: 'front', offsetMm: [100, 100] },
        ],
      });
      const issues = validateAuthoringResolveRequest(req, { hardwareCatalog: catalog });
      // name is unused but illustrates the invariant
      void name;
      expect(codes(issues)).toContain('HARDWARE_INCOMPATIBLE');
    }
  });

  test('componentDefinitionId containing "door" does not grant door-compatibility', () => {
    const catalog = [
      { id: 'hw-slide', category: 'slide', compatibleRoles: ['CAJON'] },
    ];
    // defID looks like a door, but role is 'INTERIOR' — slides are still incompatible.
    const req = request({
      components: [{ componentInstanceId: 'c-01', componentDefinitionId: 'door-looking-def-id', role: 'INTERIOR' }],
      hardwarePlacements: [
        { hardwarePlacementId: 'hp-1', placementKind: 'manual', catalogHardwareId: 'hw-slide',
          hostComponentInstanceId: 'c-01', anchorFace: 'front', offsetMm: [100, 100] },
      ],
    });
    const issues = validateAuthoringResolveRequest(req, { hardwareCatalog: catalog });
    // CAJON ≠ INTERIOR → incompatible regardless of defID
    expect(codes(issues)).toContain('HARDWARE_INCOMPATIBLE');
  });

  test('explicit role: FRENTE hardware accepted on FRENTE host, rejected on LATERAL host', () => {
    const catalog = [
      { id: 'hw-frente-only', compatibleRoles: ['FRENTE'] },
    ];

    const frenteHost = request({
      components: [{ componentInstanceId: 'c-01', componentDefinitionId: 'def-01', role: 'FRENTE' }],
      hardwarePlacements: [
        { hardwarePlacementId: 'hp-1', placementKind: 'manual', catalogHardwareId: 'hw-frente-only',
          hostComponentInstanceId: 'c-01', anchorFace: 'front', offsetMm: [100, 100] },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(frenteHost, { hardwareCatalog: catalog })))
      .not.toContain('HARDWARE_INCOMPATIBLE');

    const lateralHost = request({
      components: [{ componentInstanceId: 'c-01', componentDefinitionId: 'def-01', role: 'LATERAL' }],
      hardwarePlacements: [
        { hardwarePlacementId: 'hp-1', placementKind: 'manual', catalogHardwareId: 'hw-frente-only',
          hostComponentInstanceId: 'c-01', anchorFace: 'front', offsetMm: [100, 100] },
      ],
    });
    expect(codes(validateAuthoringResolveRequest(lateralHost, { hardwareCatalog: catalog })))
      .toContain('HARDWARE_INCOMPATIBLE');
  });
});
