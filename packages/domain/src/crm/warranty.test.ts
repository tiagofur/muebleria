import { describe, expect, it } from 'vitest';
import {
  WARRANTY_CATEGORY_METADATA,
  WARRANTY_PRIORITY_METADATA,
  WARRANTY_STATUS_METADATA,
  refabricationPiecesToCutRows,
} from './warranty';
import type { WarrantyTicket } from '../types';

describe('Warranty Domain Logic', () => {
  it('exposes metadata for all categories, priorities and statuses', () => {
    expect(WARRANTY_CATEGORY_METADATA.damaged_part.label).toBe(
      'Pieza dañada / rayada',
    );
    expect(WARRANTY_PRIORITY_METADATA.urgent.color).toBe('#ef4444');
    expect(WARRANTY_STATUS_METADATA.resolved.label).toBe('Resuelto / Cerrado');
  });

  it('converts refabrication pieces to ProductionCutRows for Optimizer', () => {
    const mockTicket: WarrantyTicket = {
      id: 'ticket-1',
      ticketNumber: 'GAR-2026-001',
      projectId: 'proj-1',
      title: 'Frente rayado',
      description: 'Reemplazar frente',
      category: 'damaged_part',
      priority: 'urgent',
      status: 'in_progress',
      refabricationPieces: [
        {
          pieceDescription: 'Frente Cajón 800 · BAJO-80',
          materialName: 'Roble Nebraska',
          lengthMm: 796,
          widthMm: 196,
          quantity: 2,
          grain: 1,
          L1: 1,
          L2: 1,
          W1: 1,
          W2: 1,
          partName: 'Frente Cajón 800',
          moduleCode: 'BAJO-80',
        },
      ],
      photos: [],
      createdAt: '2026-08-15T12:00:00Z',
      updatedAt: '2026-08-15T12:00:00Z',
    };

    const cutRows = refabricationPiecesToCutRows(mockTicket);
    expect(cutRows).toHaveLength(1);
    expect(cutRows[0]!.description).toBe(
      '[RE-CORTE GAR-2026-001] Frente Cajón 800 · BAJO-80',
    );
    expect(cutRows[0]!.lengthMm).toBe(796);
    expect(cutRows[0]!.widthMm).toBe(196);
    expect(cutRows[0]!.quantity).toBe(2);
    expect(cutRows[0]!.materialName).toBe('Roble Nebraska');
    expect(cutRows[0]!.grain).toBe(1);
    expect(cutRows[0]!.L1).toBe(1);
    expect(cutRows[0]!.W2).toBe(1);
    expect(cutRows[0]!.labelRef).toBe('GAR-2026-001-P1');
  });


  it('handles empty refabrication pieces gracefully', () => {
    const cutRows = refabricationPiecesToCutRows({
      ticketNumber: 'GAR-EMPTY',
      refabricationPieces: [],
    });
    expect(cutRows).toEqual([]);
  });
});
