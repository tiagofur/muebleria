/**
 * Totals aside panel — extracted from ProjectDetailViewInner (#refactor).
 *
 * Sticky sidebar showing: breakdown (materials/edge/hardware/labor/margin),
 * sale price, material summary (boards m², edges ML, hardware units),
 * sheet estimates, nesting import, version history, and export issues.
 */

import { memo, type ReactNode } from 'react';
import {
  estimateBoardSheets,
  parseNestingImportCsv,
  nestingImportFromRows,
  isProjectClosed,
} from '@muebles/domain';
import { AlertCircle } from 'lucide-react';
import { InlineLoading } from '../../common';
import { TotalsSkeleton } from './TotalsSkeleton';
import { PricePreviewGate } from '../../optionGroups/PricePreviewGate';
import { ExportIssueList } from '../ExportIssueList';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { formatIsoDate, formatProjectMoney } from '../projectHelpers';
import { useProjectDetail } from './projectDetailContext';

export const ProjectTotalsAside = memo(function ProjectTotalsAside(): ReactNode {
  const {
    project,
    catalogs,
    breakdown,
    materialSummary,
    breakdownLoading,
    breakdownError,
    previewBlocked,
    missingGroups,
    groupLabels,
    showCosts,
    exportBlockMessage,
    exportErrors,
    canMutate,
    onRestoreVersion,
    onImportNesting,
  } = useProjectDetail();

  return (
    <aside
      className={
        previewBlocked || !breakdown
          ? 'project-totals project-totals--blocked project-totals--sticky'
          : 'project-totals project-totals--sticky'
      }
      aria-label="Totales de cotización"
      aria-live="polite"
    >
      <div className="project-totals__header">
        <div className="project-totals__heading">
          <h3 className="project-totals__title">
            {isProjectClosed(project.status) && project.priceSnapshot
              ? 'Totales (congelados)'
              : 'Totales'}
          </h3>
          {isProjectClosed(project.status) && project.priceSnapshot ? (
            <span
              className="project-totals__frozen-badge"
              title={`Precios capturados el ${formatIsoDate(project.priceSnapshot.capturedAt)}`}
            >
              Precios congelados
            </span>
          ) : null}
        </div>
        {breakdownLoading ? (
          <InlineLoading label="Recalculando…" data-testid="breakdown-loading" />
        ) : null}
      </div>

      {breakdownError ? (
        <p className="project-totals__error" role="alert" data-testid="breakdown-error">
          <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
          <span>{breakdownError}</span>
        </p>
      ) : null}

      <PricePreviewGate
        requiredGroupCodes={previewBlocked ? missingGroups : []}
        optionChoices={{}}
        groupLabels={groupLabels}
        blockedMessage="Totales bloqueados: faltan opciones obligatorias en uno o más ítems."
      >
        {breakdownLoading && !breakdown ? (
          <TotalsSkeleton />
        ) : breakdown ? (
          <dl className="project-totals__grid">
            {showCosts ? (
              <>
                <div><dt>Materiales</dt><dd>{formatProjectMoney(breakdown.materialsCost, project.currency)}</dd></div>
                <div><dt>Cantos</dt><dd>{formatProjectMoney(breakdown.edgeTotal, project.currency)}</dd></div>
                <div><dt>Herrajes</dt><dd>{formatProjectMoney(breakdown.hardwareTotal, project.currency)}</dd></div>
                <div><dt>Costo directo</dt><dd>{formatProjectMoney(breakdown.directCost, project.currency)}</dd></div>
                <div><dt>MO modular</dt><dd>{formatProjectMoney(breakdown.laborModular, project.currency)}</dd></div>
                <div><dt>MO fija</dt><dd>{formatProjectMoney(breakdown.laborFixedCost, project.currency)}</dd></div>
                <div><dt>Factor margen</dt><dd>{breakdown.marginFactor.toFixed(2)}</dd></div>
              </>
            ) : null}
            <div className="project-totals__sale-row">
              <dt>Precio de venta</dt>
              <dd className="project-totals__sale">
                {formatProjectMoney(breakdown.salePrice, project.currency)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="project-totals__empty">
            {project.items.length === 0
              ? 'Agregá muebles para ver totales.'
              : 'No se pudo calcular el desglose con las opciones actuales.'}
          </p>
        )}
      </PricePreviewGate>

      {materialSummary &&
      (materialSummary.materials.length > 0 ||
        materialSummary.hardware.length > 0) ? (
        <section
          className="project-material-summary"
          aria-label="Resumen de materiales"
          data-testid="project-material-summary"
        >
          <h4 className="project-material-summary__title">
            Resumen de materiales
          </h4>
          {materialSummary.materials.length > 0 ? (
            <div className="project-material-summary__block">
              <p className="project-material-summary__label">
                Tableros · {materialSummary.totalAreaM2.toFixed(3)} m²
              </p>
              <ul className="project-material-summary__list">
                {materialSummary.materials.map((row) => (
                  <li key={row.materialId}>
                    <span className="project-material-summary__name">
                      {row.name}
                    </span>
                    <span className="project-material-summary__meta">
                      {row.areaM2.toFixed(3)} m²
                      {showCosts
                        ? ` · ${formatProjectMoney(row.boardCost, project.currency)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {(() => {
                const sheets = estimateBoardSheets(
                  materialSummary.materials,
                  catalogs.materials,
                ).filter((s) => s.estimatedSheets > 0);
                if (sheets.length === 0) return null;
                return (
                  <div
                    className="project-material-summary__block"
                    data-testid="project-sheet-estimate"
                    style={{ marginTop: '0.75rem' }}
                  >
                    <p className="project-material-summary__label">
                      Pliegos estimados
                    </p>
                    <p
                      className="catalog-form__hint"
                      style={{ marginTop: 0 }}
                    >
                      Estimado — nesting real en software de corte
                    </p>
                    <ul className="project-material-summary__list">
                      {sheets.map((s) => (
                        <li key={s.materialId}>
                          <span className="project-material-summary__name">
                            {s.name}
                          </span>
                          <span className="project-material-summary__meta">
                            ~{s.estimatedSheets} pliego
                            {s.estimatedSheets === 1 ? '' : 's'}
                            {s.sheetWidthMm > 0
                              ? ` (${s.sheetWidthMm}×${s.sheetLengthMm} mm)`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {project.nestingImport &&
              project.nestingImport.rows.length > 0 ? (
                <div
                  className="project-material-summary__block"
                  data-testid="project-nesting-import"
                  style={{ marginTop: '0.75rem' }}
                >
                  <p className="project-material-summary__label">
                    Nesting importado
                  </p>
                  <p
                    className="catalog-form__hint"
                    style={{ marginTop: 0 }}
                  >
                    Consumo real (
                    {project.nestingImport.sourceName ?? 'CSV'}) ·{' '}
                    {new Date(
                      project.nestingImport.importedAt,
                    ).toLocaleString()}
                  </p>
                  <ul className="project-material-summary__list">
                    {project.nestingImport.rows.map((r) => (
                      <li key={r.materialCode}>
                        <span className="project-material-summary__name">
                          {r.materialCode}
                        </span>
                        <span className="project-material-summary__meta">
                          {r.sheetsUsed} pliego
                          {r.sheetsUsed === 1 ? '' : 's'}
                          {r.areaM2 != null ? ` · ${r.areaM2} m²` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {canMutate && onImportNesting ? (
                <div style={{ marginTop: '0.75rem' }}>
                  <label
                    className="btn btn--small"
                    style={{ cursor: 'pointer' }}
                  >
                    Importar nesting (CSV)
                    <input
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      style={{ display: 'none' }}
                      data-testid="project-nesting-file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void file.text().then((text) => {
                          const rows = parseNestingImportCsv(text);
                          if (rows.length === 0) return;
                          onImportNesting(
                            project.id,
                            nestingImportFromRows(
                              rows,
                              new Date().toISOString(),
                              file.name,
                            ),
                          );
                        });
                      }}
                    />
                  </label>
                  <p className="catalog-form__hint">
                    Columnas: material_code, sheets_used [, area_m2]
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          {materialSummary.edges.length > 0 ? (
            <div className="project-material-summary__block">
              <p className="project-material-summary__label">
                Cantos · {materialSummary.totalEdgeMl.toFixed(2)} ML
              </p>
              <ul className="project-material-summary__list">
                {materialSummary.edges.map((row) => (
                  <li key={row.edgeBandId}>
                    <span className="project-material-summary__name">
                      {row.name}
                    </span>
                    <span className="project-material-summary__meta">
                      {row.edgeMl.toFixed(2)} ML
                      {showCosts
                        ? ` · ${formatProjectMoney(row.edgeCost, project.currency)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {materialSummary.hardware.length > 0 ? (
            <div className="project-material-summary__block">
              <p className="project-material-summary__label">
                Herrajes ·{' '}
                {materialSummary.hardware.reduce(
                  (s, h) => s + h.quantity,
                  0,
                )}{' '}
                uds
              </p>
              <ul className="project-material-summary__list">
                {materialSummary.hardware.map((row) => (
                  <li key={row.hardwareId}>
                    <span className="project-material-summary__name">
                      {row.description}
                    </span>
                    <span className="project-material-summary__meta">
                      ×{row.quantity}
                      {showCosts
                        ? ` · ${formatProjectMoney(row.lineCost, project.currency)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {onRestoreVersion ? (
        <VersionHistoryPanel project={project} onRestore={onRestoreVersion} />
      ) : null}

      {exportBlockMessage ? (
        <p className="project-totals__export-msg" role="status">
          {exportBlockMessage}
        </p>
      ) : null}

      {exportErrors.length > 0 ? (
        <ExportIssueList issues={exportErrors} />
      ) : null}
    </aside>
  );
});
