/**
 * Shared frozen-authority fixtures for the exact commercial export tests
 * (#642 / Delivery 3). Q1 freezes 600 mm; Q2 freezes 650 mm — the canonical
 * determinism pair.
 */

import type {
  QuoteCommercialSnapshot,
  QuoteRevisionDetail,
} from '@granete/storage';

export const Q1_LINE_ID = '11111111-1111-4111-8111-111111111111';
export const Q1_UNIT_A = '21111111-1111-4111-8111-111111111111';
export const Q1_UNIT_B = '22222222-2222-4222-8222-222222222222';

export function exactSnapshotFixture(
  overrides?: Partial<QuoteCommercialSnapshot>,
): QuoteCommercialSnapshot {
  return {
    schema: 'granete.quote-commercial-snapshot.v1',
    capturedAt: '2026-09-10T10:00:00.000Z',
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
        quoteLineId: Q1_LINE_ID,
        quantity: 2,
        furnitureInstanceIds: [Q1_UNIT_A, Q1_UNIT_B],
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
        furnitureInstanceId: Q1_UNIT_A,
        quoteLineId: Q1_LINE_ID,
        moduleCode: 'MOD-GAB-600',
        moduleName: 'Bajo mesada 600',
        lifecycleStatus: 'active',
        options: [
          {
            groupCode: 'INTERIOR',
            groupLabel: 'Interior',
            choiceId: 'mat-a',
            choiceLabel: 'Melamina blanca',
          },
        ],
      },
      {
        furnitureInstanceId: Q1_UNIT_B,
        quoteLineId: Q1_LINE_ID,
        moduleCode: 'MOD-GAB-600',
        moduleName: 'Bajo mesada 600',
        lifecycleStatus: 'active',
        options: [
          {
            groupCode: 'INTERIOR',
            groupLabel: 'Interior',
            choiceId: 'mat-r',
            choiceLabel: 'Roble caramelado',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function itemsWithWidth(
  widthMm: number,
): QuoteRevisionDetail['items'] {
  return [Q1_UNIT_A, Q1_UNIT_B].map((furnitureInstanceId) => ({
    furnitureInstanceId,
    furnitureDefinitionId: 'mod-gab',
    definitionVersion: 1,
    parameters: { widthMm, heightMm: 720, depthMm: 560 },
    materialChoices: {},
    lifecycleStatus: 'active' as const,
  }));
}

/** Q1 — the frozen 600 mm revision (published historical truth). */
export function exactQ1Fixture(): {
  revision: QuoteRevisionDetail;
  snapshot: QuoteCommercialSnapshot;
} {
  return {
    revision: {
      id: '31111111-1111-4111-8111-111111111111',
      projectId: 'p-1',
      revisionNumber: 1,
      status: 'superseded',
      sourceType: 'manual',
      createdAt: '2026-09-09T09:00:00.000Z',
      publishedAt: '2026-09-09T12:00:00.000Z',
      acceptedAt: '2026-09-10T15:00:00.000Z',
      items: itemsWithWidth(600),
    },
    snapshot: exactSnapshotFixture({
      capturedAt: '2026-09-09T09:00:00.000Z',
      lines: [
        {
          quoteLineId: Q1_LINE_ID,
          quantity: 2,
          furnitureInstanceIds: [Q1_UNIT_A, Q1_UNIT_B],
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
          furnitureInstanceId: Q1_UNIT_A,
          quoteLineId: Q1_LINE_ID,
          moduleCode: 'MOD-GAB-600',
          moduleName: 'Bajo mesada 600',
          lifecycleStatus: 'active',
          options: [
            {
              groupCode: 'INTERIOR',
              groupLabel: 'Interior',
              choiceId: 'mat-a',
              choiceLabel: 'Melamina blanca',
            },
          ],
        },
        {
          furnitureInstanceId: Q1_UNIT_B,
          quoteLineId: Q1_LINE_ID,
          moduleCode: 'MOD-GAB-600',
          moduleName: 'Bajo mesada 600',
          lifecycleStatus: 'active',
          options: [
            {
              groupCode: 'INTERIOR',
              groupLabel: 'Interior',
              choiceId: 'mat-a',
              choiceLabel: 'Melamina blanca',
            },
          ],
        },
      ],
    }),
  };
}

/** Q2 — the frozen 650 mm revision (current accepted truth). */
export function exactQ2Fixture(): {
  revision: QuoteRevisionDetail;
  snapshot: QuoteCommercialSnapshot;
} {
  return {
    revision: {
      id: '51111111-1111-4111-8111-111111111111',
      projectId: 'p-1',
      revisionNumber: 2,
      status: 'accepted',
      sourceType: 'requote',
      createdAt: '2026-09-10T09:00:00.000Z',
      publishedAt: '2026-09-10T12:00:00.000Z',
      acceptedAt: '2026-09-11T15:00:00.000Z',
      items: itemsWithWidth(650),
    },
    snapshot: exactSnapshotFixture({
      capturedAt: '2026-09-10T09:00:00.000Z',
      breakdown: {
        materialsCost: 120,
        edgeTotal: 12,
        hardwareTotal: 5,
        directCost: 137,
        laborModular: 0,
        laborFixedCost: 0,
        marginFactor: 1.35,
        salePrice: 184.95,
      },
      lines: [
        {
          quoteLineId: Q1_LINE_ID,
          quantity: 2,
          furnitureInstanceIds: [Q1_UNIT_A, Q1_UNIT_B],
          amounts: {
            materialsCost: 120,
            edgeTotal: 12,
            hardwareTotal: 5,
            directCost: 137,
            laborModular: 0,
            salePrice: 184.95,
          },
        },
      ],
      units: [
        {
          furnitureInstanceId: Q1_UNIT_A,
          quoteLineId: Q1_LINE_ID,
          moduleCode: 'MOD-GAB-650',
          moduleName: 'Bajo mesada 650',
          lifecycleStatus: 'active',
          options: [
            {
              groupCode: 'INTERIOR',
              groupLabel: 'Interior',
              choiceId: 'mat-a',
              choiceLabel: 'Melamina blanca',
            },
          ],
        },
        {
          furnitureInstanceId: Q1_UNIT_B,
          quoteLineId: Q1_LINE_ID,
          moduleCode: 'MOD-GAB-650',
          moduleName: 'Bajo mesada 650',
          lifecycleStatus: 'active',
          options: [
            {
              groupCode: 'INTERIOR',
              groupLabel: 'Interior',
              choiceId: 'mat-a',
              choiceLabel: 'Melamina blanca',
            },
          ],
        },
      ],
    }),
  };
}
