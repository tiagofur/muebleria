import type { ProjectTechnicalStatus, ProjectInternalMessageType } from '../types';

export interface TechnicalStatusMeta {
  readonly status: ProjectTechnicalStatus;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly color: 'neutral' | 'warning' | 'info' | 'success' | 'danger';
  readonly stepNumber: number;
}

export const TECHNICAL_STATUS_METADATA: Record<ProjectTechnicalStatus, TechnicalStatusMeta> = {
  pending_assignment: {
    status: 'pending_assignment',
    label: 'Pendiente de Responsable Técnico',
    shortLabel: 'Sin Asignar',
    description: 'Esperando designación de ingeniero o técnico a cargo de validar la fabricación.',
    color: 'neutral',
    stepNumber: 1,
  },
  in_review: {
    status: 'in_review',
    label: 'En Revisión Técnica / Medidas',
    shortLabel: 'En Revisión',
    description: 'Ingeniería validando despiece, relevamiento en obra y factibilidad de armado.',
    color: 'warning',
    stepNumber: 2,
  },
  changes_requested: {
    status: 'changes_requested',
    label: 'Cambios Solicitados a Ventas',
    shortLabel: 'Obs. Técnicas',
    description: 'Se encontraron inconsistencias técnicas o de medidas que ventas debe coordinar con el cliente.',
    color: 'danger',
    stepNumber: 2,
  },
  approved_for_production: {
    status: 'approved_for_production',
    label: 'Aprobado para Producción',
    shortLabel: 'Aprobado Taller',
    description: 'Despiece y herrajes congelados y validados. Listo para emitir orden de corte.',
    color: 'info',
    stepNumber: 3,
  },
  in_workshop: {
    status: 'in_workshop',
    label: 'En Taller / Armado',
    shortLabel: 'En Armado',
    description: 'Piezas cortadas, canteadas y en proceso de ensamblado/pre-armado en banco.',
    color: 'info',
    stepNumber: 4,
  },
  ready_to_install: {
    status: 'ready_to_install',
    label: 'Listo para Despacho / Instalación',
    shortLabel: 'Listo Despacho',
    description: 'Módulos terminados con control de calidad superado, listos para envío a obra.',
    color: 'success',
    stepNumber: 5,
  },
  installed: {
    status: 'installed',
    label: 'Instalado en Obra',
    shortLabel: 'Instalado',
    description: 'Muebles colocados en obra y montaje completado.',
    color: 'success',
    stepNumber: 6,
  },
  completed: {
    status: 'completed',
    label: 'Completado / Conforme',
    shortLabel: 'Finalizado',
    description: 'Proyecto finalizado con acta de conformidad y fotos de obra firmadas.',
    color: 'success',
    stepNumber: 7,
  },
};

export interface MessageTypeMeta {
  readonly type: ProjectInternalMessageType;
  readonly label: string;
  readonly description: string;
  readonly badgeColor: 'neutral' | 'warning' | 'info' | 'success' | 'danger';
}

export const INTERNAL_MESSAGE_TYPE_METADATA: Record<ProjectInternalMessageType, MessageTypeMeta> = {
  comment: {
    type: 'comment',
    label: 'Comentario General',
    description: 'Nota informativa de seguimiento interno.',
    badgeColor: 'neutral',
  },
  technical_query: {
    type: 'technical_query',
    label: 'Consulta Técnica',
    description: 'Pregunta sobre medidas, materiales o herrajes para ingeniería.',
    badgeColor: 'warning',
  },
  query_response: {
    type: 'query_response',
    label: 'Respuesta Técnica',
    description: 'Resolución o aclaración sobre una duda técnica previa.',
    badgeColor: 'info',
  },
  design_change: {
    type: 'design_change',
    label: 'Cambio de Diseño Acordado',
    description: 'Modificación acordada en planos, frentes o despiece.',
    badgeColor: 'warning',
  },
  production_alert: {
    type: 'production_alert',
    label: 'Alerta de Taller / Falta Material',
    description: 'Aviso sobre retrasos, roturas o faltantes en producción.',
    badgeColor: 'danger',
  },
  gate_approval: {
    type: 'gate_approval',
    label: 'Aprobación / Handoff',
    description: 'Registro de validación de compuerta técnica (Pase a producción, QC, etc).',
    badgeColor: 'success',
  },
};

/**
 * Returns available technical transitions for a given status.
 */
export function getAvailableTechnicalTransitions(
  current: ProjectTechnicalStatus = 'pending_assignment',
): readonly ProjectTechnicalStatus[] {
  switch (current) {
    case 'pending_assignment':
      return ['in_review', 'approved_for_production'];
    case 'in_review':
      return ['approved_for_production', 'changes_requested'];
    case 'changes_requested':
      return ['in_review', 'approved_for_production'];
    case 'approved_for_production':
      return ['in_workshop', 'changes_requested'];
    case 'in_workshop':
      return ['ready_to_install', 'changes_requested'];
    case 'ready_to_install':
      return ['installed', 'in_workshop'];
    case 'installed':
      return ['completed', 'ready_to_install'];
    case 'completed':
      return ['installed'];
    default:
      return ['pending_assignment'];
  }
}
