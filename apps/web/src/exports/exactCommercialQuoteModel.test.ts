import { describe, expect, it } from 'vitest';
import type {
  QuoteCommercialSnapshot,
  QuoteRevisionDetail,
} from '@granete/storage';
import {
  buildExactCommercialQuoteExportModel,
  commercialLifecycleTimestamp,
  resolveExactRevisionExportSource,
} from './exactCommercialQuoteModel';

function snapshotFixture(overrides?: Partial<QuoteCommercialSnapshot>): QuoteCommercialSnapshot {
  return {
    schema: 'granete.quote-commercial-snapshot.v1',
    capturedAt: '2026-09-11T10:00:00.000Z',
    currency: 'MXN',
    customer: { id: 'c-1', name: 'Pedro Pérez' },
    project: { id: 'p-1', name: 'Cocina Pedro' },
    breakdown: {
      materialsCost: 100,
      edgeTotal: 10,
      hardwareTotal: 5,
      directCost: 115,
      laborModular: 0,
      laborFixedCost: 0,
      marginFactor: 1.35,
      salePrice: 155.25,
    },
    lines: [
      {
        quoteLineId: '11111111-1111-4111-8111-111111111111',
        quantity: 2,
        furnitureInstanceIds: [
          '21111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        amounts: {
          materialsCost: 100,
          edgeTotal: 10,
          hardwareTotal: 5,
          directCost: 115,
          laborModular: 0,
          salePrice: 155.25,
        },
      },
    ],
    units: [
      {
        furnitureInstanceId: '21111111-1111-4111-8111-111111111111',
        quoteLineId: '11111111-1111-4111-8111-111111111111',
        moduleCode: 'MOD-GAB-600',
        moduleName: 'Bajo mesada 600',
        lifecycleStatus: 'active',
        options: [
          { groupCode: 'INTERIOR', groupLabel: 'Interior', choiceId: 'mat-a', choiceLabel: 'Melamina blanca' },
        ],
      },
      {
        furnitureInstanceId: '22222222-2222-4222-8222-222222222222',
        quoteLineId: '11111111-1111-4111-8111-111111111111',
        moduleCode: 'MOD-GAB-600',
        moduleName: 'Bajo mesada 600',
        lifecycleStatus: 'active',
        options: [
          { groupCode: 'INTERIOR', groupLabel: 'Interior', choiceId: 'mat-a', choiceLabel: 'Melamina blanca' },
        ],
      },
    ],
    ...overrides,
  };
}

function revisionFixture(
  overrides?: Partial<QuoteRevisionDetail>,
): QuoteRevisionDetail {
  return {
    id: '31111111-1111-4111-8111-111111111111',
    projectId: 'p-1',
    revisionNumber: 2,
    status: 'accepted',
    sourceType: 'requote',
    createdAt: '2026-09-10T09:00:00.000Z',
    publishedAt: '2026-09-10T12:00:00.000Z',
    acceptedAt: '2026-09-11T15:00:00.000Z',
    items: [
      {
        furnitureInstanceId: '21111111-1111-4111-8111-111111111111',
        furnitureDefinitionId: 'mod-gab',
        definitionVersion: 1,
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        materialChoices: {},
        lifecycleStatus: 'active',
      },
      {
        furnitureInstanceId: '22222222-2222-4222-8222-222222222222',
        furnitureDefinitionId: 'mod-gab',
        definitionVersion: 1,
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        materialChoices: {},
        lifecycleStatus: 'active',
      },
    ],
    ...overrides,
  };
}

describe('buildExactCommercialQuoteExportModel (#642)', () => {
  it('derives the model exclusively from the frozen snapshot identity', () => {
    const model = buildExactCommercialQuoteExportModel({
      revision: revisionFixture(),
      snapshot: snapshotFixture(),
    });
    expect(model.revisionNumber).toBe(2);
    expect(model.statusLabel).toBe('Aceptada');
    expect(model.projectName).toBe('Cocina Pedro');
    expect(model.customerName).toBe('Pedro Pérez');
    expect(model.currency).toBe('MXN');
    expect(model.capturedAt).toBe('2026-09-11T10:00:00.000Z');
    expect(model.saleTotal).toBe(155.25);
    expect(model.lines).toHaveLength(1);
    expect(model.lines[0]!.quantity).toBe(2);
    expect(model.lines[0]!.moduleCode).toBe('MOD-GAB-600');
    expect(model.lines[0]!.salePrice).toBe(155.25);
    expect(model.lines[0]!.units).toHaveLength(2);
    expect(model.lines[0]!.units[0]!.dimensionsLabel).toBe('600×720×560 mm');
    expect(model.lines[0]!.units[0]!.optionsSummary).toBe(
      'Interior: Melamina blanca',
    );
    expect(model.lines[0]!.units[0]!.lifecycleStatusLabel).toBe('Activa');
  });

  it('uses the real commercial lifecycle date: acceptedAt wins over publishedAt/createdAt', () => {
    const revision = revisionFixture();
    expect(commercialLifecycleTimestamp(revision)).toBe(revision.acceptedAt);
    expect(commercialLifecycleTimestamp({ ...revision, acceptedAt: null })).toBe(
      revision.publishedAt,
    );
    expect(
      commercialLifecycleTimestamp({ ...revision, acceptedAt: null, publishedAt: null }),
    ).toBe(revision.createdAt);

    const model = buildExactCommercialQuoteExportModel({
      revision,
      snapshot: snapshotFixture(),
    });
    // acceptedAt 2026-09-11T15:00Z formatted es-MX
    expect(model.dateLabel).toMatch(/11\/09\/2026/);
  });

  it('maps line amounts to absence when the actor is not authorized (never a fake 0)', () => {
    const model = buildExactCommercialQuoteExportModel(
      { revision: revisionFixture(), snapshot: snapshotFixture() },
      { amountsVisible: false },
    );
    expect(model.lines[0]!.salePrice).toBeNull();
    // The frozen sale total is still shown — server policy keeps it for clients.
    expect(model.saleTotal).toBe(155.25);
  });

  it('preserves a legitimate frozen 0.00 line price when amounts are visible', () => {
    const snapshot = snapshotFixture({
      lines: [
        {
          quoteLineId: '11111111-1111-4111-8111-111111111111',
          quantity: 1,
          furnitureInstanceIds: ['21111111-1111-4111-8111-111111111111'],
          amounts: {
            materialsCost: 0,
            edgeTotal: 0,
            hardwareTotal: 0,
            directCost: 0,
            laborModular: 0,
            salePrice: 0,
          },
        },
      ],
      units: [snapshotFixture().units[0]!],
    });
    const model = buildExactCommercialQuoteExportModel({
      revision: revisionFixture({ items: [revisionFixture().items[0]!] }),
      snapshot,
    });
    expect(model.lines[0]!.salePrice).toBe(0);
  });

  it('keeps distinct lines with identical module names distinct (join by quoteLineId)', () => {
    const base = snapshotFixture();
    const sameNameUnits = base.units.map((u) => ({
      ...u,
      quoteLineId: '44444444-4444-4444-8444-444444444444',
    }));
    const snapshot = {
      ...base,
      lines: [
        ...base.lines,
        {
          quoteLineId: '44444444-4444-4444-8444-444444444444',
          quantity: 2,
          furnitureInstanceIds: sameNameUnits.map((u) => u.furnitureInstanceId),
          amounts: base.lines[0]!.amounts,
        },
      ],
      units: [...base.units, ...sameNameUnits],
    };
    const model = buildExactCommercialQuoteExportModel({
      revision: revisionFixture(),
      snapshot,
    });
    expect(model.lines).toHaveLength(2);
    expect(new Set(model.lines.map((l) => l.quoteLineId)).size).toBe(2);
    expect(model.lines.every((l) => l.moduleName === 'Bajo mesada 600')).toBe(true);
  });
});

describe('resolveExactRevisionExportSource — exact id + fail-closed states (#642/3)', () => {
  it('resolves the exact revision + snapshot by id from the loaded list', () => {
    const revision = revisionFixture();
    const snapshot = snapshotFixture();
    const other = revisionFixture({ id: '41111111-1111-4111-8111-111111111111', revisionNumber: 1 });
    const result = resolveExactRevisionExportSource(
      [
        { ...other, commercialSnapshot: undefined },
        { ...revision, commercialSnapshot: snapshot },
      ],
      revision.id,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.revision.id).toBe(revision.id);
      expect(result.source.revision.revisionNumber).toBe(2);
      expect(result.source.snapshot).toBe(snapshot);
    }
  });

  it('fails closed for an unknown revision id (no implicit latest)', () => {
    const revision = revisionFixture();
    const result = resolveExactRevisionExportSource(
      [{ ...revision, commercialSnapshot: snapshotFixture() }],
      '61111111-1111-4111-8111-111111111111',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.message).toContain('No se encontró la revisión solicitada');
    }
  });

  it('legacy snapshot-less revision fails closed with the actionable CTA', () => {
    const revision = revisionFixture({ revisionNumber: 1, commercialSnapshot: undefined });
    const result = resolveExactRevisionExportSource([revision], revision.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.message).toContain(
        'no tiene historial comercial congelado',
      );
      expect(result.issues[0]!.message).toContain('nueva revisión actualizada');
    }
  });

  it('org-withheld retail amounts (manufacturing-only) fail closed — never a faked 0', () => {
    const revision = revisionFixture({ commercialAmountsWithheld: true });
    const result = resolveExactRevisionExportSource(
      [{ ...revision, commercialSnapshot: snapshotFixture() }],
      revision.id,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.message).toContain('no está disponible para tu organización');
    }
  });
});
