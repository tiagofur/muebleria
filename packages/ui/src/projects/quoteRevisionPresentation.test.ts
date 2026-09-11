import { describe, expect, it } from 'vitest';
import type { QuoteCommercialSnapshot, QuoteRevisionItem } from '@granete/storage';
import {
  buildRevisionLines,
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
});
