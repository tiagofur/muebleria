/**
 * Hook to build the documents items array for EngineeringWorkspace's Documentos tab.
 */

import { useMemo } from 'react';
import type { ModuleLabel, PieceLabel } from '@muebles/domain';
import type { ProductionOrderReadiness } from '../../production/productionOrderModel';
import type { ProductionDocumentItem } from '../../production/ProductionOrderDocumentsPanel';

export interface UseEngineeringDocumentsOptions {
  readonly readiness: ProductionOrderReadiness;
  readonly labels?: readonly PieceLabel[] | null;
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportOptimizer?: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onExportHardware?: () => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportPieceLabels?: (
    labels: readonly PieceLabel[],
    options: { perUnit: boolean },
  ) => void | Promise<void>;
  readonly onExportModulePdf?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly onExportAssemblySheets?: () => void | Promise<void>;
  readonly onExportCncPilot?: () => void | Promise<void>;
  readonly onNavigateToTab: (tabId: string) => void;
}

export function useEngineeringDocuments({
  readiness,
  labels,
  moduleLabels,
  onExportProductionPack,
  onExportOptimizer,
  onExportCutListCsv,
  onExportHardware,
  onExportElevations,
  onExportPieceLabels,
  onExportModulePdf,
  onExportAssemblySheets,
  onExportCncPilot,
  onNavigateToTab,
}: UseEngineeringDocumentsOptions): readonly ProductionDocumentItem[] {
  return useMemo(
    (): readonly ProductionDocumentItem[] => [
      {
        id: 'pack',
        label: 'Pack de producción (ZIP)',
        hint: 'Optimizer + herrajes + etiquetas PDF y ZPL + resumen + elevaciones + despiece',
        available: readiness.packGenerable && Boolean(onExportProductionPack),
        reason: 'Requiere despiece de corte válido',
        onDownload: onExportProductionPack,
      },
      {
        id: 'optimizer',
        label: 'Optimizer (Excel)',
        hint: 'Plan de corte Plantilla_Optimizer.xlsx',
        available: readiness.optimizerGenerable,
        reason: 'Requiere despiece válido',
        onDownload: onExportOptimizer,
      },
      {
        id: 'cutlist-csv',
        label: 'Cut-list CSV',
        hint: 'CSV genérico (separador ;) para sierra/CNC/terceros',
        available: readiness.materialsResolved && Boolean(onExportCutListCsv),
        reason: 'Requiere piezas de tablero',
        onDownload: onExportCutListCsv,
      },
      {
        id: 'hardware',
        label: 'Lista de herrajes',
        hint: 'Picking / compras (.xlsx)',
        available: Boolean(onExportHardware),
        onDownload: onExportHardware,
      },
      {
        id: 'elevations',
        label: 'Elevaciones por muro (PDF)',
        hint: 'Alzados con códigos y medidas',
        available: Boolean(onExportElevations),
        reason: 'Sin muros en el layout de cocina',
        onDownload: onExportElevations,
      },
      {
        id: 'labels',
        label: 'Etiquetas de pieza (PDF A4)',
        hint: 'Hojas A4 con QR v2 — generálalas en la pestaña Etiquetas',
        available: Boolean(labels?.length) && Boolean(onExportPieceLabels),
        reason: 'Sin piezas de tablero',
        actionLabel: 'Ir a Etiquetas',
        onDownload: () => onNavigateToTab('etiquetas'),
      },
      {
        id: 'labels-zpl',
        label: 'Etiquetas ZPL (impresora térmica)',
        hint: 'Lote .zpl para Zebra — pestaña Etiquetas → Impresora térmica',
        available: Boolean(labels?.length),
        reason: 'Sin piezas de tablero',
        actionLabel: 'Ir a Etiquetas',
        onDownload: () => onNavigateToTab('etiquetas'),
      },
      {
        id: 'module-labels',
        label: 'Etiquetas de módulo / bulto (PDF)',
        hint: 'Una por unidad física con QR — pestaña Etiquetas',
        available: Boolean(moduleLabels?.length) && Boolean(onExportModulePdf),
        reason: 'Sin ítems en la obra',
        actionLabel: 'Ir a Etiquetas',
        onDownload: () => onNavigateToTab('etiquetas'),
      },
      {
        id: 'assembly',
        label: 'Hojas de armado (PDF)',
        hint: 'Una página por módulo: medidas + herrajes + estado de piso',
        available: Boolean(onExportAssemblySheets),
        onDownload: onExportAssemblySheets,
      },
      {
        id: 'cnc-pilot',
        label: 'CNC pilot (JSON)',
        hint: 'Perfiles de pieza para piloto CNC — no reemplaza el Optimizer (#111)',
        available: Boolean(onExportCncPilot),
        onDownload: onExportCncPilot,
      },
      {
        id: 'despiece',
        label: 'Despiece (ver tab)',
        hint: 'Lista de piezas en la pestaña Despiece',
        available: readiness.materialsResolved,
        reason: 'Sin piezas de tablero',
        actionLabel: 'Ver tab',
        onDownload: () => onNavigateToTab('despiece'),
      },
    ],
    [
      readiness,
      labels,
      moduleLabels,
      onExportProductionPack,
      onExportOptimizer,
      onExportCutListCsv,
      onExportHardware,
      onExportElevations,
      onExportPieceLabels,
      onExportModulePdf,
      onExportAssemblySheets,
      onExportCncPilot,
      onNavigateToTab,
    ],
  );
}
