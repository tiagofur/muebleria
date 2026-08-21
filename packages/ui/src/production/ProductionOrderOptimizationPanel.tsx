/**
 * Production hub — Plan de Corte 2D, Requisición de Almacén y Exportaciones de Taller (F115).
 *
 * - Plan de corte 2D con dos estrategias (F126): sierra guillotina o CNC nesting
 *   (MaxRects, mezcla piezas grandes y chicas con espaciado de fresa).
 * - Requisición exacta de tableros completos para Almacén.
 * - Visor interactivo; secuencia de cortes paso a paso solo en modo sierra.
 * - Exportación exclusiva por estrategia: sierra → PDF + Optimizer XLSX;
 *   nesting → DXF R12 (tableros nesteados o piezas sueltas).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  MaterialBoard,
  Project,
  ProductionCutRow,
  CutPlan,
  CutPlanConfig,
  CutStrategy,
} from '@muebles/domain';
import {
  estimateBoardSheets,
  generateProjectMaterialSummary,
  optimizeCutPlan,
  DEFAULT_CUT_PLAN_CONFIG,
  DEFAULT_TOOL_SPACING_MM,
  type Catalog,
} from '@muebles/domain';
import { ProductionBoardView } from './ProductionBoardView';

export type ProductionOrderOptimizationPanelProps = {
  readonly project: Project;
  readonly catalog: Catalog | null;
  readonly cutRows: readonly ProductionCutRow[] | null;
  /** Workshop-level default (F133); the project's persisted plan always wins. */
  readonly defaultCutStrategy?: CutStrategy;
  readonly onSaveCutPlan?: (cutPlan: CutPlan) => void;
  readonly onExportCutPlanPdf?: (cutPlan: CutPlan) => void;
  readonly onExportOptimizer?: () => void;
  readonly onExportCutPlanDxf?: (cutPlan: CutPlan, variant: 'sheets' | 'pieces') => void;
  readonly onExportCutPlanPtx?: (
    cutPlan: CutPlan,
    mode?: 'unified' | 'by-material',
  ) => void;
  readonly exportBusy?: boolean;
};

export function ProductionOrderOptimizationPanel({
  project,
  catalog,
  cutRows,
  defaultCutStrategy,
  onSaveCutPlan,
  onExportCutPlanPdf,
  onExportOptimizer,
  onExportCutPlanDxf,
  onExportCutPlanPtx,
  exportBusy = false,
}: ProductionOrderOptimizationPanelProps): ReactNode {
  // Cut strategy dispatch (F126 saw/nesting + F133 workshop default):
  // the project's persisted plan wins, then the taller default, then sierra.
  const [cutStrategy, setCutStrategy] = useState<CutStrategy>(
    project.cutPlan?.config.cutStrategy ?? defaultCutStrategy ?? 'saw-guillotine',
  );
  const [toolSpacingMm, setToolSpacingMm] = useState<number>(
    project.cutPlan?.config.toolSpacingMm ?? DEFAULT_TOOL_SPACING_MM,
  );
  const isNesting = cutStrategy === 'cnc-nesting';
  // Cut Configuration parameters
  const [sawKerfMm, setSawKerfMm] = useState<number>(
    project.cutPlan?.config.sawKerfMm ?? DEFAULT_CUT_PLAN_CONFIG.sawKerfMm,
  );
  const [trimTopMm, setTrimTopMm] = useState<number>(
    project.cutPlan?.config.trim.topMm ?? DEFAULT_CUT_PLAN_CONFIG.trim.topMm,
  );
  const [trimBottomMm, setTrimBottomMm] = useState<number>(
    project.cutPlan?.config.trim.bottomMm ?? DEFAULT_CUT_PLAN_CONFIG.trim.bottomMm,
  );
  const [trimLeftMm, setTrimLeftMm] = useState<number>(
    project.cutPlan?.config.trim.leftMm ?? DEFAULT_CUT_PLAN_CONFIG.trim.leftMm,
  );
  const [trimRightMm, setTrimRightMm] = useState<number>(
    project.cutPlan?.config.trim.rightMm ?? DEFAULT_CUT_PLAN_CONFIG.trim.rightMm,
  );
  const [allowRotationNoGrain, setAllowRotationNoGrain] = useState<boolean>(
    project.cutPlan?.config.allowRotationNoGrain ?? DEFAULT_CUT_PLAN_CONFIG.allowRotationNoGrain,
  );
  const [deductEdgeBand, setDeductEdgeBand] = useState<boolean>(
    project.cutPlan?.config.deductEdgeBand ?? DEFAULT_CUT_PLAN_CONFIG.deductEdgeBand,
  );

  // Current active CutPlan (stored in state or loaded from project)
  const [cutPlanState, setCutPlanState] = useState<CutPlan | null>(project.cutPlan ?? null);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const currentCutPlan = cutPlanState ?? project.cutPlan ?? null;

  const summary = useMemo(() => {
    if (!catalog) return null;
    try {
      return generateProjectMaterialSummary(project, catalog);
    } catch {
      return null;
    }
  }, [project, catalog]);

  const sheetEstimates = useMemo(() => {
    if (!summary || !catalog) return [];
    return estimateBoardSheets(
      summary.materials,
      catalog.materials,
      null,
    ).filter((s) => s.estimatedSheets > 0);
  }, [summary, catalog]);

  const handleGenerateCutPlan = () => {
    if (!cutRows || cutRows.length === 0) return;
    const config: CutPlanConfig = {
      sawKerfMm: Math.max(0, sawKerfMm),
      trim: {
        topMm: Math.max(0, trimTopMm),
        bottomMm: Math.max(0, trimBottomMm),
        leftMm: Math.max(0, trimLeftMm),
        rightMm: Math.max(0, trimRightMm),
      },
      deductEdgeBand,
      allowRotationNoGrain,
      minRemnantLengthMm: DEFAULT_CUT_PLAN_CONFIG.minRemnantLengthMm,
      minRemnantWidthMm: DEFAULT_CUT_PLAN_CONFIG.minRemnantWidthMm,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
      cutStrategy,
      ...(cutStrategy === 'cnc-nesting' ? { toolSpacingMm: Math.max(0, toolSpacingMm) } : {}),
    };

    const newPlan = optimizeCutPlan(
      project.id,
      cutRows,
      catalog?.materials ?? [],
      config,
      project.name,
    );

    setCutPlanState(newPlan);
    setActiveSheetIndex(0);
    setSaveSuccessMsg(null);
  };

  const handleSavePlan = () => {
    if (!currentCutPlan) return;
    onSaveCutPlan?.(currentCutPlan);
    setSaveSuccessMsg('✓ Plan de corte guardado exitosamente en el proyecto');
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  const handleExportPdf = () => {
    if (!currentCutPlan) return;
    onExportCutPlanPdf?.(currentCutPlan);
  };

  const handleExportDxf = (variant: 'sheets' | 'pieces') => {
    if (!currentCutPlan) return;
    onExportCutPlanDxf?.(currentCutPlan, variant);
  };

  const activeSheet = currentCutPlan?.sheets[activeSheetIndex] ?? null;
  // Exports follow the GENERATED plan, not the live selector: the file must
  // always match the strategy that produced the layout on screen.
  const planStrategy = currentCutPlan?.config.cutStrategy ?? cutStrategy;

  return (
    <div className="prod-opt" data-testid="prod-hub-optimizacion">
      {/* 1. CONFIGURATION BAR */}
      <section
        className="prod-opt__config-section"
        data-testid="prod-opt-config"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg, 8px)',
          padding: '16px 20px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>Parámetros del Plan de Corte 2D</h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.85em', color: 'var(--text-muted)' }}>
              {isNesting
                ? 'El nesting CNC mezcla piezas grandes y chicas en el mismo tablero; ajustá el espaciado de fresa y el refilado.'
                : 'Ajustá el disco de corte, refilado de 4 lados y sobrecorte para optimizar el material.'}
            </p>
          </div>
          {currentCutPlan && (
            <span style={{ fontSize: '0.82em', color: 'var(--text-muted)', background: 'var(--surface-muted)', padding: '4px 8px', borderRadius: 4 }}>
              Plan activo · {new Date(currentCutPlan.generatedAt).toLocaleString()}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center',
            background: 'var(--surface-muted)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} role="group" aria-label="Tipo de corte">
            <span style={{ fontSize: '0.85em', fontWeight: 500 }}>Tipo de corte:</span>
            <button
              type="button"
              className={`btn btn--small ${!isNesting ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={!isNesting}
              data-testid="prod-opt-strategy-saw"
              onClick={() => setCutStrategy('saw-guillotine')}
            >
              Sierra
            </button>
            <button
              type="button"
              className={`btn btn--small ${isNesting ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={isNesting}
              data-testid="prod-opt-strategy-nesting"
              onClick={() => setCutStrategy('cnc-nesting')}
            >
              CNC Nesting
            </button>
          </div>

          {isNesting ? (
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}
              title="Distancia mínima entre piezas: diámetro de fresa + margen de seguridad."
            >
              <span>Espaciado fresa (mm)</span>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={toolSpacingMm}
                onChange={(e) => setToolSpacingMm(Number(e.target.value))}
                style={{ width: 75, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-default)' }}
              />
            </label>
          ) : (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
              <span>Disco / Kerf (mm)</span>
              <input
                type="number"
                min={0}
                max={15}
                step={0.5}
                value={sawKerfMm}
                onChange={(e) => setSawKerfMm(Number(e.target.value))}
                style={{ width: 75, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border-default)' }}
              />
            </label>
          )}

          {/* 4-sided Trim Margins */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.85em', fontWeight: 500 }}>Refilados (mm):</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em' }}>
              <span>Sup:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={trimTopMm}
                onChange={(e) => setTrimTopMm(Number(e.target.value))}
                style={{ width: 50, padding: '3px 4px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em' }}>
              <span>Inf:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={trimBottomMm}
                onChange={(e) => setTrimBottomMm(Number(e.target.value))}
                style={{ width: 50, padding: '3px 4px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em' }}>
              <span>Izq:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={trimLeftMm}
                onChange={(e) => setTrimLeftMm(Number(e.target.value))}
                style={{ width: 50, padding: '3px 4px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em' }}>
              <span>Der:</span>
              <input
                type="number"
                min={0}
                max={50}
                value={trimRightMm}
                onChange={(e) => setTrimRightMm(Number(e.target.value))}
                style={{ width: 50, padding: '3px 4px' }}
              />
            </label>
          </div>

          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em', cursor: 'pointer' }}
            title="Descuenta el grosor del tapacanto en el corte. Desactívalo si tu enchapadora tiene pre-fresado que rebaja la cintilla."
          >
            <input
              type="checkbox"
              checked={deductEdgeBand}
              onChange={(e) => setDeductEdgeBand(e.target.checked)}
            />
            <span>Descontar cintilla (Sobrecorte)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allowRotationNoGrain}
              onChange={(e) => setAllowRotationNoGrain(e.target.checked)}
            />
            <span>Giro libre en piezas sin veta</span>
          </label>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={handleGenerateCutPlan}
              disabled={exportBusy || !cutRows || cutRows.length === 0}
            >
              ⚡ Generar Plan de Corte 2D
            </button>
            {currentCutPlan && onSaveCutPlan && (
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={handleSavePlan}
              >
                💾 Guardar Plan
              </button>
            )}
          </div>
        </div>

        {saveSuccessMsg && (
          <p style={{ color: '#16a34a', fontSize: '0.9em', fontWeight: 500, margin: '8px 0 0' }}>
            {saveSuccessMsg}
          </p>
        )}
      </section>

      {/* 2. WAREHOUSE REQUISITION SUMMARY */}
      <section
        className="prod-opt__layer"
        data-testid="prod-opt-summary"
        aria-label="Requisición de almacén"
        style={{ marginBottom: '24px' }}
      >
        <div className="prod-opt__layer-head" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1.05em', fontWeight: 600 }}>Requisición para Almacén (Tableros Enteros)</h3>
        </div>

        {currentCutPlan ? (
          <div className="prod-opt__exact-summary" style={{ margin: '8px 0' }}>
            <ul className="prod-opt__list">
              {currentCutPlan.stats.byMaterial.map((m) => (
                <li key={m.materialCode} style={{ borderLeft: '4px solid var(--accent-primary, #3b82f6)' }}>
                  <span className="prod-opt__name">{m.materialName} ({m.materialCode})</span>
                  <span className="prod-opt__meta">
                    <strong style={{ color: 'var(--text-primary)', fontSize: '1.05em' }}>
                      {m.sheetsNeeded} tablero{m.sheetsNeeded === 1 ? '' : 's'} completo{m.sheetsNeeded === 1 ? '' : 's'} a despachar
                    </strong>
                    {` · ${m.piecesCount} piezas · ${m.netAreaM2} m² netos · ${m.yieldPercent}% rendimiento (merma: ${m.wastePercent}%)`}
                    {m.usefulRemnantsCount > 0 ? ` · ${m.usefulRemnantsCount} retazos útiles a inventario (${m.usefulRemnantsAreaM2} m²)` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <p className="prod-opt__disclaimer">
              Estimación previa. Hacé clic en <strong>⚡ Generar Plan de Corte 2D</strong> arriba para obtener la requisición geométrica 100% exacta.
            </p>
            {sheetEstimates.length > 0 ? (
              <ul className="prod-opt__list">
                {sheetEstimates.map((s) => (
                  <li key={s.materialId}>
                    <span className="prod-opt__name">{s.name}</span>
                    <span className="prod-opt__meta">
                      ~{s.estimatedSheets} pliego{s.estimatedSheets === 1 ? '' : 's'}
                      {s.sheetWidthMm > 0 ? ` · ${s.sheetWidthMm}×${s.sheetLengthMm} mm` : ''}
                      {` · merma base ${s.wastePercent}%`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="prod-hub__placeholder-body">
                Sin datos de piezas para estimar pliegos.
              </p>
            )}
          </div>
        )}
      </section>

      {/* 3. 2D CUT PLAN & WORKSHOP WORKSPACE */}
      <section
        className="prod-opt__layer"
        data-testid="prod-opt-workspace"
        aria-label="Diagramas de corte para taller"
        style={{ marginBottom: '24px' }}
      >
        <div className="prod-opt__layer-head" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1.05em', fontWeight: 600 }}>Diagramas y Secuencia de Corte para Taller</h3>
        </div>

        {!cutRows || cutRows.length === 0 ? (
          <p className="prod-hub__placeholder-body">
            Sin piezas de corte para optimizar. Revisá el despiece o el BOM en cotización.
          </p>
        ) : currentCutPlan && currentCutPlan.sheets.length > 0 ? (
          <div>
            {/* Sheet Selector */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                margin: '10px 0 14px',
                overflowX: 'auto',
                paddingBottom: 4,
              }}
            >
              <span style={{ fontSize: '0.85em', fontWeight: 600 }}>Tableros:</span>
              {currentCutPlan.sheets.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`btn btn--small ${activeSheetIndex === idx ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setActiveSheetIndex(idx)}
                >
                  #{idx + 1} · {s.materialCode} ({s.yieldPercent}% uso)
                </button>
              ))}
            </div>

            {/* Board Diagram + Step-by-Step Cuts Sidebar (saw only: nesting has no cut sequence) */}
            {activeSheet && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: activeSheet.instructions.length > 0 ? '1fr 300px' : '1fr',
                  gap: 16,
                }}
              >
                <div>
                  <ProductionBoardView sheet={activeSheet} />
                </div>
                {activeSheet.instructions.length > 0 && (
                  <div
                  style={{
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: 14,
                    fontSize: '0.85em',
                    maxHeight: 520,
                    overflowY: 'auto',
                  }}
                >
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95em', fontWeight: 600 }}>
                    Secuencia de Corte ({activeSheet.instructions.length} pasos)
                  </h4>
                  <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.45 }}>
                    {activeSheet.instructions.map((inst) => (
                      <li key={inst.step} style={{ marginBottom: 6 }}>
                        <span style={{ fontWeight: inst.phase === 1 ? 600 : 400 }}>
                          {inst.description}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="prod-opt__boards">
            <p className="prod-opt__disclaimer">
              Hacé clic en <strong>⚡ Generar Plan de Corte 2D</strong> arriba para generar los diagramas acotados de taller.
            </p>
          </div>
        )}
      </section>

      {/* 4. WORKSHOP EXPORTS AREA */}
      <section
        className="prod-opt__exports-section"
        data-testid="prod-opt-exports"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg, 8px)',
          padding: '18px 20px',
          marginTop: '16px',
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05em', fontWeight: 600 }}>Exportaciones para Taller y Maquinaria</h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.85em', color: 'var(--text-muted)' }}>
            Descargá los planos de corte para máquinas manuales o enviá los archivos a seccionadoras automáticas.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {planStrategy === 'cnc-nesting' ? (
            /* CNC Nesting: DXF exclusivo del modo (F125/F126) */
            <div
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                background: 'var(--surface-card)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: '1.2em' }}>⚙</span>
                  <strong style={{ fontSize: '0.95em' }}>DXF para CNC Nesting</strong>
                </div>
                <p style={{ margin: '4px 0 12px', fontSize: '0.82em', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  Geometría DXF R12 del plan nesteado: contornos, etiquetas con cantos y dirección de veta.
                  «Tableros nesteados» reproduce el plan de esta pantalla; «Piezas sueltas» es para el
                  software de tu CNC que prefiere anidar por su cuenta.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => handleExportDxf('sheets')}
                  disabled={exportBusy || !currentCutPlan || !onExportCutPlanDxf}
                  data-testid="prod-opt-export-dxf-sheets"
                >
                  Descargar DXF (tableros)
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => handleExportDxf('pieces')}
                  disabled={exportBusy || !currentCutPlan || !onExportCutPlanDxf}
                  data-testid="prod-opt-export-dxf-pieces"
                >
                  Descargar DXF (piezas)
                </button>
              </div>
            </div>
          ) : (
            /* Sierra: PDF de taller + Optimizer XLSX; el DXF no aplica */
            <>
              <div
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  background: 'var(--surface-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: '1.2em' }}>📄</span>
                    <strong style={{ fontSize: '0.95em' }}>PDF Plan de Corte Manual</strong>
                  </div>
                  <p style={{ margin: '4px 0 12px', fontSize: '0.82em', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    Diagramas vectoriales acotados con cantos resaltados en color, marcas de veta, retazos útiles y carátula para Almacén.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={handleExportPdf}
                  disabled={exportBusy || !currentCutPlan}
                  data-testid="prod-opt-export-pdf-manual"
                  style={{ alignSelf: 'flex-start' }}
                >
                  Descargar PDF de Taller
                </button>
              </div>

              <div
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  background: 'var(--surface-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: '1.2em' }}>📊</span>
                    <strong style={{ fontSize: '0.95em' }}>Optimizer XLSX (sierra)</strong>
                  </div>
                  <p style={{ margin: '4px 0 12px', fontSize: '0.82em', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    Planilla Optimizer con cantos y referencias — la fuente de verdad de corte para sierra
                    y seccionadoras.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => onExportOptimizer?.()}
                  disabled={exportBusy || !onExportOptimizer}
                  data-testid="prod-opt-export-optimizer-xlsx"
                  style={{ alignSelf: 'flex-start' }}
                >
                  Descargar Optimizer XLSX
                </button>
              </div>

              {/* Automatic Panel Saws (PTX v1.14) */}
              <div
                style={{
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  background: 'var(--surface-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: '1.2em' }}>⚡</span>
                    <strong style={{ fontSize: '0.95em' }}>PTX Seccionadoras (SCM / Homag / Biesse)</strong>
                  </div>
                  <p style={{ margin: '4px 0 12px', fontSize: '0.82em', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    Patrón de corte pre-optimizado v1.14 para seccionadoras automáticas SCM (Maestro Cut / WinCut), Homag (Cut Rite), Biesse (Selco) y Giben.
                  </p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      if (currentCutPlan) onExportCutPlanPtx?.(currentCutPlan, 'unified');
                    }}
                    disabled={exportBusy || !currentCutPlan || !onExportCutPlanPtx}
                    data-testid="prod-opt-export-ptx"
                  >
                    Descargar PTX (Todo en 1)
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--secondary"
                    onClick={() => {
                      if (currentCutPlan) onExportCutPlanPtx?.(currentCutPlan, 'by-material');
                    }}
                    disabled={exportBusy || !currentCutPlan || !onExportCutPlanPtx}
                    data-testid="prod-opt-export-ptx-by-material"
                  >
                    Por Material (ZIP)
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
