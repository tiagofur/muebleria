/**
 * Production hub — Etiquetas tab: the single home for labels.
 * Supports Piece Labels (for CNC/cutting/edgebanding) and Module/Package Labels (for assembly/loading/delivery).
 * Office prints PDF (A4); plant prints thermal ZPL. Same data, same QR,
 * scope + copies configurable, faithful preview (real QR).
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { PieceLabel, ModuleLabel, Project } from '@granete/domain';
import { Box, Layers } from 'lucide-react';
import {
  readLabelPrinterSettings,
  writeLabelPrinterSettings,
} from './labelPrinterSettings';
import { WorkflowTabs } from '../common/Tabs';
import {
  PieceLabelsTabContent,
  type PrintRawBridge,
} from './labels/PieceLabelsTabContent';
import { ModuleLabelsTabContent } from './labels/ModuleLabelsTabContent';

type ElectronPrintHost = {
  readonly electronAPI?: { readonly printRaw?: PrintRawBridge };
};

function readPrintRawBridge(): PrintRawBridge | null {
  const host = (globalThis as { window?: ElectronPrintHost }).window;
  const bridge = host?.electronAPI?.printRaw;
  return typeof bridge === 'function' ? bridge : null;
}

export type ProductionOrderLabelsPanelProps = {
  readonly project: Project;
  /** Resolved piece labels (domain generatePieceLabels); null = resolve error. */
  readonly labels: readonly PieceLabel[] | null;
  readonly labelsError?: string | null;
  /** Resolved module/package labels (domain generateModuleLabels); null = resolve error. */
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly moduleLabelsError?: string | null;
  /** Shell builds the PDF from the scoped piece labels + copy mode. */
  readonly onExportPdf?: (
    labels: readonly PieceLabel[],
    perUnit: boolean,
  ) => void | Promise<void>;
  /** Shell builds the PDF from the scoped module labels. */
  readonly onExportModulePdf?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly exportBusy?: boolean;
  /** Test seam — defaults to a browser blob download. */
  readonly onDownloadZpl?: (content: string, filename: string) => void;
};

export function ProductionOrderLabelsPanel({
  project,
  labels,
  labelsError = null,
  moduleLabels = null,
  moduleLabelsError = null,
  onExportPdf,
  onExportModulePdf,
  exportBusy = false,
  onDownloadZpl,
}: ProductionOrderLabelsPanelProps): ReactNode {
  const [labelMode, setLabelMode] = useState<'pieces' | 'modules'>('pieces');
  const [printer, setPrinter] = useState(() => readLabelPrinterSettings());
  const [printRaw] = useState<PrintRawBridge | null>(() =>
    readPrintRawBridge(),
  );

  useEffect(() => {
    writeLabelPrinterSettings(printer);
  }, [printer]);

  if (labels === null && (!moduleLabels || moduleLabels.length === 0)) {
    return (
      <div className="prod-labels" data-testid="prod-hub-etiquetas">
        <p className="prod-hub__ready-banner prod-hub__ready-banner--blocked">
          {labelsError ||
            moduleLabelsError ||
            'No se pudieron resolver las etiquetas.'}
        </p>
      </div>
    );
  }

  if (labels?.length === 0 && (!moduleLabels || moduleLabels.length === 0)) {
    return (
      <div className="prod-labels" data-testid="prod-hub-etiquetas">
        <p className="prod-hub__placeholder-body">
          No hay piezas ni muebles para etiquetar. Revisá módulos y opciones en
          cotización.
        </p>
      </div>
    );
  }

  return (
    <div className="prod-labels" data-testid="prod-hub-etiquetas">
      {/* Top Type Selector: Piezas vs Muebles */}
      <WorkflowTabs
        tabs={[
          {
            id: 'pieces',
            label: 'Piezas de Tablero',
            count: labels?.length ?? 0,
            icon: <Layers size={14} strokeWidth={1.5} aria-hidden />,
          },
          {
            id: 'modules',
            label: 'Muebles y Bultos',
            count: moduleLabels?.length ?? 0,
            icon: <Box size={14} strokeWidth={1.5} aria-hidden />,
          },
        ]}
        activeTab={labelMode}
        onTabChange={(mode) => setLabelMode(mode)}
        ariaLabel="Tipo de etiqueta"
        idPrefix="prod-labels"
        testIdPrefix="prod-labels"
      />

      <div
        role="tabpanel"
        id={`prod-labels-panel-${labelMode}`}
        aria-labelledby={`prod-labels-tab-${labelMode}`}
      >
        {labelMode === 'pieces' ? (
          <PieceLabelsTabContent
            project={project}
            labels={labels ?? []}
            printer={printer}
            onPrinterChange={setPrinter}
            printRaw={printRaw}
            exportBusy={exportBusy}
            onExportPdf={onExportPdf}
            onDownloadZpl={onDownloadZpl}
          />
        ) : (
          <ModuleLabelsTabContent
            project={project}
            moduleLabels={moduleLabels ?? []}
            printer={printer}
            onPrinterChange={setPrinter}
            printRaw={printRaw}
            exportBusy={exportBusy}
            onExportModulePdf={onExportModulePdf}
            onDownloadZpl={onDownloadZpl}
          />
        )}
      </div>
    </div>
  );
}
