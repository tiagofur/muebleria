import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { WarrantyTicket } from '@muebles/domain';
import {
  exportWarrantyRefabricationOptimizer,
  warrantyRefabricationFilename,
} from './warrantyRefabricationExport';

describe('Warranty Refabrication Excel Export', () => {
  it('generates standard filename', () => {
    expect(
      warrantyRefabricationFilename({ ticketNumber: 'GAR-2026-001' }),
    ).toBe('Re-corte_GAR-2026-001_Optimizer.xlsx');
  });

  it('exports refabrication pieces into Plantilla_Optimizer workbook', async () => {
    const mockTicket: WarrantyTicket = {
      id: 'ticket-1',
      ticketNumber: 'GAR-2026-001',
      projectId: 'proj-1',
      title: 'Lateral rayado',
      description: 'Re-cortar lateral',
      category: 'damaged_part',
      priority: 'urgent',
      status: 'in_progress',
      refabricationPieces: [
        {
          pieceDescription: 'Lateral Izq · ALTO-60',
          materialName: 'Blanco Frost',
          lengthMm: 720,
          widthMm: 300,
          quantity: 1,
          grain: 0,
          L1: 1,
          L2: 1,
          W1: 1,
          W2: 0,
        },
      ],
      photos: [],
      createdAt: '2026-08-15T12:00:00Z',
      updatedAt: '2026-08-15T12:00:00Z',
    };

    const bytes = await exportWarrantyRefabricationOptimizer(mockTicket);
    expect(bytes.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as any);
    const sheet = workbook.getWorksheet('Plantilla');
    expect(sheet).toBeDefined();

    // Check row 3 (first data row)
    const row3 = sheet!.getRow(3);
    expect(row3.getCell(1).value).toBe(1); // Quantity
    expect(row3.getCell(2).value).toBe(720); // Length
    expect(row3.getCell(3).value).toBe(300); // Width
    expect(row3.getCell(4).value).toBe(
      '[RE-CORTE GAR-2026-001] Lateral Izq · ALTO-60',
    );
    expect(row3.getCell(5).value).toBe('Blanco Frost');
  });
});
