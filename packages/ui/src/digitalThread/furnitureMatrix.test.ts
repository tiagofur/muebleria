import { describe, expect, it } from 'vitest';
import type {
  Design,
  DesignWorkingCopy,
  FurnitureInstance,
  ProductionRelease,
  ProjectDesignReconciliationResult,
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

function quoteRevision(overrides: Partial<QuoteRevisionDetail> & { id: string }): QuoteRevisionDetail {
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

describe('buildFurnitureMatrix — physical-unit traceability (#500)', () => {
  it('quantity=3 renders three distinct physical units with Unidad i de N provenance', () => {
    const definitionId = 'def-1';
    const instances = [
      instance({ id: 'fi-a', furniture_definition_id: definitionId, created_at: '2026-09-01T10:00:01Z' }),
      instance({ id: 'fi-b', furniture_definition_id: definitionId, created_at: '2026-09-01T10:00:02Z' }),
      instance({ id: 'fi-c', furniture_definition_id: definitionId, created_at: '2026-09-01T10:00:03Z' }),
    ];

    const { rows, summary } = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: null,
      designContext: { kind: 'none', designId: null, designRevisionId: null },
      workingCopy: null,
      designRevision: null,
      reconciliation: null,
    });

    expect(rows).toHaveLength(3);
    // Identity is the server id, never the QuoteLine or the array index.
    expect(new Set(rows.map((row) => row.instance.id))).toEqual(new Set(['fi-a', 'fi-b', 'fi-c']));
    expect(rows.map((row) => row.unitIndex)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.unitTotal === 3)).toBe(true);
    expect(summary.total).toBe(3);
    expect(summary.activeUnits).toBe(3);
    // No design selected: nobody is pending, the state is honest no-design.
    expect(summary.pendingPlacement).toBe(0);
    expect(rows.every((row) => row.presence === 'no-design')).toBe(true);
  });

  it('partial placement derives placed/pending strictly from the selected design context items', () => {
    const workingCopy: DesignWorkingCopy = {
      design_id: 'd-1',
      project_id: 'p-1',
      source_type: 'sketchup',
      items: [
        {
          id: 'wi-1',
          design_id: 'd-1',
          furniture_instance_id: 'fi-a',
          parameters: {},
          material_choices: {},
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
        {
          id: 'wi-2',
          design_id: 'd-1',
          furniture_instance_id: 'fi-b',
          parameters: {},
          material_choices: {},
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
      ],
      updated_at: '2026-09-01T12:00:00Z',
    };
    const instances = [
      instance({ id: 'fi-a', furniture_definition_id: 'def-1' }),
      instance({ id: 'fi-b', furniture_definition_id: 'def-1' }),
      instance({ id: 'fi-c', furniture_definition_id: 'def-1' }),
    ];

    const { rows, summary } = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: null,
      designContext: { kind: 'working', designId: 'd-1', designRevisionId: null },
      workingCopy,
      designRevision: null,
      reconciliation: null,
    });

    const byId = new Map(rows.map((row) => [row.instance.id, row]));
    expect(byId.get('fi-a')?.presence).toBe('placed');
    expect(byId.get('fi-b')?.presence).toBe('placed');
    expect(byId.get('fi-c')?.presence).toBe('pending');
    expect(summary.placedInDesign).toBe(2);
    expect(summary.pendingPlacement).toBe(1);
    // Pending carries a next step; it is a view state, not a persisted status.
    expect(byId.get('fi-c')?.actionRequired).toBe('Pendiente de colocar en el diseño');
  });

  it('mixed origins keep server provenance verbatim, including duplicate parent identity', () => {
    const instances = [
      instance({ id: 'fi-quote', origin: 'quote', furniture_definition_id: 'def-1' }),
      instance({ id: 'fi-design', origin: 'design' }),
      instance({ id: 'fi-manual', origin: 'manual' }),
      instance({ id: 'fi-import', origin: 'import' }),
      instance({ id: 'fi-dup', origin: 'duplicate', origin_furniture_instance_id: 'fi-quote' }),
    ];

    const { rows } = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: null,
      designContext: { kind: 'none', designId: null, designRevisionId: null },
      workingCopy: null,
      designRevision: null,
      reconciliation: null,
    });

    const byId = new Map(rows.map((row) => [row.instance.id, row]));
    expect(byId.get('fi-quote')?.originLabel).toBe('Cotización');
    expect(byId.get('fi-design')?.originLabel).toBe('Diseño');
    expect(byId.get('fi-manual')?.originLabel).toBe('Manual');
    expect(byId.get('fi-import')?.originLabel).toBe('Importado');
    expect(byId.get('fi-dup')?.originLabel).toBe('Duplicado');
    expect(byId.get('fi-dup')?.duplicateOfInstanceId).toBe('fi-quote');
  });

  it('commercial presence derives from the exact selected QuoteRevision snapshot only', () => {
    const instances = [
      instance({ id: 'fi-a', furniture_definition_id: 'def-1' }),
      instance({ id: 'fi-b', furniture_definition_id: 'def-1' }),
    ];
    const quoteRevisions = [
      quoteRevision({
        id: 'qr-1',
        revisionNumber: 1,
        items: [
          {
            furnitureInstanceId: 'fi-a',
            parameters: { widthMm: 600 },
            materialChoices: {},
            lifecycleStatus: 'active',
          },
          {
            furnitureInstanceId: 'fi-b',
            parameters: { widthMm: 600 },
            materialChoices: {},
            lifecycleStatus: 'active',
          },
        ],
      }),
      quoteRevision({
        id: 'qr-2',
        revisionNumber: 2,
        items: [
          {
            furnitureInstanceId: 'fi-a',
            parameters: { widthMm: 650 },
            materialChoices: {},
            lifecycleStatus: 'active',
          },
        ],
      }),
    ];

    const base = {
      instances,
      quoteRevisions,
      designContext: { kind: 'none' as const, designId: null, designRevisionId: null },
      workingCopy: null,
      designRevision: null,
      reconciliation: null,
    };

    const viewingR2 = buildFurnitureMatrix({ ...base, selectedQuoteRevisionId: 'qr-2' });
    const byIdR2 = new Map(viewingR2.rows.map((row) => [row.instance.id, row]));
    expect(byIdR2.get('fi-a')?.quotedInSelectedRevision).toBe(true);
    expect(byIdR2.get('fi-b')?.quotedInSelectedRevision).toBe(false);
    expect(viewingR2.summary.quotedActive).toBe(1);

    // Switching to the historical revision retargets the view explicitly.
    const viewingR1 = buildFurnitureMatrix({ ...base, selectedQuoteRevisionId: 'qr-1' });
    expect(viewingR1.summary.quotedActive).toBe(2);
  });

  it('mirrors reconciliation statuses from the server result only — never invents quoted_not_modeled', () => {
    const instances = [instance({ id: 'fi-a' }), instance({ id: 'fi-b' })];
    const reconciliation = {
      projectId: 'p-1',
      quoteRevisionId: 'qr-1',
      designRevisionId: 'dr-1',
      summary: {
        total: 2,
        synced: 0,
        quotedNotModeled: 1,
        modeledNotQuoted: 0,
        modified: 1,
        removed: 0,
        conflict: 0,
      },
      items: [
        {
          furnitureInstanceId: 'fi-a',
          status: 'quoted_not_modeled',
          differences: [],
          impact: { commercial: false, manufacturing: false, spatial: false },
        },
        {
          furnitureInstanceId: 'fi-b',
          status: 'modified',
          differences: [
            { path: 'parameters.widthMm', quoteValue: 600, designValue: 650, impact: { commercial: true, manufacturing: true, spatial: false } },
          ],
          impact: { commercial: true, manufacturing: true, spatial: false },
        },
      ],
      impact: {
        requiresRequote: true,
        requiresResolution: false,
        canRequote: true,
        commercialChanges: 1,
        manufacturingChanges: 1,
        spatialChanges: 0,
      },
    } as unknown as ProjectDesignReconciliationResult;

    const withServerResult = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: 'qr-1',
      designContext: { kind: 'revision', designId: 'd-1', designRevisionId: 'dr-1' },
      workingCopy: null,
      designRevision: null,
      reconciliation,
    });
    const byId = new Map(withServerResult.rows.map((row) => [row.instance.id, row]));
    expect(byId.get('fi-a')?.reconciliation).toBe('quoted_not_modeled');
    expect(byId.get('fi-b')?.reconciliation).toBe('modified');
    expect(byId.get('fi-b')?.nextStep).toContain('revisión de cotización');
    expect(withServerResult.summary.requireAttention).toBe(2);

    // Without a server reconciliation result (e.g. working-copy context) the
    // view stays honest: no invented statuses even for pending units.
    const withoutServerResult = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: null,
      designContext: { kind: 'none', designId: null, designRevisionId: null },
      workingCopy: null,
      designRevision: null,
      reconciliation: null,
    });
    expect(withoutServerResult.rows.every((row) => row.reconciliation === null)).toBe(true);
  });

  it('terminal units stay visible and historically understandable', () => {
    const instances = [
      instance({ id: 'fi-live' }),
      instance({ id: 'fi-gone', lifecycle_status: 'removed' }),
      instance({ id: 'fi-cancelled', lifecycle_status: 'cancelled' }),
    ];

    const { rows, summary } = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: null,
      designContext: { kind: 'none', designId: null, designRevisionId: null },
      workingCopy: null,
      designRevision: null,
      reconciliation: null,
    });

    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((row) => [row.instance.id, row]));
    expect(byId.get('fi-gone')?.lifecycleLabel).toBe('Retirada');
    expect(byId.get('fi-cancelled')?.lifecycleLabel).toBe('Cancelada');
    expect(summary.activeUnits).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.cancelled).toBe(1);
  });

  it('derives presence from an exact published DesignRevision when selected', () => {
    const instances = [instance({ id: 'fi-a' }), instance({ id: 'fi-b' })];
    const designRevision = {
      id: 'dr-1',
      design_id: 'd-1',
      revision_number: 1,
      source_type: 'sketchup',
      status: 'published',
      created_at: '2026-09-01T13:00:00Z',
      items: [
        {
          id: 'dri-1',
          design_revision_id: 'dr-1',
          furniture_instance_id: 'fi-b',
          parameters: {},
          material_choices: {},
          created_at: '2026-09-01T13:00:00Z',
        },
      ],
    };

    const { rows, summary } = buildFurnitureMatrix({
      instances,
      quoteRevisions: [],
      selectedQuoteRevisionId: null,
      designContext: { kind: 'revision', designId: 'd-1', designRevisionId: 'dr-1' },
      workingCopy: null,
      designRevision: designRevision as never,
      reconciliation: null,
    });

    const byId = new Map(rows.map((row) => [row.instance.id, row]));
    expect(byId.get('fi-a')?.presence).toBe('pending');
    expect(byId.get('fi-b')?.presence).toBe('placed');
    expect(summary.placedInDesign).toBe(1);
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
      unitIndex: 1,
      unitTotal: 1,
      presence: 'placed',
      quotedInSelectedRevision: true,
      reconciliation: null,
      actionRequired: null,
      nextStep: null,
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
      unitIndex: 1,
      unitTotal: 1,
      presence: 'pending',
      quotedInSelectedRevision: false,
      reconciliation: null,
      actionRequired: 'Pendiente de colocar en el diseño',
      nextStep: 'Colocá la unidad desde el panel de muebles',
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
    expect(defaultDesignContext([])).toEqual({ kind: 'none', designId: null, designRevisionId: null });
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
