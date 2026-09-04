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

export const AUTHORING_RESOLVE_LIMITS = {
  identifierLength: 256,
  envelopeStringLength: 128,
  idempotencyKeyLength: 128,
  parameterCount: 256,
  materialChoiceCount: 256,
  componentCount: 10_000,
  relationshipCount: 10_000,
  relationshipTargetCount: 256,
  hardwarePlacementCount: 10_000,
  issueCount: 10_000,
} as const;

/**
 * Stable error/issue codes. Clients branch on these, never on localized
 * message substrings.
 */
export const AUTHORING_RESOLVE_ISSUE_CODES = [
  'SCHEMA_ID_MISMATCH',
  'SCHEMA_VERSION_UNSUPPORTED',
  'METHOD_NOT_ALLOWED',
  'AUTHENTICATION_REQUIRED',
  'ACCESS_FORBIDDEN',
  'CONTENT_TYPE_UNSUPPORTED',
  'REQUEST_INVALID',
  'PAYLOAD_TOO_LARGE',
  'QUERY_PARAMETERS_UNSUPPORTED',
  'CATALOG_REFERENCE_MISSING',
  'CATALOG_REVISION_STALE',
  'PARAMETER_INVALID',
  'PARAMETER_UNKNOWN',
  'PARAMETER_REQUIRED',
  'PARAMETER_TYPE_INVALID',
  'PARAMETER_OUT_OF_RANGE',
  'PARAMETER_STEP_INVALID',
  'PARAMETER_ENUM_INVALID',
  'PARAMETER_STRING_TOO_LONG',
  'PARAMETER_DEFINITION_INVALID',
  'PARAMETER_BINDING_CONFLICT',
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
  'HARDWARE_DERIVED_EDIT',
  'HARDWARE_INCOMPATIBLE',
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
  readonly componentDefinitionId: StableEntityId;
  readonly catalogComponentId?: string;
  readonly role?: string;
  readonly transform?: AuthoringOccurrenceTransformV1;
};

export type AuthoringOccurrenceTransformV1 = {
  readonly frame: 'assembly';
  readonly translationMm: readonly [number, number, number];
};

/**
 * The resolve-scoped manual placement intent. v1 carries no
 * rotationDeg/handedness: fields that do not drive resolution are not part
 * of the wire (an apparent capability is worse than an absent one); #468
 * adds them together with their resolution semantics.
 */
export type AuthoringHardwarePlacementV1 = {
  readonly hardwarePlacementId: StableEntityId;
  readonly placementKind?: 'manual' | 'derived';
  readonly catalogHardwareId: string;
  readonly hostComponentInstanceId: StableEntityId;
  readonly anchorFace: string;
  readonly offsetMm: readonly [number, number];
};

/**
 * The furniture authoring snapshot to resolve. `components` absent = the
 * definition's default occurrence set (parity with the GET layout endpoint);
 * present = the complete authored occurrence set (add/remove/move).
 * `hardwarePlacements` absent = the definition's default manual placements;
 * present (even empty) = the complete manual placement set the user authored.
 * `catalogRevision` is REQUIRED: the resolve is only reproducible against a
 * pinned catalog (no implicit latest).
 */
export type AuthoringFurnitureIntentV1 = {
  readonly furnitureDefinitionId: string;
  readonly catalogRevision: string;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
  readonly materialChoices?: Readonly<Record<string, string>>;
  readonly components?: readonly AuthoringComponentOccurrenceV1[];
  readonly relationships?: readonly PartRelationshipIntent[];
  readonly hardwarePlacements?: readonly AuthoringHardwarePlacementV1[];
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
    readonly lengthMm: number;
    readonly widthMm: number;
    readonly thicknessMm: number;
    readonly materialId?: string;
    readonly materialCode?: string;
    readonly materialName?: string;
    readonly materialColorHex?: string;
    readonly materialImageUrl?: string;
    readonly materialTextureUrl?: string;
    readonly materialTextureTileWidthMm?: number;
    readonly materialTextureTileLengthMm?: number;
    readonly materialRoughness?: number;
    readonly materialMetalness?: number;
    readonly materialClearcoat?: number;
    readonly materialGrain?: boolean;
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
  readonly manufacturingFingerprint: string;
};

/**
 * Resolve-scoped validation of the accepted intent. `scope` pins the
 * semantics: this subset NEVER claims the #347 fabrication-readiness
 * verdict — the full preflight is only linked through `preflightContract`.
 */
export type ResolvedPreflightV1 = {
  readonly scope: 'authoring-resolve-subset';
  readonly status: 'clear' | 'blocked';
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
  readonly hardwarePlacements: readonly AuthoringHardwarePlacementV1[];
};

type AuthoringResolveResponseEnvelopeV1 = {
  readonly schemaId: typeof SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID;
  readonly schemaName: typeof SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME;
  readonly schemaVersion: typeof SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION;
  readonly resolveContract: typeof SKETCHUP_AUTHORING_RESOLVE_CONTRACT;
  readonly responseMessageId: string;
  readonly inReplyToMessageId: string;
  readonly idempotencyKey: string;
  readonly catalogRevision: string;
  readonly issues: readonly ContractIssue[];
};

export type AcceptedAuthoringResolveResponseV1 = AuthoringResolveResponseEnvelopeV1 & {
  readonly status: 'accepted';
  readonly normalizedSnapshot: NormalizedAuthoringIntentV1;
  readonly resolved: {
    readonly layout: ResolvedLayoutWireV1;
    readonly machining: ResolvedMachiningV1;
    readonly preflight: ResolvedPreflightV1;
  };
};

export type RejectedAuthoringResolveResponseV1 = AuthoringResolveResponseEnvelopeV1 & {
  readonly status: 'rejected';
  readonly normalizedSnapshot?: never;
  readonly resolved?: never;
};

export type AuthoringResolveResponseV1 =
  | AcceptedAuthoringResolveResponseV1
  | RejectedAuthoringResolveResponseV1;

export type AuthoringResolveResponseCorrelation = {
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly catalogRevision: string;
  readonly furnitureDefinitionId: string;
};

export class AuthoringResolveResponseValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid authoring resolve response: ${problems.join('; ')}`);
    this.name = 'AuthoringResolveResponseValidationError';
    this.problems = problems;
  }
}

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
export type AuthoringResolveValidationContext = {
  readonly hardwareCatalog?: readonly {
    readonly id?: string;
    readonly hardwareId?: string;
    readonly category?: string;
    readonly compatibleRoles?: readonly string[];
  }[];
};

export function validateAuthoringResolveRequest(
  request: AuthoringResolveRequestV1,
  context?: AuthoringResolveValidationContext,
): readonly ContractIssue[] {
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

  rejectUnknownKeys(request, REQUEST_KEYS, '', push);

  if (!isEnvelopeString(request.messageId)) push('REQUEST_INVALID', 'messageId is required and must not exceed 128 characters', 'messageId');
  if (!isNonEmptyString(request.idempotencyKey)) push('REQUEST_INVALID', 'idempotencyKey is required', 'idempotencyKey');
  if (request.idempotencyKey !== undefined && request.idempotencyKey.length > AUTHORING_RESOLVE_LIMITS.idempotencyKeyLength) {
    push('REQUEST_INVALID', 'idempotencyKey cannot exceed 128 characters', 'idempotencyKey');
  }
  if (!isRfc3339(request.sentAt)) push('REQUEST_INVALID', 'sentAt must be an RFC3339 timestamp', 'sentAt');
  if (request.source !== undefined) rejectUnknownKeys(request.source, SOURCE_KEYS, 'source', push);
  if (request.source?.client === undefined || !isEnvelopeString(request.source.client) ||
    request.source.host === undefined || !isEnvelopeString(request.source.host) ||
    request.source.clientVersion === undefined || !isEnvelopeString(request.source.clientVersion) ||
    request.source.hostVersion === undefined || !isEnvelopeString(request.source.hostVersion)) {
    push('REQUEST_INVALID', 'source client/clientVersion/host/hostVersion are required', 'source');
  }

  const units = request.units;
  if (units !== undefined) rejectUnknownKeys(units, UNIT_KEYS, 'units', push);
  if (units?.length !== 'mm' || units?.angle !== 'deg' ||
    typeof units?.precisionMm !== 'number' || !Number.isFinite(units.precisionMm) ||
    units.precisionMm <= 0 || units.precisionMm > 1) {
    push('REQUEST_INVALID', 'units must be { length: mm, angle: deg, precisionMm in (0,1] }', 'units');
  }
  const frame = request.coordinateSystem;
  if (frame !== undefined) rejectUnknownKeys(frame, COORDINATE_KEYS, 'coordinateSystem', push);
  if (frame?.handedness !== 'right' || frame?.upAxis !== 'z' || !isEnvelopeString(frame?.projectFrameId)) {
    push('REQUEST_INVALID', 'coordinateSystem must be { handedness: right, upAxis: z, projectFrameId }', 'coordinateSystem');
  }

  const furniture = request.furniture;
  if (!furniture || !isNonEmptyString(furniture.furnitureDefinitionId)) {
    push('CATALOG_REFERENCE_MISSING', 'furniture.furnitureDefinitionId is required', 'furniture.furnitureDefinitionId');
    return issues;
  }
  rejectUnknownKeys(furniture, FURNITURE_KEYS, 'furniture', push);
  if (!isNonEmptyString(furniture.catalogRevision)) {
    push('REQUEST_INVALID',
      'furniture.catalogRevision is required: the resolve is only reproducible against a pinned catalog',
      'furniture.catalogRevision');
  }
  if (!isEnvelopeString(furniture.furnitureDefinitionId) || !isEnvelopeString(furniture.catalogRevision)) {
    push('REQUEST_INVALID', 'furnitureDefinitionId and catalogRevision cannot exceed 128 characters', 'furniture');
  }

  const parameters = furniture.parameters ?? {};
  if (Object.keys(parameters).length > AUTHORING_RESOLVE_LIMITS.parameterCount) {
    push('REQUEST_INVALID', 'furniture.parameters exceeds 256 entries', 'furniture.parameters');
  }
  for (const key of Object.keys(parameters)) {
    if (!isBoundedString(key) || !isParameterValue(parameters[key])) {
      push('PARAMETER_INVALID', `${key} must carry a finite scalar string, number, or boolean`, `furniture.parameters.${key}`);
    }
  }

  const materialChoices = furniture.materialChoices ?? {};
  if (Object.keys(materialChoices).length > AUTHORING_RESOLVE_LIMITS.materialChoiceCount) {
    push('REQUEST_INVALID', 'furniture.materialChoices exceeds 256 entries', 'furniture.materialChoices');
  }
  for (const [key, value] of Object.entries(materialChoices)) {
    if (!isBoundedString(key) || !isBoundedString(value)) {
      push('MATERIAL_CHOICE_INVALID', 'material choices require bounded non-empty string keys and values', `furniture.materialChoices.${key}`);
    }
  }

  const seenInstanceIds = new Set<string>();
  const components = furniture.components ?? [];
  if (components.length > AUTHORING_RESOLVE_LIMITS.componentCount) {
    push('REQUEST_INVALID', 'furniture.components exceeds 10000 entries', 'furniture.components');
  }
  for (const [index, occurrence] of components.entries()) {
    const path = `furniture.components[${index}]`;
    rejectUnknownKeys(occurrence, COMPONENT_KEYS, path, push);
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
    if (!isBoundedString(occurrence.componentDefinitionId)) {
      push('REQUEST_INVALID', 'componentDefinitionId is required', `${path}.componentDefinitionId`);
    }
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

  const seenRelationshipIds = new Set<string>();
  if ((furniture.relationships?.length ?? 0) > AUTHORING_RESOLVE_LIMITS.relationshipCount) {
    push('REQUEST_INVALID', 'furniture.relationships exceeds 10000 entries', 'furniture.relationships');
  }
  for (const [index, relationship] of (furniture.relationships ?? []).entries()) {
    const path = `furniture.relationships[${index}]`;
    rejectUnknownKeys(relationship, RELATIONSHIP_KEYS, path, push);
    if (!isNonEmptyString(relationship?.relationshipId)) {
      push('REQUEST_INVALID', 'relationshipId is required', `${path}.relationshipId`);
      continue;
    }
    if (seenRelationshipIds.has(relationship.relationshipId)) {
      push('REQUEST_INVALID',
        `relationshipId ${relationship.relationshipId} appears more than once`,
        `${path}.relationshipId`);
    }
    seenRelationshipIds.add(relationship.relationshipId);
    if (!isNonEmptyString(relationship.kind)) {
      push('RELATIONSHIP_INVALID', `relationship ${relationship.relationshipId} has no kind`, `${path}.kind`);
    }
    if (!isNonEmptyString(relationship.source?.componentInstanceId)) {
      push('RELATIONSHIP_INVALID', `relationship ${relationship.relationshipId} has no source anchor`, `${path}.source`);
    }
    if (!Array.isArray(relationship.targets) || relationship.targets.length === 0) {
      push('RELATIONSHIP_INVALID', `relationship ${relationship.relationshipId} has no targets`, `${path}.targets`);
    }
    if ((relationship.targets?.length ?? 0) > AUTHORING_RESOLVE_LIMITS.relationshipTargetCount) {
      push('RELATIONSHIP_INVALID', 'relationship targets exceed 256 entries', `${path}.targets`);
    }
    for (const [key, value] of Object.entries(relationship.parameters ?? {})) {
      if (!isBoundedString(key) || !isParameterValue(value)) {
        push('RELATIONSHIP_INVALID', 'relationship parameters must be finite scalar values', `${path}.parameters.${key}`);
      }
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

  const seenPlacementIds = new Set<string>();
  if ((furniture.hardwarePlacements?.length ?? 0) > AUTHORING_RESOLVE_LIMITS.hardwarePlacementCount) {
    push('REQUEST_INVALID', 'furniture.hardwarePlacements exceeds 10000 entries', 'furniture.hardwarePlacements');
  }
  for (const [index, placement] of (furniture.hardwarePlacements ?? []).entries()) {
    const path = `furniture.hardwarePlacements[${index}]`;
    if (!isNonEmptyString(placement?.hardwarePlacementId)) {
      push('REQUEST_INVALID', 'hardwarePlacementId is required', `${path}.hardwarePlacementId`);
      continue;
    }
    if (seenPlacementIds.has(placement.hardwarePlacementId)) {
      push('REQUEST_INVALID',
        `hardwarePlacementId ${placement.hardwarePlacementId} appears more than once`,
        `${path}.hardwarePlacementId`);
    }
    seenPlacementIds.add(placement.hardwarePlacementId);
    if (placement.placementKind !== undefined && placement.placementKind !== 'manual' && placement.placementKind !== 'derived') {
      push('REQUEST_INVALID', `placement ${placement.hardwarePlacementId}: placementKind must be manual or derived`, `${path}.placementKind`);
    }
    if (placement.placementKind === 'derived') {
      push('HARDWARE_DERIVED_EDIT',
        `placement ${placement.hardwarePlacementId} is derived by engineering rules and does not support manual editing`,
        path, 'Only manual hardware placements can be edited directly.');
    }
    if (!isNonEmptyString(placement.catalogHardwareId)) {
      push('HARDWARE_REFERENCE_INVALID', `placement ${placement.hardwarePlacementId} has no catalogHardwareId`,
        `${path}.catalogHardwareId`);
    } else if (context?.hardwareCatalog) {
      const hwDef = context.hardwareCatalog.find((h) => (h.id ?? h.hardwareId) === placement.catalogHardwareId);
      if (hwDef) {
        const hostBoard = components.find((c) => c.componentInstanceId === placement.hostComponentInstanceId);
        // Use only the canonical role field. Do NOT fall back to componentDefinitionId or
        // any other opaque identifier — compatibility must not be inferred from names or IDs.
        const hostRoleLower = (hostBoard?.role ?? '').toLowerCase();

        let incompatible = false;
        // Hardware.compatibleRoles is matched against the canonical optionRole only,
        // using exact normalized equality — no substring or contains() matching.
        if (hwDef.compatibleRoles && hwDef.compatibleRoles.length > 0 && hostRoleLower !== '') {
          const matched = hwDef.compatibleRoles.some((r) => r.trim().toLowerCase() === hostRoleLower);
          if (!matched) incompatible = true;
        }

        if (incompatible) {
          push('HARDWARE_INCOMPATIBLE', `hardware definition ${placement.catalogHardwareId} is incompatible with this placement`,
            `${path}.catalogHardwareId`, 'Choose a compatible hardware definition.');
        }
      }
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
    } else if (offset[0] < 0 || offset[1] < 0 || offset[0] > 1200 || offset[1] > 1200) {
      push('HARDWARE_PLACEMENT_INVALID', `placement ${placement.hardwarePlacementId} offsetMm is outside allowed bounds`,
        `${path}.offsetMm`);
    }
    const placementRecord = placement as unknown as Record<string, unknown>;
    if (placementRecord.rotationDeg !== undefined) {
      push('HARDWARE_PLACEMENT_INVALID',
        `placement ${placement.hardwarePlacementId}: rotationDeg is not part of resolve v1 (added with #468 resolution semantics)`,
        `${path}.rotationDeg`);
    }
    if (placementRecord.handedness !== undefined) {
      push('HARDWARE_PLACEMENT_INVALID',
        `placement ${placement.hardwarePlacementId}: handedness is not part of resolve v1 (added with #468 resolution semantics)`,
        `${path}.handedness`);
    }
  }

  return issues;
}

const HARDWARE_ANCHOR_FACES = new Set(['front', 'back', 'left', 'right', 'top', 'bottom']);

const REQUEST_KEYS = new Set([
  'schemaId', 'schemaName', 'schemaVersion', 'messageId', 'idempotencyKey', 'sentAt',
  'source', 'units', 'coordinateSystem', 'furniture',
]);
const SOURCE_KEYS = new Set(['client', 'clientVersion', 'host', 'hostVersion']);
const UNIT_KEYS = new Set(['length', 'angle', 'precisionMm']);
const COORDINATE_KEYS = new Set(['handedness', 'upAxis', 'projectFrameId']);
const FURNITURE_KEYS = new Set([
  'furnitureDefinitionId', 'catalogRevision', 'parameters', 'materialChoices', 'components',
  'relationships', 'hardwarePlacements',
]);
const COMPONENT_KEYS = new Set([
  'componentInstanceId', 'componentDefinitionId', 'catalogComponentId', 'role', 'transform',
]);
const RELATIONSHIP_KEYS = new Set([
  'relationshipId', 'kind', 'source', 'targets', 'joinerySystemId', 'parameters',
]);
const RESPONSE_KEYS = new Set([
  'schemaId', 'schemaName', 'schemaVersion', 'resolveContract', 'responseMessageId',
  'inReplyToMessageId', 'idempotencyKey', 'catalogRevision', 'status', 'normalizedSnapshot',
  'resolved', 'issues',
]);
const ISSUE_KEYS = new Set(['code', 'message', 'severity', 'entityId', 'path', 'remediation', 'details']);
const RESOLVED_LAYOUT_COMPONENT_KEYS = new Set([
  'componentInstanceId', 'componentDefinitionId', 'slotId', 'role', 'lengthMm', 'widthMm',
  'thicknessMm', 'materialId', 'transform', 'name', 'kind', 'dimensionsMm', 'localTransform',
  'optionRole', 'materialCode', 'materialName', 'materialColorHex', 'materialImageUrl',
  'materialTextureUrl', 'materialTextureTileWidthMm', 'materialTextureTileLengthMm',
  'materialRoughness', 'materialMetalness', 'materialClearcoat', 'materialGrain',
]);
const LAYOUT_MATERIAL_STRING_KEYS = [
  'materialId', 'materialCode', 'materialName', 'materialColorHex',
] as const;
const LAYOUT_MATERIAL_URL_KEYS = ['materialImageUrl', 'materialTextureUrl'] as const;
const LAYOUT_MATERIAL_PBR_KEYS = [
  'materialRoughness', 'materialMetalness', 'materialClearcoat',
] as const;

/**
 * Validates a response received over the wire before any SketchUp host
 * mutation. Unlike a TypeScript annotation, this checks untrusted runtime
 * data and request correlation.
 */
export function validateAuthoringResolveResponse(
  value: unknown,
  expected: AuthoringResolveRequestV1 | AuthoringResolveResponseCorrelation,
): readonly string[] {
  const problems: string[] = [];
  const root = asRecord(value);
  if (!root) return ['response must be an object'];

  rejectUnknownRecordKeys(root, RESPONSE_KEYS, 'response', problems);
  if (root.schemaId !== SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID ||
    root.schemaName !== SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME ||
    root.schemaVersion !== SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION ||
    root.resolveContract !== SKETCHUP_AUTHORING_RESOLVE_CONTRACT) {
    problems.push('response schema identity or resolveContract is unsupported');
  }

  const correlation = 'furniture' in expected
    ? {
        messageId: expected.messageId,
        idempotencyKey: expected.idempotencyKey,
        catalogRevision: expected.furniture.catalogRevision,
        furnitureDefinitionId: expected.furniture.furnitureDefinitionId,
      }
    : expected;
  if (root.responseMessageId !== `resolve-${correlation.messageId}`) {
    problems.push('responseMessageId does not correlate with the request');
  }
  if (root.inReplyToMessageId !== correlation.messageId) problems.push('inReplyToMessageId does not match the request');
  if (root.idempotencyKey !== correlation.idempotencyKey) problems.push('idempotencyKey does not match the request');
  if (root.catalogRevision !== correlation.catalogRevision) problems.push('catalogRevision does not match the pinned request');

  validateIssues(root.issues, 'issues', problems);
  if (root.status === 'accepted') {
    validateAcceptedResponse(root, correlation, problems);
  } else if (root.status === 'rejected') {
    if ('normalizedSnapshot' in root || 'resolved' in root) {
      problems.push('rejected response must not contain normalizedSnapshot or resolved');
    }
    if (!Array.isArray(root.issues) || root.issues.length === 0) {
      problems.push('rejected response must contain at least one issue');
    }
  } else {
    problems.push('status must be accepted or rejected');
  }
  return problems;
}

export function parseAuthoringResolveResponse(
  value: unknown,
  expected: AuthoringResolveRequestV1 | AuthoringResolveResponseCorrelation,
): AuthoringResolveResponseV1 {
  const problems = validateAuthoringResolveResponse(value, expected);
  if (problems.length > 0) throw new AuthoringResolveResponseValidationError(problems);
  return value as AuthoringResolveResponseV1;
}

function validateAcceptedResponse(
  root: Readonly<Record<string, unknown>>,
  correlation: AuthoringResolveResponseCorrelation,
  problems: string[],
): void {
  const snapshot = asRecord(root.normalizedSnapshot);
  const resolved = asRecord(root.resolved);
  if (!snapshot) problems.push('accepted response requires normalizedSnapshot');
  if (!resolved) problems.push('accepted response requires resolved');
  if (!snapshot || !resolved) return;
  rejectUnknownRecordKeys(snapshot, new Set(['parameters', 'materialChoices', 'components', 'relationships', 'hardwarePlacements']), 'normalizedSnapshot', problems);
  validateScalarRecord(snapshot.parameters, 'normalizedSnapshot.parameters', problems);
  validateStringRecord(snapshot.materialChoices, 'normalizedSnapshot.materialChoices', problems);

  const snapshotComponents = validateSnapshotComponents(snapshot.components, problems);
  validateRelationships(snapshot.relationships, snapshotComponents, problems);
  validatePlacements(snapshot.hardwarePlacements, snapshotComponents, problems);

  rejectUnknownRecordKeys(resolved, new Set(['layout', 'machining', 'preflight']), 'resolved', problems);
  const layout = asRecord(resolved.layout);
  const machining = asRecord(resolved.machining);
  const preflight = asRecord(resolved.preflight);
  if (!layout) problems.push('resolved.layout is required');
  if (!machining) problems.push('resolved.machining is required');
  if (!preflight) problems.push('resolved.preflight is required');
  if (layout) validateResolvedLayout(layout, correlation, snapshotComponents, problems);
  if (machining) validateResolvedMachining(machining, snapshotComponents, problems);
  if (preflight) validateResolvedPreflight(preflight, problems);
}

function validateSnapshotComponents(value: unknown, problems: string[]): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  if (!Array.isArray(value)) {
    problems.push('normalizedSnapshot.components must be an array');
    return ids;
  }
  for (const [index, item] of value.entries()) {
    const component = asRecord(item);
    const path = `normalizedSnapshot.components[${index}]`;
    if (!component) { problems.push(`${path} must be an object`); continue; }
    rejectUnknownRecordKeys(component, new Set(['componentInstanceId', 'componentDefinitionId', 'catalogComponentId', 'role', 'transform']), path, problems);
    const id = component.componentInstanceId;
    if (!isBoundedString(id) || !isBoundedString(component.componentDefinitionId) ||
      !isBoundedString(component.catalogComponentId) || !isBoundedString(component.role)) {
      problems.push(`${path} requires all four occurrence identity strings`);
      continue;
    }
    if (ids.has(id)) problems.push(`${path}.componentInstanceId is duplicated`);
    ids.set(id, component.componentDefinitionId);
    if (component.transform !== undefined && !isOccurrenceTransform(component.transform)) {
      problems.push(`${path}.transform must be an assembly-frame finite translation`);
    }
  }
  return ids;
}

function validateRelationships(value: unknown, componentIds: ReadonlyMap<string, string>, problems: string[]): void {
  if (!Array.isArray(value)) { problems.push('normalizedSnapshot.relationships must be an array'); return; }
  const relationshipIds = new Set<string>();
  for (const [index, item] of value.entries()) {
    const relationship = asRecord(item);
    const path = `normalizedSnapshot.relationships[${index}]`;
    if (!relationship) { problems.push(`${path} must be an object`); continue; }
    rejectUnknownRecordKeys(relationship, RELATIONSHIP_KEYS, path, problems);
    if (!isBoundedString(relationship.relationshipId) || !isBoundedString(relationship.kind)) problems.push(`${path} requires identity and kind`);
    if (typeof relationship.relationshipId === 'string') {
      if (relationshipIds.has(relationship.relationshipId)) problems.push(`${path}.relationshipId is duplicated`);
      relationshipIds.add(relationship.relationshipId);
    }
    const anchors = [relationship.source, ...(Array.isArray(relationship.targets) ? relationship.targets : [])];
    if (!Array.isArray(relationship.targets) || relationship.targets.length === 0) problems.push(`${path}.targets must be non-empty`);
    for (const anchorValue of anchors) {
      const anchor = asRecord(anchorValue);
      if (!anchor || !isBoundedString(anchor.componentInstanceId) || !isBoundedString(anchor.role) || !componentIds.has(anchor.componentInstanceId)) {
        problems.push(`${path} contains an invalid or orphaned anchor`);
      }
    }
    if (relationship.parameters !== undefined) validateScalarRecord(relationship.parameters, `${path}.parameters`, problems);
  }
}

function validatePlacements(value: unknown, componentIds: ReadonlyMap<string, string>, problems: string[]): void {
  if (!Array.isArray(value)) { problems.push('normalizedSnapshot.hardwarePlacements must be an array'); return; }
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    const placement = asRecord(item);
    const path = `normalizedSnapshot.hardwarePlacements[${index}]`;
    if (!placement) { problems.push(`${path} must be an object`); continue; }
    rejectUnknownRecordKeys(placement, new Set(['hardwarePlacementId', 'placementKind', 'catalogHardwareId', 'hostComponentInstanceId', 'anchorFace', 'offsetMm']), path, problems);
    if (placement.placementKind !== undefined && placement.placementKind !== 'manual' && placement.placementKind !== 'derived') {
      problems.push(`${path}.placementKind must be manual or derived`);
    }
    if (!isBoundedString(placement.hardwarePlacementId) || !isBoundedString(placement.catalogHardwareId) ||
      !isBoundedString(placement.hostComponentInstanceId) || !componentIds.has(placement.hostComponentInstanceId) ||
      !HARDWARE_ANCHOR_FACES.has(String(placement.anchorFace)) || !isFiniteTuple(placement.offsetMm, 2)) {
      problems.push(`${path} is invalid or references an unknown component`);
    }
    if (typeof placement.hardwarePlacementId === 'string') {
      if (ids.has(placement.hardwarePlacementId)) problems.push(`${path}.hardwarePlacementId is duplicated`);
      ids.add(placement.hardwarePlacementId);
    }
  }
}

function validateResolvedLayout(
  layout: Readonly<Record<string, unknown>>,
  correlation: AuthoringResolveResponseCorrelation,
  snapshotComponents: ReadonlyMap<string, string>,
  problems: string[],
): void {
  if (layout.furnitureDefinitionId !== correlation.furnitureDefinitionId) problems.push('layout furnitureDefinitionId does not match the request');
  if (!isBoundedString(layout.definitionName) || !isBoundedString(layout.transformContract) || !isFiniteTuple(layout.dimensionsMm, 3)) {
    problems.push('resolved.layout envelope is invalid');
  }
  if (!Array.isArray(layout.components)) { problems.push('resolved.layout.components must be an array'); return; }
  const layoutIds = new Set<string>();
  for (const [index, item] of layout.components.entries()) {
    const component = asRecord(item);
    const path = `resolved.layout.components[${index}]`;
    if (!component || !isBoundedString(component.componentInstanceId) || !isBoundedString(component.componentDefinitionId)) {
      problems.push(`${path} lacks occurrence identity`); continue;
    }
    rejectUnknownRecordKeys(component, RESOLVED_LAYOUT_COMPONENT_KEYS, path, problems);
    if (layoutIds.has(component.componentInstanceId)) problems.push(`${path}.componentInstanceId is duplicated`);
    layoutIds.add(component.componentInstanceId);
    if (snapshotComponents.get(component.componentInstanceId) !== component.componentDefinitionId) {
      problems.push(`${path} does not match normalizedSnapshot identity`);
    }
    if (![component.lengthMm, component.widthMm, component.thicknessMm].every(isFiniteNumber) || !isOccurrenceLayoutTransform(component.transform)) {
      problems.push(`${path} geometry is invalid`);
    }
    for (const key of LAYOUT_MATERIAL_STRING_KEYS) {
      if (component[key] !== undefined && !isBoundedString(component[key])) {
        problems.push(`${path}.${key} must be a bounded non-empty string`);
      }
    }
    for (const key of LAYOUT_MATERIAL_URL_KEYS) {
      if (component[key] !== undefined && !isNonEmptyString(component[key])) {
        problems.push(`${path}.${key} must be a non-empty string`);
      } else if (typeof component[key] === 'string' && component[key].length > 2048) {
        problems.push(`${path}.${key} cannot exceed 2048 characters`);
      }
    }
    for (const key of ['materialTextureTileWidthMm', 'materialTextureTileLengthMm'] as const) {
      if (component[key] !== undefined && (!isFiniteNumber(component[key]) || component[key] <= 0)) {
        problems.push(`${path}.${key} must be a positive finite number`);
      }
    }
    for (const key of LAYOUT_MATERIAL_PBR_KEYS) {
      if (component[key] !== undefined && !isFiniteNumber(component[key])) {
        problems.push(`${path}.${key} must be a finite number`);
      }
    }
    if (component.materialGrain !== undefined && typeof component.materialGrain !== 'boolean') {
      problems.push(`${path}.materialGrain must be boolean`);
    }
  }
  for (const id of snapshotComponents.keys()) if (!layoutIds.has(id)) problems.push(`layout omits normalized component ${id}`);
  if (!Array.isArray(layout.hardware)) problems.push('resolved.layout.hardware must be an array');
}

function validateResolvedMachining(
  machining: Readonly<Record<string, unknown>>,
  componentIds: ReadonlyMap<string, string>,
  problems: string[],
): void {
  if (typeof machining.manufacturingFingerprint !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(machining.manufacturingFingerprint)) {
    problems.push('manufacturingFingerprint must be sha256 followed by 64 lowercase hex characters');
  }
  if (!Array.isArray(machining.operations) || !Array.isArray(machining.derivedHardwarePlacements)) {
    problems.push('resolved.machining arrays are required'); return;
  }
  for (const [index, item] of machining.operations.entries()) {
    const operation = asRecord(item);
    const path = `resolved.machining.operations[${index}]`;
    if (!operation || !isBoundedString(operation.operationId) || !isBoundedString(operation.hostComponentInstanceId) ||
      !componentIds.has(operation.hostComponentInstanceId) || !isValidProvenance(operation.provenance) || !Array.isArray(operation.holes)) {
      problems.push(`${path} is invalid`); continue;
    }
    for (const holeValue of operation.holes) {
      const hole = asRecord(holeValue);
      if (!hole || !isBoundedString(hole.face) || !isBoundedString(hole.type) ||
        ![hole.xMm, hole.yMm, hole.diameterMm, hole.depthMm].every(isFiniteNumber) ||
        !HARDWARE_ANCHOR_FACES.has(String(hole.face)) ||
        (hole.xMm as number) < 0 || (hole.yMm as number) < 0 ||
        (hole.diameterMm as number) <= 0 || (hole.depthMm as number) <= 0) {
        problems.push(`${path} contains an invalid hole`);
      }
    }
  }
}

function validateResolvedPreflight(preflight: Readonly<Record<string, unknown>>, problems: string[]): void {
  rejectUnknownRecordKeys(preflight, new Set(['scope', 'status', 'issues', 'preflightContract']), 'resolved.preflight', problems);
  if (preflight.scope !== 'authoring-resolve-subset' ||
    (preflight.status !== 'clear' && preflight.status !== 'blocked') ||
    preflight.preflightContract !== MANUFACTURING_PREFLIGHT_CONTRACT) {
    problems.push('resolved.preflight contract is unsupported');
  }
  validateIssues(preflight.issues, 'resolved.preflight.issues', problems);
}

function validateIssues(value: unknown, path: string, problems: string[]): void {
  if (!Array.isArray(value) || value.length > AUTHORING_RESOLVE_LIMITS.issueCount) { problems.push(`${path} must be a bounded array`); return; }
  for (const [index, item] of value.entries()) {
    const issue = asRecord(item);
    const issuePath = `${path}[${index}]`;
    if (!issue) { problems.push(`${issuePath} must be an object`); continue; }
    rejectUnknownRecordKeys(issue, ISSUE_KEYS, issuePath, problems);
    if (typeof issue.code !== 'string' || !isAuthoringResolveIssueCode(issue.code) || !isBoundedString(issue.message) ||
      (issue.severity !== 'error' && issue.severity !== 'warning' && issue.severity !== 'info')) {
      problems.push(`${issuePath} has an unknown code, missing severity, or invalid message`);
    }
  }
}

function isValidProvenance(value: unknown): boolean {
  const provenance = asRecord(value);
  if (!provenance) return false;
  if (provenance.sourceKind === 'relationship') {
    return isBoundedString(provenance.relationshipId) && provenance.hardwarePlacementId === undefined;
  }
  if (provenance.sourceKind === 'manualHardwarePlacement') {
    return isBoundedString(provenance.hardwarePlacementId) && provenance.relationshipId === undefined && provenance.catalogRuleId === undefined;
  }
  return false;
}

function isOccurrenceTransform(value: unknown): boolean {
  const transform = asRecord(value);
  return transform?.frame === 'assembly' && isFiniteTuple(transform.translationMm, 3);
}

function isOccurrenceLayoutTransform(value: unknown): boolean {
  const transform = asRecord(value);
  return transform !== undefined && isFiniteTuple(transform.translationMm, 3);
}

function validateScalarRecord(value: unknown, path: string, problems: string[]): void {
  const record = asRecord(value);
  if (!record) { problems.push(`${path} must be an object`); return; }
  for (const [key, item] of Object.entries(record)) if (!isBoundedString(key) || !isParameterValue(item)) problems.push(`${path}.${key} must be a finite scalar`);
}

function validateStringRecord(value: unknown, path: string, problems: string[]): void {
  const record = asRecord(value);
  if (!record) { problems.push(`${path} must be an object`); return; }
  for (const [key, item] of Object.entries(record)) if (!isBoundedString(key) || !isBoundedString(item)) problems.push(`${path}.${key} must be a bounded string`);
}

function rejectUnknownKeys(
  value: object,
  allowed: ReadonlySet<string>,
  path: string,
  push: (code: AuthoringResolveIssueCode, message: string, path?: string) => void,
): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) push('REQUEST_INVALID', `unknown field ${key}`, path ? `${path}.${key}` : key);
}

function rejectUnknownRecordKeys(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>, path: string, problems: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) problems.push(`${path}.${key} is not part of resolve v1`);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteTuple(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function isParameterValue(value: unknown): value is ParameterValue {
  return typeof value === 'boolean' || isFiniteNumber(value) || isBoundedString(value);
}

function isBoundedString(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= AUTHORING_RESOLVE_LIMITS.identifierLength;
}

function isEnvelopeString(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= AUTHORING_RESOLVE_LIMITS.envelopeStringLength;
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// --- Manufacturing fingerprint (parity with the Go resolver) -----------------

/** Board identity/dimensions/material entering the manufacturing fingerprint. */
export interface FingerprintBoard {
  readonly id: string;
  readonly defId: string;
  readonly catalogComponentId?: string;
  readonly role: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly materialId?: string;
}

/** Manual placement identity entering the manufacturing fingerprint. */
export interface FingerprintPlacement {
  readonly id: string;
  readonly hardwareId: string;
  readonly host: string;
  readonly anchorFace: string;
  readonly offsetMm: readonly [number, number];
}

/**
 * Deterministic fingerprint over the FULL manufacturing identity of a
 * resolved authoring state — boards (occurrence identity + dimensions +
 * selected material), manual placements, derived placements and machining
 * operations. Parity-pinned against the Go resolver over the shared
 * contract fixture: both sides must derive the same string from the same
 * scenario, so a handle swap, a same-drilling substitution or a material
 * change all move it.
 */
export function authoringResolveFingerprint(input: {
  readonly boards: readonly FingerprintBoard[];
  readonly manualPlacements: readonly FingerprintPlacement[];
  readonly derivedHardwarePlacements: readonly {
    readonly derivedHardwarePlacementId: string;
    readonly hostComponentInstanceId: string;
    readonly provenance: { readonly sourceKind: string; readonly relationshipId: string };
  }[];
  readonly operations: readonly {
    readonly operationId: string;
    readonly hostComponentInstanceId: string;
    readonly provenance: Record<string, unknown>;
    readonly holes: readonly ResolveHoleV1[];
  }[];
}): string {
  const boards = input.boards
    .map((board) => {
      const body: Record<string, unknown> = {
        id: board.id, defId: board.defId, role: board.role,
        lengthMm: board.lengthMm, widthMm: board.widthMm, thicknessMm: board.thicknessMm,
      };
      if (board.catalogComponentId) body.catalogComponentId = board.catalogComponentId;
      if (board.materialId) body.materialId = board.materialId;
      return { sort: board.id, body };
    })
    .sort((a, b) => compareUtf8(a.sort, b.sort))
    .map((entry) => entry.body);

  const manualPlacements = input.manualPlacements
    .map((placement) => ({
      sort: placement.id,
      body: {
        id: placement.id, hardwareId: placement.hardwareId, host: placement.host,
        anchorFace: placement.anchorFace, offsetMm: [...placement.offsetMm],
      },
    }))
    .sort((a, b) => compareUtf8(a.sort, b.sort))
    .map((entry) => entry.body);

  const derived = input.derivedHardwarePlacements
    .map((placement) => ({
      sort: placement.derivedHardwarePlacementId,
      body: {
        id: placement.derivedHardwarePlacementId,
        host: placement.hostComponentInstanceId,
        prov: { sourceKind: placement.provenance.sourceKind, relationshipId: placement.provenance.relationshipId },
      },
    }))
    .sort((a, b) => compareUtf8(a.sort, b.sort))
    .map((entry) => entry.body);

  const operations = input.operations
    .map((operation) => ({
      sort: operation.operationId,
      body: {
        id: operation.operationId,
        host: operation.hostComponentInstanceId,
        prov: operation.provenance,
        holes: operation.holes.map((hole) => ({
          face: hole.face, xMm: hole.xMm, yMm: hole.yMm,
          diameterMm: hole.diameterMm, depthMm: hole.depthMm, type: hole.type,
        })),
      },
    }))
    .sort((a, b) => compareUtf8(a.sort, b.sort))
    .map((entry) => entry.body);

  return `sha256-${sha256Hex(new TextEncoder().encode(canonicalizeJson({
    boards,
    manualPlacements,
    derivedHardwarePlacements: derived,
    operations,
  })))}`;
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(',')}}`;
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

/** SHA-256 over the canonical UTF-8 bytes, without a Node-only dependency. */
function sha256Hex(message: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const bitLength = BigInt(message.length) * 8n;
  for (let index = 0; index < 8; index += 1) padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);

  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotateRight = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      words[index] = ((padded[at]! << 24) | (padded[at + 1]! << 16) | (padded[at + 2]! << 8) | padded[at + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15]!, 7) ^ rotateRight(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rotateRight(words[index - 2]!, 17) ^ rotateRight(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sum1 + choice + constants[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0; hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0; hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0; hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0; hash[7] = (hash[7]! + h!) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, '0')).join('');
}
