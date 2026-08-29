/**
 * Versioned rich authoring resolve contract v1 (#477): the stateless
 * transport/resolve boundary SketchUp uses to submit semantic furniture
 * authoring intent beyond widthMm/heightMm/depthMm + material choices.
 *
 * It reuses the #346 authoring envelope semantics (schema identity triple,
 * messageId/idempotency correlation, units/coordinate-frame contract,
 * PartRelationshipIntent, HardwarePlacementIntent, ContractIssue) instead of
 * inventing a parallel SketchUp-only model. The Go resolver
 * (backend-go internal/domain/engine) is the wire authority; TS/Ruby consume
 * the shared fixture at contracts/sketchupAuthoringResolve.contract.json for
 * parity. When #384 connected mode exists this same semantic contract plugs
 * in behind the Design working-copy command — it is not replaced.
 *
 * Boundary rules (issue #477):
 * - stateless: identical requests resolve to identical responses and never
 *   create Project/FurnitureInstance business records (nothing is persisted
 *   before Gate A / #384);
 * - client occurrence IDs are authoring-scoped identity inside the resolve;
 *   the server never promotes them to business identity;
 * - the server resolves geometry, machining and fingerprints; Ruby never
 *   becomes the authority for joints or drilling.
 */

import type {
  AuthoringSource,
  ContractIssue,
  CoordinateSystem,
  DerivedHardwarePlacement,
  HardwarePlacementIntent,
  ParameterValue,
  PartRelationshipIntent,
  StableEntityId,
  UnitSystem,
} from './sketchupAuthoringSchema';

export const SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME = 'granete.sketchup-authoring-resolve' as const;
export const SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION = '1.0' as const;
export const SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID =
  `${SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME}.v1` as const;

/** Capability marker echoed by every response (#477: version/schema mismatch fails before host mutation). */
export const SKETCHUP_AUTHORING_RESOLVE_CONTRACT = SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID;

/** Link/contract marker for the full manufacturing preflight model (#347). */
export const MANUFACTURING_PREFLIGHT_CONTRACT = 'granete.manufacturing-preflight.v1' as const;

/**
 * Stable error/issue codes. Clients branch on these, never on localized
 * message substrings.
 */
export const AUTHORING_RESOLVE_ISSUE_CODES = [
  'SCHEMA_ID_MISMATCH',
  'SCHEMA_VERSION_UNSUPPORTED',
  'REQUEST_INVALID',
  'PAYLOAD_TOO_LARGE',
  'QUERY_PARAMETERS_UNSUPPORTED',
  'CATALOG_REFERENCE_MISSING',
  'CATALOG_REVISION_STALE',
  'CATALOG_DEFINITION_INACTIVE',
  'PARAMETER_INVALID',
  'MATERIAL_CHOICE_INVALID',
  'RESOLVE_GEOMETRY_INVALID',
  'OCCURRENCE_UNKNOWN_TEMPLATE',
  'OCCURRENCE_DUPLICATE_ID',
  'OCCURRENCE_COUNT_UNSUPPORTED',
  'SNAPSHOT_INCOMPLETE',
  'TRANSFORM_INVALID',
  'RELATIONSHIP_INVALID',
  'RELATIONSHIP_ORPHANED',
  'JOINERY_SYSTEM_UNSUPPORTED',
  'HARDWARE_HOST_INVALID',
  'HARDWARE_REFERENCE_INVALID',
  'HARDWARE_PLACEMENT_INVALID',
  'DRILLING_CONFLICT',
] as const;

export type AuthoringResolveIssueCode = (typeof AUTHORING_RESOLVE_ISSUE_CODES)[number];

/**
 * One concrete component occurrence in the authoring snapshot. Identity is
 * the client-stable componentInstanceId (#346): two shelves may share a
 * componentDefinitionId while keeping independent occurrence identity.
 *
 * The optional transform carries AUTHORING intent only — v1 supports a
 * translation in the assembly (furniture) frame. An absent transform means
 * "use the server-resolved default pose for this occurrence", so un-authored
 * geometry always re-resolves (a material change moves dependent poses
 * server-side; the client never echoes stale poses).
 */
export type AuthoringComponentOccurrenceV1 = {
  readonly componentInstanceId: StableEntityId;
  readonly componentDefinitionId?: StableEntityId;
  readonly catalogComponentId?: string;
  readonly role?: string;
  readonly transform?: AuthoringOccurrenceTransformV1;
};

export type AuthoringOccurrenceTransformV1 = {
  readonly frame: 'assembly';
  readonly translationMm: readonly [number, number, number];
};

/**
 * The furniture authoring snapshot to resolve. `components` absent = the
 * definition's default occurrence set (parity with the GET layout endpoint);
 * present = the complete authored occurrence set (add/remove/move).
 * `hardwarePlacements` absent = the definition's default manual placements;
 * present (even empty) = the complete manual placement set the user authored.
 */
export type AuthoringFurnitureIntentV1 = {
  readonly furnitureDefinitionId: string;
  readonly catalogRevision?: string;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
  readonly materialChoices?: Readonly<Record<string, string>>;
  readonly components?: readonly AuthoringComponentOccurrenceV1[];
  readonly relationships?: readonly PartRelationshipIntent[];
  readonly hardwarePlacements?: readonly HardwarePlacementIntent[];
};

export type AuthoringResolveRequestV1 = {
  readonly schemaId: string;
  readonly schemaName: string;
  readonly schemaVersion: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly sentAt: string;
  readonly source: AuthoringSource;
  readonly units: UnitSystem;
  readonly coordinateSystem: CoordinateSystem;
  readonly furniture: AuthoringFurnitureIntentV1;
};

/** Structural view of the #415 layout wire shape TS consumers rely on. */
export type ResolvedLayoutWireV1 = {
  readonly furnitureDefinitionId: string;
  readonly definitionName: string;
  readonly transformContract: string;
  readonly dimensionsMm: readonly [number, number, number];
  readonly components: readonly {
    readonly componentInstanceId: string;
    readonly componentDefinitionId: string;
    readonly slotId: string;
    readonly role?: string;
    readonly transform: { readonly translationMm: readonly [number, number, number] };
  }[];
  readonly hardware: readonly {
    readonly placementId: string;
    readonly hardwareId: string;
    readonly hostComponentInstanceId: string;
    readonly anchorFace: string;
    readonly placementKind: string;
  }[];
};

/** Board-local machining detail the host piece drills (parity with TS #356 holes). */
export type ResolveHoleV1 = {
  readonly face: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly type: string;
};

export type ResolvedMachiningOperationV1 = {
  readonly operationId: string;
  readonly hostComponentInstanceId: string;
  readonly provenance:
    | { readonly sourceKind: 'relationship'; readonly relationshipId: string; readonly catalogRuleId?: string }
    | { readonly sourceKind: 'manualHardwarePlacement'; readonly hardwarePlacementId: string };
  readonly holes: readonly ResolveHoleV1[];
};

export type ResolvedMachiningV1 = {
  readonly operations: readonly ResolvedMachiningOperationV1[];
  readonly derivedHardwarePlacements: readonly DerivedHardwarePlacement[];
  readonly bomFingerprint: string;
};

export type ResolvedPreflightV1 = {
  readonly status: 'ready' | 'warning' | 'blocked';
  readonly issues: readonly ContractIssue[];
  readonly preflightContract: typeof MANUFACTURING_PREFLIGHT_CONTRACT;
};

/**
 * Server-normalized accepted intent: the stateless mutation receipt. Clients
 * echo this back as the base of the next snapshot; resolved data (layout,
 * machining) never re-enters it.
 */
export type NormalizedAuthoringIntentV1 = {
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly materialChoices: Readonly<Record<string, string>>;
  readonly components: readonly (AuthoringComponentOccurrenceV1 & {
    readonly componentDefinitionId: string;
    readonly catalogComponentId: string;
    readonly role: string;
    readonly transform?: { readonly frame: 'assembly'; readonly translationMm: readonly [number, number, number] };
  })[];
  readonly relationships: readonly PartRelationshipIntent[];
  readonly hardwarePlacements: readonly HardwarePlacementIntent[];
};

export type AuthoringResolveResponseV1 = {
  readonly schemaId: typeof SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID;
  readonly schemaName: typeof SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME;
  readonly schemaVersion: typeof SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION;
  readonly resolveContract: typeof SKETCHUP_AUTHORING_RESOLVE_CONTRACT;
  readonly responseMessageId: string;
  readonly inReplyToMessageId: string;
  readonly idempotencyKey: string;
  readonly status: 'accepted' | 'rejected';
  readonly normalizedSnapshot?: NormalizedAuthoringIntentV1;
  readonly resolved?: {
    readonly layout: ResolvedLayoutWireV1;
    readonly machining: ResolvedMachiningV1;
    readonly preflight: ResolvedPreflightV1;
  };
  readonly issues: readonly ContractIssue[];
};

const ISSUE_CODE_SET: ReadonlySet<string> = new Set(AUTHORING_RESOLVE_ISSUE_CODES);

export function isAuthoringResolveIssueCode(code: string): code is AuthoringResolveIssueCode {
  return ISSUE_CODE_SET.has(code);
}

/**
 * Client-side structural validation of a resolve request. Mirrors the Go
 * gateway's fail-closed checks (schema identity, correlation, units/frame,
 * occurrence/relationship/hardware reference shape) so callers get stable
 * issue codes before spending a round-trip. Catalog-existence checks stay
 * server-side: this never decides manufacturability or catalog membership.
 */
export function validateAuthoringResolveRequest(request: AuthoringResolveRequestV1): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const push = (code: AuthoringResolveIssueCode, message: string, path?: string, remediation?: string) =>
    issues.push({ code, message, severity: 'error', path, remediation });

  if (request.schemaName !== SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME ||
    request.schemaId !== SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID) {
    push('SCHEMA_ID_MISMATCH', `schema identity must be ${SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID}`, 'schemaId');
    return issues;
  }
  if (request.schemaVersion !== SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION) {
    push(
      'SCHEMA_VERSION_UNSUPPORTED',
      `schemaVersion ${request.schemaVersion} is not supported by this contract`,
      'schemaVersion',
      'Update the extension or target a supported resolve schema version.',
    );
    return issues;
  }

  if (!isNonEmptyString(request.messageId)) push('REQUEST_INVALID', 'messageId is required', 'messageId');
  if (!isNonEmptyString(request.idempotencyKey)) push('REQUEST_INVALID', 'idempotencyKey is required', 'idempotencyKey');
  if (!isNonEmptyString(request.sentAt)) push('REQUEST_INVALID', 'sentAt is required', 'sentAt');
  if (request.source?.client === undefined || !isNonEmptyString(request.source.client) ||
    request.source.host === undefined || !isNonEmptyString(request.source.host)) {
    push('REQUEST_INVALID', 'source client/host are required', 'source');
  }

  const units = request.units;
  if (units?.length !== 'mm' || units?.angle !== 'deg' ||
    typeof units?.precisionMm !== 'number' || !Number.isFinite(units.precisionMm) ||
    units.precisionMm <= 0 || units.precisionMm > 1) {
    push('REQUEST_INVALID', 'units must be { length: mm, angle: deg, precisionMm in (0,1] }', 'units');
  }
  const frame = request.coordinateSystem;
  if (frame?.handedness !== 'right' || frame?.upAxis !== 'z' || !isNonEmptyString(frame?.projectFrameId)) {
    push('REQUEST_INVALID', 'coordinateSystem must be { handedness: right, upAxis: z, projectFrameId }', 'coordinateSystem');
  }

  const furniture = request.furniture;
  if (!furniture || !isNonEmptyString(furniture.furnitureDefinitionId)) {
    push('CATALOG_REFERENCE_MISSING', 'furniture.furnitureDefinitionId is required', 'furniture.furnitureDefinitionId');
    return issues;
  }

  const parameters = furniture.parameters ?? {};
  for (const key of Object.keys(parameters)) {
    if (key !== 'widthMm' && key !== 'heightMm' && key !== 'depthMm') {
      push('PARAMETER_INVALID', `unknown furniture parameter ${key}`, `furniture.parameters.${key}`,
        'v1 resolves widthMm/heightMm/depthMm only.');
    } else if (!Number.isInteger(parameters[key]) || (parameters[key] as number) <= 0) {
      push('PARAMETER_INVALID', `${key} must be a positive integer of millimeters`, `furniture.parameters.${key}`);
    }
  }

  const seenInstanceIds = new Set<string>();
  const components = furniture.components ?? [];
  for (const [index, occurrence] of components.entries()) {
    const path = `furniture.components[${index}]`;
    if (!isNonEmptyString(occurrence?.componentInstanceId)) {
      push('REQUEST_INVALID', 'componentInstanceId is required', `${path}.componentInstanceId`);
      continue;
    }
    if (seenInstanceIds.has(occurrence.componentInstanceId)) {
      push('OCCURRENCE_DUPLICATE_ID',
        `componentInstanceId ${occurrence.componentInstanceId} appears more than once`,
        `${path}.componentInstanceId`);
    }
    seenInstanceIds.add(occurrence.componentInstanceId);
    const transform = occurrence.transform;
    if (transform !== undefined) {
      if (transform?.frame !== 'assembly') {
        push('TRANSFORM_INVALID', 'occurrence transform frame must be assembly', `${path}.transform.frame`);
      }
      const t = transform?.translationMm;
      if (!Array.isArray(t) || t.length !== 3 || t.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        push('TRANSFORM_INVALID', 'translationMm must be three finite millimeters', `${path}.transform.translationMm`);
      }
    }
  }

  for (const [index, relationship] of (furniture.relationships ?? []).entries()) {
    const path = `furniture.relationships[${index}]`;
    if (!isNonEmptyString(relationship?.relationshipId)) {
      push('REQUEST_INVALID', 'relationshipId is required', `${path}.relationshipId`);
      continue;
    }
    if (!isNonEmptyString(relationship.kind)) {
      push('RELATIONSHIP_INVALID', `relationship ${relationship.relationshipId} has no kind`, `${path}.kind`);
    }
    if (!isNonEmptyString(relationship.source?.componentInstanceId)) {
      push('RELATIONSHIP_INVALID', `relationship ${relationship.relationshipId} has no source anchor`, `${path}.source`);
    }
    if (!Array.isArray(relationship.targets) || relationship.targets.length === 0) {
      push('RELATIONSHIP_INVALID', `relationship ${relationship.relationshipId} has no targets`, `${path}.targets`);
    }
    const anchors = [relationship.source, ...(relationship.targets ?? [])];
    for (const anchor of anchors) {
      if (anchor?.componentInstanceId !== undefined &&
        !seenInstanceIds.has(anchor.componentInstanceId) &&
        components.length > 0) {
        push('RELATIONSHIP_ORPHANED',
          `anchor references componentInstanceId ${anchor.componentInstanceId} that is not part of the snapshot`,
          path, 'Anchor the relationship to an occurrence present in the snapshot.');
      }
    }
  }

  for (const [index, placement] of (furniture.hardwarePlacements ?? []).entries()) {
    const path = `furniture.hardwarePlacements[${index}]`;
    if (!isNonEmptyString(placement?.hardwarePlacementId)) {
      push('REQUEST_INVALID', 'hardwarePlacementId is required', `${path}.hardwarePlacementId`);
      continue;
    }
    if (!isNonEmptyString(placement.catalogHardwareId)) {
      push('HARDWARE_REFERENCE_INVALID', `placement ${placement.hardwarePlacementId} has no catalogHardwareId`,
        `${path}.catalogHardwareId`);
    }
    if (!isNonEmptyString(placement.hostComponentInstanceId)) {
      push('HARDWARE_HOST_INVALID', `placement ${placement.hardwarePlacementId} has no host component instance`,
        `${path}.hostComponentInstanceId`);
    } else if (components.length > 0 && !seenInstanceIds.has(placement.hostComponentInstanceId)) {
      push('HARDWARE_HOST_INVALID',
        `placement ${placement.hardwarePlacementId} hosts on ${placement.hostComponentInstanceId} which is not part of the snapshot`,
        `${path}.hostComponentInstanceId`);
    }
    if (!HARDWARE_ANCHOR_FACES.has(placement.anchorFace)) {
      push('HARDWARE_PLACEMENT_INVALID', `placement ${placement.hardwarePlacementId} has unknown anchorFace`,
        `${path}.anchorFace`);
    }
    const offset = placement.offsetMm;
    if (!Array.isArray(offset) || offset.length !== 2 ||
      offset.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      push('HARDWARE_PLACEMENT_INVALID', `placement ${placement.hardwarePlacementId} offsetMm must be two finite millimeters`,
        `${path}.offsetMm`);
    }
    if (placement.rotationDeg !== undefined &&
      (typeof placement.rotationDeg !== 'number' || !Number.isFinite(placement.rotationDeg) ||
        placement.rotationDeg % 360 !== 0)) {
      push('HARDWARE_PLACEMENT_INVALID',
        `placement ${placement.hardwarePlacementId} rotationDeg must be 0 (mod 360) in resolve v1`,
        `${path}.rotationDeg`);
    }
    if (placement.handedness !== undefined && !HARDWARE_HANDEDNESS.has(placement.handedness)) {
      push('HARDWARE_PLACEMENT_INVALID', `placement ${placement.hardwarePlacementId} has unknown handedness`,
        `${path}.handedness`);
    }
  }

  return issues;
}

const HARDWARE_ANCHOR_FACES = new Set(['front', 'back', 'left', 'right', 'top', 'bottom']);
const HARDWARE_HANDEDNESS = new Set(['left', 'right', 'neutral']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
