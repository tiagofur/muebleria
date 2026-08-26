/**
 * SketchUp authoring envelope schema v1 — executable contract types and
 * identity rules from docs/sketchup-manufacturing-contract.md. The namespace
 * is granete.* since the platform rename (#366); nothing shipped under
 * muebles.* so no migration is owed.
 */

export const SKETCHUP_AUTHORING_SCHEMA_NAME = 'granete.sketchup-authoring' as const;
export const SKETCHUP_AUTHORING_SCHEMA_VERSION = '1.0' as const;
export const SKETCHUP_AUTHORING_SCHEMA_ID = `${SKETCHUP_AUTHORING_SCHEMA_NAME}.v1` as const;

export type StableEntityId = string;

export type SchemaIdentityV1 = {
  readonly schemaId: typeof SKETCHUP_AUTHORING_SCHEMA_ID;
  readonly schemaName: typeof SKETCHUP_AUTHORING_SCHEMA_NAME;
  readonly schemaVersion: typeof SKETCHUP_AUTHORING_SCHEMA_VERSION;
};

export type AuthoringSource = {
  readonly client: 'granete-for-sketchup';
  readonly clientVersion: string;
  readonly host: 'sketchup';
  readonly hostVersion: string;
};

export type EntityTombstone = {
  readonly entityType:
    | 'assembly'
    | 'componentInstance'
    | 'relationship'
    | 'hardwarePlacement';
  readonly entityId: StableEntityId;
  readonly deletedAt: string;
};

export type UnitSystem = {
  readonly length: 'mm';
  readonly angle: 'deg';
  readonly precisionMm: number;
};

export type CoordinateSystem = {
  readonly handedness: 'right';
  readonly upAxis: 'z';
  readonly projectFrameId: string;
};

export type TransformFrame = 'project' | 'assembly' | 'componentInstance';

export type Transform3D = {
  readonly frame: TransformFrame;
  readonly translationMm: readonly [number, number, number];
  readonly rotationQuaternion: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
};

export type ParameterValue = string | number | boolean;

export type DesignComponent = {
  readonly componentDefinitionId: StableEntityId;
  readonly componentInstanceId: StableEntityId;
  readonly catalogComponentId?: string;
  readonly role: string;
  readonly transform: Transform3D;
};

export type RelationshipAnchor = {
  readonly componentInstanceId: StableEntityId;
  readonly role: string;
  readonly face?: string;
  readonly reference?: string;
};

export type PartRelationshipIntent = {
  readonly relationshipId: StableEntityId;
  readonly kind: string;
  readonly source: RelationshipAnchor;
  readonly targets: readonly RelationshipAnchor[];
  readonly joinerySystemId?: string;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
};

export type HardwarePlacementIntent = {
  readonly hardwarePlacementId: StableEntityId;
  readonly catalogHardwareId: string;
  readonly hostComponentInstanceId: StableEntityId;
  readonly anchorFace: string;
  readonly offsetMm: readonly [number, number];
  readonly rotationDeg: number;
  readonly handedness?: 'left' | 'right' | 'neutral';
};

export type DesignAssembly = {
  readonly assemblyId: StableEntityId;
  readonly catalogItemId: string;
  readonly catalogRevision: string;
  readonly displayName?: string;
  readonly transform: Transform3D;
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly components?: readonly DesignComponent[];
  readonly relationships?: readonly PartRelationshipIntent[];
  readonly hardwarePlacements?: readonly HardwarePlacementIntent[];
};

export type AuthoringEnvelopeV1 = {
  readonly schemaId: string;
  readonly schemaName: string;
  readonly schemaVersion: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly sentAt: string;
  readonly projectId: string;
  readonly baseSourceRevisionId?: string;
  readonly sourceRevisionId: string;
  readonly source: AuthoringSource;
  readonly units: UnitSystem;
  readonly coordinateSystem: CoordinateSystem;
  readonly mutationMode: 'full-snapshot-with-tombstones';
  readonly assemblies: readonly DesignAssembly[];
  readonly tombstones: readonly EntityTombstone[];
};

export type ContractIssue = {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly entityId?: StableEntityId;
  readonly path?: string;
  readonly remediation?: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

// --- Capability negotiation (contract §10) ---

export type MachineProfileRef = {
  readonly machineProfileId: string;
  readonly machineProfileRevisionId: string;
};

export type MachineCapability = {
  readonly capabilityId: string;
  readonly version: string;
  readonly constraints: Readonly<Record<string, unknown>>;
};

export type CapabilityNegotiation = {
  readonly machineProfile: MachineProfileRef;
  readonly required: readonly MachineCapability[];
  readonly supported: readonly MachineCapability[];
  readonly unsupported: readonly ContractIssue[];
};

export type MutationReceipt = {
  readonly createdEntityIds: readonly StableEntityId[];
  readonly updatedEntityIds: readonly StableEntityId[];
  readonly deletedEntityIds: readonly StableEntityId[];
};

export type AppliedSchemaMigration = {
  readonly migrationId: string;
  readonly fromSchemaName: string;
  readonly fromSchemaVersion: string;
  readonly toSchemaId: typeof SKETCHUP_AUTHORING_SCHEMA_ID;
  readonly toSchemaVersion: typeof SKETCHUP_AUTHORING_SCHEMA_VERSION;
};

export type ReadonlyAuthoringSnapshot = {
  readonly projectId: StableEntityId;
  readonly sourceRevisionId: StableEntityId;
  readonly assemblies: readonly DesignAssembly[];
};

export type AuthoringRoundTripResponseV1 = {
  readonly schemaId: typeof SKETCHUP_AUTHORING_SCHEMA_ID;
  readonly schemaName: typeof SKETCHUP_AUTHORING_SCHEMA_NAME;
  readonly schemaVersion: typeof SKETCHUP_AUTHORING_SCHEMA_VERSION;
  readonly responseMessageId: string;
  readonly inReplyToMessageId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly sourceRevisionId: string;
  readonly status: 'accepted' | 'rejected' | 'conflict';
  readonly migration?: AppliedSchemaMigration;
  readonly mutationReceipt?: MutationReceipt;
  readonly authoringSnapshot?: ReadonlyAuthoringSnapshot;
  readonly resolvedFeedback?: ResolvedManufacturingFeedback;
  readonly issues: readonly ContractIssue[];
};

export type RelationshipProvenance = {
  readonly sourceKind: 'relationship';
  readonly relationshipId: StableEntityId;
  readonly catalogRuleId?: string;
};

export type JointProvenance = {
  readonly sourceKind: 'joint';
  readonly relationshipId: StableEntityId;
  readonly jointPlacementId: StableEntityId;
  readonly catalogRuleId?: string;
};

export type ManualHardwarePlacementProvenance = {
  readonly sourceKind: 'manualHardwarePlacement';
  readonly hardwarePlacementId: StableEntityId;
  readonly catalogRuleId?: string;
};

export type DerivedOperationProvenance =
  | RelationshipProvenance
  | JointProvenance
  | ManualHardwarePlacementProvenance;

export type DerivedHardwarePlacement = {
  readonly derivedHardwarePlacementId: StableEntityId;
  readonly hostComponentInstanceId: StableEntityId;
  readonly provenance: RelationshipProvenance | JointProvenance;
};

export type DerivedMachiningOperation = {
  readonly operationId: StableEntityId;
  readonly hostComponentInstanceId: StableEntityId;
  readonly provenance: DerivedOperationProvenance;
};

export type ManufacturingIdentity = {
  readonly projectId: string;
  readonly designRevisionId: string;
  readonly sourceRevisionId: string;
  readonly bomFingerprint: string;
  readonly resolvedAt: string;
};

/**
 * Read-only manufacturing feedback attached to a response. Granete produces
 * it; SketchUp may render or cache it, but it can never re-enter an
 * AuthoringEnvelopeV1 as authoring truth.
 */
export type ResolvedManufacturingFeedback = {
  readonly identity: ManufacturingIdentity;
  readonly preflightStatus: 'ready' | 'blocked' | 'warning';
  readonly derivedHardwarePlacements: readonly DerivedHardwarePlacement[];
  readonly derivedMachiningOperations: readonly DerivedMachiningOperation[];
  readonly issues: readonly ContractIssue[];
};

/**
 * Exactly one provenance variant must be present: `{}` and ambiguous
 * relationship/joint/manual combinations are invalid by contract §6.
 */
export function isValidDerivedOperationProvenance(
  provenance: unknown,
): provenance is DerivedOperationProvenance {
  if (provenance === null || typeof provenance !== 'object') return false;
  const record = provenance as Record<string, unknown>;
  const sourceKind = record.sourceKind;
  if (sourceKind === 'relationship') return typeof record.relationshipId === 'string';
  if (sourceKind === 'joint') {
    return typeof record.relationshipId === 'string' && typeof record.jointPlacementId === 'string';
  }
  if (sourceKind === 'manualHardwarePlacement') {
    return typeof record.hardwarePlacementId === 'string';
  }
  return false;
}

/**
 * Deterministic canonical fingerprint for idempotency comparisons: key order
 * and numeric formatting must never decide whether two payloads are "the
 * same mutation".
 */
export function fingerprintEnvelope(envelope: AuthoringEnvelopeV1): string {
  return canonicalJson(normalizeEnvelope(envelope));
}

/**
 * Transport rounding: precisionMm is a transport property, never a
 * fabrication tolerance. Everything the envelope carries in mm is rounded
 * before comparison or persistence so round-trips are exact.
 */
export function roundToPrecisionMm(value: number, precisionMm: number): number {
  const decimals = Math.round(-Math.log10(precisionMm));
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeEnvelope(envelope: AuthoringEnvelopeV1): AuthoringEnvelopeV1 {
  const precision = validPrecision(envelope) ? envelope.units.precisionMm : 0.01;
  return {
    ...envelope,
    assemblies: envelope.assemblies.map((assembly) => ({
      ...assembly,
      transform: normalizeTransform(assembly.transform, precision),
      components: assembly.components?.map((component) => ({
        ...component,
        transform: normalizeTransform(component.transform, precision),
      })),
      hardwarePlacements: assembly.hardwarePlacements?.map((placement) => ({
        ...placement,
        offsetMm: [
          roundToPrecisionMm(placement.offsetMm[0], precision),
          roundToPrecisionMm(placement.offsetMm[1], precision),
        ],
        rotationDeg: roundToPrecisionMm(placement.rotationDeg, precision),
      })),
    })),
  };
}

function normalizeTransform(transform: Transform3D, precision: number): Transform3D {
  return {
    ...transform,
    translationMm: transform.translationMm.map((mm) => roundToPrecisionMm(mm, precision)) as [
      number,
      number,
      number,
    ],
  };
}

function validPrecision(envelope: AuthoringEnvelopeV1): boolean {
  return (
    envelope.units?.length === 'mm' &&
    typeof envelope.units.precisionMm === 'number' &&
    Number.isFinite(envelope.units.precisionMm) &&
    envelope.units.precisionMm > 0
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
