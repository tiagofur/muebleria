/**
 * Production hub — regenerable factory documents (PROD-1.4).
 */

import type { ReactNode } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Package,
  Tags,
  Wrench,
} from 'lucide-react';

export type ProductionDocumentId =
  | 'pack'
  | 'optimizer'
  | 'cutlist-csv'
  | 'cutlist-csv-config'
  | 'hardware'
  | 'labels'
  | 'labels-zpl'
  | 'module-labels'
  | 'elevations'
  | 'despiece'
  | 'drilling'
  | 'cnc-pilot'
  | 'assembly';

export type ProductionDocumentItem = {
  readonly id: ProductionDocumentId;
  readonly label: string;
  readonly hint: string;
  readonly available: boolean;
  readonly reason?: string;
  /** Honest CTA — "Configurar"/"Ver tab" when the action is not a download. */
  readonly actionLabel?: string;
  readonly onDownload?: () => void | Promise<void>;
};

export type ProductionOrderDocumentsPanelProps = {
  readonly documents: readonly ProductionDocumentItem[];
  readonly exportBusy?: boolean;
  /**
   * Pack as the tab's primary action. The hub chrome already owns the primary
   * when a pack button exists there — pass false then (design.md §8: one
   * primary per context level, chrome OR tab, never both).
   */
  readonly packAsPrimary?: boolean;
};

const ICONS: Record<ProductionDocumentId, typeof FileText> = {
  pack: Package,
  optimizer: FileSpreadsheet,
  'cutlist-csv': FileSpreadsheet,
  'cutlist-csv-config': FileSpreadsheet,
  hardware: Wrench,
  labels: Tags,
  'labels-zpl': Tags,
  'module-labels': Tags,
  elevations: FileText,
  despiece: FileText,
  drilling: FileText,
  'cnc-pilot': FileText,
  assembly: FileText,
};

export function ProductionOrderDocumentsPanel({
  documents,
  exportBusy = false,
  packAsPrimary = true,
}: ProductionOrderDocumentsPanelProps): ReactNode {
  return (
    <div className="prod-docs" data-testid="prod-hub-documentos">
      <h3 className="prod-hub__section-title">Documentos de taller</h3>
      <p className="prod-hub__exports-hint">
        Pack, Optimizer, herrajes, etiquetas y PDFs — misma resolución de BOM
        de esta orden. No cambia el diseño.
      </p>
      <ul className="prod-docs__list">
        {documents.map((doc) => {
          const Icon = ICONS[doc.id];
          return (
            <li key={doc.id} className="prod-docs__item">
              <div className="prod-docs__meta">
                <Icon size={18} strokeWidth={1.5} aria-hidden />
                <div>
                  <p className="prod-docs__label">{doc.label}</p>
                  <p className="prod-docs__hint">
                    {doc.available
                      ? doc.hint
                      : (doc.reason ?? 'No disponible')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={
                  packAsPrimary && doc.id === 'pack'
                    ? 'btn btn--primary'
                    : 'btn'
                }
                disabled={exportBusy || !doc.available || !doc.onDownload}
                onClick={() => {
                  if (doc.onDownload) void doc.onDownload();
                }}
                data-testid={`prod-doc-${doc.id}`}
              >
                {exportBusy
                  ? 'Generando…'
                  : (doc.actionLabel ?? 'Descargar')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
