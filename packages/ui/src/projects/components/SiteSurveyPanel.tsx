/**
 * SiteSurveyPanel — structured field survey of one obra (OC-040/OC-041):
 * spaces with field measurements, openings/obstacles/utilities, plumb/level/
 * square notes, explicit capture/verify authorship and the measure-intent
 * pipeline (preliminary → field → approved → fabrication). The shell owns the
 * mutations (server-authoritative survey endpoints); this component renders
 * the domain state and dispatches actions.
 */

import { useState, type ReactNode } from 'react';
import { CheckCircle2, Plus, Ruler, Trash2, TriangleAlert } from 'lucide-react';
import {
  MEASURE_INTENT_LABELS_ES,
  SURVEY_ELEMENT_KIND_LABELS_ES,
  surveyFabricationBlockers,
  type MeasureIntent,
  type SiteSurvey,
  type SurveyElementKind,
} from '@muebles/domain';
import '../projects.css';
import './siteSurvey.css';

export type SurveyHandlers = {
  readonly onStart?: (projectId: string) => void | Promise<void>;
  readonly onUpsertSpace?: (
    projectId: string,
    input: { id?: string; name: string; plumbNote?: string; levelNote?: string; squareNote?: string },
  ) => void | Promise<void>;
  readonly onRemoveSpace?: (projectId: string, spaceId: string) => void | Promise<void>;
  readonly onCaptureMeasures?: (
    projectId: string,
    spaceId: string,
    measures: { widthMm: number; heightMm: number; depthMm?: number; notes?: string },
  ) => void | Promise<void>;
  readonly onVerify?: (projectId: string) => void | Promise<void>;
  readonly onApproveSpace?: (projectId: string, spaceId: string) => void | Promise<void>;
  readonly onFreeze?: (projectId: string) => void | Promise<void>;
};

export interface SiteSurveyPanelProps {
  readonly projectId: string;
  readonly survey: SiteSurvey | undefined;
  readonly handlers: SurveyHandlers;
  /** May capture on site (RBAC survey_captured: ventas/ingeniería/admin). */
  readonly canCapture?: boolean;
  /** May verify the survey (RBAC survey_verified: gerencia/ingeniería/admin). */
  readonly canVerify?: boolean;
  /** May approve/freeze for fabrication (RBAC survey_measures_approved: ingeniería/admin). */
  readonly canApprove?: boolean;
  readonly testId?: string;
};

function intentBadgeClass(intent: MeasureIntent): string {
  if (intent === 'fabrication') return 'status-badge status-badge--done';
  if (intent === 'approved') return 'status-badge status-badge--accepted';
  if (intent === 'field') return 'status-badge status-badge--progress';
  return 'status-badge status-badge--draft';
}

function mm(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toLocaleString('es-MX')} mm`;
}

export function SiteSurveyPanel({
  projectId,
  survey,
  handlers,
  canCapture = false,
  canVerify = false,
  canApprove = false,
  testId = 'site-survey-panel',
}: SiteSurveyPanelProps): ReactNode {
  const [newSpaceName, setNewSpaceName] = useState('');
  const [captureSpaceId, setCaptureSpaceId] = useState<string | null>(null);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [depth, setDepth] = useState('');
  const [captureNote, setCaptureNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const blockers = survey ? surveyFabricationBlockers(survey) : [];
  const surveyVerified = Boolean(survey?.verifiedAt);

  const startSurvey = (): void => {
    void handlers.onStart?.(projectId);
  };

  const addSpace = (): void => {
    const name = newSpaceName.trim();
    if (!name) {
      setError('El espacio necesita un nombre');
      return;
    }
    void handlers.onUpsertSpace?.(projectId, { name });
    setNewSpaceName('');
    setError(null);
  };

  const submitCapture = (spaceId: string): void => {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      setError('Ancho y alto (mm) deben ser mayores a cero');
      return;
    }
    const d = Number(depth);
    void handlers.onCaptureMeasures?.(projectId, spaceId, {
      widthMm: w,
      heightMm: h,
      ...(Number.isFinite(d) && d > 0 ? { depthMm: d } : {}),
      ...(captureNote.trim() ? { notes: captureNote.trim() } : {}),
    });
    setCaptureSpaceId(null);
    setWidth('');
    setHeight('');
    setDepth('');
    setCaptureNote('');
    setError(null);
  };

  if (!survey) {
    return (
      <div className="site-survey site-survey--empty" data-testid={testId}>
        <div className="empty-state">
          <Ruler size={32} aria-hidden="true" />
          <h4 className="empty-state__title">Sin levantamiento estructurado</h4>
          <p className="empty-state__description">
            Cargá los espacios de la obra (cocina, closet…), levantá las medidas en sitio y
            aprobálas antes de liberar producción. Una medida preliminar nunca llega a CNC sin
            este gate.
          </p>
          {canCapture && handlers.onStart ? (
            <button type="button" className="btn btn--primary" onClick={startSurvey}>
              <Plus size={16} aria-hidden="true" /> Iniciar levantamiento
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="site-survey" data-testid={testId}>
      <div className="site-survey__header">
        <div>
          <h4 className="site-survey__title">
            <Ruler size={18} aria-hidden="true" /> Levantamiento — revisión {survey.revision}
          </h4>
          <p className="site-survey__hint">
            {surveyVerified
              ? `Verificado${survey.verifiedAt ? ` el ${survey.verifiedAt.slice(0, 10)}` : ''}`
              : 'Sin verificación con autor'}
          </p>
        </div>
        <div className="site-survey__header-actions">
          {canVerify && !surveyVerified && handlers.onVerify ? (
            <button
              type="button"
              className="btn"
              onClick={() => void handlers.onVerify?.(projectId)}
              data-testid="site-survey-verify"
            >
              <CheckCircle2 size={16} aria-hidden="true" /> Verificar levantamiento
            </button>
          ) : null}
          {canApprove && handlers.onFreeze ? (
            <button
              type="button"
              className="btn"
              disabled={blockers.length > 0}
              title={blockers.length > 0 ? blockers[0]!.message : 'Congelar medidas aprobadas como base de fabricación'}
              onClick={() => void handlers.onFreeze?.(projectId)}
              data-testid="site-survey-freeze"
            >
              Congelar para fabricación
            </button>
          ) : null}
        </div>
      </div>

      {blockers.length > 0 ? (
        <ul className="site-survey__blockers" data-testid="site-survey-blockers">
          {blockers.map((blocker, index) => (
            <li key={`${blocker.kind}-${blocker.spaceId ?? index}`} className="site-survey__blocker">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>
                {blocker.message}
                {blocker.kind === 'preliminary_space' ? ' — levantar en obra' : undefined}
                {blocker.kind === 'field_space_unapproved' ? ' — aprobar (ingeniería)' : undefined}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="site-survey__ok" data-testid="site-survey-ok">
          <CheckCircle2 size={14} aria-hidden="true" /> Medidas listas para fabricación
        </p>
      )}

      {canCapture && handlers.onUpsertSpace ? (
        <div className="site-survey__add">
          <label className="field">
            <span className="field__label">Nuevo espacio</span>
            <div className="site-survey__add-row">
              <input
                type="text"
                className="input"
                placeholder="Cocina, Closet principal…"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                data-testid="site-survey-new-space"
              />
              <button type="button" className="btn" onClick={addSpace}>
                <Plus size={16} aria-hidden="true" /> Agregar
              </button>
            </div>
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="site-survey__error" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="site-survey__spaces">
        {survey.spaces.map((space) => (
          <li key={space.id} className="site-survey__space" data-testid="site-survey-space">
            <div className="site-survey__space-head">
              <div className="site-survey__space-title">
                <strong>{space.name}</strong>
                <span className={intentBadgeClass(space.intent)}>
                  {MEASURE_INTENT_LABELS_ES[space.intent]}
                </span>
              </div>
              <div className="site-survey__space-actions">
                {canCapture && space.intent === 'preliminary' && handlers.onCaptureMeasures ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setCaptureSpaceId(captureSpaceId === space.id ? null : space.id)}
                    data-testid="site-survey-capture-toggle"
                  >
                    <Ruler size={14} aria-hidden="true" /> Levantar en obra
                  </button>
                ) : null}
                {canApprove && space.intent === 'field' && handlers.onApproveSpace ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => void handlers.onApproveSpace?.(projectId, space.id)}
                    data-testid="site-survey-approve"
                  >
                    <CheckCircle2 size={14} aria-hidden="true" /> Aprobar
                  </button>
                ) : null}
                {canCapture && space.intent !== 'fabrication' && handlers.onRemoveSpace ? (
                  <button
                    type="button"
                    className="btn btn--small btn--icon"
                    aria-label={`Eliminar ${space.name}`}
                    title={`Eliminar ${space.name}`}
                    onClick={() => void handlers.onRemoveSpace?.(projectId, space.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            <dl className="site-survey__measures">
              <div>
                <dt>Ancho</dt>
                <dd>{mm(space.measures?.widthMm)}</dd>
              </div>
              <div>
                <dt>Alto</dt>
                <dd>{mm(space.measures?.heightMm)}</dd>
              </div>
              <div>
                <dt>Prof.</dt>
                <dd>{mm(space.measures?.depthMm)}</dd>
              </div>
              {space.preliminaryMeasures && space.measures &&
              (space.preliminaryMeasures.widthMm !== space.measures.widthMm ||
                space.preliminaryMeasures.heightMm !== space.measures.heightMm) ? (
                <div className="site-survey__preliminary">
                  <dt>Preliminar</dt>
                  <dd>
                    {space.preliminaryMeasures.widthMm.toLocaleString('es-MX')} ×{' '}
                    {space.preliminaryMeasures.heightMm.toLocaleString('es-MX')} mm
                  </dd>
                </div>
              ) : null}
            </dl>

            {space.elements.length > 0 ? (
              <ul className="site-survey__elements">
                {space.elements.map((el) => (
                  <li key={el.id} className="site-survey__element">
                    <span className="site-survey__element-kind">
                      {SURVEY_ELEMENT_KIND_LABELS_ES[el.kind as SurveyElementKind]}
                    </span>{' '}
                    {el.label}
                    {el.widthMm ? ` · ${el.widthMm.toLocaleString('es-MX')} mm` : undefined}
                    {el.heightMm ? ` × ${el.heightMm.toLocaleString('es-MX')} mm` : undefined}
                    {el.distanceMm ? ` · a ${el.distanceMm.toLocaleString('es-MX')} mm` : undefined}
                  </li>
                ))}
              </ul>
            ) : null}

            {space.plumbNote || space.levelNote || space.squareNote ? (
              <div className="site-survey__notes">
                {space.plumbNote ? <p><strong>Plomo:</strong> {space.plumbNote}</p> : undefined}
                {space.levelNote ? <p><strong>Nivel:</strong> {space.levelNote}</p> : undefined}
                {space.squareNote ? <p><strong>Escuadra:</strong> {space.squareNote}</p> : undefined}
              </div>
            ) : null}

            {captureSpaceId === space.id ? (
              <div className="site-survey__capture-form" data-testid="site-survey-capture-form">
                <div className="site-survey__capture-grid">
                  <label className="field">
                    <span className="field__label">Ancho (mm)</span>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      value={width}
                      onChange={(e) => setWidth(e.target.value)}
                      data-testid="site-survey-width"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Alto (mm)</span>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      data-testid="site-survey-height"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Prof. (mm)</span>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      value={depth}
                      onChange={(e) => setDepth(e.target.value)}
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field__label">Notas del sitio</span>
                  <input
                    type="text"
                    className="input"
                    placeholder="Pared con desplome, toma de agua…"
                    value={captureNote}
                    onChange={(e) => setCaptureNote(e.target.value)}
                  />
                </label>
                <div className="site-survey__capture-actions">
                  <button type="button" className="btn" onClick={() => setCaptureSpaceId(null)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => submitCapture(space.id)}
                    data-testid="site-survey-capture-submit"
                  >
                    Guardar medidas levantadas
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
