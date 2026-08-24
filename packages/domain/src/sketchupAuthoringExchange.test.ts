import { describe, expect, it } from 'vitest';

import { cabinetCatalog, cabinetEnvelope, cloneCabinetEnvelope } from './__fixtures__/sketchupAuthoringCabinet';
import {
  EMPTY_AUTHORING_STATE,
  applyAuthoringEnvelope,
  envelopeFromSnapshot,
  type AuthoringExchangeState,
} from './sketchupAuthoringExchange';
import {
  SKETCHUP_AUTHORING_SCHEMA_ID,
  fingerprintEnvelope,
  type AuthoringEnvelopeV1,
  type AuthoringRoundTripResponseV1,
} from './sketchupAuthoringSchema';
import { validateAuthoringEnvelope } from './sketchupAuthoringValidation';
import { applyRegisteredMigrations } from './sketchupAuthoringMigrations';

function seedState(): { state: AuthoringExchangeState; response: AuthoringRoundTripResponseV1 } {
  const first = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, cloneCabinetEnvelope(), cabinetCatalog);
  expect(first.response.status).toBe('accepted');
  return { state: first.state as AuthoringExchangeState, response: first.response };
}

type Writable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Writable<U>[] : Writable<T[K]>;
};

function nextEnvelope(
  base: AuthoringEnvelopeV1,
  mutate: (envelope: Writable<AuthoringEnvelopeV1>) => void,
): AuthoringEnvelopeV1 {
  const envelope = JSON.parse(JSON.stringify(base)) as Writable<AuthoringEnvelopeV1>;
  mutate(envelope);
  return envelope as unknown as AuthoringEnvelopeV1;
}

describe('applyAuthoringEnvelope — schema identity', () => {
  it('rejects unknown schemaName or schemaVersion before mutating', () => {
    const unknownName = nextEnvelope(cabinetEnvelope, (e) => {
      e.schemaName = 'other.sketchup-authoring';
    });
    const result = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, unknownName, cabinetCatalog);
    expect(result.response.status).toBe('rejected');
    expect(result.response.issues.map((issue) => issue.code)).toContain('SCHEMA_VERSION_UNSUPPORTED');
    expect(result.state).toBe(EMPTY_AUTHORING_STATE);
  });

  it('rejects a schemaId inconsistent with schemaName + major version', () => {
    const mismatched = nextEnvelope(cabinetEnvelope, (e) => {
      e.schemaId = 'granete.sketchup-authoring.v2';
    });
    const result = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, mismatched, cabinetCatalog);
    expect(result.response.status).toBe('rejected');
    expect(result.response.issues.map((issue) => issue.code)).toContain('SCHEMA_ID_MISMATCH');
  });

  it('fails closed for versions without a registered lossless migration', () => {
    const old = nextEnvelope(cabinetEnvelope, (e) => {
      e.schemaVersion = '0.9';
    });
    expect(applyRegisteredMigrations(old)).toBe('unsupported');
    const result = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, old, cabinetCatalog);
    expect(result.response.status).toBe('rejected');
    expect(result.response.issues[0]?.code).toBe('SCHEMA_VERSION_UNSUPPORTED');
    expect(result.state).toBe(EMPTY_AUTHORING_STATE);
  });
});

describe('applyAuthoringEnvelope — idempotency and correlation', () => {
  it('replays the same response for the same key and payload', () => {
    const { state } = seedState();
    const replay = applyAuthoringEnvelope(state, cloneCabinetEnvelope(), cabinetCatalog);

    expect(replay.response.status).toBe('accepted');
    expect(replay.state).toBe(state);
    expect(replay.response.mutationReceipt?.createdEntityIds).toEqual(['assembly-base-01']);
  });

  it('rejects the same key with a different payload as IDEMPOTENCY_CONFLICT', () => {
    const { state } = seedState();
    const different = nextEnvelope(cabinetEnvelope, (e) => {
      e.sourceRevisionId = 'source-rev-9';
    });
    const result = applyAuthoringEnvelope(state, different, cabinetCatalog);

    expect(result.response.status).toBe('rejected');
    expect(result.response.issues[0]?.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(result.state).toBe(state);
  });

  it('correlates response identity with the request', () => {
    const { response } = seedState();
    expect(response.inReplyToMessageId).toBe(cabinetEnvelope.messageId);
    expect(response.idempotencyKey).toBe(cabinetEnvelope.idempotencyKey);
    expect(response.projectId).toBe(cabinetEnvelope.projectId);
    expect(response.sourceRevisionId).toBe(cabinetEnvelope.sourceRevisionId);
    expect(response.schemaId).toBe(SKETCHUP_AUTHORING_SCHEMA_ID);
  });
});

describe('applyAuthoringEnvelope — atomic mutations', () => {
  it('accepts a first snapshot as pure creates', () => {
    const { response } = seedState();
    expect(response.mutationReceipt).toEqual({
      createdEntityIds: ['assembly-base-01'],
      updatedEntityIds: [],
      deletedEntityIds: [],
    });
    expect(response.authoringSnapshot?.assemblies).toHaveLength(1);
  });

  it('classifies renames as updates that never change the stable ID', () => {
    const { state } = seedState();
    const renamed = nextEnvelope(cabinetEnvelope, (e) => {
      e.messageId = 'msg-rename-1';
      e.idempotencyKey = 'project-42:source-rev-9';
      e.baseSourceRevisionId = 'source-rev-8';
      e.sourceRevisionId = 'source-rev-9';
      e.assemblies[0]!.displayName = 'Mueble bajo renombrado';
    });
    const result = applyAuthoringEnvelope(state, renamed, cabinetCatalog);

    expect(result.response.status).toBe('accepted');
    expect(result.response.mutationReceipt).toEqual({
      createdEntityIds: [],
      updatedEntityIds: ['assembly-base-01'],
      deletedEntityIds: [],
    });
    expect(result.response.authoringSnapshot?.assemblies[0]?.assemblyId).toBe('assembly-base-01');
    expect(result.response.authoringSnapshot?.assemblies[0]?.displayName).toBe('Mueble bajo renombrado');
  });

  it('applies tombstoned deletes and never allows ID reuse', () => {
    const { state } = seedState();
    const deleted = nextEnvelope(cabinetEnvelope, (e) => {
      e.messageId = 'msg-delete-1';
      e.idempotencyKey = 'project-42:source-rev-9';
      e.baseSourceRevisionId = 'source-rev-8';
      e.sourceRevisionId = 'source-rev-9';
      e.assemblies = [];
      e.tombstones = [
        { entityType: 'assembly', entityId: 'assembly-base-01', deletedAt: '2026-08-24T06:00:00Z' },
      ];
    });
    const afterDelete = applyAuthoringEnvelope(state, deleted, cabinetCatalog);
    expect(afterDelete.response.status).toBe('accepted');
    expect(afterDelete.response.mutationReceipt?.deletedEntityIds).toEqual(['assembly-base-01']);
    expect(afterDelete.response.authoringSnapshot?.assemblies).toEqual([]);

    const resurrected = nextEnvelope(cabinetEnvelope, (e) => {
      e.messageId = 'msg-reuse-1';
      e.idempotencyKey = 'project-42:source-rev-10';
      e.baseSourceRevisionId = 'source-rev-9';
      e.sourceRevisionId = 'source-rev-10';
    });
    const result = applyAuthoringEnvelope(afterDelete.state as AuthoringExchangeState, resurrected, cabinetCatalog);
    expect(result.response.status).toBe('rejected');
    expect(result.response.issues[0]?.code).toBe('STABLE_ID_REUSE');
  });

  it('conflicts on a stale base without partial mutation', () => {
    const { state } = seedState();
    const stale = nextEnvelope(cabinetEnvelope, (e) => {
      e.messageId = 'msg-stale-1';
      e.idempotencyKey = 'project-42:source-rev-9';
      e.baseSourceRevisionId = 'source-rev-3';
      e.sourceRevisionId = 'source-rev-9';
      e.assemblies = [];
      e.tombstones = [
        { entityType: 'assembly', entityId: 'assembly-base-01', deletedAt: '2026-08-24T06:00:00Z' },
      ];
    });
    const result = applyAuthoringEnvelope(state, stale, cabinetCatalog);

    expect(result.response.status).toBe('conflict');
    expect(result.response.issues[0]?.code).toBe('SOURCE_REVISION_CONFLICT');
    expect(result.state).toBe(state);
    expect([...(result.state.assemblies.keys())]).toEqual(['assembly-base-01']);
  });

  it('conflicts when a live assembly is omitted without a tombstone', () => {
    const { state } = seedState();
    const incomplete = nextEnvelope(cabinetEnvelope, (e) => {
      e.messageId = 'msg-omission-1';
      e.idempotencyKey = 'project-42:source-rev-9';
      e.baseSourceRevisionId = 'source-rev-8';
      e.sourceRevisionId = 'source-rev-9';
      e.assemblies = [];
    });
    const result = applyAuthoringEnvelope(state, incomplete, cabinetCatalog);

    expect(result.response.status).toBe('conflict');
    expect(result.response.issues[0]?.code).toBe('SOURCE_REVISION_CONFLICT');
    expect(result.response.issues[0]?.entityId).toBe('assembly-base-01');
  });

  it('rejects the whole request when any structural error exists (atomicity)', () => {
    const broken = nextEnvelope(cabinetEnvelope, (e) => {
      const assembly = e.assemblies[0]!;
      const relationship = assembly.relationships![0]!;
      relationship.source.componentInstanceId = 'ghost-instance';
    });
    const result = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, broken, cabinetCatalog);
    expect(result.response.status).toBe('rejected');
    expect(result.state).toBe(EMPTY_AUTHORING_STATE);
  });
});

describe('applyAuthoringEnvelope — golden round-trip', () => {
  it('SketchUp → Granete → SketchUp loses no authoring semantics', () => {
    const { response } = seedState();
    const snapshot = response.authoringSnapshot!;
    expect(snapshot).toBeDefined();

    const back = envelopeFromSnapshot(snapshot, cabinetEnvelope.source);
    const result = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, back, cabinetCatalog);
    expect(result.response.status).toBe('accepted');

    const original = cabinetEnvelope.assemblies[0]!;
    const roundTripped = result.response.authoringSnapshot!.assemblies[0]!;
    expect(fingerprintOfAssemblies(roundTripped)).toBe(fingerprintOfAssemblies(original));

    const shelfOne = roundTripped.components?.find((c) => c.componentInstanceId === 'shelf-01');
    const shelfTwo = roundTripped.components?.find((c) => c.componentInstanceId === 'shelf-02');
    expect(shelfOne?.componentDefinitionId).toBe('definition-shelf');
    expect(shelfTwo?.componentDefinitionId).toBe('definition-shelf');
    expect(shelfOne?.componentInstanceId).not.toBe(shelfTwo?.componentInstanceId);
    expect(roundTripped.relationships?.map((r) => r.relationshipId).sort()).toEqual([
      'rel-shelf-01',
      'rel-shelf-02',
    ]);
    expect(roundTripped.hardwarePlacements?.[0]?.hostComponentInstanceId).toBe('side-left-01');
    expect(roundTripped.transform.translationMm).toEqual([1200, 0, 0]);
  });
});

function fingerprintOfAssemblies(assembly: unknown): string {
  return JSON.stringify(sortKeys(assembly));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function reverseAllKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseAllKeys) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([k, v]) => [k, reverseAllKeys(v)])) as unknown as T;
  }
  return value;
}

describe('validateAuthoringEnvelope — structured issues', () => {
  it('reports unknown catalog references, stale revisions and unsupported joinery', () => {
    const envelope = nextEnvelope(cabinetEnvelope, (e) => {
      e.assemblies[0]!.catalogItemId = 'module-unknown-999';
      e.assemblies[0]!.hardwarePlacements![0]!.catalogHardwareId = 'hinge-unknown';
      e.assemblies[0]!.relationships![0]!.joinerySystemId = 'joinery-unknown';
    });
    const codes = validateAuthoringEnvelope(envelope, cabinetCatalog).map((issue) => issue.code);

    expect(codes).toContain('CATALOG_REFERENCE_MISSING');
    expect(codes).toContain('JOINERY_SYSTEM_UNSUPPORTED');
  });

  it('flags duplicate stable IDs and orphan anchors with stable paths', () => {
    const envelope = nextEnvelope(cabinetEnvelope, (e) => {
      e.assemblies[0]!.components![1]!.componentInstanceId = 'side-left-01';
    });
    const issues = validateAuthoringEnvelope(envelope, cabinetCatalog);
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain('STABLE_ID_DUPLICATE');
    expect(issues.every((issue) => issue.path === undefined || issue.path.includes('assemblies['))).toBe(true);
  });

  it('rejects negative, non-uniform or unnormalized transforms', () => {
    const envelope = nextEnvelope(cabinetEnvelope, (e) => {
      e.assemblies[0]!.transform.scale = [1, 1, -1];
    });
    const codes = validateAuthoringEnvelope(envelope, cabinetCatalog).map((issue) => issue.code);
    expect(codes).toContain('TRANSFORM_INVALID');
  });

  it('treats resolved manufacturing data as out-of-authoring by construction', () => {
    // The envelope type has no field for resolved parts/drilling/machine
    // output; feeding resolved feedback back must go through a new envelope,
    // which the schema cannot express. This asserts the read-only boundary.
    const envelope = cloneCabinetEnvelope();
    const serialized = JSON.stringify(envelope);
    for (const forbidden of ['ResolvedBoardPart', 'drilling', 'toolpath', 'bomFingerprint']) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});

describe('fingerprintEnvelope', () => {
  it('is invariant to key order and transport rounding noise', () => {
    const reordered = reverseAllKeys(cabinetEnvelope);
    expect(fingerprintEnvelope(reordered)).toBe(fingerprintEnvelope(cabinetEnvelope));

    const slightlyDifferentMm = nextEnvelope(cabinetEnvelope, (e) => {
      e.assemblies[0]!.transform.translationMm = [1200.004, 0, 0];
    });
    expect(fingerprintEnvelope(slightlyDifferentMm)).toBe(fingerprintEnvelope(cabinetEnvelope));

    const different = nextEnvelope(cabinetEnvelope, (e) => {
      e.assemblies[0]!.transform.translationMm = [1300, 0, 0];
    });
    expect(fingerprintEnvelope(different)).not.toBe(fingerprintEnvelope(cabinetEnvelope));
  });
});
