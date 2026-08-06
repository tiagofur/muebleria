/**
 * Component detail view — engineering read-only workspace (wave 1 redesign).
 * Primary: geometry + plank edge diagram. Secondary: pose (disclosure), roles,
 * perforations. Chrome carries plate metric + edit actions.
 */

import type { ReactNode } from 'react';
import type { Component, EdgeSide } from '@muebles/domain';
import { ChevronLeft, Eye, EyeOff, Pencil } from 'lucide-react';
import { EngineeringDetailLayout } from '../../common/EngineeringDetailLayout';
import { geometrySummary, placementLabel } from '../componentDraft';
import {
  PlankEdgeDiagram,
  type EdgeStates,
} from './PlankEdgeDiagram';

export type ComponentDetailViewProps = {
  readonly component: Component;
  readonly onBack: () => void;
  readonly onEdit: (c: Component) => void;
  readonly onToggleActive?: (c: Component) => void;
  readonly canMutate: boolean;
};

const EMPTY_EDGES: EdgeStates = {
  L1: false,
  L2: false,
  W1: false,
  W2: false,
};

function orDash(value: number | undefined): string {
  return typeof value === 'number' && !Number.isNaN(value)
    ? String(value)
    : '—';
}

function edgesToStates(edges: Component['defaultEdges']): EdgeStates {
  const next = { ...EMPTY_EDGES };
  for (const e of edges ?? []) {
    const side = e.side as EdgeSide;
    if (side === 'L1' || side === 'L2' || side === 'W1' || side === 'W2') {
      next[side] = Boolean(e.enabled);
    }
  }
  return next;
}

function plateMetric(c: Component): string | null {
  const g = c.geometry?.kind === 'rectangular_board' ? c.geometry : null;
  if (!g) return null;
  return `${g.lengthMm} × ${g.widthMm} × ${g.thicknessMm} mm`;
}

function poseHasCustom(c: Component): boolean {
  const rot =
    (c.rotateX != null && c.rotateX !== 0) ||
    (c.rotateY != null && c.rotateY !== 0) ||
    (c.rotateZ != null && c.rotateZ !== 0);
  const formulas = Boolean(c.xFormula || c.yFormula || c.zFormula);
  return rot || formulas;
}

function poseSummary(c: Component): string {
  if (!poseHasCustom(c)) return 'Por defecto del placement';
  const parts: string[] = [];
  if (c.rotateX) parts.push(`Rx ${c.rotateX}°`);
  if (c.rotateY) parts.push(`Ry ${c.rotateY}°`);
  if (c.rotateZ) parts.push(`Rz ${c.rotateZ}°`);
  if (c.xFormula || c.yFormula || c.zFormula) parts.push('fórmulas XYZ');
  return parts.join(' · ') || 'Personalizada';
}

function edgeEnabledCount(edges: EdgeStates): number {
  return (['L1', 'L2', 'W1', 'W2'] as const).filter((s) => edges[s]).length;
}

export function ComponentDetailView({
  component: c,
  onBack,
  onEdit,
  onToggleActive,
  canMutate,
}: ComponentDetailViewProps): ReactNode {
  const geometry =
    c.geometry?.kind === 'rectangular_board' ? c.geometry : null;
  const edges = edgesToStates(c.defaultEdges);
  const perforations = c.perforations ?? [];
  const metric = plateMetric(c);
  const customPose = poseHasCustom(c);
  const encintados = edgeEnabledCount(edges);

  const chrome = (
    <header
      className="workspace-chrome"
      data-testid="component-detail-chrome"
    >
      <div className="workspace-chrome__lead">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={onBack}
          aria-label="Volver a la lista"
        >
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          Lista
        </button>
        <div className="workspace-chrome__identity">
          <span className="workspace-chrome__code">{c.code}</span>
          <div className="workspace-chrome__title-row">
            <h2 className="workspace-chrome__title">{c.name}</h2>
            {c.active === false ? (
              <span className="status-badge badge-inactive">Inactivo</span>
            ) : null}
          </div>
          <p
            className="workspace-chrome__subtitle"
            data-testid="component-summary"
          >
            {placementLabel(c.placement)}
            <span className="workspace-chrome__dot" aria-hidden>
              ·
            </span>
            {geometrySummary(c)}
          </p>
        </div>
      </div>
      <div
        className="workspace-chrome__total"
        data-testid="component-detail-metric"
      >
        <span className="workspace-chrome__total-label">Placa</span>
        {metric ? (
          <span className="workspace-chrome__total-value">{metric}</span>
        ) : (
          <span className="workspace-chrome__total-value workspace-chrome__total-value--muted">
            Sin geometría
          </span>
        )}
      </div>
      <div className="workspace-chrome__actions">
        {canMutate ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onEdit(c)}
              data-testid="component-detail-edit"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Editar
            </button>
            {onToggleActive ? (
              <button
                type="button"
                className="btn"
                onClick={() => onToggleActive(c)}
                title={c.active === false ? 'Reactivar' : 'Desactivar'}
              >
                {c.active === false ? (
                  <>
                    <Eye size={16} strokeWidth={1.5} aria-hidden />
                    Reactivar
                  </>
                ) : (
                  <>
                    <EyeOff size={16} strokeWidth={1.5} aria-hidden />
                    Desactivar
                  </>
                )}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );

  const notes = c.notes ? (
    <p className="eng-detail__notes" data-testid="component-detail-notes">
      {c.notes}
    </p>
  ) : null;

  const primary = (
    <>
      <section
        className="surface-card surface-card--lg"
        aria-label="Geometría y dimensiones"
      >
        <h3 className="eng-detail__panel-title">Geometría</h3>
        {geometry ? (
          <dl
            className="eng-detail__defs"
            data-testid="component-detail-geometry"
          >
            <div>
              <dt>Largo × Ancho × Espesor</dt>
              <dd>
                {geometry.lengthMm} × {geometry.widthMm} ×{' '}
                {geometry.thicknessMm} mm
              </dd>
            </div>
            {geometry.lengthFormula ? (
              <div>
                <dt>Fórmula largo</dt>
                <dd>
                  <code>{geometry.lengthFormula}</code>
                </dd>
              </div>
            ) : null}
            {geometry.widthFormula ? (
              <div>
                <dt>Fórmula ancho</dt>
                <dd>
                  <code>{geometry.widthFormula}</code>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="eng-detail__empty">Sin geometría definida.</p>
        )}
      </section>

      <section
        className="surface-card surface-card--lg"
        aria-label="Cantos por defecto"
        data-testid="component-detail-edges"
      >
        <h3 className="eng-detail__panel-title">
          Cantos por defecto
          {geometry ? ` (${encintados}/4)` : null}
        </h3>
        <p className="eng-detail__panel-hint">
          Solo lectura. Para cambiar cantos, usá Editar.
        </p>
        {geometry ? (
          <PlankEdgeDiagram
            edges={edges}
            onToggle={() => {
              /* read-only detail */
            }}
            lengthMm={geometry.lengthMm}
            widthMm={geometry.widthMm}
            disabled
          />
        ) : (
          <p className="eng-detail__empty">
            Definí geometría para ver el diagrama de cantos.
          </p>
        )}
      </section>
    </>
  );

  const secondary = (
    <>
      <details
        className="eng-detail__disclosure"
        open={customPose}
        data-testid="component-detail-pose"
      >
        <summary>
          Posición y rotación
          <span className="eng-detail__disclosure-summary">
            {poseSummary(c)}
          </span>
        </summary>
        <div className="eng-detail__disclosure-body">
          <dl className="eng-detail__defs">
            <div>
              <dt>Rotación X</dt>
              <dd>{orDash(c.rotateX)}°</dd>
            </div>
            <div>
              <dt>Rotación Y</dt>
              <dd>{orDash(c.rotateY)}°</dd>
            </div>
            <div>
              <dt>Rotación Z</dt>
              <dd>{orDash(c.rotateZ)}°</dd>
            </div>
            {c.xFormula ? (
              <div>
                <dt>Fórmula X</dt>
                <dd>
                  <code>{c.xFormula}</code>
                </dd>
              </div>
            ) : null}
            {c.yFormula ? (
              <div>
                <dt>Fórmula Y</dt>
                <dd>
                  <code>{c.yFormula}</code>
                </dd>
              </div>
            ) : null}
            {c.zFormula ? (
              <div>
                <dt>Fórmula Z</dt>
                <dd>
                  <code>{c.zFormula}</code>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </details>

      <section className="surface-card" aria-label="Roles de opción">
        <h3 className="eng-detail__panel-title">
          Roles de opción
          {c.optionRoles.length > 0 ? ` (${c.optionRoles.length})` : null}
        </h3>
        {c.optionRoles.length > 0 ? (
          <ul
            className="eng-detail__chips"
            data-testid="component-detail-roles"
          >
            {c.optionRoles.map((role) => (
              <li key={role} className="eng-detail__chip">
                {role}
              </li>
            ))}
          </ul>
        ) : (
          <p className="eng-detail__empty">Sin roles asignados.</p>
        )}
      </section>

      {perforations.length > 0 ? (
        <section className="surface-card" aria-label="Perforaciones">
          <h3 className="eng-detail__panel-title">
            Perforaciones ({perforations.length})
          </h3>
          <ul
            className="eng-detail__list"
            data-testid="component-detail-perforations"
          >
            {perforations.map((p) => (
              <li key={p.id} className="eng-detail__list-item">
                <span className="eng-detail__list-main eng-detail__mono">
                  {p.type} · Ø {p.diameterMm} mm
                </span>
                <span className="eng-detail__list-sub">
                  prof. {p.depthMm} mm ·{' '}
                  {Math.round((p.relativePosition?.xPercent ?? 0) * 100)}% /{' '}
                  {Math.round((p.relativePosition?.yPercent ?? 0) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );

  return (
    <EngineeringDetailLayout
      dataTestId="component-detail"
      className="component-detail"
      chrome={chrome}
      notes={notes}
      primary={primary}
      secondary={secondary}
    />
  );
}
