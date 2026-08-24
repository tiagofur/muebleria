/**
 * Authoring exchange engine: applies a full-snapshot-with-tombstones envelope
 * to previously accepted state, atomically and idempotently, and produces the
 * correlated round-trip response. Pure domain logic: the caller persists the
 * returned state; this module never resolves manufacturing truth.
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

/** Accepted authoring state for one project; persisted by the caller. */
export type AuthoringExchangeState = {
  readonly projectId: string;
  readonly sourceRevisionId: string;
  readonly assemblies: ReadonlyMap<StableEntityId, DesignAssembly>;
  readonly deletedAssemblyIds: ReadonlySet<StableEntityId>;
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
  deletedAssemblyIds: new Set(),
  idempotency: new Map(),
};

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

  // 5. Snapshot completeness: omission never deletes.
  const snapshotIssues = checkSnapshotCompleteness(state, envelope);
  if (snapshotIssues.length > 0) {
    return conflict(state, envelope, snapshotIssues);
  }

  // 6. Tombstone and ID-reuse guards.
  const tombstoneIssues = checkTombstonesAndReuse(state, envelope);
  if (tombstoneIssues.length > 0) {
    return rejected(state, envelope, tombstoneIssues);
  }

  // 7. Atomic apply.
  const assemblies = new Map(state.assemblies);
  const deletedAssemblyIds = new Set(state.deletedAssemblyIds);
  const created: StableEntityId[] = [];
  const updated: StableEntityId[] = [];
  const deleted: StableEntityId[] = [];

  for (const tombstone of envelope.tombstones) {
    if (tombstone.entityType === 'assembly' && assemblies.delete(tombstone.entityId)) {
      deletedAssemblyIds.add(tombstone.entityId);
      deleted.push(tombstone.entityId);
    }
  }
  for (const assembly of envelope.assemblies) {
    if (assemblies.has(assembly.assemblyId)) {
      updated.push(assembly.assemblyId);
    } else {
      created.push(assembly.assemblyId);
    }
    assemblies.set(assembly.assemblyId, assembly);
  }

  const nextState: AuthoringExchangeState = {
    projectId: envelope.projectId,
    sourceRevisionId: envelope.sourceRevisionId,
    assemblies,
    deletedAssemblyIds,
    idempotency: new Map(state.idempotency).set(envelope.idempotencyKey, {
      payloadFingerprint: fingerprint,
      response: acceptedResponse(
        envelope,
        {
          createdEntityIds: created,
          updatedEntityIds: updated,
          deletedEntityIds: deleted,
        },
        migration,
        assemblies,
      ),
    }),
  };
  return { state: nextState, response: nextState.idempotency.get(envelope.idempotencyKey)!.response };
}

function checkSnapshotCompleteness(
  state: Readonly<AuthoringExchangeState>,
  envelope: AuthoringEnvelopeV1,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];
  const sent = new Set(envelope.assemblies.map((assembly) => assembly.assemblyId));
  const tombstoned = new Set(
    envelope.tombstones
      .filter((tombstone) => tombstone.entityType === 'assembly')
      .map((tombstone) => tombstone.entityId),
  );

  for (const assemblyId of state.assemblies.keys()) {
    if (!sent.has(assemblyId) && !tombstoned.has(assemblyId)) {
      issues.push({
        code: 'SOURCE_REVISION_CONFLICT',
        message: `assembly ${assemblyId} is missing from the snapshot without a tombstone`,
        severity: 'error',
        entityId: assemblyId,
        remediation: 'Send the full snapshot or tombstone the deleted assembly.',
      });
    }
  }
  return issues;
}

function checkTombstonesAndReuse(
  state: Readonly<AuthoringExchangeState>,
  envelope: AuthoringEnvelopeV1,
): readonly ContractIssue[] {
  const issues: ContractIssue[] = [];

  for (const tombstone of envelope.tombstones) {
    if (tombstone.entityType !== 'assembly') continue;
    if (!state.assemblies.has(tombstone.entityId) && !state.deletedAssemblyIds.has(tombstone.entityId)) {
      issues.push({
        code: 'ENTITY_TOMBSTONE_INVALID',
        message: `tombstone for unknown assembly ${tombstone.entityId}`,
        severity: 'error',
        entityId: tombstone.entityId,
      });
    }
  }
  for (const assembly of envelope.assemblies) {
    if (state.deletedAssemblyIds.has(assembly.assemblyId)) {
      issues.push({
        code: 'STABLE_ID_REUSE',
        message: `assemblyId ${assembly.assemblyId} was deleted and can never be reused`,
        severity: 'error',
        entityId: assembly.assemblyId,
      });
    }
  }
  return issues;
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
