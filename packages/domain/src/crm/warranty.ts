import type {
  ProductionCutRow,
  WarrantyRefabricationPiece,
  WarrantyTicket,
  WarrantyTicketCategory,
  WarrantyTicketPriority,
  WarrantyTicketStatus,
} from '../types';

export interface WarrantyCategoryMeta {
  readonly label: string;
  readonly description: string;
  readonly icon: string;
}

export const WARRANTY_CATEGORY_METADATA: Record<
  WarrantyTicketCategory,
  WarrantyCategoryMeta
> = {
  hardware_adjustment: {
    label: 'Ajuste de herrajes',
    description: 'Calibración de bisagras, correderas, pistones o tiradores',
    icon: 'wrench',
  },
  damaged_part: {
    label: 'Pieza dañada / rayada',
    description: 'Frente, lateral o tapa rayada, golpeada o despuntada',
    icon: 'scissors',
  },
  finishing_defect: {
    label: 'Detalle de acabado / canto',
    description: 'Despegue de canto, exceso de adhesivo o defecto superficial',
    icon: 'layers',
  },
  installation_issue: {
    label: 'Descuadre / fijación en obra',
    description: 'Desnivel de pared, tornillería floja o descuadre de módulos',
    icon: 'maximize-2',
  },
  other: {
    label: 'Otro reclamo',
    description: 'Consulta o requerimiento post-venta general',
    icon: 'help-circle',
  },
};

export interface WarrantyPriorityMeta {
  readonly label: string;
  readonly color: string;
}

export const WARRANTY_PRIORITY_METADATA: Record<
  WarrantyTicketPriority,
  WarrantyPriorityMeta
> = {
  low: {
    label: 'Baja',
    color: '#64748b', // Slate
  },
  normal: {
    label: 'Normal',
    color: '#0284c7', // Sky
  },
  urgent: {
    label: 'Urgente',
    color: '#ef4444', // Red
  },
};

export interface WarrantyStatusMeta {
  readonly label: string;
  readonly color: string;
  readonly description: string;
}

export const WARRANTY_STATUS_METADATA: Record<
  WarrantyTicketStatus,
  WarrantyStatusMeta
> = {
  open: {
    label: 'Abierto / Recibido',
    color: '#f59e0b', // Amber
    description: 'Incidencia recibida pendiente de coordinación técnica',
  },
  visit_scheduled: {
    label: 'Visita programada',
    color: '#8b5cf6', // Purple
    description: 'Fecha acordada para inspección o reparación en obra',
  },
  in_progress: {
    label: 'En reparación / corte',
    color: '#3b82f6', // Blue
    description: 'Técnico asignado o piezas en proceso de re-corte en taller',
  },
  resolved: {
    label: 'Resuelto / Cerrado',
    color: '#10b981', // Green
    description: 'Reparación completada y comprobante de resolución validado',
  },
  cancelled: {
    label: 'Cancelado',
    color: '#94a3b8', // Gray
    description: 'Ticket desestimado o cancelado',
  },
};

/**
 * Converts a warranty ticket's refabrication pieces into ProductionCutRows
 * ready for the Optimizer Excel export or CNC cut plan.
 */
export function refabricationPiecesToCutRows(
  ticket: Pick<WarrantyTicket, 'ticketNumber' | 'refabricationPieces'>,
): ProductionCutRow[] {
  if (!ticket.refabricationPieces || ticket.refabricationPieces.length === 0) {
    return [];
  }

  return ticket.refabricationPieces.map((p, idx) => {
    const prefix = `[RE-CORTE ${ticket.ticketNumber}]`;
    const desc = p.pieceDescription
      ? `${prefix} ${p.pieceDescription}`
      : `${prefix} Pieza #${idx + 1}`;

    return {
      quantity: Math.max(1, p.quantity),
      lengthMm: Math.round(p.lengthMm),
      widthMm: Math.round(p.widthMm),
      description: desc,
      materialName: p.materialName || 'Melamina',
      grain: p.grain ?? 1,
      L1: p.L1 ?? 0,
      L2: p.L2 ?? 0,
      W1: p.W1 ?? 0,
      W2: p.W2 ?? 0,
      partName: p.partName,
      partCode: p.partCode,
      moduleCode: p.moduleCode,
      labelRef: `${ticket.ticketNumber}-P${idx + 1}`,
    };
  });
}
