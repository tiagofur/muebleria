/**
 * Structural and semantic validation of an AuthoringEnvelopeV1 against the
 * manufacturing contract. Validation never throws: it reports ContractIssue
 * entries so Ruby/UI can present them; it never reimplements resolution.
 *
 * Every error issue carries code, message, severity, remediation and a stable
 * location (entityId and/or path) so it can route back to SketchUp context
 * (#347 acceptance).
 */

import {
  SKETCHUP_AUTHORING_SCHEMA_ID,
  SKETCHUP_AUTHORING_SCHEMA_NAME,
  SKETCHUP_AUTHORING_SCHEMA_VERSION,
  type AuthoringEnvelopeV1,
  type ContractIssue,
  type DesignAssembly,
  type PartRelationshipIntent,
} from './sketchupAuthoringSchema';

/** Known catalog surface the envelope is validated against. */
export type AuthoringCatalogIndex = {
  readonly items: Readonly<Record<string, string>>;
  readonly hardware: Readonly<Record<string, true>>;
  readonly joinerySystems: Readonly<Record<string, true>>;
};

const QUATERNION_TOLERANCE = 1e-6;

export function validateAuthoringEnvelope(
  envelope: AuthoringEnvelopeV1,
  catalog: AuthoringCatalogIndex,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [
    ...validateSchemaIdentity(envelope),
    ...validateTransportFields(envelope),
    ...validateAssemblies(envelope, catalog),
    ...validateCrossReferences(envelope),
    ...validateTombstones(envelope),
  ];
  return issues;
}

export function hasErrors(issues: readonly ContractIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

function validateSchemaIdentity(envelope: AuthoringEnvelopeV1): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const { schemaId, schemaName, schemaVersion } = envelope;

  if (schemaName !== SKETCHUP_AUTHORING_SCHEMA_NAME) {
    issues.push(
      issue('SCHEMA_VERSION_UNSUPPORTED', `Unknown schemaName: ${schemaName}`, 'error', {
        entityId: envelope.projectId,
        path: 'schemaName',
        remediation: `Send ${SKETCHUP_AUTHORING_SCHEMA_NAME}.`,
      }),
    );
    return issues;
  }
  if (schemaVersion !== SKETCHUP_AUTHORING_SCHEMA_VERSION) {
    issues.push(
      issue(
        'SCHEMA_VERSION_UNSUPPORTED',
        `Unknown schemaVersion ${schemaVersion} for ${schemaName}`,
        'error',
        {
          entityId: envelope.projectId,
          path: 'schemaVersion',
          remediation: `Only ${SKETCHUP_AUTHORING_SCHEMA_VERSION} is supported.`,
        },
      ),
    );
    return issues;
  }
  if (schemaId !== SKETCHUP_AUTHORING_SCHEMA_ID) {
    issues.push(
      issue('SCHEMA_ID_MISMATCH', `schemaId must be ${SKETCHUP_AUTHORING_SCHEMA_ID}`, 'error', {
        entityId: envelope.projectId,
        path: 'schemaId',
        remediation: `Send the exact schemaId ${SKETCHUP_AUTHORING_SCHEMA_ID}.`,
        details: { actual: schemaId },
      }),
    );
  }
  return issues;
}

function validateTransportFields(envelope: AuthoringEnvelopeV1): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];

  for (const field of ['messageId', 'idempotencyKey', 'projectId', 'sourceRevisionId'] as const) {
    if (!nonEmptyString(envelope[field])) {
      issues.push(
        issue('SCHEMA_ID_MISMATCH', `${field} must be a non-empty string`, 'error', {
          entityId: envelope.projectId,
          path: field,
          remediation: `Fill ${field} with a stable non-empty identifier before sending.`,
        }),
      );
    }
  }
  if (Number.isNaN(Date.parse(envelope.sentAt))) {
    issues.push(
      issue('SCHEMA_ID_MISMATCH', 'sentAt must be an ISO-8601 timestamp', 'error', {
        entityId: envelope.projectId,
        path: 'sentAt',
        remediation: 'Send sentAt as an ISO-8601 UTC timestamp.',
      }),
    );
  }
  if (envelope.mutationMode !== 'full-snapshot-with-tombstones') {
    issues.push(
      issue(
        'SCHEMA_VERSION_UNSUPPORTED',
        `mutationMode ${String(envelope.mutationMode)} is not supported in v1`,
        'error',
        {
          entityId: envelope.projectId,
          path: 'mutationMode',
          remediation: 'Send mutationMode full-snapshot-with-tombstones.',
        },
      ),
    );
  }
  if (envelope.units?.length !== 'mm' || envelope.units?.angle !== 'deg') {
    issues.push(
      issue('TRANSFORM_INVALID', 'units must be length mm and angle deg', 'error', {
        entityId: envelope.projectId,
        path: 'units',
        remediation: 'Convert to millimeters and degrees before transport.',
      }),
    );
  } else if (
    !Number.isFinite(envelope.units.precisionMm) ||
    envelope.units.precisionMm <= 0
  ) {
    issues.push(
      issue('TRANSFORM_INVALID', 'precisionMm must be a positive number', 'error', {
        entityId: envelope.projectId,
        path: 'units.precisionMm',
        remediation: 'Declare a positive transport precision in millimeters (e.g. 0.01).',
      }),
    );
  }
  if (envelope.coordinateSystem?.handedness !== 'right' || envelope.coordinateSystem?.upAxis !== 'z') {
    issues.push(
      issue('TRANSFORM_INVALID', 'coordinateSystem must be right-handed with z up', 'error', {
        entityId: envelope.projectId,
        path: 'coordinateSystem',
        remediation: 'Normalize the frame to right-handed with z up before transport.',
      }),
    );
  } else if (!nonEmptyString(envelope.coordinateSystem.projectFrameId)) {
    issues.push(
      issue('TRANSFORM_INVALID', 'projectFrameId must be non-empty', 'error', {
        entityId: envelope.projectId,
        path: 'coordinateSystem.projectFrameId',
        remediation: 'Declare the project frame identifier the transforms refer to.',
      }),
    );
  }
  return issues;
}

function validateAssemblies(
  envelope: AuthoringEnvelopeV1,
  catalog: AuthoringCatalogIndex,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];

  for (const assembly of envelope.assemblies) {
    const path = `assemblies[assemblyId=${assembly.assemblyId}]`;
    const knownRevision = catalog.items[assembly.catalogItemId];
    if (knownRevision === undefined) {
      issues.push(
        issue('CATALOG_REFERENCE_MISSING', `Unknown catalogItemId ${assembly.catalogItemId}`, 'error', {
          entityId: assembly.assemblyId,
          path,
          remediation: 'Publish the catalog item before referencing it.',
        }),
      );
    } else if (knownRevision !== assembly.catalogRevision) {
      issues.push(
        issue(
          'CATALOG_REVISION_STALE',
          `catalogItemId ${assembly.catalogItemId} is at revision ${knownRevision}, envelope sends ${assembly.catalogRevision}`,
          'error',
          {
            entityId: assembly.assemblyId,
            path,
            remediation: `Re-insert the item from the current catalog (revision ${knownRevision}) to refresh authoring references.`,
          },
        ),
      );
    }
    issues.push(...validateTransform(assembly.transform, path, assembly.assemblyId));

    for (const component of assembly.components ?? []) {
      const componentPath = `${path}.components[componentInstanceId=${component.componentInstanceId}]`;
      if (!nonEmptyString(component.componentDefinitionId) || !nonEmptyString(component.role)) {
        issues.push(
          issue('RELATIONSHIP_INVALID', 'components need definition id and role', 'error', {
            entityId: component.componentInstanceId,
            path: componentPath,
            remediation: 'Every component instance needs a catalog definition id and a semantic role.',
          }),
        );
      }
      issues.push(...validateTransform(component.transform, componentPath, component.componentInstanceId));
    }

    for (const relationship of assembly.relationships ?? []) {
      issues.push(...validateRelationship(relationship, path, catalog));
    }

    for (const placement of assembly.hardwarePlacements ?? []) {
      const hardwarePath = `${path}.hardwarePlacements[hardwarePlacementId=${placement.hardwarePlacementId}]`;
      if (catalog.hardware[placement.catalogHardwareId] !== true) {
        issues.push(
          issue(
            'CATALOG_REFERENCE_MISSING',
            `Unknown catalogHardwareId ${placement.catalogHardwareId}`,
            'error',
            {
              entityId: placement.hardwarePlacementId,
              path: hardwarePath,
              remediation: 'Choose a hardware item that exists in the active catalog.',
            },
          ),
        );
      }
      if (!nonEmptyString(placement.hostComponentInstanceId) || !nonEmptyString(placement.anchorFace)) {
        issues.push(
          issue('HARDWARE_HOST_INVALID', 'hardware placements need host and anchor face', 'error', {
            entityId: placement.hardwarePlacementId,
            path: hardwarePath,
            remediation: 'Anchor the placement to a host component instance and a board-local face.',
          }),
        );
      }
    }
  }
  return issues;
}

function validateRelationship(
  relationship: PartRelationshipIntent,
  assemblyPath: string,
  catalog: AuthoringCatalogIndex,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const path = `${assemblyPath}.relationships[relationshipId=${relationship.relationshipId}]`;

  if (relationship.targets.length === 0) {
    issues.push(
      issue('RELATIONSHIP_INVALID', 'relationships need at least one target anchor', 'error', {
        entityId: relationship.relationshipId,
        path,
        remediation: 'Add at least one target anchor to the relationship.',
      }),
    );
  }
  if (relationship.joinerySystemId !== undefined && catalog.joinerySystems[relationship.joinerySystemId] !== true) {
    issues.push(
      issue(
        'JOINERY_SYSTEM_UNSUPPORTED',
        `Unknown joinerySystemId ${relationship.joinerySystemId}`,
        'error',
        {
          entityId: relationship.relationshipId,
          path,
          remediation: 'Request a joinery system that exists in the active catalog.',
        },
      ),
    );
  }
  for (const anchor of [relationship.source, ...relationship.targets]) {
    if (!nonEmptyString(anchor.componentInstanceId) || !nonEmptyString(anchor.role)) {
      issues.push(
        issue('RELATIONSHIP_INVALID', 'anchors need componentInstanceId and role', 'error', {
          entityId: relationship.relationshipId,
          path,
          remediation: 'Every anchor needs a componentInstanceId and a semantic role.',
        }),
      );
    }
  }
  return issues;
}

function validateTransform(
  transform: DesignAssembly['transform'],
  path: string,
  entityId: string,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (transform === undefined || transform === null) {
    return [
      issue('TRANSFORM_INVALID', 'transform is required', 'error', {
        entityId,
        path,
        remediation: 'Attach a project-frame transform to the entity.',
      }),
    ];
  }
  const [sx, sy, sz] = transform.scale;
  if (sx <= 0 || sy <= 0 || sz <= 0) {
    issues.push(
      issue('TRANSFORM_INVALID', 'negative or zero scale must be normalized before transport', 'error', {
        entityId,
        path,
        remediation: 'Bake the mirroring into geometry or regenerate the instance; scale must be positive.',
        details: { scale: transform.scale },
      }),
    );
  }
  if (Math.abs(sx - sy) > QUATERNION_TOLERANCE || Math.abs(sy - sz) > QUATERNION_TOLERANCE) {
    issues.push(
      issue('TRANSFORM_INVALID', 'non-uniform scale is an explicit v1 transport error', 'error', {
        entityId,
        path,
        remediation: 'Resize via parameters so the resolver regenerates exact panel dimensions.',
        details: { scale: transform.scale },
      }),
    );
  }
  const norm = transform.rotationQuaternion.reduce((acc, q) => acc + q * q, 0);
  if (Math.abs(norm - 1) > QUATERNION_TOLERANCE) {
    issues.push(
      issue('TRANSFORM_INVALID', 'rotationQuaternion must be normalized', 'error', {
        entityId,
        path,
        remediation: 'Normalize the quaternion before transport.',
        details: { norm },
      }),
    );
  }
  if (!transform.translationMm.every((mm) => Number.isFinite(mm))) {
    issues.push(
      issue('TRANSFORM_INVALID', 'translationMm must be finite millimeters', 'error', {
        entityId,
        path,
        remediation: 'Send finite millimeter offsets in the declared frame.',
      }),
    );
  }
  return issues;
}

function validateCrossReferences(envelope: AuthoringEnvelopeV1): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const seen = new Map<string, string>();

  const track = (id: string, kind: string, path: string): void => {
    if (!nonEmptyString(id)) return;
    const previous = seen.get(`${kind}:${id}`);
    if (previous !== undefined) {
      issues.push(
        issue('STABLE_ID_DUPLICATE', `${kind} ${id} appears more than once`, 'error', {
          entityId: id,
          path,
          remediation: 'Stable IDs are unique per kind; assign a fresh ID to the new entity.',
          details: { firstPath: previous },
        }),
      );
    } else {
      seen.set(`${kind}:${id}`, path);
    }
  };

  const instanceIds = new Set<string>();

  for (const assembly of envelope.assemblies) {
    const path = `assemblies[assemblyId=${assembly.assemblyId}]`;
    track(assembly.assemblyId, 'assembly', path);
    for (const component of assembly.components ?? []) {
      const componentPath = `${path}.components[componentInstanceId=${component.componentInstanceId}]`;
      track(component.componentInstanceId, 'componentInstance', componentPath);
      instanceIds.add(component.componentInstanceId);
    }
  }
  for (const assembly of envelope.assemblies) {
    const path = `assemblies[assemblyId=${assembly.assemblyId}]`;
    for (const relationship of assembly.relationships ?? []) {
      const relPath = `${path}.relationships[relationshipId=${relationship.relationshipId}]`;
      track(relationship.relationshipId, 'relationship', relPath);
      for (const anchor of [relationship.source, ...relationship.targets]) {
        if (nonEmptyString(anchor.componentInstanceId) && !instanceIds.has(anchor.componentInstanceId)) {
          issues.push(
            issue(
              'RELATIONSHIP_ORPHANED',
              `anchor references unknown componentInstanceId ${anchor.componentInstanceId}`,
              'error',
              {
                entityId: relationship.relationshipId,
                path: relPath,
                remediation: 'Anchor the relationship to a component instance that exists in the snapshot.',
              },
            ),
          );
        }
      }
    }
    for (const placement of assembly.hardwarePlacements ?? []) {
      const hardwarePath = `${path}.hardwarePlacements[hardwarePlacementId=${placement.hardwarePlacementId}]`;
      track(placement.hardwarePlacementId, 'hardwarePlacement', hardwarePath);
      if (
        nonEmptyString(placement.hostComponentInstanceId) &&
        !instanceIds.has(placement.hostComponentInstanceId)
      ) {
        issues.push(
          issue(
            'HARDWARE_HOST_INVALID',
            `host references unknown componentInstanceId ${placement.hostComponentInstanceId}`,
            'error',
            {
              entityId: placement.hardwarePlacementId,
              path: hardwarePath,
              remediation: 'Host the placement on a component instance that exists in the snapshot.',
            },
          ),
        );
      }
    }
  }
  return issues;
}

function validateTombstones(envelope: AuthoringEnvelopeV1): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const seen = new Set<string>();

  for (const tombstone of envelope.tombstones) {
    const key = `${tombstone.entityType}:${tombstone.entityId}`;
    const path = `tombstones[entityType=${tombstone.entityType},entityId=${tombstone.entityId}]`;
    if (seen.has(key)) {
      issues.push(
        issue('ENTITY_TOMBSTONE_INVALID', `duplicate tombstone for ${key}`, 'error', {
          entityId: tombstone.entityId,
          path,
          remediation: 'Send each tombstone exactly once per snapshot.',
        }),
      );
    }
    seen.add(key);
    if (!nonEmptyString(tombstone.entityId) || Number.isNaN(Date.parse(tombstone.deletedAt))) {
      issues.push(
        issue('ENTITY_TOMBSTONE_INVALID', 'tombstones need entityId and deletedAt', 'error', {
          entityId: tombstone.entityId,
          path,
          remediation: 'Every tombstone needs a stable entityId and an ISO-8601 deletedAt.',
        }),
      );
    }
  }
  return issues;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function issue(
  code: string,
  message: string,
  severity: ContractIssue['severity'],
  extra: {
    entityId?: string;
    path?: string;
    remediation?: string;
    details?: Readonly<Record<string, unknown>>;
  },
): ContractIssue {
  return { code, message, severity, ...extra };
}
