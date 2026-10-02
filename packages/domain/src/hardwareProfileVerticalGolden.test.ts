/**
 * #919 golden vertical — TS/Go parity over the SAME hand-computed fixture
 * (contracts/hardwareProfileVertical.golden.json). Every number in the
 * fixture was derived on paper; the TS mirror must reproduce the contact
 * operations exactly as the Go engine does. A mismatch is a finding, never
 * a regeneration.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveFixedShelfOperations, type ContactBoard } from './sketchupRelationshipMachining';
import type { PartRelationshipIntent, RelationshipRecipeIntent } from './sketchupAuthoringSchema';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(here, '../../..', 'contracts', 'hardwareProfileVertical.golden.json'), 'utf8'),
) as {
  contactScenario: {
    boards: Record<string, { widthMm: number; thicknessMm: number; lengthMm: number; basis: Record<string, number[]> }>;
    contact: { contactId: string; relationshipId: string; participantA: string; participantB: string; faceA: string; faceB: string };
    stations: { count: number; startMarginMm: number; endMarginMm: number; distancesMm: number[] };
    recipe: {
      recipeId: string; recipeRevision: string; technicalProfileId: string; technicalProfileRevision: string;
      rules: Array<{
        ruleId: string; ruleRevision: string; participantRole: 'A' | 'B'; operationRole: string;
        entryFace: 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
        offsetMm: number[]; axis: number[]; diameterMm: number; depthMm: number;
      }>;
    };
    expectedOperations: {
      operations: Array<{
        participant: string; entryFace: string; diameterMm: number; depthMm: number; ruleId: string;
      }>;
    };
  };
};

function goldenScenario(): { boards: ContactBoard[]; relationship: PartRelationshipIntent } {
  const scenario = golden.contactScenario;
  const board = (id: string): ContactBoard => {
    const raw = scenario.boards[id]!;
    return {
      occurrenceId: id,
      widthMm: raw.widthMm,
      thicknessMm: raw.thicknessMm,
      lengthMm: raw.lengthMm,
      translationMm: [0, 0, 0],
      basis: { x: raw.basis.x as [number, number, number], y: raw.basis.y as [number, number, number], z: raw.basis.z as [number, number, number] },
    };
  };
  const recipe: RelationshipRecipeIntent = {
    contactId: `${scenario.contact.relationshipId}:${scenario.contact.participantB}`,
    recipeId: scenario.recipe.recipeId,
    recipeRevision: scenario.recipe.recipeRevision,
    technicalProfileId: scenario.recipe.technicalProfileId,
    technicalProfileRevision: scenario.recipe.technicalProfileRevision,
    rules: scenario.recipe.rules.map((rule) => ({
      ruleId: rule.ruleId,
      ruleRevision: rule.ruleRevision,
      participantRole: rule.participantRole,
      operationRole: rule.operationRole,
      entryFace: rule.entryFace,
      offsetMm: rule.offsetMm as [number, number, number],
      axis: rule.axis as [number, number, number],
      diameterMm: rule.diameterMm,
      depthMm: rule.depthMm,
    })),
  };
  const relationship: PartRelationshipIntent = {
    relationshipId: scenario.contact.relationshipId,
    kind: 'fixed-shelf-side',
    source: { componentInstanceId: scenario.contact.participantA, role: 'shelf-edge', face: scenario.contact.faceA },
    targets: [{ componentInstanceId: scenario.contact.participantB, role: 'side', face: scenario.contact.faceB }],
    parameters: {
      stationCount: scenario.stations.count,
      startMarginMm: scenario.stations.startMarginMm,
      endMarginMm: scenario.stations.endMarginMm,
    },
    recipes: [recipe],
  };
  return { boards: [board('shelf-A'), board('side-B')], relationship };
}

describe('#919 golden vertical TS/Go parity', () => {
  const { boards, relationship } = goldenScenario();
  const result = deriveFixedShelfOperations(relationship, boards);

  test('the governed joint reaches MACHINING_READY with the hand-planned stations', () => {
    expect(result.issues).toEqual([]);
    expect(result.status.stage).toBe('MACHINING_READY');
    expect(result.status.stations.stationDistances[0]?.distancesMm).toEqual(golden.contactScenario.stations.distancesMm);
  });

  test('the hand-computed holes match exactly (host, face, position, diameter, depth)', () => {
    expect(result.issues).toEqual([]);
    // Cam (participant A rule) hosts on the shelf; dowel (participant B rule)
    // hosts on the side. Each hole sits at its station on the entry face.
    const holesByHost = new Map<string, Array<{ face: string; xMm: number; yMm: number; diameterMm: number; depthMm: number }>>();
    for (const operation of result.operations) {
      holesByHost.set(
        operation.hostComponentInstanceId,
        operation.detail.holes.map(({ face, xMm, yMm, diameterMm, depthMm }) => ({ face, xMm, yMm, diameterMm, depthMm })),
      );
    }
    const cam = holesByHost.get('shelf-A') ?? [];
    expect(cam.map((hole) => [hole.face, hole.xMm, hole.yMm, hole.diameterMm, hole.depthMm])).toEqual([
      ['bottom', 30, 9, 15, 13],
      ['bottom', 70, 9, 15, 13],
    ]);
    const dowel = holesByHost.get('side-B') ?? [];
    expect(dowel.map((hole) => [hole.face, hole.xMm, hole.yMm, hole.diameterMm, hole.depthMm])).toEqual([
      ['back', 30, 9, 8, 12],
      ['back', 70, 9, 8, 12],
    ]);
  });

  test('provenance names the pinned profile, recipe revision and rule', () => {
    for (const operation of result.operations) {
      const provenance = operation.provenance as {
        technicalProfileId?: string; technicalProfileRevision?: string; recipeRevision?: string; catalogRuleId?: string;
      };
      expect(provenance.technicalProfileId).toBe(golden.contactScenario.recipe.technicalProfileId);
      expect(provenance.technicalProfileRevision).toBe(golden.contactScenario.recipe.technicalProfileRevision);
      expect(provenance.recipeRevision).toBe(golden.contactScenario.recipe.recipeRevision);
      // The machining-level provenance carries the RECIPE id in catalogRuleId
      // (same as the Go machining provenance); per-rule identity rides the Go
      // contact-operation provenance.
      expect(provenance.catalogRuleId).toBe(golden.contactScenario.recipe.recipeId);
    }
  });
});
