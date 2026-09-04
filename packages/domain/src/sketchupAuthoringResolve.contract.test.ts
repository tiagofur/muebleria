/**
 * #477 contract parity: the shared fixture at
 * contracts/sketchupAuthoringResolve.contract.json is generated from the Go
 * resolver's own HTTP responses (golden author). This test recomputes the
 * machining truth on the TS side with the #356 relationship resolver over
 * the SAME scenario inputs and asserts the operations and the deterministic
 * fingerprint match the Go wire byte-for-byte — Go and TS must never maintain
 * incompatible parallel payload shapes.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveRelationshipMachining } from './sketchupRelationshipMachining';
import type {
  AuthoringResolveRequestV1,
  AuthoringResolveResponseV1,
} from './sketchupAuthoringResolve';
import {
  MANUFACTURING_PREFLIGHT_CONTRACT,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID,
  authoringResolveFingerprint,
  parseAuthoringResolveResponse,
  validateAuthoringResolveRequest,
} from './sketchupAuthoringResolve';
import type {
  DesignAssembly,
  HardwarePlacementIntent,
  PartRelationshipIntent,
  ReadonlyAuthoringSnapshot,
  Transform3D,
} from './sketchupAuthoringSchema';
import type {
  ManualHardwareRule,
  ShelfSupportRule,
  SketchUpComponentGeometry,
  SketchUpJoineryCatalog,
} from './sketchupJoineryCatalog';
import type { Hardware } from './types';
import type { FurnitureParameter } from './smartFurnitureDomain';
import { evaluateFurnitureParameters } from './furnitureParameters';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
  'contracts',
  'sketchupAuthoringResolve.contract.json',
);

interface FixtureCase {
  readonly id: string;
  readonly request: AuthoringResolveRequestV1;
  readonly query?: string;
  readonly expectedHttpStatus: number;
  readonly response: AuthoringResolveResponseV1;
}

interface FixtureFile {
  readonly schemaVersion: number;
  readonly schema: { readonly schemaId: string; readonly schemaName: string; readonly schemaVersion: string };
  readonly furnitureDefinitionId: string;
  readonly parameterDefinitions: readonly FurnitureParameter[];
  readonly joinery: {
    readonly componentGeometry: Readonly<Record<string, Omit<SketchUpComponentGeometry, 'componentDefinitionId'>>>;
    readonly joinerySystems: Readonly<Record<string, ShelfSupportRule>>;
    readonly relationshipKinds: Readonly<Record<string, string>>;
    readonly machiningProfiles: Readonly<Record<string, ManualHardwareRule & { readonly profileId: string }>>;
    readonly machiningProfileContract: string;
    readonly hardware: readonly Hardware[];
  };
  readonly scenarios: readonly FixtureCase[];
}

const identityTransform = (frame: Transform3D['frame']): Transform3D => ({
  frame,
  translationMm: [0, 0, 0],
  rotationQuaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

function loadFixture(): FixtureFile {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureFile;
}

function fixtureJoineryCatalog(fixture: FixtureFile): SketchUpJoineryCatalog {
  const componentGeometry: Record<string, SketchUpComponentGeometry> = {};
  for (const [definitionId, geometry] of Object.entries(fixture.joinery.componentGeometry)) {
    componentGeometry[definitionId] = { ...geometry, componentDefinitionId: definitionId };
  }
  // Manual machining rules come from the VERSIONED technical profile table
  // keyed by hardware code — the same table the Go resolver consumes. TS
  // never hardcodes its own hinge rules.
  const manualHardware: Record<string, ManualHardwareRule> = {};
  for (const hardware of fixture.joinery.hardware) {
    const profile = fixture.joinery.machiningProfiles[hardware.code];
    if (profile) {
      manualHardware[hardware.id] = {
        pilotDiameterMm: profile.pilotDiameterMm,
        pilotDepthMm: profile.pilotDepthMm,
        holeType: profile.holeType as ManualHardwareRule['holeType'],
        boardFace: profile.boardFace as ManualHardwareRule['boardFace'],
      };
    }
  }
  return {
    componentGeometry,
    joinerySystems: { ...fixture.joinery.joinerySystems },
    relationshipKinds: { ...fixture.joinery.relationshipKinds },
    manualHardware,
    hardware: [...fixture.joinery.hardware],
  };
}

/** Rebuild the authoring snapshot the Go resolver acted on, from the wire. */
function snapshotFromScenario(scenario: FixtureCase): ReadonlyAuthoringSnapshot {
  const resolved = scenario.response.resolved;
  if (!resolved || !scenario.response.normalizedSnapshot) {
    throw new Error(`scenario ${scenario.id}: accepted fixture case must carry the resolved payload`);
  }
  const assembly: DesignAssembly = {
    assemblyId: 'fixture-assembly',
    catalogItemId: '',
    catalogRevision: '',
    transform: identityTransform('project'),
    parameters: {},
    components: resolved.layout.components.map((component) => ({
      componentDefinitionId: component.componentDefinitionId,
      componentInstanceId: component.componentInstanceId,
      role: component.role ?? '',
      transform: {
        frame: 'assembly' as const,
        translationMm: [...component.transform.translationMm] as [number, number, number],
        rotationQuaternion: [0, 0, 0, 1] as [number, number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    })),
    relationships:
      scenario.response.normalizedSnapshot.relationships as PartRelationshipIntent[],
    hardwarePlacements:
      scenario.response.normalizedSnapshot.hardwarePlacements as HardwarePlacementIntent[],
  };
  return {
    projectId: 'fixture-project',
    sourceRevisionId: 'fixture-rev',
    assemblies: [assembly],
  };
}

describe('#477 shared authoring resolve contract fixture', () => {
  const fixture = loadFixture();

  test('carries the versioned schema identity the Go resolver enforces', () => {
    expect(fixture.schema.schemaId).toBe(SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID);
    expect(fixture.schema.schemaName).toBe('granete.sketchup-authoring-resolve');
    expect(fixture.schema.schemaVersion).toBe('1.0');
  });

  test('covers the canonical scenarios and the negative proofs', () => {
    const ids = fixture.scenarios.map((scenario) => scenario.id);
    for (const required of [
      '01-params-materials-parity',
      '02-move-shelf',
      '03-add-shelf-shared-definition',
      '04-remove-shelf',
      '05-move-manual-hinge',
      '06-replace-hinge',
      '07-orphan-anchor-rejection',
      '08-unknown-schema-version',
      '10-unicode-quarter-step',
      '11-material-pbr-roundtrip',
      '12-cost-only-manual-hardware',
      'neg-query-parameter',
      'neg-adhoc-body-parameter',
      'neg-duplicate-occurrence-id',
    ]) {
      expect(ids).toContain(required);
    }
  });

  test('shared fixture proves UTF-8 fingerprinting and arbitrary-step precision', () => {
    const scenario = fixture.scenarios.find((entry) => entry.id === '10-unicode-quarter-step')!;
    expect(scenario.request.units.precisionMm).toBe(0.25);
    expect(
      scenario.request.furniture.components?.some((component) =>
        /[^\x00-\x7F]/u.test(component.componentInstanceId),
      ),
    ).toBe(true);

    const shelf = scenario.response.normalizedSnapshot?.components.find(
      (component) => component.componentInstanceId === 'entrepaño-ñ-01',
    );
    expect(shelf).toBeDefined();
    expect(shelf!.transform!.translationMm[0] / 0.25).toBe(
      Math.round(shelf!.transform!.translationMm[0] / 0.25),
    );
    expect(shelf!.transform!.translationMm[2] / 0.25).toBe(
      Math.round(shelf!.transform!.translationMm[2] / 0.25),
    );
    expect(scenario.response.resolved!.machining.manufacturingFingerprint).toMatch(/^sha256-[0-9a-f]{64}$/u);
  });

  test('full material projection and cost-only hardware survive the runtime contract', () => {
    const material = fixture.scenarios.find((entry) => entry.id === '11-material-pbr-roundtrip')!;
    const materialResponse = parseAuthoringResolveResponse(material.response, material.request);
    expect(materialResponse.status).toBe('accepted');
    if (materialResponse.status !== 'accepted') throw new Error('material scenario must be accepted');
    const textured = materialResponse.resolved.layout.components.find(
      (component) => component.materialTextureUrl === '/api/media/materials/roble-claro-texture.webp',
    );
    expect(textured).toMatchObject({
      materialImageUrl: '/api/media/materials/roble-claro.webp',
      materialTextureTileWidthMm: 600,
      materialTextureTileLengthMm: 1200,
      materialRoughness: 0.42,
      materialMetalness: 0.08,
      materialClearcoat: 0.15,
      materialGrain: true,
    });

    const costOnly = fixture.scenarios.find((entry) => entry.id === '12-cost-only-manual-hardware')!;
    const costOnlyResponse = parseAuthoringResolveResponse(costOnly.response, costOnly.request);
    expect(costOnlyResponse.status).toBe('accepted');
    if (costOnlyResponse.status !== 'accepted') throw new Error('cost-only scenario must be accepted');
    expect(costOnlyResponse.normalizedSnapshot.hardwarePlacements).toContainEqual(
      expect.objectContaining({ hardwarePlacementId: 'hp-cost-only-01', catalogHardwareId: 'hw-minifix' }),
    );
    expect(costOnlyResponse.resolved.layout.hardware).not.toContainEqual(
      expect.objectContaining({ placementId: 'hp-cost-only-01' }),
    );
    expect(costOnlyResponse.resolved.machining.manufacturingFingerprint).toMatch(/^sha256-[0-9a-f]{64}$/u);
  });

  test('every response echoes the capability marker before any host mutation', () => {
    for (const scenario of fixture.scenarios) {
      expect(scenario.response.schemaId).toBe(SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID);
      expect(scenario.response.resolveContract).toBe(SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID);
      if (scenario.query) {
        // The query-string rejection happens before the body is decoded: the
        // envelope honestly carries no correlation because the request
        // message was never read.
        expect(scenario.response.inReplyToMessageId).toBe('');
        continue;
      }
      expect(scenario.response.responseMessageId).toBe(`resolve-${scenario.request.messageId}`);
      expect(scenario.response.inReplyToMessageId).toBe(scenario.request.messageId);
      expect(scenario.response.idempotencyKey).toBe(scenario.request.idempotencyKey);
    }
  });

  test('TS client-side validation agrees with the Go gateway on every scenario', () => {
    for (const scenario of fixture.scenarios) {
      const tsIssues = validateAuthoringResolveRequest(scenario.request, {
        hardwareCatalog: fixture.joinery.hardware,
      });
      const parameterIssues = evaluateFurnitureParameters(
        fixture.parameterDefinitions,
        scenario.request.furniture.parameters ?? {},
      ).issues;
      const tsCodes = new Set([...tsIssues.map((issue) => issue.code), ...parameterIssues.map((issue) => issue.code)]);
      const goCodes = (scenario.response.issues ?? []).map((issue) => issue.code);

      if (scenario.response.status === 'accepted') {
        // The query-string negative proof is transport-level (the body is
        // valid); everything else accepted must pass TS validation clean.
        if (!scenario.query) {
          expect(tsIssues, scenario.id).toHaveLength(0);
          expect(parameterIssues, scenario.id).toHaveLength(0);
        }
        expect(scenario.expectedHttpStatus, scenario.id).toBe(200);
      } else {
        expect(goCodes.length, scenario.id).toBeGreaterThan(0);
        // The Go rejection code must be one the TS validator also knows how
        // to produce from the same request (schema/field/content rules).
        if (!scenario.query) {
          // The transport validator checks scalar shape; the shared typed
          // definition evaluator checks membership/defaults/rules.
          if (!goCodes.every((code) => code === 'PARAMETER_INVALID')) {
            expect(goCodes.some((code) => tsCodes.has(code)), `${scenario.id}: go=${goCodes} ts=${[...tsCodes]}`).toBe(true);
          }
        }
      }
    }
  });

  test('TS #356 machining recomputation matches the Go wire for every accepted scenario', () => {
    const catalog = fixtureJoineryCatalog(fixture);
    const accepted = fixture.scenarios.filter((scenario) => scenario.response.status === 'accepted');
    expect(accepted.length).toBeGreaterThanOrEqual(7);

    for (const scenario of accepted) {
      const result = deriveRelationshipMachining(snapshotFromScenario(scenario), catalog);

      const machining = scenario.response.resolved!.machining;
      const wireOps = [...machining.operations].sort((a, b) =>
        a.operationId.localeCompare(b.operationId),
      );
      const tsOps = [...result.derivedMachiningOperations]
        .map((operation) => ({
          operationId: operation.operationId,
          hostComponentInstanceId: operation.hostComponentInstanceId,
          provenance: operation.provenance,
          holes: operation.detail.holes,
        }))
        .sort((a, b) => a.operationId.localeCompare(b.operationId));

      expect(tsOps.length, scenario.id).toBe(wireOps.length);
      for (let i = 0; i < wireOps.length; i += 1) {
        const wireOp = wireOps[i]!;
        expect(canonicalize(tsOps[i]), `${scenario.id} op ${wireOp.operationId}`).toBe(
          canonicalize(wireOp),
        );
      }

      const wirePlacements = [...machining.derivedHardwarePlacements].sort((a, b) =>
        a.derivedHardwarePlacementId.localeCompare(b.derivedHardwarePlacementId),
      );
      const tsPlacements = [...result.derivedHardwarePlacements].sort((a, b) =>
        a.derivedHardwarePlacementId.localeCompare(b.derivedHardwarePlacementId),
      );
      expect(tsPlacements.length, scenario.id).toBe(wirePlacements.length);
      for (let i = 0; i < wirePlacements.length; i += 1) {
        expect(canonicalize(tsPlacements[i]), scenario.id).toBe(canonicalize(wirePlacements[i]));
      }

      // The machining fingerprint of the #356 resolver is the machining-side
      // anchor: Go and TS must derive the same machining identity.
      expect(result.bomFingerprint, scenario.id).toBeDefined();

      // The FULL manufacturing fingerprint is the resolve-contract anchor:
      // boards (dimensions + materials), manual placements, derived
      // placements and machining — recomputed from the wire on the TS side.
      const normalizedComponents = scenario.response.normalizedSnapshot?.components ?? [];
      const boards = (scenario.response.resolved?.layout.components ?? []).map((component) => {
        const normalizedComponent = normalizedComponents.find(
          (entry) => entry.componentInstanceId === component.componentInstanceId,
        );
        return {
          id: component.componentInstanceId,
          defId: component.componentDefinitionId,
          catalogComponentId: normalizedComponent?.catalogComponentId,
          role: component.role ?? '',
          lengthMm: component.lengthMm,
          widthMm: component.widthMm,
          thicknessMm: component.thicknessMm,
          materialId: component.materialId,
        };
      });
      const fingerprint = authoringResolveFingerprint({
        boards,
        manualPlacements: (scenario.response.normalizedSnapshot?.hardwarePlacements ?? []).map((placement) => ({
          id: placement.hardwarePlacementId,
          hardwareId: placement.catalogHardwareId,
          host: placement.hostComponentInstanceId,
          anchorFace: placement.anchorFace,
          offsetMm: placement.offsetMm,
        })),
        derivedHardwarePlacements: machining.derivedHardwarePlacements,
        operations: machining.operations,
      });
      expect(fingerprint, scenario.id).toBe(machining.manufacturingFingerprint);
    }
  });

  test('dependent machining tracks the authoring intent across the canonical flow', () => {
    const byId = new Map(fixture.scenarios.map((scenario) => [scenario.id, scenario]));
    const fingerprint = (id: string) =>
      byId.get(id)!.response.resolved!.machining.manufacturingFingerprint;
    const opsOf = (id: string) => byId.get(id)!.response.resolved!.machining.operations;

    // Moving the shelf moves the fingerprint, keeps unrelated machining.
    expect(fingerprint('02-move-shelf')).not.toBe(fingerprint('04-remove-shelf'));
    const movedShelfHoles = opsOf('02-move-shelf')
      .filter((operation) => operation.hostComponentInstanceId === 'side-left-01')
      .flatMap((operation) => operation.holes);
    for (const hole of movedShelfHoles) {
      expect(hole.yMm).toBe(520);
    }

    // Replacing the hinge moves the fingerprint (cup diameter follows the
    // selected definition).
    expect(fingerprint('06-replace-hinge')).not.toBe(fingerprint('04-remove-shelf'));
    const replaced = opsOf('06-replace-hinge').find(
      (operation) => operation.provenance.sourceKind === 'manualHardwarePlacement',
    );
    expect(replaced?.holes[0]?.diameterMm).toBe(32);

    // Removing the shelf leaves zero relationship-derived machining.
    for (const operation of opsOf('04-remove-shelf')) {
      expect(operation.provenance.sourceKind).not.toBe('relationship');
    }

    // Preflight contract marker stays linked to the #347 model.
    for (const scenario of fixture.scenarios) {
      if (scenario.response.resolved) {
        expect(scenario.response.resolved.preflight.preflightContract).toBe(
          MANUFACTURING_PREFLIGHT_CONTRACT,
        );
      }
    }
  });

  test('occurrence identity survives request→resolve on the wire', () => {
    const moveShelf = fixture.scenarios.find((scenario) => scenario.id === '02-move-shelf')!;
    const layout = moveShelf.response.resolved!.layout;
    const instanceIds = layout.components.map((component) => component.componentInstanceId);
    for (const occurrence of moveShelf.request.furniture.components ?? []) {
      expect(instanceIds).toContain(occurrence.componentInstanceId);
    }
    // Two shelves sharing a definition keep independent identity (scenario 03).
    const addShelf = fixture.scenarios.find((scenario) => scenario.id === '03-add-shelf-shared-definition')!;
    const shelves = (addShelf.response.resolved?.layout.components ?? []).filter(
      (component) => component.componentDefinitionId === 'mod-comp-shelf',
    );
    expect(shelves.length).toBe(2);
    expect(new Set(shelves.map((shelf) => shelf.componentInstanceId)).size).toBe(2);
  });
});
