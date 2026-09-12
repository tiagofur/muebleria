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
} from '@granete/domain';
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
    quoteAuthority,
  } = useProjectDetail();
  if (quoteAuthority) {
    const isReady = quoteAuthority.kind === 'ready';
    return (
      <aside
        className={`project-totals project-totals--sticky${isReady && breakdown ? '' : ' project-totals--blocked'}`}
        aria-label="Totales de cotización"
        aria-live="polite"
      >
        <div className="project-totals__header">
          <div className="project-totals__heading">
            <h3 className="project-totals__title">
              {isReady ? `Totales congelados · Q${quoteAuthority.revisionNumber}` : 'Totales no disponibles'}
            </h3>
            {isReady ? (
              <span
                className="project-totals__frozen-badge"
                title={`Precios capturados el ${formatIsoDate(quoteAuthority.capturedAt)}`}
              >
                Precios congelados
              </span>
            ) : null}
          </div>
          {quoteAuthority.kind === 'loading' ? (
            <InlineLoading label="Cargando totales congelados…" data-testid="breakdown-loading" />
          ) : null}
        </div>

        {quoteAuthority.kind === 'legacy' ? (
          // #642 legacy recovery: honest unavailability is not an error — the
          // historical total simply cannot be verified. Never 0, never
          // recalculated from the mutable project or the current catalog.
          <div data-testid="legacy-price-unavailable" className="project-totals__sale-row" style={{ alignItems: 'center' }}>
            <dt>Precio histórico</dt>
            <dd className="project-totals__sale project-totals__sale--muted">
              — No disponible con precisión
            </dd>
            <p className="catalog-form__hint" style={{ margin: 0 }}>
              Esta revisión se creó antes del historial comercial congelado; el total exacto no puede verificarse.
              Creá una nueva revisión actualizada para fijar precios actuales.
            </p>
          </div>
        ) : null}
        {quoteAuthority.kind === 'error' || quoteAuthority.kind === 'empty' ? (
          <p className="project-totals__error" role="alert" data-testid="breakdown-error">
            <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
            <span>{quoteAuthority.message}</span>
            {quoteAuthority.kind === 'error' ? (
              <button type="button" className="btn btn--secondary btn--small" onClick={quoteAuthority.onRetry}>
                Reintentar
              </button>
            ) : null}
          </p>
        ) : null}
        {isReady && quoteAuthority.staleMessage ? (
          <p className="project-totals__error" role="alert">
            <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
            <span>{quoteAuthority.staleMessage}</span>
            <button type="button" className="btn btn--secondary btn--small" onClick={quoteAuthority.onRetry}>
              Reintentar
            </button>
          </p>
        ) : null}

        {isReady && breakdown ? (
          <dl className="project-totals__grid">
            {showCosts ? (
              <>
                <div><dt>Materiales</dt><dd>{formatProjectMoney(breakdown.materialsCost, quoteAuthority.currency)}</dd></div>
                <div><dt>Cantos</dt><dd>{formatProjectMoney(breakdown.edgeTotal, quoteAuthority.currency)}</dd></div>
                <div><dt>Herrajes</dt><dd>{formatProjectMoney(breakdown.hardwareTotal, quoteAuthority.currency)}</dd></div>
                <div><dt>Costo directo</dt><dd>{formatProjectMoney(breakdown.directCost, quoteAuthority.currency)}</dd></div>
                <div><dt>MO modular</dt><dd>{formatProjectMoney(breakdown.laborModular, quoteAuthority.currency)}</dd></div>
                <div><dt>Factor margen</dt><dd>{breakdown.marginFactor.toFixed(2)}</dd></div>
              </>
            ) : null}
            <div className="project-totals__sale-row">
              <dt>Precio de venta</dt>
              <dd className="project-totals__sale">
                {quoteAuthority.amountsWithheld === true ? (
                  <span
                    className="project-totals__sale project-totals__sale--muted"
                    data-testid="withheld-sale-total"
                  >
                    — No disponible para tu organización
                  </span>
                ) : (
                  formatProjectMoney(breakdown.salePrice, quoteAuthority.currency)
                )}
              </dd>
            </div>
          </dl>
        ) : isReady ? (
          <p className="project-totals__error" role="alert">
            El snapshot exacto no contiene totales disponibles. Creá una nueva revisión.
          </p>
        ) : null}

        {/* #642/3: fail-closed commercial export issues (e.g. legacy revision
            without frozen history) surface here — the same actionable inline
            list as the pre-DT aside. */}
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
  }

  const currency = project.currency;

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
            Totales
          </h3>
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
                <div><dt>Materiales</dt><dd>{formatProjectMoney(breakdown.materialsCost, currency)}</dd></div>
                <div><dt>Cantos</dt><dd>{formatProjectMoney(breakdown.edgeTotal, currency)}</dd></div>
                <div><dt>Herrajes</dt><dd>{formatProjectMoney(breakdown.hardwareTotal, currency)}</dd></div>
                <div><dt>Costo directo</dt><dd>{formatProjectMoney(breakdown.directCost, currency)}</dd></div>
                <div><dt>MO modular</dt><dd>{formatProjectMoney(breakdown.laborModular, currency)}</dd></div>
                <div>
                  <dt>Factor margen</dt>
                  <dd>
                    {breakdown.marginFactor.toFixed(2)}
                    {breakdown.marginFactor > 1 ? (
                      <span
                        className="project-totals__margin-pct"
                        title="Margen bruto sobre precio de venta: (Venta - Costo) / Venta"
                      >
                        {' '}({(((breakdown.marginFactor - 1) / breakdown.marginFactor) * 100).toFixed(1)}% mg)
                      </span>
                    ) : null}
                  </dd>
                </div>
              </>
            ) : null}
            <div className="project-totals__sale-row">
              <dt>Precio de venta</dt>
              <dd className="project-totals__sale">
                {formatProjectMoney(breakdown.salePrice, currency)}
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
                        ? ` · ${formatProjectMoney(row.boardCost, currency)}`
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
                    style={{ marginTop: 'var(--space-3)' }}
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
                  style={{ marginTop: 'var(--space-3)' }}
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
                <div style={{ marginTop: 'var(--space-3)' }}>
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
                        ? ` · ${formatProjectMoney(row.edgeCost, currency)}`
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
                        ? ` · ${formatProjectMoney(row.lineCost, currency)}`
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
