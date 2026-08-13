/**
 * Modal dialog for pre-viewing and configuring CSV cut list exports for third-party optimizers (F073).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  CsvDelimiter,
  CsvOptimizerPreset,
  ProductionCutRow,
} from '@muebles/domain';
import { cutListConfigurableCsvExport } from '@muebles/domain';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import './csvExportConfigModal.css';

export interface CsvExportConfigModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly cutRows: readonly ProductionCutRow[];
  readonly projectName?: string;
  readonly onDownloadCsv?: (content: string, filename: string) => void;
}

export function CsvExportConfigModal({
  isOpen,
  onClose,
  cutRows,
  projectName = 'Proyecto',
  onDownloadCsv,
}: CsvExportConfigModalProps): ReactNode {
  const [preset, setPreset] = useState<CsvOptimizerPreset>('standard');
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(';');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [materialFilter, setMaterialFilter] = useState<string>('ALL');

  const uniqueMaterials = useMemo(() => {
    const list = cutRows
      .map((r) => r.materialName?.trim())
      .filter((m): m is string => Boolean(m));
    return [...new Set(list)];
  }, [cutRows]);

  const activeMaterialFilter = materialFilter === 'ALL' ? null : materialFilter;

  const generatedCsv = useMemo(() => {
    if (cutRows.length === 0) return '';
    try {
      return cutListConfigurableCsvExport(cutRows, {
        preset,
        delimiter,
        includeHeader,
        materialFilter: activeMaterialFilter,
      });
    } catch {
      return 'Sin registros que coincidan con el filtro seleccionado.';
    }
  }, [cutRows, preset, delimiter, includeHeader, activeMaterialFilter]);

  if (!isOpen || cutRows.length === 0) {
    return null;
  }

  const handleDownload = () => {
    const safeName = projectName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filename = `plan_corte_${safeName}_${preset}.csv`;

    if (onDownloadCsv) {
      onDownloadCsv(generatedCsv, filename);
    } else {
      const blob = new Blob([generatedCsv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="csv-modal-overlay" data-testid="csv-modal-overlay">
      <div
        className="csv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-modal-title"
      >
        <header className="csv-modal__header">
          <h3 id="csv-modal-title" className="csv-modal__title">
            <FileSpreadsheet size={20} className="csv-modal__icon" /> Exportar CSV Configurable
          </h3>
          <button
            type="button"
            className="csv-modal__close-btn"
            onClick={onClose}
            aria-label="Cerrar modal"
            data-testid="csv-modal-close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="csv-modal__body">
          {/* Options grid */}
          <div className="csv-modal__grid">
            <label className="csv-modal__field">
              <span>Preset de Optimizador</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as CsvOptimizerPreset)}
                data-testid="csv-preset-select"
              >
                <option value="standard">Estándar (Completo)</option>
                <option value="lepton">Lepton Optimizer</option>
                <option value="cortecerto">CorteCerto</option>
                <option value="optinest">OptiNest</option>
              </select>
            </label>

            <label className="csv-modal__field">
              <span>Delimitador</span>
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as CsvDelimiter)}
                data-testid="csv-delimiter-select"
              >
                <option value=";">Punto y Coma ( ; ) — Estándar ES</option>
                <option value=",">Coma ( , ) — Estándar US</option>
                <option value="\t">Tabulador ( Tab )</option>
              </select>
            </label>

            <label className="csv-modal__field">
              <span>Filtrar por Material</span>
              <select
                value={materialFilter}
                onChange={(e) => setMaterialFilter(e.target.value)}
                data-testid="csv-material-select"
              >
                <option value="ALL">Todos los materiales ({uniqueMaterials.length})</option>
                {uniqueMaterials.map((mat) => (
                  <option key={mat} value={mat}>
                    {mat}
                  </option>
                ))}
              </select>
            </label>

            <label className="csv-modal__checkbox">
              <input
                type="checkbox"
                checked={includeHeader}
                onChange={(e) => setIncludeHeader(e.target.checked)}
                data-testid="csv-header-checkbox"
              />
              <span>Incluir fila de encabezados</span>
            </label>
          </div>

          {/* CSV Text Preview */}
          <div className="csv-modal__preview-box" data-testid="csv-preview-box">
            <span className="csv-modal__preview-label">Vista Previa CSV (primeras líneas)</span>
            <pre className="csv-modal__preview-text" data-testid="csv-preview-text">
              {generatedCsv}
            </pre>
          </div>
        </div>

        <footer className="csv-modal__footer">
          <span className="csv-modal__info">
            Preset: <strong>{preset}</strong> | Separador:{' '}
            <strong>{delimiter === '\t' ? 'TAB' : delimiter}</strong>
          </span>

          <div className="csv-modal__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
              data-testid="csv-cancel-btn"
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleDownload}
              data-testid="csv-download-btn"
            >
              <Download size={16} /> Descargar .CSV
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
