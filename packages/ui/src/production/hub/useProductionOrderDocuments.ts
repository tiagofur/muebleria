/**
 * Hook to build documents list for ProductionOrderHub Documentos tab.
 */

import { useMemo } from 'react';
import type { Catalog, PieceLabel, ProductionCutRow, Project } from '@granete/domain';
import { generatePartDrillingData, resolveProjectDrilling } from '@granete/domain';
import type { ProductionOrderReadiness } from '../productionOrderModel';
import type { ProductionDocumentItem } from '../ProductionOrderDocumentsPanel';

export interface UseProductionOrderDocumentsOptions {
  readonly project: Project;
  /** F130: full catalog enables the REAL drilling source (F128 engine + F129 joints). */
  readonly catalog?: Catalog | null;
  readonly readiness: ProductionOrderReadiness;
  readonly cutRows?: readonly ProductionCutRow[] | null;
  readonly pieceLabels?: readonly PieceLabel[] | null;
  readonly elevationsAvailable?: boolean;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportOptimizer: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onExportHardware: () => void | Promise<void>;
  readonly onExportPieceLabels?: (
    labels: readonly PieceLabel[],
    options?: { readonly perUnit?: boolean },
  ) => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportCncPilot?: () => void | Promise<void>;
  readonly onExportAssemblySheets?: () => void | Promise<void>;
  readonly onOpenCsvConfig: () => void;
  readonly onNavigateToTab: (tab: string) => void;
}

export function useProductionOrderDocuments({
  project,
  readiness,
  cutRows,
  pieceLabels,
  elevationsAvailable = false,
  onExportProductionPack,
  onExportOptimizer,
  onExportCutListCsv,
  onExportHardware,
  onExportPieceLabels,
  onExportElevations,
  onExportCncPilot,
  onExportAssemblySheets,
  onOpenCsvConfig,
  onNavigateToTab,
  catalog,
}: UseProductionOrderDocumentsOptions): readonly ProductionDocumentItem[] {
  const downloadDrillingJson = () => {
    if (!cutRows || cutRows.length === 0) return;
    // F130: real source first (manual placements + derived joints + engine);
    // heuristics stay as fallback for callers without catalog access.
    let data;
    try {
      data = catalog
        ? resolveProjectDrilling({ project, catalog }).data
        : generatePartDrillingData({ project, cutRows });
    } catch {
      data = generatePartDrillingData({ project, cutRows });
    }
    const content = JSON.stringify(data, null, 2);
    const safeName = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `perforaciones_${safeName}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
        id: 'cutlist-csv-config',
        label: 'CSV configurable (terceros)',
        hint: 'Elegí preset de optimizador, separador y material antes de bajar',
        available: readiness.materialsResolved && (cutRows?.length ?? 0) > 0,
        reason: 'Requiere piezas de tablero',
        actionLabel: 'Configurar',
        onDownload: onOpenCsvConfig,
      },
      {
        id: 'hardware',
        label: 'Lista de herrajes',
        hint: 'Picking / compras (.xlsx)',
        available: Boolean(onExportHardware),
        onDownload: onExportHardware,
      },
      {
        id: 'labels',
        label: 'Etiquetas de pieza (PDF)',
        hint: 'A4 con encintado y QR — imprimir y cortar en oficina',
        available:
          Boolean(onExportPieceLabels) && (pieceLabels?.length ?? 0) > 0,
        reason: 'Requiere piezas de tablero',
        onDownload: onExportPieceLabels
          ? () => onExportPieceLabels(pieceLabels ?? [], { perUnit: false })
          : undefined,
      },
      {
        id: 'labels-zpl',
        label: 'Etiquetas térmicas (ZPL)',
        hint: 'Impresora Zebra — configurar tamaño/DPI y descargar .zpl',
        available: (pieceLabels?.length ?? 0) > 0,
        reason: 'Requiere piezas de tablero',
        actionLabel: 'Configurar',
        onDownload: () => onNavigateToTab('etiquetas'),
      },
      {
        id: 'elevations',
        label: 'Elevaciones e islas (PDF)',
        hint: 'Alzados por muro y fichas de isla con medidas',
        available: elevationsAvailable && Boolean(onExportElevations),
        reason: 'Sin muros ni islas en el layout',
        onDownload: onExportElevations,
      },
      {
        id: 'drilling',
        label: 'Perforaciones (JSON)',
        hint: 'Metadatos de taladros por pieza para mecanizado',
        available: readiness.materialsResolved && (cutRows?.length ?? 0) > 0,
        reason: 'Requiere piezas de tablero',
        onDownload: downloadDrillingJson,
      },
      {
        id: 'cnc-pilot',
        label: 'CNC pilot (JSON)',
        hint: 'Metadatos rectangulares por pieza — no reemplaza al Optimizer',
        available: readiness.materialsResolved && Boolean(onExportCncPilot),
        reason: 'Requiere piezas de tablero',
        onDownload: onExportCncPilot,
      },
      {
        id: 'assembly',
        label: 'Hojas de armado (PDF)',
        hint: 'Una página por módulo: medidas + herrajes + estado piso',
        available: project.items.length > 0 && Boolean(onExportAssemblySheets),
        reason: 'Sin módulos en el alcance',
        onDownload: onExportAssemblySheets,
      },
    ],
    [
      project,
      readiness,
      cutRows,
      pieceLabels,
      elevationsAvailable,
      onExportProductionPack,
      onExportOptimizer,
      onExportCutListCsv,
      onExportHardware,
      onExportPieceLabels,
      onExportElevations,
      onExportCncPilot,
      onExportAssemblySheets,
      onOpenCsvConfig,
      onNavigateToTab,
    ],
  );
}
