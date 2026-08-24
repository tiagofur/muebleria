import { describe, expect, it } from 'vitest';

import {
  cabinetCatalog,
  cabinetEnvelope,
  cloneCabinetEnvelope,
  mutateCabinetEnvelope,
  type WritableEnvelope,
} from './__fixtures__/sketchupAuthoringCabinet';
import { cabinetJoineryCatalog } from './__fixtures__/sketchupJoineryCatalogFixture';
import {
  deriveRelationshipMachining,
  diffRelationshipMachining,
  isFingerprintStale,
  provenanceKey,
  type RelationshipMachiningResult,
} from './sketchupRelationshipMachining';
import { applyAuthoringEnvelope, EMPTY_AUTHORING_STATE } from './sketchupAuthoringExchange';
import type { AuthoringEnvelopeV1, ReadonlyAuthoringSnapshot } from './sketchupAuthoringSchema';

function acceptedSnapshot(): ReadonlyAuthoringSnapshot {
  const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, cloneCabinetEnvelope(), cabinetCatalog);
  if (response.status !== 'accepted' || response.authoringSnapshot === undefined) {
    throw new Error(`fixture envelope was not accepted: ${JSON.stringify(response.issues)}`);
  }
  return response.authoringSnapshot;
}

function resolveFrom(
  mutate: (envelope: WritableEnvelope<AuthoringEnvelopeV1>) => void,
): RelationshipMachiningResult {
  const envelope = mutateCabinetEnvelope(mutate);
  const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, envelope, cabinetCatalog);
  if (response.status !== 'accepted' || response.authoringSnapshot === undefined) {
    throw new Error(`envelope was not accepted: ${JSON.stringify(response.issues)}`);
  }
  return deriveRelationshipMachining(response.authoringSnapshot, cabinetJoineryCatalog);
}

function opIdsByRelationship(result: RelationshipMachiningResult, relationshipId: string): string[] {
  return result.derivedMachiningOperations
    .filter((op) => op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === relationshipId)
    .map((op) => op.operationId)
    .sort();
}

describe('deriveRelationshipMachining — base resolution', () => {
  it('derives provenance-linked operations for every shelf relationship and the manual hinge', () => {
    const result = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);

    expect(result.issues).toEqual([]);
    expect(opIdsByRelationship(result, 'rel-shelf-01')).toEqual([
      'rel-shelf-01:op-1',
      'rel-shelf-01:op-2',
      'rel-shelf-01:op-3',
      'rel-shelf-01:op-4',
      'rel-shelf-01:op-5',
    ]);
    expect(opIdsByRelationship(result, 'rel-shelf-02')).toHaveLength(5);

    const hinge = result.derivedMachiningOperations.find((op) => op.operationId === 'hp-hinge-door-01:op-1');
    expect(hinge?.provenance.sourceKind).toBe('manualHardwarePlacement');
    expect(hinge?.detail.holes[0]).toMatchObject({ diameterMm: 35, depthMm: 12.5, type: 'hinge' });

    for (const op of result.derivedMachiningOperations) {
      expect(provenanceKey(op.provenance)).not.toBe('');
      expect(op.hostComponentInstanceId).toMatch(/^(side-|shelf-)/);
      expect(op.detail.holes.length).toBeGreaterThan(0);
    }
  });

  it('reuses the existing joint primitives: side holes sit at the shelf intent height', () => {
    const result = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);
    const shelfOneSideOps = result.derivedMachiningOperations.filter(
      (op) =>
        op.provenance.sourceKind === 'relationship' &&
        op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-01' &&
        (op.hostComponentInstanceId === 'side-left-01' || op.hostComponentInstanceId === 'side-right-01'),
    );
    // Cam op + dowel op per side, at z=350 (shelf-01 authoring intent).
    expect(shelfOneSideOps).toHaveLength(4);
    for (const op of shelfOneSideOps) {
      for (const hole of op.detail.holes) {
        expect(hole.yMm).toBe(350);
        expect(hole.face).toBe('front');
      }
      expect(op.detail.holes.every((hole) => hole.xMm > 0 && hole.xMm < 570)).toBe(true);
    }
  });
});

describe('canonical case 1 — move a shelf', () => {
  it('moves only the moved relationship machining; unrelated stays structurally identical', () => {
    const before = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);
    const after = resolveFrom((envelope) => {
      const shelf = envelope.assemblies[0]!.components!.find((c) => c.componentInstanceId === 'shelf-02')!;
      shelf.transform = { ...shelf.transform, translationMm: [18, 0, 620] };
    });

    const diff = diffRelationshipMachining(before, after);
    expect(diff.recomputedProvenanceKeys).toEqual(['relationship:rel-shelf-02']);
    expect(diff.unchangedProvenanceKeys).toContain('relationship:rel-shelf-01');
    expect(diff.unchangedProvenanceKeys).toContain('manualHardwarePlacement:hp-hinge-door-01');
    expect(diff.addedProvenanceKeys).toEqual([]);
    expect(diff.removedProvenanceKeys).toEqual([]);

    const sideOps = after.derivedMachiningOperations.filter(
      (op) =>
        op.provenance.sourceKind === 'relationship' &&
        op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-02' &&
        op.hostComponentInstanceId === 'side-left-01',
    );
    for (const op of sideOps) {
      expect(op.detail.holes.every((hole) => hole.yMm === 620)).toBe(true);
    }
    expect(isFingerprintStale(before.bomFingerprint, after.bomFingerprint)).toBe(true);
  });

  it('leaves the fingerprint untouched for non-manufacturing changes (rename)', () => {
    const before = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);
    const after = resolveFrom((envelope) => {
      envelope.assemblies[0]!.displayName = 'Mueble renombrado';
    });
    expect(after.bomFingerprint).toBe(before.bomFingerprint);
  });
});

describe('canonical case 2 — add a second shelf from the same definition', () => {
  it('generates only the new operations without duplicating the first shelf', () => {
    const oneShelf = resolveFrom((envelope) => {
      const assembly = envelope.assemblies[0]!;
      assembly.components = assembly.components!.filter((c) => c.componentInstanceId !== 'shelf-02');
      assembly.relationships = assembly.relationships!.filter((r) => r.relationshipId !== 'rel-shelf-02');
    });
    const twoShelves = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);

    expect(opIdsByRelationship(oneShelf, 'rel-shelf-01')).toEqual(opIdsByRelationship(twoShelves, 'rel-shelf-01'));
    expect(twoShelves.derivedMachiningOperations.length).toBeGreaterThan(oneShelf.derivedMachiningOperations.length);
    expect(twoShelves.bomFingerprint).not.toBe(oneShelf.bomFingerprint);

    // Shared definition, independent instances: hosts differ per shelf.
    const hosts = new Set(
      twoShelves.derivedMachiningOperations
        .filter((op) => op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-02')
        .map((op) => op.hostComponentInstanceId),
    );
    expect(hosts.has('shelf-02')).toBe(true);
    expect(hosts.has('shelf-01')).toBe(false);
  });
});

describe('canonical case 3 — remove a shelf', () => {
  it('removes only its relationships and derived machining; no orphans', () => {
    const before = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);
    const after = resolveFrom((envelope) => {
      const assembly = envelope.assemblies[0]!;
      assembly.components = assembly.components!.filter((c) => c.componentInstanceId !== 'shelf-02');
      assembly.relationships = assembly.relationships!.filter((r) => r.relationshipId !== 'rel-shelf-02');
    });

    const diff = diffRelationshipMachining(before, after);
    expect(diff.removedProvenanceKeys).toEqual(['relationship:rel-shelf-02']);
    expect(diff.unchangedProvenanceKeys).toContain('relationship:rel-shelf-01');
    expect(diff.unchangedProvenanceKeys).toContain('manualHardwarePlacement:hp-hinge-door-01');

    expect(after.derivedMachiningOperations.some((op) => op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-02')).toBe(false);
    expect(after.derivedMachiningOperations.some((op) => op.hostComponentInstanceId === 'shelf-02')).toBe(false);
  });
});

describe('canonical case 4 — change the joinery system', () => {
  it('resolves machining again from the current rules without reusing old truth', () => {
    const before = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);
    const after = resolveFrom((envelope) => {
      const relationship = envelope.assemblies[0]!.relationships!.find((r) => r.relationshipId === 'rel-shelf-02')! as { joinerySystemId?: string };
      relationship.joinerySystemId = 'dowel-only';
    });

    const diff = diffRelationshipMachining(before, after);
    expect(diff.recomputedProvenanceKeys).toEqual(['relationship:rel-shelf-02']);
    expect(diff.unchangedProvenanceKeys).toContain('relationship:rel-shelf-01');

    const shelfTwoOps = after.derivedMachiningOperations.filter(
      (op) => op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-02',
    );
    expect(shelfTwoOps.length).toBeGreaterThan(0);
    for (const op of shelfTwoOps) {
      expect(op.detail.holes.every((hole) => hole.type === 'dowel')).toBe(true);
    }
    expect(after.bomFingerprint).not.toBe(before.bomFingerprint);
  });
});

describe('canonical case 5 — hinge near a shelf', () => {
  it('moving the manual hinge changes only its machining', () => {
    const before = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog);
    const after = resolveFrom((envelope) => {
      const hinge = envelope.assemblies[0]!.hardwarePlacements![0]!;
      hinge.offsetMm = [40, 250];
    });

    const diff = diffRelationshipMachining(before, after);
    expect(diff.recomputedProvenanceKeys).toEqual(['manualHardwarePlacement:hp-hinge-door-01']);
    expect(diff.unchangedProvenanceKeys).toContain('relationship:rel-shelf-01');
    expect(diff.unchangedProvenanceKeys).toContain('relationship:rel-shelf-02');

    const hinge = after.derivedMachiningOperations.find((op) => op.operationId === 'hp-hinge-door-01:op-1');
    expect(hinge?.detail.holes[0]).toMatchObject({ xMm: 40, yMm: 250 });
  });
});

describe('invalid and impossible relationships', () => {
  it('fails structured when the shelf is outside the side panel height', () => {
    const result = resolveFrom((envelope) => {
      const shelf = envelope.assemblies[0]!.components!.find((c) => c.componentInstanceId === 'shelf-02')!;
      shelf.transform = { ...shelf.transform, translationMm: [18, 0, 800] };
    });

    expect(result.issues.map((issue) => issue.code)).toContain('RELATIONSHIP_INVALID');
    expect(result.derivedMachiningOperations.some((op) => op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-02')).toBe(false);
    expect(result.derivedMachiningOperations.some((op) => op.provenance.sourceKind === 'relationship' && op.provenance.relationshipId === 'rel-shelf-01')).toBe(true);
  });

  it('fails structured for orphaned anchors; unknown joinery fails at the envelope gate', () => {
    const orphan = deriveRelationshipMachining(
      {
        projectId: 'project-42',
        sourceRevisionId: 'source-rev-8',
        assemblies: [
          {
            ...cabinetEnvelope.assemblies[0]!,
            components: cabinetEnvelope.assemblies[0]!.components!.slice(0, 1),
            relationships: cabinetEnvelope.assemblies[0]!.relationships!,
          },
        ],
      },
      cabinetJoineryCatalog,
    );
    expect(orphan.issues.map((issue) => issue.code)).toContain('RELATIONSHIP_ORPHANED');

    const envelope = mutateCabinetEnvelope((e) => {
      e.assemblies[0]!.relationships![0]!.joinerySystemId = 'joinery-unknown';
    });
    const rejected = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, envelope, cabinetCatalog);
    expect(rejected.response.status).toBe('rejected');
    expect(rejected.response.issues[0]?.code).toBe('JOINERY_SYSTEM_UNSUPPORTED');
  });
});

describe('post-release staleness', () => {
  it('a released fingerprint goes stale on manufacturing change, never silently equal', () => {
    const released = deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog).bomFingerprint;
    const moved = resolveFrom((envelope) => {
      const shelf = envelope.assemblies[0]!.components!.find((c) => c.componentInstanceId === 'shelf-01')!;
      shelf.transform = { ...shelf.transform, translationMm: [18, 0, 400] };
    }).bomFingerprint;

    expect(isFingerprintStale(released, moved)).toBe(true);
    expect(isFingerprintStale(released, released)).toBe(false);
  });
});
