import { describe, expect, it } from 'vitest';

import { pieceToSetupFrame, type MachiningFace, type Point3, type RigidFrame } from './neutralMachiningGeometry';
import { planNeutralMachining, type NeutralMachiningInput } from './neutralMachiningPlan';

const dimensions = { xMm: 11, yMm: 7, zMm: 3 } as const;
const entries: Record<MachiningFace, { point: Point3; axis: Point3 }> = {
  top: { point: { x: 5, y: 3, z: 3 }, axis: { x: 0, y: 0, z: -1 } },
  bottom: { point: { x: 5, y: 3, z: 0 }, axis: { x: 0, y: 0, z: 1 } },
  left: { point: { x: 0, y: 3, z: 1.5 }, axis: { x: 1, y: 0, z: 0 } },
  right: { point: { x: 11, y: 3, z: 1.5 }, axis: { x: -1, y: 0, z: 0 } },
  front: { point: { x: 5, y: 0, z: 1.5 }, axis: { x: 0, y: 1, z: 0 } },
  back: { point: { x: 5, y: 7, z: 1.5 }, axis: { x: 0, y: -1, z: 0 } },
};

const setup = (face: MachiningFace) => ({
  setupId: `setup-${face}`,
  presentedFace: face,
  accessibleFaces: [face],
  setupToCandidate: pieceToSetupFrame('top', dimensions),
  maxSetupEnvelopeMm: { xMm: 11, yMm: 7, zMm: 11 },
  clearanceMm: 4,
  supportedAxesInSetup: [{ x: 0, y: 0, z: -1 }],
  supportedKinds: ['drill'],
  supportedRequirementKeys: ['synthetic-bore'],
  supportedToolKeys: ['fixture-tool'],
}) satisfies NeutralMachiningInput['setups'][number];

const operation = (id: string, face: MachiningFace = 'top') => ({
  operationId: id,
  fixtureId: 'fixture-1',
  sourceRevisionId: 'revision-1',
  pieceOccurrenceId: 'occurrence-1',
  kind: 'drill' as const,
  entryFace: face,
  entryPointMm: entries[face].point,
  axisIntoPiece: entries[face].axis,
  diameterMm: 1,
  depthMm: 1,
  travel: 'blind' as const,
  requiredClearanceMm: 1,
  requirementKeys: ['synthetic-bore'],
  toolKey: 'fixture-tool',
}) satisfies NeutralMachiningInput['operations'][number];

const input = (face: MachiningFace = 'top'): NeutralMachiningInput => ({
  source: {
    kind: 'synthetic-fixture', fixtureId: 'fixture-1',
    sourceRevisionId: 'revision-1', pieceOccurrenceId: 'occurrence-1',
  },
  resolution: { status: 'complete' },
  pieceDimensionsMm: dimensions,
  requiredOperationIds: ['drill-1'],
  operations: [operation('drill-1', face)],
  setups: [setup(face)],
});

const coverage = (candidate: ReturnType<typeof planNeutralMachining>) => candidate.coverage[0]!;

describe('neutral synthetic machining coverage (#879 B2b)', () => {
  it.each(Object.keys(entries) as MachiningFace[])('assigns normal %s bore with six-face frames', (face) => {
    const result = planNeutralMachining(input(face));
    expect(result.nonFabricable).toBe(true);
    expect(result.blockers).toContain('NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED');
    expect(result.coverage).toHaveLength(1);
    expect(coverage(result)).toMatchObject({
      requirementIndex: 0, operationId: 'drill-1',
      status: 'ASSIGNED_TO_SUPPORTED_SETUP', setupId: `setup-${face}`,
    });
    expect(coverage(result).pieceToSetup).toBeDefined();
    expect(coverage(result).setupToCandidate).toBeDefined();
    expect(JSON.stringify(result)).not.toMatch(/filename|nativeBytes|sha256|mprxe/i);
  });

  it('uses oriented, not piece-local, setup dimensions on a side setup', () => {
    const side = input('left');
    expect(coverage(planNeutralMachining({ ...side, setups: [{
      ...setup('left'), maxSetupEnvelopeMm: { xMm: 3, yMm: 7, zMm: 11 },
    }] })).status).toBe('ASSIGNED_TO_SUPPORTED_SETUP');
    expect(coverage(planNeutralMachining({ ...side, setups: [{
      ...setup('left'), maxSetupEnvelopeMm: { xMm: 11, yMm: 7, zMm: 3 },
    }] }))).toMatchObject({ status: 'BLOCKED', reasons: ['SETUP_ENVELOPE_EXCEEDED'] });
  });

  it('blocks blind travel reaching the box exit and through travel short of it', () => {
    const base = input();
    const withTravel = (travel: 'blind' | 'through', depthMm: number) =>
      planNeutralMachining({ ...base, operations: [{ ...operation('drill-1'), travel, depthMm }] });
    expect(coverage(withTravel('blind', 100)).reasons).toContain('BLIND_TRAVEL_EXITS_PIECE');
    expect(coverage(withTravel('blind', 3)).reasons).toContain('BLIND_TRAVEL_EXITS_PIECE');
    expect(coverage(withTravel('through', 0.5)).reasons).toContain('THROUGH_TRAVEL_SHORT_OF_EXIT');
    expect(coverage(withTravel('through', 3)).status).toBe('ASSIGNED_TO_SUPPORTED_SETUP');
  });

  it('rejects a bore wider than the face and a bore crossing a face edge', () => {
    const base = input();
    const test = (diameterMm: number, x: number) => coverage(planNeutralMachining({
      ...base, operations: [{ ...operation('drill-1'), diameterMm,
        entryPointMm: { x, y: 3, z: 3 } }],
    }));
    expect(test(100, 5).reasons).toContain('BORE_EXCEEDS_FACE');
    expect(test(1, 0.2).reasons).toContain('BORE_EXCEEDS_FACE');
    expect(test(1, 0.5).status).toBe('ASSIGNED_TO_SUPPORTED_SETUP');
  });

  it('blocks off-face points, non-unit/outward axes, and angled drilling', () => {
    const base = input();
    const withOp = (change: Partial<NeutralMachiningInput['operations'][number]>) =>
      coverage(planNeutralMachining({ ...base, operations: [{ ...operation('drill-1'), ...change }] }));
    expect(withOp({ entryPointMm: { x: 5, y: 3, z: 2 } }).reasons)
      .toContain('ENTRY_POINT_NOT_ON_FACE');
    expect(withOp({ axisIntoPiece: { x: 0, y: 0, z: -2 } }).reasons)
      .toContain('AXIS_NOT_UNIT');
    expect(withOp({ axisIntoPiece: { x: 0, y: 0, z: 1 } }).reasons)
      .toContain('AXIS_NOT_INWARD');
    expect(withOp({ axisIntoPiece: { x: 0.6, y: 0, z: -0.8 } }).reasons)
      .toContain('ANGLED_BORE_UNPROVEN');
  });

  it('makes missing, duplicate, unexpected, and source-mismatched identities explicit', () => {
    const base = input();
    expect(coverage(planNeutralMachining({ ...base, operations: [] })).reasons)
      .toContain('REQUIRED_OPERATION_MISSING');
    const duplicate = planNeutralMachining({ ...base, requiredOperationIds: ['drill-1', 'drill-1'] });
    expect(duplicate.coverage).toHaveLength(2);
    expect(duplicate.coverage.every((item) => item.reasons.includes('DUPLICATE_REQUIRED_OPERATION_ID')))
      .toBe(true);
    expect(coverage(planNeutralMachining({ ...base, operations: [
      operation('drill-1'), operation('drill-1'),
    ] })).reasons).toContain('DUPLICATE_OPERATION_ID');
    expect(coverage(planNeutralMachining({ ...base, operations: [
      operation('drill-1'), operation('unexpected'),
    ] })).reasons).toContain('UNEXPECTED_OPERATION_ID');
    expect(coverage(planNeutralMachining({ ...base, operations: [{
      ...operation('drill-1'), pieceOccurrenceId: 'other',
    }] })).reasons).toContain('OPERATION_SOURCE_MISMATCH');
    expect(coverage(planNeutralMachining({ ...base, operations: [{
      ...operation('drill-1'), fixtureId: 'other',
    }] })).reasons).toContain('OPERATION_SOURCE_MISMATCH');
  });

  it('accounts for each required entry and blocks empty or malformed manifests', () => {
    const base = input();
    const complete = planNeutralMachining({ ...base,
      requiredOperationIds: ['drill-1', 'drill-2'],
      operations: [operation('drill-1'), operation('drill-2')],
    });
    expect(complete.coverage.map((item) => [item.requirementIndex, item.operationId, item.status]))
      .toEqual([[0, 'drill-1', 'ASSIGNED_TO_SUPPORTED_SETUP'],
        [1, 'drill-2', 'ASSIGNED_TO_SUPPORTED_SETUP']]);
    const empty = planNeutralMachining({ ...base, requiredOperationIds: [], operations: [] });
    expect(empty.coverage).toEqual([]);
    expect(empty.blockers).toContain('NO_REQUIRED_OPERATIONS');
    expect(coverage(planNeutralMachining({ ...base, requiredOperationIds: [' '] })).reasons)
      .toContain('INVALID_REQUIRED_OPERATION_ID');
  });

  it('blocks incomplete resolution, invalid source, and malformed dimensions', () => {
    const base = input();
    expect(coverage(planNeutralMachining({ ...base, resolution: {
      status: 'incomplete', reasonCodes: ['missing-upstream-definition'],
    } })).reasons).toContain('UPSTREAM_RESOLUTION_INCOMPLETE');
    expect(coverage(planNeutralMachining({ ...base, source: {
      ...base.source, kind: 'not-synthetic' as 'synthetic-fixture',
    } })).reasons).toContain('SYNTHETIC_SOURCE_REQUIRED');
    expect(coverage(planNeutralMachining({ ...base, pieceDimensionsMm: {
      ...dimensions, zMm: Number.NaN,
    } })).reasons).toContain('INVALID_PIECE_DIMENSIONS');
  });

  it('requires explicit supported face, axis, tool, requirement, and clearance', () => {
    const base = input();
    const withSetup = (change: Partial<NeutralMachiningInput['setups'][number]>) =>
      coverage(planNeutralMachining({ ...base, setups: [{ ...setup('top'), ...change }] }));
    expect(withSetup({ accessibleFaces: [] }).reasons).toContain('FACE_NOT_ACCESSIBLE');
    expect(withSetup({ supportedAxesInSetup: [] }).reasons).toContain('AXIS_NOT_SUPPORTED');
    expect(withSetup({ supportedKinds: [] }).reasons).toContain('KIND_NOT_SUPPORTED');
    expect(withSetup({ supportedToolKeys: [] }).reasons).toContain('TOOL_NOT_SUPPORTED');
    expect(withSetup({ supportedRequirementKeys: [] }).reasons).toContain('REQUIREMENT_NOT_SUPPORTED');
    expect(withSetup({ clearanceMm: null }).reasons).toContain('CLEARANCE_NOT_CONFIRMED');
    expect(withSetup({ clearanceMm: 0.5 }).reasons).toContain('CLEARANCE_INSUFFICIENT');
  });

  it('fails closed on malformed supplied setup capability entries', () => {
    const base = input();
    const withSetup = (change: Partial<NeutralMachiningInput['setups'][number]>) =>
      coverage(planNeutralMachining({ ...base, setups: [{ ...setup('top'), ...change }] }));
    expect(withSetup({ accessibleFaces: ['top', 'invalid' as MachiningFace] }).reasons)
      .toContain('INVALID_SETUP_CAPABILITIES');
    expect(withSetup({ supportedAxesInSetup: [
      { x: 0, y: 0, z: -1 }, { x: 1, y: 1, z: 0 },
    ] }).reasons).toContain('INVALID_SETUP_CAPABILITIES');
    expect(withSetup({ supportedKinds: ['drill', 'laser' as 'drill'] }).reasons)
      .toContain('INVALID_SETUP_CAPABILITIES');
    expect(withSetup({ supportedRequirementKeys: ['synthetic-bore', ' '] }).reasons)
      .toContain('INVALID_SETUP_CAPABILITIES');
    expect(withSetup({ supportedToolKeys: ['fixture-tool', ' '] }).reasons)
      .toContain('INVALID_SETUP_CAPABILITIES');
  });

  it('validates every supplied frame before transform and handles malformed setup IDs', () => {
    const base = input();
    const badFrame = { ...setup('top').setupToCandidate, xAxis: { x: -1, y: 0, z: 0 } };
    expect(coverage(planNeutralMachining({ ...base, setups: [
      { ...setup('top'), setupToCandidate: badFrame },
    ] })).reasons).toContain('INVALID_SETUP_FRAME');
    expect(coverage(planNeutralMachining({ ...base, setups: [
      { ...setup('top'), setupToCandidate: null as unknown as RigidFrame },
    ] })).reasons).toContain('INVALID_SETUP_FRAME');
    expect(coverage(planNeutralMachining({ ...base, setups: [
      { ...setup('top'), setupToCandidate: {
        ...setup('top').setupToCandidate, xAxis: null as unknown as Point3,
      } },
    ] })).reasons).toContain('INVALID_SETUP_FRAME');
    expect(coverage(planNeutralMachining({ ...base, setups: [
      setup('top'), setup('top'),
    ] })).reasons).toContain('DUPLICATE_SETUP_ID');
  });

  it('selects deterministically from supported setups without relying on input order', () => {
    const base = input();
    const preferred = { ...setup('top'), setupId: 'a-setup' };
    const alternate = { ...setup('top'), setupId: 'z-setup' };
    for (const setups of [[alternate, preferred], [preferred, alternate]]) {
      expect(coverage(planNeutralMachining({ ...base, setups })).setupId).toBe('a-setup');
    }
  });

  it('orders distinct Unicode setup IDs by codepoint, independent of input order', () => {
    const base = input();
    const composed = { ...setup('top'), setupId: 'é' };
    const decomposed = { ...setup('top'), setupId: 'e\u0301' };
    for (const setups of [[composed, decomposed], [decomposed, composed]]) {
      expect(coverage(planNeutralMachining({ ...base, setups })).setupId).toBe('e\u0301');
    }
  });

  it('binds a deep-copied validated operation into each assigned manifest entry', () => {
    const base = input();
    const first = { ...operation('drill-1'),
      entryPointMm: { x: 5, y: 3, z: 3 }, requirementKeys: ['synthetic-bore'],
    };
    const second = { ...first, diameterMm: 1.5, depthMm: 2,
      requiredClearanceMm: 2, toolKey: 'alternate-tool',
      requirementKeys: ['alternate-bore'],
    };
    const supported = { ...setup('top'),
      supportedToolKeys: ['fixture-tool', 'alternate-tool'],
      supportedRequirementKeys: ['synthetic-bore', 'alternate-bore'],
    };
    const candidate = coverage(planNeutralMachining({ ...base,
      operations: [first], setups: [supported],
    }));
    const changed = coverage(planNeutralMachining({ ...base,
      operations: [second], setups: [supported],
    }));
    expect(candidate.status).toBe('ASSIGNED_TO_SUPPORTED_SETUP');
    expect(candidate.validatedOperation).toEqual(first);
    expect(changed.validatedOperation).toEqual(second);
    expect(changed.validatedOperation).not.toEqual(candidate.validatedOperation);
    first.entryPointMm.x = 6;
    first.requirementKeys.push('mutated-later');
    expect(candidate.validatedOperation?.entryPointMm.x).toBe(5);
    expect(candidate.validatedOperation?.requirementKeys).toEqual(['synthetic-bore']);
  });

  it('does not alias caller-owned source or setup frame in an assigned manifest', () => {
    const base = input();
    const source = { ...base.source };
    const frame = {
      xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }, origin: { x: 0, y: 0, z: 0 },
    };
    const candidate = planNeutralMachining({ ...base, source, setups: [{
      ...setup('top'), setupToCandidate: frame,
    }] });
    source.fixtureId = 'changed-after-plan';
    frame.origin.x = 99;
    expect(candidate.source.fixtureId).toBe('fixture-1');
    expect(coverage(candidate).setupToCandidate?.origin.x).toBe(0);
    expect(coverage(candidate).candidateEntryPointMm).toEqual({ x: 5, y: 3, z: 3 });
    expect(Object.isFrozen(candidate.source)).toBe(true);
    expect(Object.isFrozen(coverage(candidate).setupToCandidate?.origin)).toBe(true);
  });

  it('freezes the manifest tree so audit evidence cannot change after planning', () => {
    const candidate = planNeutralMachining(input());
    const assigned = coverage(candidate);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.coverage)).toBe(true);
    expect(Object.isFrozen(candidate.blockers)).toBe(true);
    expect(Object.isFrozen(assigned)).toBe(true);
    expect(Object.isFrozen(assigned.reasons)).toBe(true);
    expect(Object.isFrozen(assigned.pieceToSetup?.xAxis)).toBe(true);
    expect(Object.isFrozen(assigned.candidateEntryPointMm)).toBe(true);
    expect(Object.isFrozen(assigned.validatedOperation?.entryPointMm)).toBe(true);
  });

  it('blocks null operation rows, piece dimensions, and setup envelopes', () => {
    const base = input();
    expect(coverage(planNeutralMachining({ ...base, operations: [
      null as unknown as NeutralMachiningInput['operations'][number],
    ] })).reasons).toContain('INVALID_OPERATION_ID');
    expect(coverage(planNeutralMachining({ ...base,
      pieceDimensionsMm: null as unknown as NeutralMachiningInput['pieceDimensionsMm'],
    })).reasons).toContain('INVALID_PIECE_DIMENSIONS');
    expect(coverage(planNeutralMachining({ ...base, setups: [{
      ...setup('top'), maxSetupEnvelopeMm: null as unknown as
        NeutralMachiningInput['setups'][number]['maxSetupEnvelopeMm'],
    }] })).reasons).toContain('INVALID_SETUP_CAPABILITIES');
  });

  it('blocks null identity and setup collections without throwing or assigning', () => {
    const base = input();
    const malformed = <T,>(value: null): T => value as T;
    const noRequired = planNeutralMachining({ ...base,
      requiredOperationIds: malformed<NeutralMachiningInput['requiredOperationIds']>(null),
    });
    expect(noRequired.coverage).toEqual([]);
    expect(noRequired.blockers).toContain('INVALID_REQUIRED_OPERATION_ID');
    expect(coverage(planNeutralMachining({ ...base,
      operations: malformed<NeutralMachiningInput['operations']>(null),
    })).reasons).toContain('INVALID_OPERATION_ID');
    expect(coverage(planNeutralMachining({ ...base,
      setups: malformed<NeutralMachiningInput['setups']>(null),
    })).reasons).toContain('INVALID_SETUP_CAPABILITIES');
    expect(coverage(planNeutralMachining({ ...base,
      setups: [malformed<NeutralMachiningInput['setups'][number]>(null)],
    })).reasons).toContain('INVALID_SETUP_ID');
  });

  it('composes the piece and a non-default candidate frame without changing the operation identity', () => {
    const base = input('left');
    const candidateFrame = {
      xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 0, y: -1, z: 0 }, origin: { x: 19, y: 23, z: 29 },
    };
    const result = coverage(planNeutralMachining({ ...base, setups: [{
      ...setup('left'), setupToCandidate: candidateFrame,
    }] }));
    expect(result).toMatchObject({
      operationId: 'drill-1', status: 'ASSIGNED_TO_SUPPORTED_SETUP',
      candidateEntryPointMm: { x: 20.5, y: 12, z: 32 },
      candidateAxisIntoPiece: { x: 0, y: 1, z: 0 },
    });
  });
  it('fails closed on null and undefined planner input without throwing', () => {
    for (const malformed of [null, undefined]) {
      const candidate = planNeutralMachining(malformed as unknown as NeutralMachiningInput);
      expect(candidate.kind).toBe('neutral-offline-candidate');
      expect(candidate.nonFabricable).toBe(true);
      expect(candidate.complete).toBe(false);
      expect(candidate.coverage).toEqual([]);
      for (const blocker of ['SYNTHETIC_SOURCE_REQUIRED', 'UPSTREAM_RESOLUTION_INCOMPLETE',
        'INVALID_PIECE_DIMENSIONS', 'NO_REQUIRED_OPERATIONS', 'NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED']) {
        expect(candidate.blockers, String(malformed)).toContain(blocker);
      }
    }
  });

  it('marks complete only when every required operation is assigned exactly once', () => {
    expect(planNeutralMachining(input()).complete).toBe(true);
    expect(planNeutralMachining({ ...input(), requiredOperationIds: ['drill-1', 'drill-2'],
      operations: [operation('drill-1'), operation('drill-2')] }).complete).toBe(true);
    expect(planNeutralMachining({ ...input(), setups: [] }).complete).toBe(false);
    expect(planNeutralMachining({ ...input(), requiredOperationIds: ['drill-1', 'drill-1'] })
      .complete).toBe(false);
  });
});
