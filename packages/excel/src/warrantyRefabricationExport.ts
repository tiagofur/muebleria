import type { ProductionCutRow, WarrantyTicket } from '@granete/domain';
import { refabricationPiecesToCutRows } from '@granete/domain';
import { optimizerExport } from './optimizerExport';

/**
 * Returns standard filename for warranty refabrication optimizer export.
 * e.g. "Re-corte_GAR-2026-001_Optimizer.xlsx"
 */
export function warrantyRefabricationFilename(
  ticket: Pick<WarrantyTicket, 'ticketNumber'>,
): string {
  const safeNumber = (ticket.ticketNumber || 'GAR')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `Re-corte_${safeNumber}_Optimizer.xlsx`;
}

/**
 * Exports a warranty ticket's replacement pieces to Plantilla_Optimizer format.
 */
export async function exportWarrantyRefabricationOptimizer(
  ticket: Pick<WarrantyTicket, 'ticketNumber' | 'refabricationPieces'>,
  extraCutRows?: readonly ProductionCutRow[],
): Promise<Uint8Array> {
  const rows = extraCutRows ?? refabricationPiecesToCutRows(ticket);
  return optimizerExport(rows);
}
