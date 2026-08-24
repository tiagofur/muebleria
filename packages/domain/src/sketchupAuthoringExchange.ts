/**
 * Authoring exchange engine: applies a full-snapshot-with-tombstones envelope
 * to previously accepted state, atomically and idempotently, and produces the
 * correlated round-trip response. Pure domain logic: the caller persists the
 * returned state; this module never resolves manufacturing truth.
 *
 * Entity granularity: assemblies, component instances, relationships and
 * hardware placements all follow the same contract rules — unknown ID creates,
 * existing ID updates, tombstone deletes, omission without tombstone is a
 * conflict, and a deleted ID is never reused. The mutation receipt reports
 * what the sender explicitly mutated: an assembly tombstone reports the
 * assembly (its sub-entities die with it); sub-entity tombstones report the
 * sub-entity.
 */

import {
  SKETCHUP_AUTHORING_SCHEMA_ID,
  SKETCHUP_AUTHORING_SCHEMA_NAME,
  SKETCHUP_AUTHORING_SCHEMA_VERSION,
  fingerprintEnvelope,
  type AppliedSchemaMigration,
  type AuthoringEnvelopeV1,
  type AuthoringRoundTripResponseV1,
  type ContractIssue,
  type DesignAssembly,
  type EntityTombstone,
  type MutationReceipt,
  type ReadonlyAuthoringSnapshot,
  type StableEntityId,
} from './sketchupAuthoringSchema';
import {
  hasErrors,
  validateAuthoringEnvelope,
  type AuthoringCatalogIndex,
} from './sketchupAuthoringValidation';
import { applyRegisteredMigrations } from './sketchupAuthoringMigrations';

export type TombstoneableEntityType = EntityTombstone['entityType'];

/** Accepted authoring state for one project; persisted by the caller. */
export type AuthoringExchangeState = {
  readonly projectId: string;
  readonly sourceRevisionId: string;
  readonly assemblies: ReadonlyMap<StableEntityId, DesignAssembly>;
  readonly deletedEntityKeys: ReadonlySet<string>;
  readonly idempotency: ReadonlyMap<string, IdempotencyRecord>;
};

export type IdempotencyRecord = {
  readonly payloadFingerprint: string;
  readonly response: AuthoringRoundTripResponseV1;
};

export const EMPTY_AUTHORING_STATE: Readonly<AuthoringExchangeState> = {
  projectId: '',
  sourceRevisionId: '',
  assemblies: new Map(),
  deletedEntityKeys: new Set(),
  idempotency: new Map(),
};

export function entityKey(entityType: TombstoneableEntityType, entityId: StableEntityId): string {
  return `${entityType}:${entityId}`;
}

export function applyAuthoringEnvelope(
  state: Readonly<AuthoringExchangeState>,
  envelope: AuthoringEnvelopeV1,
  catalog: AuthoringCatalogIndex,
): { readonly state: Readonly<AuthoringExchangeState>; readonly response: AuthoringRoundTripResponseV1 } {
  // 1. Schema identity and migrations decide before anything mutates.
  const migration = applyRegisteredMigrations(envelope);
  if (migration === 'unsupported') {
    return rejected(state, envelope, [
      {
        code: 'SCHEMA_VERSION_UNSUPPORTED',
        message: `No registered lossless migration to ${SKETCHUP_AUTHORING_SCHEMA_VERSION}`,
        severity: 'error',
        remediation: 'Send a supported schemaVersion.',
      },
    ]);
  }

  // 2. Idempotency: same logical mutation replays the same response.
  const fingerprint = fingerprintEnvelope(envelope);
  const replay = state.idempotency.get(envelope.idempotencyKey);
  if (replay !== undefined) {
    if (replay.payloadFingerprint !== fingerprint) {
      return rejected(state, envelope, [
        {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'idempotencyKey was already used with a different payload',
          severity: 'error',
        },
      ]);
    }
    return { state, response: replay.response };
  }

  // 3. Structural validation gates everything else.
  const issues = validateAuthoringEnvelope(envelope, catalog);
  if (hasErrors(issues)) {
    return rejected(state, envelope, issues);
  }

  // 4. Optimistic base: a stale base conflicts without partial mutation.
  const stateExists = state.sourceRevisionId !== '' && state.projectId === envelope.projectId;
  if (stateExists && envelope.baseSourceRevisionId !== state.sourceRevisionId) {
    return conflict(state, envelope, [
      {
        code: 'SOURCE_REVISION_CONFLICT',
        message: `baseSourceRevisionId ${String(envelope.baseSourceRevisionId)} is stale; accepted state is at ${state.sourceRevisionId}`,
        severity: 'error',
        remediation: 'Re-export from the current source revision.',
      },
    ]);
  }

  const previous = indexLiveEntities(state.assemblies.values());
  const sent = indexLiveEntities(envelope.assemblies);
  const tombstoned = new Set(
    envelope.tombstones.map((tombstone) => entityKey(tombstone.entityType, tombstone.entityId)),
  );

  // 5. Snapshot completeness: omission never deletes, at any granularity.
  const completenessIssues = checkSnapshotCompleteness(previous, envelope, tombstoned);
  if (completenessIssues.length > 0) {
    return conflict(state, envelope, completenessIssues);
  }

  // 6. Tombstone validity and ID-reuse guards.
  const guardIssues = checkTombstonesAndReuse(previous, sent, envelope, state.deletedEntityKeys);
  if (guardIssues.length > 0) {
    return rejected(state, envelope, guardIssues);
  }

  // 7. Atomic apply.
  const assemblies = new Map(state.assemblies);
  const deletedEntityKeys = new Set(state.deletedEntityKeys);
  const created: StableEntityId[] = [];
  const updated: StableEntityId[] = [];
  const deleted: StableEntityId[] = [];

  for (const tombstone of envelope.tombstones) {
    const key = entityKey(tombstone.entityType, tombstone.entityId);
    deletedEntityKeys.add(key);
    if (tombstone.entityType === 'assembly') {
      assemblies.delete(tombstone.entityId);
    }
    deleted.push(tombstone.entityId);
  }
  for (const assembly of envelope.assemblies) {
    const isUpdate = previous.assemblies.has(assembly.assemblyId);
    if (isUpdate) {
      updated.push(assembly.assemblyId);
    } else {
      created.push(assembly.assemblyId);
    }
    assemblies.set(assembly.assemblyId, assembly);

    const previousSubEntities = previous.assemblies.get(assembly.assemblyId);
    const classify = (entityId: StableEntityId): void => {
      if (previousSubEntities?.all.has(entityId) === true || previous.globalIds.has(entityId)) {
        updated.push(entityId);
      } else {
        created.push(entityId);
      }
    };
    for (const component of assembly.components ?? []) classify(component.componentInstanceId);
    for (const relationship of assembly.relationships ?? []) classify(relationship.relationshipId);
    for (const placement of assembly.hardwarePlacements ?? []) classify(placement.hardwarePlacementId);
  }

  const response = acceptedResponse(
    envelope,
    { createdEntityIds: created, updatedEntityIds: updated, deletedEntityIds: deleted },
    migration,
    assemblies,
  );
  const nextState: AuthoringExchangeState = {
    projectId: envelope.projectId,
    sourceRevisionId: envelope.sourceRevisionId,
    assemblies,
    deletedEntityKeys,
    idempotency: new Map(state.idempotency).set(envelope.idempotencyKey, {
      payloadFingerprint: fingerprint,
      response,
    }),
  };
  return { state: nextState, response };
}

type LiveIndex = {
  readonly assemblies: ReadonlyMap<StableEntityId, LiveAssemblyIndex>;
  /** Every stable ID that is live, sub-entities included. */
  readonly globalIds: ReadonlySet<StableEntityId>;
};

type LiveAssemblyIndex = {
  readonly componentInstances: ReadonlySet<StableEntityId>;
  readonly relationships: ReadonlySet<StableEntityId>;
  readonly hardwarePlacements: ReadonlySet<StableEntityId>;
  readonly all: ReadonlySet<StableEntityId>;
};

function indexLiveEntities(assemblies: Iterable<DesignAssembly>): LiveIndex {
  const assemblyIndex = new Map<StableEntityId, LiveAssemblyIndex>();
  const globalIds = new Set<StableEntityId>();
  for (const assembly of assemblies) {
    const componentInstances = new Set((assembly.components ?? []).map((c) => c.componentInstanceId));
    const relationships = new Set((assembly.relationships ?? []).map((r) => r.relationshipId));
    const hardwarePlacements = new Set(
      (assembly.hardwarePlacements ?? []).map((p) => p.hardwarePlacementId),
    );
    assemblyIndex.set(assembly.assemblyId, {
      componentInstances,
      relationships,
      hardwarePlacements,
      all: new Set([...componentInstances, ...relationships, ...hardwarePlacements]),
    });
    globalIds.add(assembly.assemblyId);
    for (const id of componentInstances) globalIds.add(id);
    for (const id of relationships) globalIds.add(id);
    for (const id of hardwarePlacements) globalIds.add(id);
  }
  return { assemblies: assemblyIndex, globalIds };
}

function checkSnapshotCompleteness(
  previous: LiveIndex,
  envelope: AuthoringEnvelopeV1,
  tombstoned: ReadonlySet<string>,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const sentAssemblies = new Map(envelope.assemblies.map((assembly) => [assembly.assemblyId, assembly]));

  for (const [assemblyId, liveIndex] of previous.assemblies) {
    const sent = sentAssemblies.get(assemblyId);
    if (sent === undefined) {
      if (!tombstoned.has(entityKey('assembly', assemblyId))) {
        issues.push({
          code: 'SOURCE_REVISION_CONFLICT',
          message: `assembly ${assemblyId} is missing from the snapshot without a tombstone`,
          severity: 'error',
          entityId: assemblyId,
          remediation: 'Send the full snapshot or tombstone the deleted assembly.',
        });
      }
      continue;
    }
    issues.push(
      ...checkSubEntityCompleteness('componentInstance', assemblyId, liveIndex.componentInstances, sent, tombstoned),
      ...checkSubEntityCompleteness('relationship', assemblyId, liveIndex.relationships, sent, tombstoned),
      ...checkSubEntityCompleteness('hardwarePlacement', assemblyId, liveIndex.hardwarePlacements, sent, tombstoned),
    );
  }
  return issues;
}

function checkSubEntityCompleteness(
  entityType: TombstoneableEntityType,
  assemblyId: StableEntityId,
  previousIds: ReadonlySet<StableEntityId>,
  sent: DesignAssembly,
  tombstoned: ReadonlySet<string>,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const sentIds: ReadonlySet<StableEntityId> =
    entityType === 'componentInstance'
      ? new Set((sent.components ?? []).map((c) => c.componentInstanceId))
      : entityType === 'relationship'
        ? new Set((sent.relationships ?? []).map((r) => r.relationshipId))
        : new Set((sent.hardwarePlacements ?? []).map((p) => p.hardwarePlacementId));

  for (const entityId of previousIds) {
    if (!sentIds.has(entityId) && !tombstoned.has(entityKey(entityType, entityId))) {
      issues.push({
        code: 'SOURCE_REVISION_CONFLICT',
        message: `${entityType} ${entityId} of assembly ${assemblyId} is missing without a tombstone`,
        severity: 'error',
        entityId,
        path: `assemblies[assemblyId=${assemblyId}]`,
        remediation: 'Send the entity or tombstone it explicitly.',
      });
    }
  }
  return issues;
}

function checkTombstonesAndReuse(
  previous: LiveIndex,
  sent: LiveIndex,
  envelope: AuthoringEnvelopeV1,
  previousDeletedKeys: ReadonlySet<string>,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];

  for (const tombstone of envelope.tombstones) {
    const key = entityKey(tombstone.entityType, tombstone.entityId);
    const wasLive = previous.globalIds.has(tombstone.entityId);
    const wasDeleted = previousDeletedKeys.has(key);
    if (!wasLive && !wasDeleted) {
      issues.push({
        code: 'ENTITY_TOMBSTONE_INVALID',
        message: `tombstone for unknown ${tombstone.entityType} ${tombstone.entityId}`,
        severity: 'error',
        entityId: tombstone.entityId,
      });
    }
    if (sent.globalIds.has(tombstone.entityId)) {
      issues.push({
        code: 'ENTITY_TOMBSTONE_INVALID',
        message: `${tombstone.entityType} ${tombstone.entityId} is tombstoned and still present in the snapshot`,
        severity: 'error',
        entityId: tombstone.entityId,
        remediation: 'Remove the entity from the snapshot or drop its tombstone.',
      });
    }
  }

  for (const entityId of sent.globalIds) {
    if (previousDeletedKeys.has(`assembly:${entityId}`)) {
      issues.push(reuseIssue('assembly', entityId));
    }
    if (previousDeletedKeys.has(`componentInstance:${entityId}`)) {
      issues.push(reuseIssue('componentInstance', entityId));
    }
    if (previousDeletedKeys.has(`relationship:${entityId}`)) {
      issues.push(reuseIssue('relationship', entityId));
    }
    if (previousDeletedKeys.has(`hardwarePlacement:${entityId}`)) {
      issues.push(reuseIssue('hardwarePlacement', entityId));
    }
  }
  return issues;
}

function reuseIssue(entityType: TombstoneableEntityType, entityId: StableEntityId): ContractIssue {
  return {
    code: 'STABLE_ID_REUSE',
    message: `${entityType} ${entityId} was deleted and can never be reused`,
    severity: 'error',
    entityId,
  };
}

function acceptedResponse(
  envelope: AuthoringEnvelopeV1,
  receipt: MutationReceipt,
  migration: AppliedSchemaMigration | undefined,
  assemblies: ReadonlyMap<StableEntityId, DesignAssembly>,
): AuthoringRoundTripResponseV1 {
  return {
    schemaId: SKETCHUP_AUTHORING_SCHEMA_ID,
    schemaName: SKETCHUP_AUTHORING_SCHEMA_NAME,
    schemaVersion: SKETCHUP_AUTHORING_SCHEMA_VERSION,
    responseMessageId: `response-${envelope.messageId}`,
    inReplyToMessageId: envelope.messageId,
    idempotencyKey: envelope.idempotencyKey,
    projectId: envelope.projectId,
    sourceRevisionId: envelope.sourceRevisionId,
    status: 'accepted',
    ...(migration !== undefined ? { migration } : {}),
    mutationReceipt: receipt,
    authoringSnapshot: {
      projectId: envelope.projectId,
      sourceRevisionId: envelope.sourceRevisionId,
      assemblies: [...assemblies.values()],
    },
    issues: [],
  };
}

function rejected(
  state: Readonly<AuthoringExchangeState>,
  envelope: AuthoringEnvelopeV1,
  issues: readonly ContractIssue[],
): { readonly state: Readonly<AuthoringExchangeState>; readonly response: AuthoringRoundTripResponseV1 } {
  return { state, response: responseWithStatus(envelope, 'rejected', issues) };
}

function conflict(
  state: Readonly<AuthoringExchangeState>,
  envelope: AuthoringEnvelopeV1,
  issues: readonly ContractIssue[],
): { readonly state: Readonly<AuthoringExchangeState>; readonly response: AuthoringRoundTripResponseV1 } {
  return { state, response: responseWithStatus(envelope, 'conflict', issues) };
}

function responseWithStatus(
  envelope: AuthoringEnvelopeV1,
  status: 'rejected' | 'conflict',
  issues: readonly ContractIssue[],
): AuthoringRoundTripResponseV1 {
  return {
    schemaId: SKETCHUP_AUTHORING_SCHEMA_ID,
    schemaName: SKETCHUP_AUTHORING_SCHEMA_NAME,
    schemaVersion: SKETCHUP_AUTHORING_SCHEMA_VERSION,
    responseMessageId: `response-${envelope.messageId}`,
    inReplyToMessageId: envelope.messageId,
    idempotencyKey: envelope.idempotencyKey,
    projectId: envelope.projectId,
    sourceRevisionId: envelope.sourceRevisionId,
    status,
    issues,
  };
}

/**
 * Rebuilds an authoring envelope from an accepted snapshot so the golden
 * round-trip (SketchUp → Granete → SketchUp) can be asserted semantically.
 * Read-only resolved feedback never re-enters through here.
 */
export function envelopeFromSnapshot(
  snapshot: ReadonlyAuthoringSnapshot,
  source: AuthoringEnvelopeV1['source'],
): AuthoringEnvelopeV1 {
  return {
    schemaId: SKETCHUP_AUTHORING_SCHEMA_ID,
    schemaName: SKETCHUP_AUTHORING_SCHEMA_NAME,
    schemaVersion: SKETCHUP_AUTHORING_SCHEMA_VERSION,
    messageId: `round-trip-${snapshot.sourceRevisionId}`,
    idempotencyKey: `round-trip:${snapshot.projectId}:${snapshot.sourceRevisionId}`,
    sentAt: '1970-01-01T00:00:00.000Z',
    projectId: snapshot.projectId,
    baseSourceRevisionId: snapshot.sourceRevisionId,
    sourceRevisionId: snapshot.sourceRevisionId,
    source,
    units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
    coordinateSystem: { handedness: 'right', upAxis: 'z', projectFrameId: `${snapshot.projectId}-frame` },
    mutationMode: 'full-snapshot-with-tombstones',
    assemblies: snapshot.assemblies,
    tombstones: [],
  };
}
