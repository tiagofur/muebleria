import { describe, expect, it } from 'vitest';
import {
  computeEngineeringDashboardStats,
  computeWarehouseDashboardStats,
  DATA_TRUTH_ORIGIN_LABELS_ES,
} from './index';

describe('Data Truth Contract (OC-006)', () => {
  it('defines labels for all five data truth origin states', () => {
    expect(DATA_TRUTH_ORIGIN_LABELS_ES).toEqual({
      actual: 'Real',
      estimated: 'Estimado',
      forecast: 'Proyectado',
      proxy: 'Aproximado (proxy)',
      missing: 'Sin datos',
    });
  });

  describe('Engineering Dashboard truth provenance', () => {
    it('tags cutPieceCount and totalCutPieces as proxy when calculated from heuristic moduleCount * 8', () => {
      const stats = computeEngineeringDashboardStats([
        {
          id: 'p1',
          name: 'Cocina A',
          customerId: 'c1',
          customerLabel: 'Cliente 1',
          currency: 'USD',
          marginFactor: 1.3,
          laborFixedCost: 0,
          status: 'accepted',
          items: [
            { id: 'i1', moduleId: 'm1', optionChoices: {}, quantity: 2 },
            { id: 'i2', moduleId: 'm2', optionChoices: {}, quantity: 3 },
          ],
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        },
      ]);

      expect(stats.totalModulesCalculated).toBe(5);
      expect(stats.totalCutPiecesCalculated).toBe(40); // 5 * 8
      expect(stats.totalCutPiecesOrigin).toBe('proxy');
      expect(stats.projects[0]?.cutPieceOrigin).toBe('proxy');
    });
  });

  describe('Warehouse Dashboard truth provenance', () => {
    it('marks boardArea, edgeLength and hardware as proxy when calculated via heuristics', () => {
      const stats = computeWarehouseDashboardStats([
        {
          id: 'p1',
          name: 'Obra 1',
          status: 'accepted',
          items: [{ quantity: 2 }],
          createdAt: '2026-08-01T10:00:00.000Z',
        },
      ]);

      expect(stats.boardAreaOrigin).toBe('proxy');
      expect(stats.edgeLengthOrigin).toBe('proxy');
      expect(stats.hardwareLinesOrigin).toBe('proxy');
      expect(stats.projects[0]?.boardAreaOrigin).toBe('proxy');
      expect(stats.projects[0]?.daysInWarehouseOrigin).toBe('proxy');
    });

    it('marks origins as actual when direct metrics are provided', () => {
      const stats = computeWarehouseDashboardStats([
        {
          id: 'p1',
          name: 'Obra 1',
          status: 'accepted',
          items: [{ quantity: 2 }],
          boardAreaM2: 5.4,
          edgeLengthMl: 25.0,
          hardwareCount: 12,
        },
      ]);

      expect(stats.boardAreaOrigin).toBe('actual');
      expect(stats.edgeLengthOrigin).toBe('actual');
      expect(stats.hardwareLinesOrigin).toBe('actual');
      expect(stats.projects[0]?.boardAreaOrigin).toBe('actual');
      expect(stats.projects[0]?.edgeLengthOrigin).toBe('actual');
      expect(stats.projects[0]?.hardwareCountOrigin).toBe('actual');
    });
  });
});
