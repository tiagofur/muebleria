import { describe, expect, it } from 'vitest';
import type {
  Design,
  FurnitureInstance,
  FurnitureWorkspaceUnit,
  ProductionRelease,
  ProjectFurnitureWorkspace,
  QuoteRevisionDetail,
} from '@granete/storage';
import {
  buildFurnitureMatrix,
  currentReleaseReference,
  defaultDesignContext,
  defaultQuoteRevisionId,
  filterMatrixRows,
  filtersAreActive,
  EMPTY_MATRIX_FILTERS,
} from './furnitureMatrix';

function instance(overrides: Partial<FurnitureInstance> & { id: string }): FurnitureInstance {
  return {
    project_id: 'p-1',
    origin: 'quote',
    lifecycle_status: 'active',
    version: 1,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function quoteRevision(
  overrides: Partial<QuoteRevisionDetail> & { id: string },
): QuoteRevisionDetail {
  return {
    projectId: 'p-1',
    revisionNumber: 1,
    status: 'published',
    sourceType: 'manual',
    createdAt: '2026-09-01T11:00:00Z',
    items: [],
    ...overrides,
  };
}

function workspaceUnit(overrides: Partial<FurnitureWorkspaceUnit> & { id: string }): FurnitureWorkspaceUnit {
  const { id, ...rest } = overrides;
  return {
    furnitureInstance: instance({ id }),
    commercial: { present: true, lifecycleStatus: 'active' },
    design: { presence: 'none', contextKind: 'none' },
    ...rest,
  };
}

describe('buildFurnitureMatrix — physical-unit traceability & server authority (#500)', () => {
  it('renders distinct physical units with QuoteLine provenance and preserves non-commercial units without false 1 of 1', () => {
    const units: FurnitureWorkspaceUnit[] = [
      // Line 1: 3 units
      workspaceUnit({
        id: 'fi-1',
        commercialGrouping: {
          quoteLineId: 'ql-1',
          unitIndex: 1,
          unitTotal: 3,
          quoteRevisionId: 'qr-1',
        },
      }),
      workspaceUnit({
        id: 'fi-2',
        commercialGrouping: {
          quoteLineId: 'ql-1',
          unitIndex: 2,
          unitTotal: 3,
          quoteRevisionId: 'qr-1',
        },
      }),
      workspaceUnit({
        id: 'fi-3',
        commercialGrouping: {
          quoteLineId: 'ql-1',
          unitIndex: 3,
          unitTotal: 3,
          quoteRevisionId: 'qr-1',
        },
      }),
      // Line 2: 2 units with same definition, kept strictly distinct
      workspaceUnit({
        id: 'fi-4',
        commercialGrouping: {
          quoteLineId: 'ql-2',
          unitIndex: 1,
          unitTotal: 2,
          quoteRevisionId: 'qr-1',
        },
      }),
      workspaceUnit({
        id: 'fi-5',
        commercialGrouping: {
          quoteLineId: 'ql-2',
          unitIndex: 2,
          unitTotal: 2,
          quoteRevisionId: 'qr-1',
        },
      }),
      // Unit from design origin: NO commercial grouping
      workspaceUnit({
        id: 'fi-design',
        furnitureInstance: instance({ id: 'fi-design', origin: 'design' }),
        commercial: { present: false },
        commercialGrouping: undefined,
      }),
    ];

    const workspace: ProjectFurnitureWorkspace = {
      projectId: 'p-1',
      designContext: { kind: 'none' },
      summary: {
        total: 6,
        activeUnits: 6,
        quoted: 5,
        placed: 0,
        pending: 0,
        actionRequired: 0,
        removed: 0,
        cancelled: 0,
      },
      units,
    };

    const { rows, summary } = buildFurnitureMatrix({ workspace });

    expect(rows).toHaveLength(6);
    const byId = new Map(rows.map((r) => [r.instance.id, r]));

    // Line 1 provenance
    expect(byId.get('fi-1')?.unitProvenanceLabel).toBe('Unidad 1 de 3');
    expect(byId.get('fi-2')?.unitProvenanceLabel).toBe('Unidad 2 de 3');
    expect(byId.get('fi-3')?.unitProvenanceLabel).toBe('Unidad 3 de 3');

    // Line 2 provenance (never merged with Line 1 into 1..5)
    expect(byId.get('fi-4')?.unitProvenanceLabel).toBe('Unidad 1 de 2');
    expect(byId.get('fi-5')?.unitProvenanceLabel).toBe('Unidad 2 de 2');

    // Design-origin unit: no false "Unidad 1 de 1"
    expect(byId.get('fi-design')?.unitProvenanceLabel).toBeNull();
    expect(byId.get('fi-design')?.commercialGrouping).toBeNull();

    expect(summary.total).toBe(6);
    expect(summary.quotedActive).toBe(5);
  });

  it('projects placed/pending and actionRequired verbatim from backend read model', () => {
    const units: FurnitureWorkspaceUnit[] = [
      workspaceUnit({
        id: 'fi-placed',
        design: {
          presence: 'placed',
          contextKind: 'working',
          designId: 'd-1',
        },
      }),
      workspaceUnit({
        id: 'fi-pending',
        design: {
          presence: 'pending',
          contextKind: 'working',
          designId: 'd-1',
        },
        actionRequired: {
          code: 'pending_placement',
          message: 'Pendiente de colocar en el diseño',
          remediation: 'Colocá la unidad desde el panel de muebles',
        },
      }),
    ];

    const workspace: ProjectFurnitureWorkspace = {
      projectId: 'p-1',
      designContext: { kind: 'working', designId: 'd-1' },
      summary: {
        total: 2,
        activeUnits: 2,
        quoted: 2,
        placed: 1,
        pending: 1,
        actionRequired: 1,
        removed: 0,
        cancelled: 0,
      },
      units,
    };

    const { rows, summary } = buildFurnitureMatrix({ workspace });
    const byId = new Map(rows.map((r) => [r.instance.id, r]));

    expect(byId.get('fi-placed')?.presence).toBe('placed');
    expect(byId.get('fi-placed')?.actionRequired).toBeNull();

    expect(byId.get('fi-pending')?.presence).toBe('pending');
    expect(byId.get('fi-pending')?.actionRequired).toBe('Pendiente de colocar en el diseño');
    expect(byId.get('fi-pending')?.nextStep).toBe('Colocá la unidad desde el panel de muebles');

    expect(summary.placedInDesign).toBe(1);
    expect(summary.pendingPlacement).toBe(1);
    expect(summary.requireAttention).toBe(1);
  });

  it('negative proof: React does NOT join design items and does NOT invent actionRequired', () => {
    // We construct a unit marked pending by backend
    const unit = workspaceUnit({
      id: 'fi-x',
      design: { presence: 'pending', contextKind: 'working' },
      actionRequired: {
        code: 'pending_placement',
        message: 'Pendiente de colocar',
        remediation: 'Colocá la unidad',
      },
    });

    const workspace: ProjectFurnitureWorkspace = {
      projectId: 'p-1',
      designContext: { kind: 'working', designId: 'd-1' },
      summary: {
        total: 1,
        activeUnits: 1,
        quoted: 1,
        placed: 0,
        pending: 1,
        actionRequired: 1,
        removed: 0,
        cancelled: 0,
      },
      units: [unit],
    };

    // Even if extraneous client-side properties (like design items) are passed,
    // buildFurnitureMatrix relies strictly on workspace.units and ignores them.
    const inputWithExtraneousItems = {
      workspace,
      workingCopy: {
        items: [{ furniture_instance_id: 'fi-x' }], // claiming fi-x is placed in working copy
      },
      designRevision: {
        items: [{ furniture_instance_id: 'fi-x' }],
      },
    };

    const { rows } = buildFurnitureMatrix(inputWithExtraneousItems);

    // Presence remains pending as authorized by backend, proving React never joins design items
    expect(rows[0]?.presence).toBe('pending');
    expect(rows[0]?.actionRequired).toBe('Pendiente de colocar');
  });

  it('mirrors reconciliation verbatim from backend read model', () => {
    const units: FurnitureWorkspaceUnit[] = [
      workspaceUnit({
        id: 'fi-synced',
        reconciliation: {
          furnitureInstanceId: 'fi-synced',
          status: 'synced',
          differences: [],
          impact: { commercial: false, manufacturing: false, spatial: false },
        },
      }),
      workspaceUnit({
        id: 'fi-mod',
        reconciliation: {
          furnitureInstanceId: 'fi-mod',
          status: 'modified',
          differences: [
            {
              path: 'parameters.widthMm',
              quoteValue: 600,
              designValue: 700,
              impact: { commercial: true, manufacturing: true, spatial: false },
            },
          ],
          impact: { commercial: true, manufacturing: true, spatial: false },
        },
        actionRequired: {
          code: 'modified',
          message: 'Modificada respecto de la cotización',
          remediation: 'Generá una nueva revisión de cotización para incorporar el cambio',
        },
      }),
    ];

    const workspace: ProjectFurnitureWorkspace = {
      projectId: 'p-1',
      designContext: { kind: 'revision', designRevisionId: 'dr-1' },
      summary: {
        total: 2,
        activeUnits: 2,
        quoted: 2,
        placed: 2,
        pending: 0,
        actionRequired: 1,
        removed: 0,
        cancelled: 0,
      },
      units,
    };

    const { rows } = buildFurnitureMatrix({ workspace });
    const byId = new Map(rows.map((r) => [r.instance.id, r]));

    expect(byId.get('fi-synced')?.reconciliation).toBe('synced');
    expect(byId.get('fi-synced')?.actionRequired).toBeNull();

    expect(byId.get('fi-mod')?.reconciliation).toBe('modified');
    expect(byId.get('fi-mod')?.actionRequired).toBe('Modificada respecto de la cotización');
    expect(byId.get('fi-mod')?.nextStep).toContain('revisión de cotización');
  });
});

describe('matrix filters', () => {
  const rows = [
    {
      instance: instance({ id: 'fi-a' }),
      label: 'Gabinete 600',
      dimensionsLabel: null,
      origin: 'quote',
      originLabel: 'Cotización',
      duplicateOfInstanceId: null,
      lifecycle: 'active',
      lifecycleLabel: 'Activa',
      isActive: true,
      commercialGrouping: { quoteLineId: 'ql-1', unitIndex: 1, unitTotal: 1 },
      unitIndex: 1,
      unitTotal: 1,
      unitProvenanceLabel: 'Unidad 1 de 1',
      presence: 'placed',
      quotedInSelectedRevision: true,
      reconciliation: null,
      reconciliationItem: null,
      actionRequired: null,
      nextStep: null,
      actionCode: null,
    },
    {
      instance: instance({ id: 'fi-b' }),
      label: 'Cajonero',
      dimensionsLabel: null,
      origin: 'manual',
      originLabel: 'Manual',
      duplicateOfInstanceId: null,
      lifecycle: 'active',
      lifecycleLabel: 'Activa',
      isActive: true,
      commercialGrouping: null,
      unitIndex: null,
      unitTotal: null,
      unitProvenanceLabel: null,
      presence: 'pending',
      quotedInSelectedRevision: false,
      reconciliation: null,
      reconciliationItem: null,
      actionRequired: 'Pendiente de colocar en el diseño',
      nextStep: 'Colocá la unidad desde el panel de muebles',
      actionCode: 'pending_placement',
    },
  ] as never[];

  it('empty filters keep every row', () => {
    expect(filterMatrixRows(rows, EMPTY_MATRIX_FILTERS)).toHaveLength(2);
    expect(filtersAreActive(EMPTY_MATRIX_FILTERS)).toBe(false);
  });

  it('search matches label or technical id', () => {
    expect(filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, search: 'cajon' })).toHaveLength(1);
    expect(filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, search: 'fi-a' })).toHaveLength(1);
    expect(filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, search: 'inexistente' })).toHaveLength(0);
  });

  it('origin, presence and attention filters compose', () => {
    expect(filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, origins: ['manual'] })).toHaveLength(1);
    expect(filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, presences: ['pending'] })).toHaveLength(1);
    expect(filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, attention: true })).toHaveLength(1);
    expect(
      filterMatrixRows(rows, { ...EMPTY_MATRIX_FILTERS, attention: true, presences: ['placed'] }),
    ).toHaveLength(0);
    expect(filtersAreActive({ ...EMPTY_MATRIX_FILTERS, attention: true })).toBe(true);
  });
});

describe('context defaults and release reference', () => {
  it('default quote revision is the newest, pinned once selected', () => {
    const revisions = [
      quoteRevision({ id: 'qr-1', revisionNumber: 1 }),
      quoteRevision({ id: 'qr-3', revisionNumber: 3 }),
      quoteRevision({ id: 'qr-2', revisionNumber: 2 }),
    ];
    expect(defaultQuoteRevisionId(revisions)).toBe('qr-3');
    expect(defaultQuoteRevisionId([])).toBeNull();
  });

  it('default design context is the first design in working mode', () => {
    const designs: Design[] = [
      {
        id: 'd-2',
        project_id: 'p-1',
        name: 'Cocina alternativa',
        status: 'active',
        created_at: '2026-09-02T10:00:00Z',
        updated_at: '2026-09-02T10:00:00Z',
      },
      {
        id: 'd-1',
        project_id: 'p-1',
        name: 'Cocina principal',
        status: 'active',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      },
    ];
    expect(defaultDesignContext(designs)).toEqual({
      kind: 'working',
      designId: 'd-1',
      designRevisionId: null,
    });
    expect(defaultDesignContext([])).toEqual({
      kind: 'none',
      designId: null,
      designRevisionId: null,
    });
  });

  it('release reference is the newest release of the project', () => {
    expect(currentReleaseReference([])).toBeNull();
    const older: ProductionRelease = {
      id: 'rel-1',
      project_id: 'p-1',
      release_number: 1,
      design_revision_id: 'dr-1',
      design_revision_number: 1,
      manufacturing_fingerprint: 'fp-1',
      status: 'active',
      released_by: 'u-1',
      released_at: '2026-09-01T10:00:00Z',
      staleness: {
        manufacturing_stale: true,
        current_design_revision_id: 'dr-2',
        current_design_revision_number: 2,
      },
    };
    const newer: ProductionRelease = {
      ...older,
      id: 'rel-2',
      release_number: 2,
      design_revision_id: 'dr-2',
    };
    expect(currentReleaseReference([older, newer])?.id).toBe('rel-2');
  });
});
