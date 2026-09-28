import { describe, expect, it } from 'vitest';
import contactFixture from '../../../contracts/j1ContactMachining.contract.json';
import identityFixture from '../../../contracts/j1ContactOperationIdentity.contract.json';

import {
  cabinetCatalog,
  cabinetEnvelope,
  cloneCabinetEnvelope,
  mutateCabinetEnvelope,
  type WritableEnvelope,
} from './__fixtures__/sketchupAuthoringCabinet';
import { cabinetJoineryCatalog } from './__fixtures__/sketchupJoineryCatalogFixture';
import {
  resolveExplicitContacts,
  planResolvedContactStations,
  contactOperationId,
  deriveResolvedContactOperationsForContact,
  deriveResolvedContactOperations,
  deriveRelationshipMachining,
  diffRelationshipMachining,
  isFingerprintStale,
  provenanceKey,
  type RelationshipMachiningResult,
  type ContactResolutionInput,
  type StationSpec,
  type ContactOperationProvenance,
  type ContactOperationRecipe,
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

describe('J1-A0b neutral station plans', () => {
  const fixture = contactFixture as unknown as ContactResolutionInput;
  const resolved = () => resolveExplicitContacts(fixture);
  const plan = (boards = fixture.boards, resolution = resolved(), specs: readonly StationSpec[] = contactFixture.stationSpecs) =>
    planResolvedContactStations(resolution, boards, specs);

  it('orders contact and station IDs by Unicode scalar value across runtimes', () => {
    const ids = ['😀', '\uE000'];
    const contacts = fixture.contacts.map((contact, index) => ({ ...contact, contactId: ids[index]! }));
    const specs = contactFixture.stationSpecs.map((spec, index) => ({ ...spec, contactId: ids[index]! }));
    const resolution = resolveExplicitContacts({ ...fixture, contacts, requiredContactIds: ids });
    expect(resolution.issues).toEqual([]);
    expect(resolution.contacts.map((contact) => contact.contactId)).toEqual(['\uE000', '😀']);
    const planned = planResolvedContactStations(resolution, fixture.boards, specs);
    expect(planned.issues).toEqual([]);
    expect(planned.plans.map((item) => item.contactId)).toEqual(['\uE000', '😀']);
  });

  it('uses one exact plan and independently asserted assembly and both local coordinates', () => {
    expect(plan()).toEqual({ plans: contactFixture.expectedStationPlans, issues: [] });
  });

  it('preserves distances and both local coordinates through translation and rotation', () => {
    const check = (transform: (v: readonly number[]) => [number, number, number]) => {
      const boards = fixture.boards.map((board) => ({ ...board, translationMm: transform(board.translationMm),
        basis: { x: transform(board.basis.x).map((n, i) => n - transform([0, 0, 0])[i]!) as [number, number, number],
          y: transform(board.basis.y).map((n, i) => n - transform([0, 0, 0])[i]!) as [number, number, number],
          z: transform(board.basis.z).map((n, i) => n - transform([0, 0, 0])[i]!) as [number, number, number] } }));
      const neighbor = { ...boards[1]!, occurrenceId: 'unanchored-neighbor' };
      const actual = plan([neighbor, ...boards].reverse(), resolveExplicitContacts({ ...fixture, boards: [...boards, neighbor], contacts: [...fixture.contacts].reverse() }));
      expect(actual.issues).toEqual([]);
      expect(actual.plans).toEqual(contactFixture.expectedStationPlans.map((expected) => ({ ...expected,
        stations: expected.stations.map((station) => ({ ...station, assemblyPointMm: transform(station.assemblyPointMm) })) })));
    };
    check(([x, y, z]) => [x! + 73, y! - 41, z! + 19]);
    check(([x, y, z]) => [y === 0 ? 0 : -y!, x!, z!]);
  });

  it('keeps same-definition occurrences in two cabinets separate', () => {
    const offset = 1000;
    const secondBoards = fixture.boards.map((b) => ({ ...b, occurrenceId: `second:${b.occurrenceId}`,
      translationMm: [b.translationMm[0] + offset, b.translationMm[1], b.translationMm[2]] as [number, number, number] }));
    const secondContacts = fixture.contacts.map((c) => ({ ...c, contactId: `second:${c.contactId}`,
      relationshipId: `second:${c.relationshipId}`, participantA: `second:${c.participantA}`, participantB: `second:${c.participantB}` }));
    const resolution = resolveExplicitContacts({ boards: [...fixture.boards, ...secondBoards], contacts: [...fixture.contacts, ...secondContacts], requiredContactIds: [] });
    const specs = [...contactFixture.stationSpecs, ...contactFixture.stationSpecs.map((s) => ({ ...s, contactId: `second:${s.contactId}` }))];
    const result = plan([...fixture.boards, ...secondBoards], resolution, specs);
    expect(result.issues).toEqual([]);
    expect(result.plans).toHaveLength(4);
    expect(result.plans.slice(0, 2)).toEqual(contactFixture.expectedStationPlans);
    expect(result.plans.slice(2)).toEqual(contactFixture.expectedStationPlans.map((p) => ({ contactId: `second:${p.contactId}`,
      stations: p.stations.map((s) => ({ ...s, assemblyPointMm: [s.assemblyPointMm[0]! + offset, s.assemblyPointMm[1], s.assemblyPointMm[2]] })) })));
  });

  it.each([
    ['zero count', { count: 0 }, 'STATION_COUNT_INVALID'],
    ['single without anchor', { count: 1 }, 'STATION_COUNT_INVALID'],
    ['fractional count', { count: 2.5 }, 'STATION_COUNT_INVALID'],
    ['nonfinite count', { count: Infinity }, 'STATION_COUNT_INVALID'],
    ['negative margin', { startMarginMm: -1 }, 'STATION_MARGIN_INVALID'],
    ['nonfinite margin', { endMarginMm: NaN }, 'STATION_MARGIN_INVALID'],
    ['consumed span', { startMarginMm: 250, endMarginMm: 250 }, 'STATION_SPAN_INVALID'],
    ['beyond span', { startMarginMm: 501 }, 'STATION_SPAN_INVALID'],
  ] as const)('fails closed for %s', (_name, changed, code) => {
    const specs = contactFixture.stationSpecs.map((s, i) => i === 0 ? { ...s, ...changed } : s);
    const result = plan(fixture.boards, resolved(), specs);
    expect(result.plans).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toContain(code);
  });

  it('rejects missing or duplicate policies, bad participant frame, corrupt interval, and A0a issues without partial plans', () => {
    const cases = [
      [resolved(), fixture.boards, contactFixture.stationSpecs.slice(1), 'STATION_SPEC_MISSING'],
      [resolved(), fixture.boards, [...contactFixture.stationSpecs, contactFixture.stationSpecs[0]!], 'STATION_SPEC_AMBIGUOUS'],
      [resolved(), fixture.boards.slice(1), contactFixture.stationSpecs, 'STATION_PARTICIPANT_INVALID'],
      [resolved(), fixture.boards.map((b, i) => i === 0 ? { ...b, basis: { ...b.basis, x: [0, 0, 0] as [number, number, number] } } : b), contactFixture.stationSpecs, 'STATION_PARTICIPANT_INVALID'],
      [{ contacts: [{ ...resolved().contacts[0]!, overlapMm: [0, Infinity] as const }], issues: [] }, fixture.boards, contactFixture.stationSpecs, 'STATION_FRAME_INVALID'],
      [{ contacts: [{ ...resolved().contacts[0]!, overlapMm: [0, 900] as const }], issues: [] }, fixture.boards, contactFixture.stationSpecs, 'STATION_POINT_INVALID'],
      [resolved(), fixture.boards.map((b, i) => i === 1 ? { ...b, basis: { ...b.basis, x: [0, -1, 9e-7] as [number, number, number] } } : b), contactFixture.stationSpecs, 'STATION_POINT_INVALID'],
      [resolveExplicitContacts({ ...fixture, contacts: [...fixture.contacts, fixture.contacts[0]!] }), fixture.boards, contactFixture.stationSpecs, 'CONTACT_AMBIGUOUS'],
    ] as const;
    for (const [resolution, boards, specs, code] of cases) {
      const result = plan(boards, resolution, specs);
      expect(result.plans).toEqual([]);
      expect(result.issues.map((issue) => issue.code)).toContain(code);
    }
  });
});

describe('J1-A1-id neutral operation identity', () => {
  it('matches the shared nine-field codec including JSON escape-sensitive IDs', () => {
    for (const item of identityFixture.cases) {
      expect(contactOperationId(item.provenance as ContactOperationProvenance)).toBe(item.operationId);
    }
  });

  it('changes identity when any of the nine dependent fields changes', () => {
    const base = identityFixture.cases[0]!.provenance as ContactOperationProvenance;
    const fields = ['relationshipId', 'contactId', 'participantId', 'stationIndex', 'recipeId',
      'recipeRevision', 'ruleId', 'ruleRevision', 'operationRole'] as const;
    const ids = fields.map((field) => contactOperationId({ ...base,
      [field]: field === 'stationIndex' ? 1 : `${base[field]}!` }));
    expect(new Set([contactOperationId(base), ...ids]).size).toBe(fields.length + 1);
  });
});

describe('J1-A1a paired operations for one exact contact', () => {
  const fixture = contactFixture as unknown as ContactResolutionInput;
  const recipes = contactFixture.operationRecipes as unknown as ContactOperationRecipe[];
  const resolved = resolveExplicitContacts(fixture);
  const planned = planResolvedContactStations(resolved, fixture.boards, contactFixture.stationSpecs);
  const derive = (index: number, recipe = recipes[index]!, plan = planned.plans[index]!,
    boards = fixture.boards, spec = contactFixture.stationSpecs[index]!, contact = resolved.contacts[index]!) =>
    deriveResolvedContactOperationsForContact(contact, plan, boards, spec, recipe);

  it('emits complete complementary operations for each exact floor-side contact', () => {
    for (const [index, expected] of [[0, contactFixture.expectedOperations.slice(0, 6)],
      [1, contactFixture.expectedOperations.slice(6)]] as const) {
      const result = derive(index);
      expect(result.issues).toEqual([]);
      expect(result.operations).toEqual(expected);
      expect(new Set(result.operations.map((operation) => operation.operationId)).size).toBe(expected.length);
    }
    expect(deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog).issues).toEqual([]);
  });

  it('keeps local machining invariant under rigid translation of the same occurrence', () => {
    const movedBoards = fixture.boards.map((board) => ({ ...board,
      translationMm: [board.translationMm[0] + 73, board.translationMm[1] - 41,
        board.translationMm[2] + 19] as const }));
    const moved = resolveExplicitContacts({ ...fixture, boards: movedBoards });
    const movedPlans = planResolvedContactStations(moved, movedBoards, contactFixture.stationSpecs);
    for (const index of [0, 1]) {
      const result = deriveResolvedContactOperationsForContact(moved.contacts[index]!, movedPlans.plans[index]!,
        movedBoards, contactFixture.stationSpecs[index]!, recipes[index]!);
      expect(result.issues).toEqual([]);
      expect(result.operations).toEqual(derive(index).operations);
    }
  });

  it('orders multiple rules for one participant by stable codepoint IDs in both runtimes', () => {
    const extra = { ...recipes[0]!.rules[1]!, ruleId: 'Z-copy', operationRole: 'counterbore-alt',
      offsetMm: [0, 18, 10] as const };
    const result = derive(0, { ...recipes[0]!, rules: [...recipes[0]!.rules, extra] });
    expect(result.issues).toEqual([]);
    expect(result.operations.filter((operation) => operation.provenance.stationIndex === 0)
      .map((operation) => operation.provenance.ruleId)).toEqual(['pilot', 'Z-copy', 'counterbore']);
  });

  it('orders supplementary and BMP rule IDs by Unicode scalar value', () => {
    const original = recipes[0]!;
    const base = original.rules[1]!;
    const supplementary = { ...base, ruleId: '😀', operationRole: 'supplementary', offsetMm: [0, 18, 10] as const };
    const bmp = { ...base, ruleId: '\uE000', operationRole: 'bmp', offsetMm: [0, 18, 20] as const };
    const result = derive(0, { ...original, rules: [...original.rules, supplementary, bmp] });
    expect(result.issues).toEqual([]);
    expect(result.operations.filter((operation) => operation.provenance.stationIndex === 0)
      .map((operation) => operation.provenance.ruleId)).toEqual(['pilot', 'counterbore', '\uE000', '😀']);
  });

  it('uses the same escaped operation identity as Go for unrestricted string IDs', () => {
    const contact = { ...resolved.contacts[0]!, relationshipId: 'rel<>&\u2028\u2029' };
    const result = derive(0, recipes[0]!, planned.plans[0]!, fixture.boards,
      contactFixture.stationSpecs[0]!, contact);
    expect(result.issues).toEqual([]);
    expect(result.operations[0]!.operationId).toBe(
      'j1:["rel\\u003c\\u003e\\u0026\\u2028\\u2029","floor-left","floor-1",0,"synthetic-j1","test-1","pilot","test-1","pilot"]');
  });

  it('returns structured errors instead of throwing for malformed decoded inputs', () => {
    const args = [resolved.contacts[0]!, planned.plans[0]!, fixture.boards,
      contactFixture.stationSpecs[0]!, recipes[0]!] as const;
    for (const index of [0, 1, 2, 3, 4]) {
      const invalid: unknown[] = [...args];
      invalid[index] = null;
      const result = deriveResolvedContactOperationsForContact(...invalid as Parameters<typeof deriveResolvedContactOperationsForContact>);
      expect(result.operations, String(index)).toEqual([]);
      expect(result.issues.map((issue) => issue.code), String(index)).toContain('OPERATION_INPUT_INVALID');
    }
    expect(derive(0, { ...recipes[0]!, rules: [null] as unknown as ContactOperationRecipe['rules'] })
      .issues.map((issue) => issue.code)).toContain('OPERATION_RULE_INVALID');
    for (const field of ['originAssemblyMm', 'axisAssembly', 'normalAssembly'] as const) {
      const contact = { ...args[0], frame: { ...args[0].frame, [field]: 1 } };
      const result = derive(0, args[4], args[1], args[2], args[3],
        contact as unknown as typeof args[0]);
      expect(result.operations, field).toEqual([]);
      expect(result.issues.map((issue) => issue.code), field).toContain('OPERATION_PLAN_INVALID');
    }
    for (const [field, value] of [['translationMm', 1], ['translationMm', null],
      ['basis', null], ['basis.x', 1]] as const) {
      const board = { ...args[2][1]!, ...(field === 'basis.x' ?
        { basis: { ...args[2][1]!.basis, x: value } } : { [field]: value }) };
      const boards = args[2].map((item, index) => index === 1 ? board : item);
      const result = derive(0, args[4], args[1], boards as unknown as typeof args[2]);
      expect(result.operations, `${field}=${value}`).toEqual([]);
      expect(result.issues.map((issue) => issue.code), `${field}=${value}`)
        .toContain('OPERATION_PARTICIPANT_INVALID');
    }
  });

  it('fails closed for invalid identity, rule, technical profile, geometry, and noncanonical plans', () => {
    const left = recipes[0]!;
    const plan = planned.plans[0]!;
    const corruptMiddle = { ...plan, stations: plan.stations.map((station, i) => i === 1 ?
      { ...station, distanceMm: 241, assemblyPointMm: [18, 271, 27] as const,
        participantALocalMm: [241, 9, 0] as const, participantBLocalMm: [289, 18, 27] as const } : station) };
    const cases = [
      ['profile missing', derive(0, { ...left, technicalProfileId: '' }), 'TECHNICAL_PROFILE_REQUIRED'],
      ['recipe revision missing', derive(0, { ...left, recipeRevision: '' }), 'OPERATION_RECIPE_INVALID'],
      ['participant rule missing', derive(0, { ...left, rules: left.rules.slice(0, 1) }), 'OPERATION_PARTICIPANT_RULE_MISSING'],
      ['duplicate rule', derive(0, { ...left, rules: [...left.rules, left.rules[0]!] }), 'OPERATION_RULE_INVALID'],
      ['duplicate machining with distinct rule IDs', derive(0, { ...left, rules: [...left.rules,
        { ...left.rules[1]!, ruleId: 'counterbore-copy' }] }), 'OPERATION_GEOMETRY_DUPLICATE'],
      ['wrong entry face', derive(0, { ...left, rules: left.rules.map((rule) =>
        rule.participantRole === 'B' ? { ...rule, entryFace: 'front' as const } : rule) }), 'OPERATION_GEOMETRY_INVALID'],
      ['outward axis', derive(0, { ...left, rules: left.rules.map((rule) =>
        rule.participantRole === 'B' ? { ...rule, axis: [0, 1, 0] as const } : rule) }), 'OPERATION_GEOMETRY_INVALID'],
      ['excess depth', derive(0, { ...left, rules: left.rules.map((rule) =>
        rule.participantRole === 'B' ? { ...rule, depthMm: 19 } : rule) }), 'OPERATION_GEOMETRY_INVALID'],
      ['oblique swept-cylinder edge breach', derive(0, { ...left, rules: left.rules.map((rule) =>
        rule.participantRole === 'B' ? { ...rule, offsetMm: [-50, 18, 0] as const,
          axis: [-0.7, -Math.sqrt(0.51), 0] as const, diameterMm: 12, depthMm: 10 } : rule) }),
      'OPERATION_GEOMETRY_INVALID'],
      ['nonfinite diameter', derive(0, { ...left, rules: left.rules.map((rule) =>
        rule.participantRole === 'B' ? { ...rule, diameterMm: Infinity } : rule) }), 'OPERATION_RULE_INVALID'],
      ['edge breach', derive(0, { ...left, rules: left.rules.map((rule) =>
        rule.participantRole === 'B' ? { ...rule, diameterMm: 60 } : rule) }), 'OPERATION_GEOMETRY_INVALID'],
      ['nonuniform station', derive(0, left, corruptMiddle), 'OPERATION_PLAN_INVALID'],
      ['missing station point', derive(0, left, { ...plan, stations: plan.stations.map((station, i) => i === 0 ?
        { ...station, assemblyPointMm: null as unknown as [number, number, number] } : station) }), 'OPERATION_PLAN_INVALID'],
      ['shifted endpoint', derive(0, left, { ...plan, stations: plan.stations.map((station, i) => i === 0 ?
        { ...station, distanceMm: 31, assemblyPointMm: [18, 61, 27] as const,
          participantALocalMm: [31, 9, 0] as const, participantBLocalMm: [499, 18, 27] as const } : station) }),
        'OPERATION_PLAN_INVALID'],
      ['wrong plan identity', derive(0, left, { ...plan, contactId: 'floor-right' }), 'OPERATION_IDENTITY_INVALID'],
      ['duplicate occurrence', derive(0, left, plan, [...fixture.boards, fixture.boards[0]!]), 'OPERATION_PARTICIPANT_INVALID'],
      ['missing relationship', derive(0, left, plan, fixture.boards, contactFixture.stationSpecs[0]!,
        { ...resolved.contacts[0]!, relationshipId: '' }), 'OPERATION_IDENTITY_INVALID'],
    ] as const;
    for (const [name, result, code] of cases) {
      expect(result.issues.map((issue) => issue.code), name).toContain(code);
      expect(result.operations, name).toEqual([]);
    }
  });
});

describe('J1-A1b reconciled contact operation collection', () => {
  const fixture = contactFixture as unknown as ContactResolutionInput;
  const recipes = contactFixture.operationRecipes as unknown as ContactOperationRecipe[];
  const resolve = (input = fixture, specs = contactFixture.stationSpecs, rules: readonly ContactOperationRecipe[] = recipes) => {
    const resolution = resolveExplicitContacts(input);
    const plans = planResolvedContactStations(resolution, input.boards, specs);
    return deriveResolvedContactOperations(resolution, plans, input.boards, specs, rules);
  };

  it('orders collection output by Unicode scalar contact IDs across runtimes', () => {
    const ids = ['\uE000', '\u{1F600}'] as const;
    const rename = <T extends { contactId: string }>(item: T, index: number): T =>
      ({ ...item, contactId: ids[index]! });
    const input = { ...fixture,
      contacts: fixture.contacts.map((contact, index) => rename(contact, index)),
      requiredContactIds: [...ids] };
    const specs = contactFixture.stationSpecs.map((spec, index) => rename(spec, index));
    const rules = recipes.map((recipe, index) => rename(recipe, index));
    const result = resolve(input as typeof fixture, specs, rules);
    expect(result.issues).toEqual([]);
    expect([...new Set(result.operations.map((operation) => operation.provenance.contactId))])
      .toEqual(['\uE000', '\u{1F600}']);
  });

  it('combines only complete sets in stable order with exact provenance and no duplicate IDs', () => {
    const result = resolve();
    expect(result.issues).toEqual([]);
    expect(result.operations.map((operation) => operation.operationId)).toEqual(
      contactFixture.expectedOperations.map((operation) => operation.operationId));
    expect(result.operations).toEqual(contactFixture.expectedOperations);
    expect(new Set(result.operations.map((operation) => operation.operationId)).size).toBe(10);
    expect(deriveRelationshipMachining(acceptedSnapshot(), cabinetJoineryCatalog).issues).toEqual([]);
  });

  it('isolates recipe changes, contact deletion, and same-definition occurrences', () => {
    const original = resolve();
    const revised = resolve(fixture, contactFixture.stationSpecs, recipes.map((recipe) =>
      recipe.contactId === 'floor-left' ? { ...recipe, recipeRevision: 'test-2' } : recipe));
    expect(revised.issues).toEqual([]);
    expect(revised.operations.filter((operation) => operation.provenance.contactId === 'floor-right'))
      .toEqual(original.operations.filter((operation) => operation.provenance.contactId === 'floor-right'));
    expect(revised.operations.filter((operation) => operation.provenance.contactId === 'floor-left').map((operation) => operation.operationId))
      .not.toEqual(original.operations.filter((operation) => operation.provenance.contactId === 'floor-left').map((operation) => operation.operationId));
    const remaining = { ...fixture, contacts: fixture.contacts.slice(1), requiredContactIds: ['floor-right'] };
    expect(resolve(remaining, contactFixture.stationSpecs.slice(1), recipes.slice(1)).operations)
      .toEqual(original.operations.filter((operation) => operation.provenance.contactId === 'floor-right'));

    const secondBoards = fixture.boards.map((board) => ({ ...board, occurrenceId: `second:${board.occurrenceId}`,
      translationMm: [board.translationMm[0] + 1000, board.translationMm[1], board.translationMm[2]] as const }));
    const secondContacts = fixture.contacts.map((contact) => ({ ...contact, relationshipId: `second:${contact.relationshipId}`,
      contactId: `second:${contact.contactId}`, participantA: `second:${contact.participantA}`, participantB: `second:${contact.participantB}` }));
    const allBoards = [...secondBoards, ...fixture.boards].reverse();
    const allContacts = [...secondContacts, ...fixture.contacts].reverse();
    const allSpecs = [...contactFixture.stationSpecs,
      ...contactFixture.stationSpecs.map((spec) => ({ ...spec, contactId: `second:${spec.contactId}` }))];
    const allRecipes = [...recipes, ...recipes.map((recipe) => ({ ...recipe, contactId: `second:${recipe.contactId}` }))];
    const doubled = resolve({ boards: allBoards, contacts: allContacts, requiredContactIds: [] }, allSpecs, allRecipes);
    expect(doubled.issues).toEqual([]);
    expect(doubled.operations).toHaveLength(20);
    expect(doubled.operations.slice(0, 10)).toEqual(original.operations);
    expect(new Set(doubled.operations.map((operation) => operation.operationId)).size).toBe(20);
    expect(doubled.operations.slice(10).map((operation) => operation.centerLocalMm))
      .toEqual(original.operations.map((operation) => operation.centerLocalMm));
  });

  it('rejects missing, duplicate, orphan, and tampered collection inputs without leaking failed sets', () => {
    const resolution = resolveExplicitContacts(fixture);
    const plans = planResolvedContactStations(resolution, fixture.boards, contactFixture.stationSpecs);
    const run = (candidatePlans = plans, specs = contactFixture.stationSpecs,
      rules: readonly ContactOperationRecipe[] = recipes, contacts = resolution) =>
      deriveResolvedContactOperations(contacts, candidatePlans, fixture.boards, specs, rules);
    const cases = [
      ['missing plan', run({ plans: plans.plans.slice(1), issues: [] }), 'OPERATION_PLAN_INVALID', 4],
      ['duplicate plan', run({ plans: [...plans.plans, plans.plans[0]!], issues: [] }), 'OPERATION_PLAN_INVALID', 4],
      ['missing spec', run(plans, contactFixture.stationSpecs.slice(1)), 'OPERATION_PLAN_INVALID', 4],
      ['duplicate spec', run(plans, [...contactFixture.stationSpecs, contactFixture.stationSpecs[0]!]), 'OPERATION_PLAN_INVALID', 4],
      ['missing recipe', run(plans, contactFixture.stationSpecs, recipes.slice(1)), 'OPERATION_RECIPE_REQUIRED', 4],
      ['duplicate recipe', run(plans, contactFixture.stationSpecs, [...recipes, recipes[0]!]), 'OPERATION_RECIPE_AMBIGUOUS', 4],
      ['tampered plan', run({ plans: [{ ...plans.plans[0]!, stations: plans.plans[0]!.stations.map((station, i) => i === 1 ?
        { ...station, participantBLocalMm: [0, 0, 0] as const } : station) }, plans.plans[1]!], issues: [] }),
        'OPERATION_PLAN_INVALID', 4],
      ['unknown plan', run({ plans: [...plans.plans, { ...plans.plans[0]!, contactId: 'ghost' }], issues: [] }),
        'OPERATION_CONTACT_UNKNOWN', 0],
      ['unknown recipe', run(plans, contactFixture.stationSpecs, [...recipes, { ...recipes[0]!, contactId: 'ghost' }]),
        'OPERATION_CONTACT_UNKNOWN', 0],
      ['unknown spec', run(plans, [...contactFixture.stationSpecs, { ...contactFixture.stationSpecs[0]!, contactId: 'ghost' }]),
        'OPERATION_CONTACT_UNKNOWN', 0],
      ['invalid identity', run(plans, contactFixture.stationSpecs, recipes,
        { contacts: [{ ...resolution.contacts[0]!, relationshipId: '' }, resolution.contacts[1]!], issues: [] }),
        'OPERATION_IDENTITY_INVALID', 4],
      ['duplicate contact', run(plans, contactFixture.stationSpecs, recipes,
        { contacts: [...resolution.contacts, resolution.contacts[0]!], issues: [] }), 'OPERATION_CONTACT_AMBIGUOUS', 4],
    ] as const;
    for (const [name, result, code, surviving] of cases) {
      expect(result.issues.map((issue) => issue.code), name).toContain(code);
      expect(result.operations, name).toHaveLength(surviving);
      expect(result.operations.every((operation) => operation.provenance.contactId === 'floor-right'), name).toBe(true);
    }
  });

  it('invalidates an entire shared relationship when either contact fails', () => {
    const resolution = resolveExplicitContacts(fixture);
    const sameRelationship = { contacts: resolution.contacts.map((contact) =>
      ({ ...contact, relationshipId: 'rel-both' })), issues: [] };
    const plans = planResolvedContactStations(sameRelationship, fixture.boards, contactFixture.stationSpecs);
    const tampered = { plans: [{ ...plans.plans[0]!, stations: [] }, plans.plans[1]!], issues: [] };
    const result = deriveResolvedContactOperations(sameRelationship, tampered, fixture.boards,
      contactFixture.stationSpecs, recipes);
    expect(result.issues.map((issue) => issue.code)).toContain('OPERATION_PLAN_INVALID');
    expect(result.operations).toEqual([]);
  });

  it('does not double emit identical physical drilling from distinct contact IDs', () => {
    const duplicate = { ...fixture.contacts[0]!, contactId: 'floor-left-copy', relationshipId: 'rel-floor-left-copy' };
    const input = { ...fixture, contacts: [...fixture.contacts, duplicate] };
    const specs = [...contactFixture.stationSpecs,
      { ...contactFixture.stationSpecs[0]!, contactId: duplicate.contactId }];
    const withCopy = [...recipes, { ...recipes[0]!, contactId: duplicate.contactId }];
    const result = resolve(input, specs, withCopy);
    expect(result.issues.map((issue) => issue.code)).toContain('OPERATION_GEOMETRY_DUPLICATE');
    expect(result.operations.map((operation) => operation.provenance.contactId))
      .toEqual(['floor-right', 'floor-right', 'floor-right', 'floor-right']);

    const resolved = resolveExplicitContacts(fixture);
    const planned = planResolvedContactStations(resolved, fixture.boards, contactFixture.stationSpecs);
    const ids = ['a-left', 'b-left', 'c-left'];
    const contacts = ids.map((id) => ({ ...resolved.contacts[0]!, contactId: id, relationshipId: `rel-${id}` }));
    const policy = ids.map((id) => ({ ...contactFixture.stationSpecs[0]!, contactId: id }));
    const contactPlans = ids.map((id) => ({ ...planned.plans[0]!, contactId: id }));
    const rules = ids.map((id, index) => ({ ...recipes[0]!, contactId: id, rules: recipes[0]!.rules.map((rule) =>
      index === 1 && rule.participantRole === 'B' ? { ...rule, offsetMm: [0, 18, 10] as const } :
        index === 2 && rule.participantRole === 'A' ? { ...rule, offsetMm: [5, 0, 0] as const } : rule) }));
    const independent = deriveResolvedContactOperations(
      { contacts: [...contacts, resolved.contacts[1]!], issues: [] },
      { plans: [...contactPlans, planned.plans[1]!], issues: [] }, fixture.boards,
      [...policy, contactFixture.stationSpecs[1]!], [...rules, recipes[1]!]);
    expect(independent.issues.map((issue) => issue.code)).toContain('OPERATION_GEOMETRY_DUPLICATE');
    expect(independent.operations).toHaveLength(10);
    expect(new Set(independent.operations.map((operation) => operation.provenance.contactId)))
      .toEqual(new Set(['c-left', 'floor-right']));
  });
});

type WritableAnchor = { componentInstanceId: string; role: string; face?: string };
type WritableRelationship = {
  relationshipId: string; kind: string;
  source: WritableAnchor; targets: WritableAnchor[]; parameters?: Record<string, number | string | boolean>;
};

describe('J1-B productive floor-side resolver states', () => {
  const AXIS_Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
  // 120° about (1,1,1)/√3: local X(depth)→+Y, Y(thickness)→+Z, Z(length)→+X.
  const CYCLIC: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
  const floorSideEnvelope = (mutate?: (relationship: WritableRelationship) => void) =>
    mutateCabinetEnvelope((envelope) => {
      const assembly = envelope.assemblies[0]!;
      // Sides placed as physical lateral panels: local X(depth 570)→+Y, Y(thickness 18)→−X, Z(height)→+Z.
      for (const side of assembly.components ?? []) {
        if (side.componentInstanceId === 'side-left-01') side.transform.translationMm[0] = 18;
        if (side.componentInstanceId === 'side-right-01') side.transform.translationMm[0] = 600;
        if (side.componentInstanceId.startsWith('side-')) {
          side.transform.rotationQuaternion = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number];
        }
      }
      assembly.components = [...(assembly.components ?? []), {
        componentDefinitionId: 'definition-shelf',
        componentInstanceId: 'floor-01',
        role: 'floor',
        transform: { frame: 'assembly', translationMm: [18, 0, 0],
          rotationQuaternion: CYCLIC, scale: [1, 1, 1] },
      }];
      const relationship = {
        relationshipId: 'rel-floor-sides-01',
        kind: 'floor-side',
        source: { componentInstanceId: 'floor-01', role: 'floor-edge' },
        targets: [
          { componentInstanceId: 'side-left-01', role: 'inside-face', face: 'back' },
          { componentInstanceId: 'side-right-01', role: 'inside-face', face: 'front' },
        ],
        parameters: { stationCount: 3, startMarginMm: 40, endMarginMm: 40 },
      };
      mutate?.(relationship);
      assembly.relationships = [...(assembly.relationships ?? []), relationship];
    });

  it('reaches TECHNICAL_PROFILE_REQUIRED with valid contacts and planned stations, emitting no operations', () => {
    const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, floorSideEnvelope(), cabinetCatalog);
    if (response.status !== 'accepted' || response.authoringSnapshot === undefined) {
      throw new Error(`fixture envelope was not accepted: ${JSON.stringify(response.issues)}`);
    }
    const result = deriveRelationshipMachining(response.authoringSnapshot, cabinetJoineryCatalog);
    const status = result.joineryStatuses.find((item) => item.relationshipId === 'rel-floor-sides-01');
    expect(status?.stage).toBe('TECHNICAL_PROFILE_REQUIRED');
    expect(status?.contacts.map((contact) => [contact.contactId, contact.status])).toEqual([
      ['rel-floor-sides-01:side-left-01', 'VALID'],
      ['rel-floor-sides-01:side-right-01', 'VALID'],
    ]);
    expect(status?.stations.status).toBe('PLANNED');
    expect(status?.stations.stationCounts).toEqual([
      { contactId: 'rel-floor-sides-01:side-left-01', stationCount: 3 },
      { contactId: 'rel-floor-sides-01:side-right-01', stationCount: 3 },
    ]);
    expect(status?.blockers).toEqual(['TECHNICAL_PROFILE_REQUIRED']);
    expect(result.issues.map((issue) => issue.code)).toContain('TECHNICAL_PROFILE_REQUIRED');
    expect(result.derivedMachiningOperations
      .filter((operation) => operation.provenance.sourceKind === 'relationship'
        && operation.provenance.relationshipId === 'rel-floor-sides-01')).toEqual([]);
  });

  it('reports RELATIONSHIP_UNSUPPORTED structurally for unregistered kinds', () => {
    const result = resolveFrom((envelope) => {
      (envelope.assemblies[0]!.relationships ?? [])[0]!.kind = 'mystery-joint';
    });
    const status = result.joineryStatuses.find((item) => item.kind === 'mystery-joint');
    expect(status?.stage).toBe('RELATIONSHIP_UNSUPPORTED');
    expect(status?.blockers).toContain('RELATIONSHIP_INVALID');
    expect(result.issues.map((issue) => issue.code)).toContain('RELATIONSHIP_INVALID');
  });

  it('fails contacts closed when an anchor face is missing', () => {
    const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE,
      floorSideEnvelope((relationship) => { delete (relationship.targets[0] as WritableAnchor).face; }), cabinetCatalog);
    const result = deriveRelationshipMachining(response.authoringSnapshot!, cabinetJoineryCatalog);
    const status = result.joineryStatuses.find((item) => item.relationshipId === 'rel-floor-sides-01');
    expect(status?.stage).toBe('CONTACT_INVALID');
    expect(status?.blockers).toContain('CONTACT_FACE_REQUIRED');
  });

  it('fails stations closed on a non-integer or sub-two station count', () => {
    for (const stationCount of [1, 2.5, Number.NaN]) {
      const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE,
        floorSideEnvelope((relationship) => { relationship.parameters = { stationCount }; }),
        cabinetCatalog);
      const result = deriveRelationshipMachining(response.authoringSnapshot!, cabinetJoineryCatalog);
      const status = result.joineryStatuses.find((item) => item.relationshipId === 'rel-floor-sides-01');
      expect(status?.stage, String(stationCount)).toBe('STATION_INVALID');
      expect(status?.blockers, String(stationCount)).toContain('STATION_PATTERN_INVALID');
      expect(status?.contacts.every((contact) => contact.status === 'VALID'), String(stationCount)).toBe(true);
    }
  });

  it('blocks contacts when panels do not physically touch', () => {
    const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE,
      floorSideEnvelope((relationship) => {
        const sideRight = relationship.targets[1]!;
        sideRight.componentInstanceId = 'side-left-01';
      }), cabinetCatalog);
    const result = deriveRelationshipMachining(response.authoringSnapshot!, cabinetJoineryCatalog);
    const status = result.joineryStatuses.find((item) => item.relationshipId === 'rel-floor-sides-01');
    expect(status?.stage).toBe('CONTACT_INVALID');
    expect(status?.stations.status).toBe('NOT_PLANNED');
    expect(result.derivedMachiningOperations
      .filter((operation) => operation.provenance.sourceKind === 'relationship'
        && operation.provenance.relationshipId === 'rel-floor-sides-01')).toEqual([]);
  });

  it('leaves shelf-support operations structurally identical beside a floor-side relationship', () => {
    const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, floorSideEnvelope(), cabinetCatalog);
    const withFloor = deriveRelationshipMachining(response.authoringSnapshot!, cabinetJoineryCatalog);
    expect(opIdsByRelationship(withFloor, 'rel-shelf-01')).toEqual(opIdsByRelationship(acceptedResolve(), 'rel-shelf-01'));
  });

  const acceptedResolve = (): RelationshipMachiningResult => {
    const { response } = applyAuthoringEnvelope(EMPTY_AUTHORING_STATE, cloneCabinetEnvelope(), cabinetCatalog);
    return deriveRelationshipMachining(response.authoringSnapshot!, cabinetJoineryCatalog);
  };
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

describe('J1-A explicit occurrence contacts', () => {
  const fixture = contactFixture as unknown as ContactResolutionInput;
  it('resolves independently asserted directed frames and asymmetric useful overlaps', () => {
    const result = resolveExplicitContacts(fixture);
    expect(result.issues).toEqual([]);
    expect(result.contacts).toEqual(contactFixture.expected);
  });

  it('ignores unanchored neighbors and input order', () => {
    const other = { ...fixture.boards[1]!, occurrenceId: 'unrelated-neighbor' };
    const changed = { ...fixture, boards: [other, ...fixture.boards].reverse(), contacts: [...fixture.contacts].reverse() };
    expect(resolveExplicitContacts(changed)).toEqual(resolveExplicitContacts(fixture));
  });

  it('keeps contact-frame overlaps local under a global translation', () => {
    const delta = [73, -41, 19] as const;
    const neighbor = { ...fixture.boards[1]!, occurrenceId: 'unanchored-neighbor' };
    const translated = { ...fixture, boards: [...fixture.boards, neighbor].map((board) => ({
      ...board,
      translationMm: board.translationMm.map((value, index) => value + delta[index]!) as [number, number, number],
    })) };
    const result = resolveExplicitContacts(translated);
    expect(result.issues).toEqual([]);
    expect(result.contacts.map((contact) => contact.contactId)).toEqual(['floor-left', 'floor-right']);
    expect(result.contacts).toEqual([
      { ...contactFixture.expected[0], frame: { ...contactFixture.expected[0]!.frame, originAssemblyMm: [91, -11, 46] } },
      { ...contactFixture.expected[1], frame: { ...contactFixture.expected[1]!.frame, originAssemblyMm: [655, 39, 46] } },
    ]);
  });

  it('rotates physical frames without changing local overlap lengths', () => {
    const rotate = ([x, y, z]: readonly [number, number, number]): [number, number, number] =>
      [y === 0 ? 0 : -y, x, z];
    const rotated = { ...fixture, boards: fixture.boards.map((board) => ({
      ...board,
      translationMm: rotate(board.translationMm),
      basis: { x: rotate(board.basis.x), y: rotate(board.basis.y), z: rotate(board.basis.z) },
    })) };
    const result = resolveExplicitContacts(rotated);
    expect(result.issues).toEqual([]);
    expect(result.contacts).toEqual([
      { ...contactFixture.expected[0], frame: { originAssemblyMm: [-30, 18, 27], axisAssembly: [-1, 0, 0], normalAssembly: [0, -1, 0] } },
      { ...contactFixture.expected[1], frame: { originAssemblyMm: [-80, 582, 27], axisAssembly: [-1, 0, 0], normalAssembly: [0, 1, 0] } },
    ]);
  });

  it('omits every conflicting same-ID contact regardless of input order', () => {
    const conflicting = { ...fixture.contacts[0]!, participantB: 'side-right-1', faceA: 'top' as const };
    for (const duplicates of [[fixture.contacts[0]!, conflicting], [conflicting, fixture.contacts[0]!]]) {
      const result = resolveExplicitContacts({ ...fixture, contacts: [...duplicates, fixture.contacts[1]!] });
      expect(result.issues.map((issue) => issue.code)).toContain('CONTACT_AMBIGUOUS');
      expect(result.contacts).toEqual([contactFixture.expected[1]]);
    }
  });

  it.each([
    ['required contact missing', 'CONTACT_REQUIRED_MISSING', (f: typeof contactFixture) => { f.contacts.pop(); }],
    ['participant missing', 'CONTACT_PARTICIPANT_MISSING', (f: typeof contactFixture) => { f.contacts[0]!.participantB = 'ghost'; }],
    ['ambiguous contact', 'CONTACT_AMBIGUOUS', (f: typeof contactFixture) => { f.contacts.push({ ...f.contacts[0]! }); }],
    ['ambiguous occurrence', 'CONTACT_AMBIGUOUS', (f: typeof contactFixture) => { f.boards.push({ ...f.boards[0]! }); }],
    ['no useful overlap', 'CONTACT_NO_OVERLAP', (f: typeof contactFixture) => { f.boards[2]!.translationMm = [600, 600, 0]; }],
    ['incompatible face', 'CONTACT_FACE_INCOMPATIBLE', (f: typeof contactFixture) => { f.contacts[1]!.faceB = 'back'; }],
    ['separated planes', 'CONTACT_FACE_INCOMPATIBLE', (f: typeof contactFixture) => { f.boards[2]!.translationMm = [601, 80, 0]; }],
    ['invalid local basis', 'CONTACT_FRAME_INVALID', (f: typeof contactFixture) => { f.boards[1]!.basis.x = [0, 0, 0]; }],
    ['skewed contact face', 'CONTACT_FACE_INCOMPATIBLE', (f: typeof contactFixture) => {
      f.boards[1]!.basis.x = [0, -Math.SQRT1_2, Math.SQRT1_2];
      f.boards[1]!.basis.z = [0, Math.SQRT1_2, Math.SQRT1_2];
    }],
    ['blank contact identity', 'CONTACT_IDENTITY_INVALID', (f: typeof contactFixture) => { f.contacts[0]!.contactId = ''; }],
    ['blank relationship identity', 'CONTACT_IDENTITY_INVALID', (f: typeof contactFixture) => { f.contacts[0]!.relationshipId = ''; }],
    ['blank occurrence identity', 'CONTACT_IDENTITY_INVALID', (f: typeof contactFixture) => {
      f.boards[0]!.occurrenceId = '';
      f.contacts[0]!.participantA = '';
      f.contacts[1]!.participantA = '';
    }],
  ] as const)('fails structured for %s', (_name, code, mutate) => {
    const changed = structuredClone(contactFixture);
    mutate(changed);
    const result = resolveExplicitContacts(changed as unknown as ContactResolutionInput);
    expect(result.issues.map((issue) => issue.code)).toContain(code);
  });
});
