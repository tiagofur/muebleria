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

/**
 * Exact quaternion of an axis-aligned signed basis (the only shape the
 * resolved layout publishes): the standard matrix→quaternion conversion, so
 * the TS engine receives the same rigid pose Go's boardLocalPose produced.
 */
function basisToQuaternion(basis: {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly number[];
}): [number, number, number, number] {
  const R = [
    [basis.x[0]!, basis.y[0]!, basis.z[0]!],
    [basis.x[1]!, basis.y[1]!, basis.z[1]!],
    [basis.x[2]!, basis.y[2]!, basis.z[2]!],
  ];
  const trace = R[0]![0]! + R[1]![1]! + R[2]![2]!;
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(R[2]![1]! - R[1]![2]!) / s, (R[0]![2]! - R[2]![0]!) / s, (R[1]![0]! - R[0]![1]!) / s, s / 4];
  } else if (R[0]![0]! > R[1]![1]! && R[0]![0]! > R[2]![2]!) {
    const s = Math.sqrt(1 + R[0]![0]! - R[1]![1]! - R[2]![2]!) * 2;
    q = [s / 4, (R[0]![1]! + R[1]![0]!) / s, (R[0]![2]! + R[2]![0]!) / s, (R[2]![1]! - R[1]![2]!) / s];
  } else if (R[1]![1]! > R[2]![2]!) {
    const s = Math.sqrt(1 + R[1]![1]! - R[0]![0]! - R[2]![2]!) * 2;
    q = [(R[0]![1]! + R[1]![0]!) / s, s / 4, (R[1]![2]! + R[2]![1]!) / s, (R[0]![2]! - R[2]![0]!) / s];
  } else {
    const s = Math.sqrt(1 + R[2]![2]! - R[0]![0]! - R[1]![1]!) * 2;
    q = [(R[0]![2]! + R[2]![0]!) / s, (R[1]![2]! + R[2]![1]!) / s, s / 4, (R[1]![0]! - R[0]![1]!) / s];
  }
  const norm = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0]! / norm, q[1]! / norm, q[2]! / norm, q[3]! / norm];
}

/**
 * Rebuild the authoring snapshot the Go resolver acted on, from the wire.
 * The board pose is the RESOLVED localTransform (the same rigid frame the
 * SketchUp runtime transports as the instance quaternion): joinery parity
 * consumes the geometry authority, not a synthesized identity frame.
 */
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
        translationMm: component.localTransform
          ? ([...component.localTransform.translationMm] as [number, number, number])
          : ([...component.transform.translationMm] as [number, number, number]),
        rotationQuaternion: component.localTransform
          ? basisToQuaternion(component.localTransform.basis)
          : ([0, 0, 0, 1] as [number, number, number, number]),
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
      '19-manual-handle-rotation-deg',
      'neg-query-parameter',
      'neg-adhoc-body-parameter',
      'neg-duplicate-occurrence-id',
      '20-floor-side-contacts',
      '21-floor-side-station-count',
      '22-floor-side-margins',
      '23-floor-side-reorder',
      '24-floor-side-none',
      '25-floor-side-unsupported-kind',
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

  test('shared fixture proves manual rotationDeg survives request, snapshot, and layout basis', () => {
    const scenario = fixture.scenarios.find((entry) => entry.id === '19-manual-handle-rotation-deg')!;
    const parsed = parseAuthoringResolveResponse(scenario.response, scenario.request);
    expect(parsed.status).toBe('accepted');
    if (parsed.status !== 'accepted') throw new Error('rotationDeg scenario must be accepted');

    const requestPlacement = scenario.request.furniture.hardwarePlacements?.[0];
    expect(requestPlacement).toMatchObject({
      hardwarePlacementId: 'hp-handle-rotated-01',
      rotationDeg: { x: 5, y: 10, z: 90 },
    });

    const snapshotPlacement = parsed.normalizedSnapshot.hardwarePlacements.find(
      (placement) => placement.hardwarePlacementId === 'hp-handle-rotated-01',
    );
    expect(snapshotPlacement?.rotationDeg).toEqual({ x: 5, y: 10, z: 90 });

    const hardware = parsed.resolved.layout.hardware.find(
      (placement) => placement.placementId === 'hp-handle-rotated-01',
    ) as { readonly localTransform?: { readonly basis?: Record<string, readonly number[]> } } | undefined;
    expect(hardware?.localTransform?.basis).toBeDefined();
    expect(hardware!.localTransform!.basis).not.toEqual({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
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
          // RELATIONSHIP_ORPHANED on a component-less request is gateway
          // authority (#467): only the server knows the definition's
          // composition, so a client cannot reproduce this rejection.
          const gatewayOnly =
            goCodes.every((code) => code === 'PARAMETER_INVALID') ||
            (goCodes.every((code) => code === 'RELATIONSHIP_ORPHANED') &&
              !(scenario.request.furniture.components ?? []).length);
          if (!gatewayOnly) {
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
        joineryStatuses: machining.joineryStatuses,
      });
      expect(fingerprint, scenario.id).toBe(machining.manufacturingFingerprint);

      // J1-B cross-runtime parity: the TS twin must derive the same joinery
      // states from the wire-resolved geometry the Go resolver published.
      const wireJoinery = machining.joineryStatuses ?? [];
      if (wireJoinery.length > 0 || result.joineryStatuses.length > 0) {
        const byRelationship = (statuses: readonly { readonly relationshipId: string }[]) =>
          [...statuses].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
        expect(
          byRelationship(result.joineryStatuses).map((status) => canonicalize(status)),
          scenario.id,
        ).toEqual(byRelationship(wireJoinery).map((status) => canonicalize(status)));
      }
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

describe('J1 golden floor-side cross-runtime parity (#874)', () => {
  const fixture = loadFixture();
  const byId = new Map(fixture.scenarios.map((scenario) => [scenario.id, scenario]));
  const machiningOf = (id: string) => byId.get(id)!.response.resolved!.machining;
  const joineryOf = (id: string) => machiningOf(id).joineryStatuses!;
  const fingerprintOf = (id: string) => machiningOf(id).manufacturingFingerprint;

  test('golden cabinet resolves two valid floor-side contacts with exact stations and the honest blocker', () => {
    const status = joineryOf('20-floor-side-contacts');
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      relationshipId: 'rel-floor-sides-01',
      kind: 'floor-side',
      stage: 'TECHNICAL_PROFILE_REQUIRED',
      blockers: ['TECHNICAL_PROFILE_REQUIRED'],
    });
    expect(status[0]!.contacts).toEqual([
      { contactId: 'rel-floor-sides-01:side-left-01', status: 'VALID', issueCodes: [] },
      { contactId: 'rel-floor-sides-01:side-right-01', status: 'VALID', issueCodes: [] },
    ]);
    expect(status[0]!.stations.status).toBe('PLANNED');
    expect(status[0]!.stations.stationCounts).toEqual([
      { contactId: 'rel-floor-sides-01:side-left-01', stationCount: 3 },
      { contactId: 'rel-floor-sides-01:side-right-01', stationCount: 3 },
    ]);
    // Independently expected positions: the asymmetric cabinet leaves the
    // left contact a 542 mm useful overlap ([0,542] from its frame origin)
    // and the right contact 524 mm ([18,542]); stationCount 3 with margins
    // 30/50 plans 30/261/492 and 30/252/474 respectively.
    expect(status[0]!.stations.stationDistances).toEqual([
      { contactId: 'rel-floor-sides-01:side-left-01', distancesMm: [30, 261, 492] },
      { contactId: 'rel-floor-sides-01:side-right-01', distancesMm: [30, 252, 474] },
    ]);
  });

  test('the floor-side relationship emits zero productive operations beside the joinery-free baseline', () => {
    // The cabinet's operations are the parameter-driven shelf-support
    // machining and the definition's manual door hardware; declaring the
    // floor-side joinery adds none — TECHNICAL_PROFILE_REQUIRED stays at
    // zero operations, never a synthetic recipe.
    expect(machiningOf('20-floor-side-contacts').operations).toEqual(machiningOf('24-floor-side-none').operations);
    for (const operation of machiningOf('20-floor-side-contacts').operations) {
      expect(operation.provenance.sourceKind === 'relationship'
        ? operation.provenance.relationshipId
        : 'manual', operation.operationId).not.toBe('rel-floor-sides-01');
    }
  });

  test('mutations move the manufacturing fingerprint; reorder and error echoes do not', () => {
    // stationCount 3 → 4 changes counts and positions
    expect(fingerprintOf('20-floor-side-contacts')).not.toBe(fingerprintOf('21-floor-side-station-count'));
    expect(joineryOf('21-floor-side-station-count')[0]!.stations.stationCounts)
      .toEqual([
        { contactId: 'rel-floor-sides-01:side-left-01', stationCount: 4 },
        { contactId: 'rel-floor-sides-01:side-right-01', stationCount: 4 },
      ]);
    // margins 30/50 → 10/20 move the station positions (left span [10,522],
    // right span [28,522] = distances 10/266/522 and 10/257/504 from origin)
    expect(fingerprintOf('20-floor-side-contacts')).not.toBe(fingerprintOf('22-floor-side-margins'));
    expect(joineryOf('22-floor-side-margins')[0]!.stations.stationDistances).toEqual([
      { contactId: 'rel-floor-sides-01:side-left-01', distancesMm: [10, 266, 522] },
      { contactId: 'rel-floor-sides-01:side-right-01', distancesMm: [10, 257, 504] },
    ]);
    // declaring the joinery at all moves the identity vs the same cabinet
    // without relationships
    expect(fingerprintOf('20-floor-side-contacts')).not.toBe(fingerprintOf('24-floor-side-none'));
    // input reorder (components and targets) keeps it byte-identical
    expect(fingerprintOf('20-floor-side-contacts')).toBe(fingerprintOf('23-floor-side-reorder'));
    // an unsupported relationship kind is a pure error echo: excluded
    expect(fingerprintOf('24-floor-side-none')).toBe(fingerprintOf('25-floor-side-unsupported-kind'));
  });

  test('the unsupported kind is an honest structured state, never a joinery identity', () => {
    expect(joineryOf('25-floor-side-unsupported-kind')).toEqual([
      {
        relationshipId: 'rel-top-sides-01',
        kind: 'top-side',
        stage: 'RELATIONSHIP_UNSUPPORTED',
        contacts: [],
        stations: { status: 'NOT_PLANNED', issueCodes: [], stationCounts: [], stationDistances: [] },
        blockers: ['RELATIONSHIP_INVALID'],
      },
    ]);
  });

  test('TS recomputation reproduces every golden joinery state from the wire', () => {
    const catalog = fixtureJoineryCatalog(fixture);
    for (const id of [
      '20-floor-side-contacts',
      '21-floor-side-station-count',
      '22-floor-side-margins',
      '23-floor-side-reorder',
      '24-floor-side-none',
      '25-floor-side-unsupported-kind',
    ]) {
      const scenario = byId.get(id)!;
      const result = deriveRelationshipMachining(snapshotFromScenario(scenario), catalog);
      const wire = scenario.response.resolved!.machining.joineryStatuses ?? [];
      const sortById = (statuses: readonly { readonly relationshipId: string }[]) =>
        [...statuses].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
      expect(sortById(result.joineryStatuses).map((status) => canonicalize(status)), id)
        .toEqual(sortById(wire).map((status) => canonicalize(status)));
    }
  });
});

describe('authoringResolveFingerprint joinery statuses (J1-B)', () => {
  const base = {
    relationshipId: 'rel-floor-sides-01', kind: 'floor-side', stage: 'TECHNICAL_PROFILE_REQUIRED',
    contacts: [{ contactId: 'rel-floor-sides-01:side-left-01', status: 'VALID', issueCodes: [] }],
    stations: { status: 'PLANNED', issueCodes: [], stationCounts: [{ contactId: 'rel-floor-sides-01:side-left-01', stationCount: 3 }] },
    blockers: ['TECHNICAL_PROFILE_REQUIRED'],
  };
  const boards = [{ id: 'b1', defId: 'd1', role: 'floor', lengthMm: 564, widthMm: 570, thicknessMm: 18 }];

  test('leaves the hash byte-identical when statuses are absent, empty, or unsupported', () => {
    const without = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [] });
    const empty = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [], joineryStatuses: [] });
    const unsupported = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [],
      joineryStatuses: [{ ...base, relationshipId: 'rel-x', stage: 'RELATIONSHIP_UNSUPPORTED' }] });
    expect(empty).toBe(without);
    expect(unsupported).toBe(without);
  });

  test('moves with semantics and ignores reordering', () => {
    const a = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [], joineryStatuses: [base] });
    const changed = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [],
      joineryStatuses: [{ ...base, stations: { ...base.stations, stationCounts: [{ contactId: 'rel-floor-sides-01:side-left-01', stationCount: 4 }] } }] });
    const other = { ...base, relationshipId: 'rel-floor-sides-02' };
    const ordered = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [], joineryStatuses: [base, other] });
    const reversed = authoringResolveFingerprint({ boards, manualPlacements: [], derivedHardwarePlacements: [], operations: [], joineryStatuses: [other, base] });
    expect(a).not.toBe(changed);
    expect(ordered).toBe(reversed);
    expect(ordered).not.toBe(a);
  });
});
