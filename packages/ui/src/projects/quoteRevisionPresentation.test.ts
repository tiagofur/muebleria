import { describe, expect, it } from 'vitest';
import type { Project } from '@granete/domain';
import type {
  ProjectCommercialSummary,
  QuoteCommercialSnapshot,
  QuoteRevisionItem,
} from '@granete/storage';
import {
  buildRevisionLines,
  filterProjectsByCommercialStatus,
  formatCommercialSummaryBadge,
  formatLifecycleStatus,
  formatRevisionUnitDimensions,
} from './quoteRevisionPresentation';

describe('quoteRevisionPresentation', () => {
  describe('formatLifecycleStatus', () => {
    it('translates lifecycle status values into Spanish UI copy', () => {
      expect(formatLifecycleStatus('active')).toBe('Activa');
      expect(formatLifecycleStatus('removed')).toBe('Retirada');
      expect(formatLifecycleStatus('cancelled')).toBe('Cancelada');
      expect(formatLifecycleStatus(undefined)).toBe('—');
      expect(formatLifecycleStatus('')).toBe('—');
    });
  });

  describe('formatRevisionUnitDimensions', () => {
    it('formats numeric widthMm, heightMm, depthMm into mm string', () => {
      expect(
        formatRevisionUnitDimensions({ widthMm: 650, heightMm: 720, depthMm: 560 }),
      ).toBe('650×720×560 mm');
    });

    it('tolerates alternative width, height, depth keys or numeric strings', () => {
      expect(
        formatRevisionUnitDimensions({ width: '600', height: 720, depth: 350 }),
      ).toBe('600×720×350 mm');
    });

    it('returns null when any dimension is missing or non-positive', () => {
      expect(formatRevisionUnitDimensions({ widthMm: 650, heightMm: 720 })).toBeNull();
      expect(formatRevisionUnitDimensions(null)).toBeNull();
      expect(formatRevisionUnitDimensions({ widthMm: 0, heightMm: 720, depthMm: 560 })).toBeNull();
    });
  });

  describe('buildRevisionLines', () => {
    const sampleSnapshot: QuoteCommercialSnapshot = {
      schema: 'granete.quote-commercial-snapshot.v1',
      capturedAt: '2026-09-10T12:00:00Z',
      currency: 'MXN',
      customer: { id: 'cust-1', name: 'Cliente A' },
      project: { id: 'prj-1', name: 'Obra 1' },
      breakdown: {
        materialsCost: 100,
        edgeTotal: 20,
        hardwareTotal: 30,
        directCost: 150,
        laborModular: 50,
        laborFixedCost: 50,
        marginFactor: 1.35,
        salePrice: 270,
      },
      lines: [
        {
          quoteLineId: 'line-1',
          quantity: 2,
          furnitureInstanceIds: ['fi-1', 'fi-2'],
          amounts: { materialsCost: 60, edgeTotal: 10, hardwareTotal: 15, directCost: 85, laborModular: 25, salePrice: 140 },
        },
        {
          quoteLineId: 'line-2',
          quantity: 1,
          furnitureInstanceIds: ['fi-3'],
          amounts: { materialsCost: 40, edgeTotal: 10, hardwareTotal: 15, directCost: 65, laborModular: 25, salePrice: 0 },
        },
      ],
      units: [
        {
          furnitureInstanceId: 'fi-1',
          quoteLineId: 'line-1',
          moduleCode: 'MOD-GAB-01',
          moduleName: 'Gabinete Bajo',
          lifecycleStatus: 'active',
          options: [{ groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-a', choiceLabel: 'Blanco' }],
        },
        {
          furnitureInstanceId: 'fi-2',
          quoteLineId: 'line-1',
          moduleCode: 'MOD-GAB-01',
          moduleName: 'Gabinete Bajo',
          lifecycleStatus: 'active',
          options: [{ groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-b', choiceLabel: 'Roble' }],
        },
        {
          furnitureInstanceId: 'fi-3',
          quoteLineId: 'line-2',
          moduleCode: 'MOD-ALAC-01',
          moduleName: 'Alacena',
          lifecycleStatus: 'active',
          options: [],
        },
      ],
    };

    const sampleItems: QuoteRevisionItem[] = [
      {
        furnitureInstanceId: 'fi-1',
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        materialChoices: { FRENTE: 'mat-a' },
        lifecycleStatus: 'active',
      },
      {
        furnitureInstanceId: 'fi-2',
        parameters: { widthMm: 650, heightMm: 720, depthMm: 560 },
        materialChoices: { FRENTE: 'mat-b' },
        lifecycleStatus: 'active',
      },
      {
        furnitureInstanceId: 'fi-3',
        parameters: { widthMm: 800, heightMm: 720, depthMm: 350 },
        materialChoices: {},
        lifecycleStatus: 'active',
      },
    ];

    it('joins lines, units and items strictly by quoteLineId and furnitureInstanceId', () => {
      const result = buildRevisionLines(sampleSnapshot, sampleItems);
      expect(result).toHaveLength(2);

      const line1 = result[0]!;
      const line2 = result[1]!;
      expect(line1.quoteLineId).toBe('line-1');
      expect(line1.quantity).toBe(2);
      expect(line1.isMultiUnit).toBe(true);
      expect(line1.salePrice).toBe(140);
      expect(line1.units).toHaveLength(2);

      const u1 = line1.units[0]!;
      expect(u1.furnitureInstanceId).toBe('fi-1');
      expect(u1.dimensionsFormatted).toBe('600×720×560 mm');
      expect(u1.options[0]?.choiceLabel).toBe('Blanco');

      const u2 = line1.units[1]!;
      expect(u2.furnitureInstanceId).toBe('fi-2');
      expect(u2.dimensionsFormatted).toBe('650×720×560 mm');
      expect(u2.options[0]?.choiceLabel).toBe('Roble');

      expect(line2.quoteLineId).toBe('line-2');
      expect(line2.quantity).toBe(1);
      expect(line2.isMultiUnit).toBe(false);
      // Legitimate zero price is preserved when amounts are visible
      expect(line2.salePrice).toBe(0);
      expect(line2.units[0]?.dimensionsFormatted).toBe('800×720×350 mm');
    });

    it('maps salePrice to null when amountsVisible is false without converting to 0', () => {
      const result = buildRevisionLines(sampleSnapshot, sampleItems, { amountsVisible: false });
      expect(result).toHaveLength(2);
      // Hidden amounts must not show as $0.00
      expect(result[0]!.salePrice).toBeNull();
      expect(result[1]!.salePrice).toBeNull();
    });

    it('handles missing item parameters by showing null dimensions', () => {
      const result = buildRevisionLines(sampleSnapshot, []);
      expect(result[0]?.units[0]?.dimensionsFormatted).toBeNull();
    });

    it('faithfully preserves a single removed or cancelled unit with zero active quantity', () => {
      const terminalSnapshot: QuoteCommercialSnapshot = {
        ...sampleSnapshot,
        lines: [
          {
            quoteLineId: 'line-terminal',
            quantity: 0,
            furnitureInstanceIds: ['fi-term-1'],
            amounts: { materialsCost: 0, edgeTotal: 0, hardwareTotal: 0, directCost: 0, laborModular: 0, salePrice: 0 },
          },
        ],
        units: [
          {
            furnitureInstanceId: 'fi-term-1',
            quoteLineId: 'line-terminal',
            moduleCode: 'MOD-TERM-01',
            moduleName: 'Mueble Cancelado',
            lifecycleStatus: 'removed',
            options: [],
          },
        ],
      };
      const terminalItems: QuoteRevisionItem[] = [
        {
          furnitureInstanceId: 'fi-term-1',
          parameters: { widthMm: 500, heightMm: 720, depthMm: 400 },
          materialChoices: {},
          lifecycleStatus: 'removed',
        },
      ];

      const result = buildRevisionLines(terminalSnapshot, terminalItems);
      expect(result).toHaveLength(1);
      const line = result[0]!;
      expect(line.quantity).toBe(0);
      expect(line.isMultiUnit).toBe(false);
      expect(line.units).toHaveLength(1);
      expect(line.units[0]!.lifecycleStatus).toBe('removed');
      expect(line.units[0]!.dimensionsFormatted).toBe('500×720×400 mm');
    });
  });

  describe('formatCommercialSummaryBadge', () => {
    it('formats none/undefined as Sin cotización with draft modifier', () => {
      expect(formatCommercialSummaryBadge(undefined)).toEqual({
        label: 'Sin cotización',
        modifier: 'status-badge--draft',
        ariaLabel: 'Estado comercial: sin cotización',
      });

      const summaryNone: ProjectCommercialSummary = {
        projectId: 'p-none',
        projectName: 'Obra Sin Cotización',
        quoteStatus: 'none',
        isLegacy: false,
        furnitureQuantity: 0,
        currency: 'MXN',
        commercialActivityAt: '2026-09-10T12:00:00Z',
      };
      expect(formatCommercialSummaryBadge(summaryNone)).toEqual({
        label: 'Sin cotización',
        modifier: 'status-badge--draft',
        ariaLabel: 'Estado comercial: sin cotización',
      });
    });

    it('formats accepted with revision prefix and accepted modifier', () => {
      const summaryAccepted: ProjectCommercialSummary = {
        projectId: 'p-acc',
        projectName: 'Obra Aceptada',
        quoteStatus: 'accepted',
        quoteRevisionId: 'rev-1',
        quoteRevisionNumber: 2,
        isLegacy: false,
        furnitureQuantity: 3,
        saleTotal: 5000,
        currency: 'MXN',
        commercialActivityAt: '2026-09-10T12:00:00Z',
      };
      expect(formatCommercialSummaryBadge(summaryAccepted)).toEqual({
        label: 'Q2 · Aceptada',
        modifier: 'status-badge--accepted',
        ariaLabel: 'Estado comercial: Q2 aceptada',
      });
    });

    it('formats published with revision prefix and quoted modifier', () => {
      const summaryPublished: ProjectCommercialSummary = {
        projectId: 'p-pub',
        projectName: 'Obra Publicada',
        quoteStatus: 'published',
        quoteRevisionId: 'rev-1',
        quoteRevisionNumber: 1,
        isLegacy: false,
        furnitureQuantity: 1,
        saleTotal: 2500,
        currency: 'MXN',
        commercialActivityAt: '2026-09-10T12:00:00Z',
      };
      expect(formatCommercialSummaryBadge(summaryPublished)).toEqual({
        label: 'Q1 · Publicada',
        modifier: 'status-badge--quoted',
        ariaLabel: 'Estado comercial: Q1 publicada',
      });
    });

    it('formats draft with draft modifier', () => {
      const summaryDraft: ProjectCommercialSummary = {
        projectId: 'p-draft',
        projectName: 'Obra Borrador',
        quoteStatus: 'draft',
        quoteRevisionId: 'rev-d',
        quoteRevisionNumber: 1,
        isLegacy: false,
        furnitureQuantity: 2,
        currency: 'MXN',
        commercialActivityAt: '2026-09-10T12:00:00Z',
      };
      expect(formatCommercialSummaryBadge(summaryDraft)).toEqual({
        label: 'Q1 · Borrador',
        modifier: 'status-badge--draft',
        ariaLabel: 'Estado comercial: Q1 borrador',
      });
    });

    it('formats superseded with inactive modifier', () => {
      const summarySuperseded: ProjectCommercialSummary = {
        projectId: 'p-sup',
        projectName: 'Obra Reemplazada',
        quoteStatus: 'superseded',
        quoteRevisionId: 'rev-old',
        quoteRevisionNumber: 1,
        isLegacy: false,
        furnitureQuantity: 1,
        currency: 'MXN',
        commercialActivityAt: '2026-09-10T12:00:00Z',
      };
      expect(formatCommercialSummaryBadge(summarySuperseded)).toEqual({
        label: 'Q1 · Reemplazada',
        modifier: 'status-badge--inactive',
        ariaLabel: 'Estado comercial: Q1 reemplazada',
      });
    });
  });

  describe('filterProjectsByCommercialStatus', () => {
    const makeProject = (id: string, name: string): Project =>
      ({
        id,
        name,
        customerId: '',
        status: 'draft',
        items: [],
        createdAt: '2026-09-10T10:00:00Z',
        updatedAt: '2026-09-10T10:00:00Z',
        currency: 'MXN',
        marginFactor: 1.35,
      }) as unknown as Project;

    const projects = [
      makeProject('p-1', 'Cocina Central'),
      makeProject('p-2', 'Placard Dormitorio'),
      makeProject('p-3', 'Mueble TV'),
      makeProject('p-4', 'Sin Cotizar'),
    ];

    const summaries = new Map<string, ProjectCommercialSummary>([
      [
        'p-1',
        {
          projectId: 'p-1',
          projectName: 'Cocina Central',
          quoteStatus: 'accepted',
          quoteRevisionNumber: 2,
          isLegacy: false,
          furnitureQuantity: 4,
          currency: 'MXN',
          commercialActivityAt: '2026-09-10T10:00:00Z',
        },
      ],
      [
        'p-2',
        {
          projectId: 'p-2',
          projectName: 'Placard Dormitorio',
          quoteStatus: 'published',
          quoteRevisionNumber: 1,
          isLegacy: false,
          furnitureQuantity: 1,
          currency: 'MXN',
          commercialActivityAt: '2026-09-10T10:00:00Z',
        },
      ],
      [
        'p-3',
        {
          projectId: 'p-3',
          projectName: 'Mueble TV',
          quoteStatus: 'draft',
          quoteRevisionNumber: 1,
          isLegacy: false,
          furnitureQuantity: 1,
          currency: 'MXN',
          commercialActivityAt: '2026-09-10T10:00:00Z',
        },
      ],
    ]);

    it('returns all projects when filter is all', () => {
      const result = filterProjectsByCommercialStatus(projects, '', 'all', [], summaries);
      expect(result).toHaveLength(4);
    });

    it('filters by commercial status: accepted, published, draft, none', () => {
      expect(
        filterProjectsByCommercialStatus(projects, '', 'accepted', [], summaries).map((p) => p.id),
      ).toEqual(['p-1']);

      expect(
        filterProjectsByCommercialStatus(projects, '', 'published', [], summaries).map((p) => p.id),
      ).toEqual(['p-2']);

      expect(
        filterProjectsByCommercialStatus(projects, '', 'draft', [], summaries).map((p) => p.id),
      ).toEqual(['p-3']);

      expect(
        filterProjectsByCommercialStatus(projects, '', 'none', [], summaries).map((p) => p.id),
      ).toEqual(['p-4']);
    });

    it('combines text query with commercial status filter', () => {
      const result = filterProjectsByCommercialStatus(projects, 'cocina', 'accepted', [], summaries);
      expect(result.map((p) => p.id)).toEqual(['p-1']);

      const noMatch = filterProjectsByCommercialStatus(projects, 'placard', 'accepted', [], summaries);
      expect(noMatch).toEqual([]);
    });
  });
});
