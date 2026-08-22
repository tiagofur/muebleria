import { describe, it, expect } from 'vitest';
import materialPlanningContract from '../../../contracts/materialPlanning.json';
import {
  MATERIAL_RESERVATION_STATUSES,
  buildMaterialRequirements,
  materializeRequirements,
  computeWarehouseAvailability,
  computeProjectMaterialCoverage,
  planShortagePurchaseLines,
  reserveProjectMaterials,
  consumePlannedMaterials,
  evaluateMaterialsReleaseReadiness,
  releaseProjectMaterials,
  activeReservations,
  type MaterialPlanning,
  type ProjectCoverageInput,
} from './materialPlanning';
import { deriveProjectStage } from './projectLifecycle';
import type { Project } from './types';
import type { MaterialStock } from './stock';
import type { PurchaseOrder } from './purchasingOrders';
import { ValidationError } from './errors';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Obra Test',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    status: 'accepted',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    productionRelease: {
      id: 'rel-1',
      projectId: 'proj-1',
      projectVersion: 1,
      designRevisionId: 'dr-1',
      bomFingerprint: 'fp-abc123',
      releasedBy: 'ing-1',
      releasedAt: '2026-08-20T10:00:00Z',
      checks: [],
    },
    ...overrides,
  };
}

function makePlanning(overrides: Partial<MaterialPlanning> = {}): MaterialPlanning {
  return {
    id: 'mplan-1',
    projectId: 'proj-1',
    requirements: {
      releaseId: 'rel-1',
      bomFingerprint: 'fp-abc123',
      derivedAt: '2026-08-21T10:00:00Z',
      lines: [
        { kind: 'herrajes', materialId: 'hw-1', quantity: 10 },
        { kind: 'tableros', materialId: 'board-1', quantity: 4 },
        { kind: 'cintillas', materialId: 'edge-1', quantity: 25 },
      ],
    },
    reservations: [],
    createdAt: '2026-08-21T10:00:00Z',
    ...overrides,
  };
}

function coverageInput(
  plannings: readonly MaterialPlanning[],
  stock: readonly MaterialStock[] = [],
  purchaseOrders: readonly PurchaseOrder[] = [],
): ProjectCoverageInput {
  return { stock, plannings, purchaseOrders };
}

describe('materialPlanning — Domain Contract Parity (OC-050..OC-054)', () => {
  it('matches materialPlanning contract fixture exactly', () => {
    expect([...MATERIAL_RESERVATION_STATUSES]).toEqual(materialPlanningContract.reservationStatuses);
  });
});

describe('buildMaterialRequirements (OC-050)', () => {
  it('normalizes and dedupes demand from the released-BOM aggregates', () => {
    const lines = buildMaterialRequirements({
      hardware: [
        { hardwareId: 'hw-1', purchaseQuantity: 8 },
        { hardwareId: 'hw-1', purchaseQuantity: 2 },
      ],
      sheetEstimates: [{ materialId: 'board-1', estimatedSheets: 4 }],
      edgeMeters: [{ materialId: 'edge-1', ml: 25.15 }],
    });
    expect(lines).toEqual([
      { kind: 'herrajes', materialId: 'hw-1', quantity: 10 },
      { kind: 'tableros', materialId: 'board-1', quantity: 4 },
      { kind: 'cintillas', materialId: 'edge-1', quantity: 25.15 },
    ]);
  });

  it('rejects empty demand and non-positive quantities', () => {
    expect(() =>
      buildMaterialRequirements({ hardware: [], sheetEstimates: [], edgeMeters: [] }),
    ).toThrow(ValidationError);
    expect(() =>
      buildMaterialRequirements({ hardware: [{ hardwareId: 'hw-1', purchaseQuantity: 0 }], sheetEstimates: [], edgeMeters: [] }),
    ).toThrow(ValidationError);
  });
});

describe('materializeRequirements (OC-050)', () => {
  it('binds the snapshot to the production release and audits materials_required', () => {
    const { project, planning, events } = materializeRequirements(makeProject(), {
      lines: [
        { kind: 'herrajes', materialId: 'hw-1', quantity: 10 },
        { kind: 'tableros', materialId: 'board-1', quantity: 4 },
      ],
      derivedBy: 'alm-1',
      at: '2026-08-21T11:00:00Z',
    });
    expect(planning.requirements?.releaseId).toBe('rel-1');
    expect(planning.requirements?.bomFingerprint).toBe('fp-abc123');
    expect(project.materialPlanning?.id).toBe(planning.id);
    expect(events.map((e) => e.type)).toEqual(['materials_required']);
    // deriveProjectStage ya consume el evento (stage almacén → procurement).
    expect(deriveProjectStage(project)).toBe('procurement');
  });

  it('refuses to materialize requirements without a production release (no heuristics)', () => {
    expect(() =>
      materializeRequirements(makeProject({ productionRelease: undefined }), { lines: [] }),
    ).toThrow(ValidationError);
  });
});

describe('computeWarehouseAvailability (OC-051)', () => {
  const stock: readonly MaterialStock[] = [
    { kind: 'herrajes', materialId: 'hw-1', quantity: 12, minStock: 2 },
  ];
  const otherPlanning = makePlanning({
    id: 'mplan-2',
    projectId: 'proj-2',
    requirements: undefined,
    reservations: [
      { id: 'r-o', kind: 'herrajes', materialId: 'hw-1', quantity: 5, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
    ],
  });

  it('derives the six honest quantities', () => {
    const rows = computeWarehouseAvailability({
      stock,
      plannings: [makePlanning(), otherPlanning],
      purchaseOrders: [
        {
          id: 'po-1', number: 'OC-0001', supplierId: 'sup-1', status: 'emitida',
          items: [
            { kind: 'herrajes', materialId: 'hw-1', quantity: 20, receivedQuantity: 5 },
            { kind: 'herrajes', materialId: 'hw-1', quantity: 0, receivedQuantity: 0 },
          ],
          createdAt: '2026-08-21T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z',
        },
      ],
    });
    const hw = rows.find((r) => r.materialId === 'hw-1')!;
    expect(hw.onHand).toBe(12);
    expect(hw.reserved).toBe(5);
    expect(hw.available).toBe(7);
    expect(hw.incoming).toBe(15);
    expect(hw.required).toBe(10);
    expect(hw.shortage).toBe(0);
  });

  it('reports shortage when neither stock nor incoming covers the requirement', () => {
    const rows = computeWarehouseAvailability({
      stock: [],
      plannings: [makePlanning()],
      purchaseOrders: [],
    });
    const hw = rows.find((r) => r.materialId === 'hw-1')!;
    expect(hw.required).toBe(10);
    expect(hw.shortage).toBe(10);
  });

  it('stops counting required after the project released its materials', () => {
    const released = makePlanning({
      release: { releasedAt: '2026-08-21T12:00:00Z', releasedBy: 'alm-1' },
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 10, status: 'released', reservedAt: '2026-08-21T10:00:00Z', releasedAt: '2026-08-21T12:00:00Z' },
      ],
    });
    const rows = computeWarehouseAvailability({
      stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10, minStock: 0 }],
      plannings: [released],
      purchaseOrders: [],
    });
    const hw = rows.find((r) => r.materialId === 'hw-1')!;
    expect(hw?.required).toBe(0);
    expect(hw?.reserved).toBe(0);
  });
});

describe('computeProjectMaterialCoverage + shortage→PO (OC-052)', () => {
  it('shows reserved/pending/shortage per line with allocated incoming', () => {
    const planning = makePlanning({
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 6, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
      ],
    });
    const input = coverageInput(
      [planning],
      [{ kind: 'herrajes', materialId: 'hw-1', quantity: 8, minStock: 0 }],
      [
        {
          id: 'po-1', number: 'OC-0001', supplierId: 'sup-1', status: 'emitida',
          items: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10, receivedQuantity: 0, allocatedProjectId: 'proj-1' }],
          createdAt: '2026-08-21T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z',
        },
      ],
    );
    const coverage = computeProjectMaterialCoverage('proj-1', input);
    const hw = coverage.find((c) => c.materialId === 'hw-1')!;
    expect(hw.required).toBe(10);
    expect(hw.reserved).toBe(6);
    expect(hw.available).toBe(2);
    expect(hw.incomingAllocated).toBe(10);
    // pending 4 − available 2 − incoming 10 → cubierto por la OC allocada.
    expect(hw.shortage).toBe(0);
    expect(hw.covered).toBe(false);

    const board = coverage.find((c) => c.materialId === 'board-1')!;
    expect(board.pendingReserve).toBe(4);
    expect(board.shortage).toBe(4);
  });

  it('plans PO lines only from real shortage, allocated to the obra', () => {
    const coverage = computeProjectMaterialCoverage(
      'proj-1',
      coverageInput([makePlanning()], [], []),
    );
    const draft = planShortagePurchaseLines(coverage, 'proj-1', { requiredBy: '2026-09-01' });
    expect(draft).toEqual([
      { kind: 'herrajes', materialId: 'hw-1', quantity: 10, allocatedProjectId: 'proj-1', requiredBy: '2026-09-01' },
      { kind: 'tableros', materialId: 'board-1', quantity: 4, allocatedProjectId: 'proj-1', requiredBy: '2026-09-01' },
      { kind: 'cintillas', materialId: 'edge-1', quantity: 25, allocatedProjectId: 'proj-1', requiredBy: '2026-09-01' },
    ]);
  });
});

describe('reserveProjectMaterials (OC-051)', () => {
  it('requires a requirements snapshot', () => {
    expect(() =>
      reserveProjectMaterials(makeProject(), { stock: [], plannings: [] }),
    ).toThrow(ValidationError);
  });

  it('reserves up to availability and audits the shortage remainder', () => {
    const { project, planning, events, reservedLines, shortLines } = reserveProjectMaterials(
      makeProject({ materialPlanning: makePlanning() }),
      {
        stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 7, minStock: 0 }],
        plannings: [makePlanning()],
        byUserId: 'alm-1',
        at: '2026-08-21T11:00:00Z',
      },
    );
    expect(reservedLines).toEqual([{ kind: 'herrajes', materialId: 'hw-1', quantity: 7 }]);
    expect(shortLines.map((l) => l.materialId)).toEqual(['hw-1', 'board-1', 'edge-1']);
    expect(activeReservations(planning)[0]?.status).toBe('active');
    expect(events.map((e) => e.type)).toEqual(['materials_reserved', 'materials_shortage_detected']);
    expect(project.events?.map((e) => e.type)).toEqual(['materials_reserved', 'materials_shortage_detected']);
  });

  it('does not emit materials_reserved twice', () => {
    const once = reserveProjectMaterials(makeProject({ materialPlanning: makePlanning() }), {
      stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 20, minStock: 0 }],
      plannings: [makePlanning()],
    });
    const twice = reserveProjectMaterials(once.project, {
      stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 20, minStock: 0 }],
      plannings: [makePlanning()],
    });
    expect(twice.events.filter((e) => e.type === 'materials_reserved')).toHaveLength(0);
  });
});

describe('consumePlannedMaterials', () => {
  it('consumes reservations oldest-first and splits partial consumption', () => {
    const planning = makePlanning({
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 4, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
        { id: 'r-2', kind: 'herrajes', materialId: 'hw-1', quantity: 6, status: 'active', reservedAt: '2026-08-21T10:05:00Z' },
      ],
    });
    const next = consumePlannedMaterials(
      planning,
      [{ kind: 'herrajes', materialId: 'hw-1', quantity: 7 }],
      '2026-08-21T15:00:00Z',
    )!;
    expect(next.reservations[0]?.status).toBe('consumed');
    expect(next.reservations[1]?.quantity).toBe(3);
    expect(next.reservations[1]?.status).toBe('active');
  });
});

describe('evaluateMaterialsReleaseReadiness (OC-054)', () => {
  it('fails every gate when no planning exists and explains how to resolve', () => {
    const { ready, checks } = evaluateMaterialsReleaseReadiness({
      planning: undefined,
      stock: [],
      plannings: [],
    });
    expect(ready).toBe(false);
    expect(checks.map((c) => c.code)).toEqual([
      'requirements_derived',
      'lines_reserved',
      'reservations_backed',
    ]);
    expect(checks[0]?.details).toContain('Derivar');
  });

  it('fails when a line is not fully reserved', () => {
    const planning = makePlanning({
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 10, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
      ],
    });
    const { ready, failing } = evaluateMaterialsReleaseReadiness({
      planning,
      stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10, minStock: 0 }],
      plannings: [planning],
    });
    expect(ready).toBe(false);
    expect(failing.map((c) => c.code)).toEqual(['lines_reserved']);
  });

  it('fails when reservations exceed physical stock (not backed)', () => {
    const planning = makePlanning({
      requirements: {
        releaseId: 'rel-1',
        bomFingerprint: 'fp-abc123',
        derivedAt: '2026-08-21T10:00:00Z',
        lines: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10 }],
      },
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 10, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
      ],
    });
    const { ready, failing } = evaluateMaterialsReleaseReadiness({
      planning,
      stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 4, minStock: 0 }],
      plannings: [planning],
    });
    expect(ready).toBe(false);
    expect(failing.map((c) => c.code)).toEqual(['reservations_backed']);
  });

  it('passes with full reservations backed by stock', () => {
    const planning = makePlanning({
      requirements: {
        releaseId: 'rel-1',
        bomFingerprint: 'fp-abc123',
        derivedAt: '2026-08-21T10:00:00Z',
        lines: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10 }],
      },
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 10, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
      ],
    });
    const { ready, failing } = evaluateMaterialsReleaseReadiness({
      planning,
      stock: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 12, minStock: 0 }],
      plannings: [planning],
    });
    expect(ready).toBe(true);
    expect(failing).toHaveLength(0);
  });
});

describe('releaseProjectMaterials (OC-054)', () => {
  const fullyReserved = (): MaterialPlanning =>
    makePlanning({
      requirements: {
        releaseId: 'rel-1',
        bomFingerprint: 'fp-abc123',
        derivedAt: '2026-08-21T10:00:00Z',
        lines: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10 }],
      },
      reservations: [
        { id: 'r-1', kind: 'herrajes', materialId: 'hw-1', quantity: 10, status: 'active', reservedAt: '2026-08-21T10:00:00Z' },
      ],
    });
  const stock = [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10, minStock: 0 }] as const;

  it('refuses to release without evidence unless an override reason is given', () => {
    expect(() =>
      releaseProjectMaterials(makeProject({ materialPlanning: makePlanning() }), {
        stock: [],
        plannings: [makePlanning()],
      }),
    ).toThrow(ValidationError);
  });

  it('releases with evidence: stamps materialsRelease and audits only materials_ready', () => {
    const { project, planning, events } = releaseProjectMaterials(
      makeProject({ materialPlanning: fullyReserved() }),
      { stock, plannings: [fullyReserved()], byUserId: 'alm-1', at: '2026-08-21T12:00:00Z' },
    );
    expect(events.map((e) => e.type)).toEqual(['materials_ready']);
    expect(project.materialsRelease).toEqual({ releasedBy: 'alm-1', releasedAt: '2026-08-21T12:00:00Z' });
    expect(planning.reservations[0]?.status).toBe('released');
    expect(planning.release?.releasedAt).toBe('2026-08-21T12:00:00Z');
    expect(planning.release?.override).toBeUndefined();
    expect(deriveProjectStage(project)).toBe('production');
  });

  it('override audit: emits materials_release_overridden before materials_ready', () => {
    const { project, planning, events } = releaseProjectMaterials(
      makeProject({ materialPlanning: makePlanning() }),
      {
        stock: [],
        plannings: [makePlanning()],
        byUserId: 'alm-1',
        at: '2026-08-21T12:00:00Z',
        overrideReason: 'Cliente trae herrajes propios',
      },
    );
    expect(events.map((e) => e.type)).toEqual(['materials_release_overridden', 'materials_ready']);
    expect(planning.release?.override?.reason).toBe('Cliente trae herrajes propios');
    expect(planning.release?.override?.failingChecks).toContain('lines_reserved');
    expect(project.materialsRelease?.releasedAt).toBe('2026-08-21T12:00:00Z');
  });

  it('refuses a second release', () => {
    const first = releaseProjectMaterials(makeProject({ materialPlanning: fullyReserved() }), {
      stock,
      plannings: [fullyReserved()],
    });
    expect(() =>
      releaseProjectMaterials(first.project, { stock, plannings: [fullyReserved()] }),
    ).toThrow(ValidationError);
  });
});
