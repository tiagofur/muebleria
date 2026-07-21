/**
 * Component detail view — read-only chrome + sections (Fase 3 follow-up).
 * Mirrors ModuleDetailView/StructureDetailView structure but adapted to the
 * Component model: shows geometry, default edges, positioning/rotation,
 * option roles, and perforations (the last three were 100% invisible in the
 * previous card-expand UI).
 */

import type { ReactNode } from 'react';
import type { Component } from '@muebles/domain';
import { Check, ChevronLeft, Eye, EyeOff, Pencil } from 'lucide-react';
import { geometrySummary, placementLabel } from '../componentDraft';

export type ComponentDetailViewProps = {
  readonly component: Component;
  readonly onBack: () => void;
  readonly onEdit: (c: Component) => void;
  readonly onToggleActive?: (c: Component) => void;
  readonly canMutate: boolean;
};

function orDash(value: number | undefined): string {
  return typeof value === 'number' && !Number.isNaN(value)
    ? String(value)
    : '—';
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
  const edges = c.defaultEdges ?? [];
  const perforations = c.perforations ?? [];

  return (
    <div className="component-detail" data-testid="component-detail">
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
                  title={
                    c.active === false ? 'Reactivar' : 'Desactivar'
                  }
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

      {c.notes ? (
        <p className="module-detail__notes" data-testid="component-detail-notes">
          {c.notes}
        </p>
      ) : null}

      <section
        className="module-detail__section"
        aria-label="Geometría y dimensiones"
      >
        <h3 className="module-detail__section-title">Geometría</h3>
        {geometry ? (
          <ul className="module-detail__preset-list">
            <li className="module-detail__preset">
              <span className="module-detail__preset-name">
                Largo × Ancho × Espesor
              </span>
              <span className="module-detail__preset-dims">
                {geometry.lengthMm} × {geometry.widthMm} ×{' '}
                {geometry.thicknessMm} mm
              </span>
            </li>
            {geometry.lengthFormula ? (
              <li className="module-detail__preset">
                <span className="module-detail__preset-name">
                  Fórmula largo
                </span>
                <span className="module-detail__preset-dims">
                  {geometry.lengthFormula}
                </span>
              </li>
            ) : null}
            {geometry.widthFormula ? (
              <li className="module-detail__preset">
                <span className="module-detail__preset-name">
                  Fórmula ancho
                </span>
                <span className="module-detail__preset-dims">
                  {geometry.widthFormula}
                </span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="module-detail__empty">Sin geometría definida.</p>
        )}
      </section>

      <section
        className="module-detail__section"
        aria-label="Cantos por defecto"
      >
        <h3 className="module-detail__section-title">
          Cantos por defecto ({edges.length})
        </h3>
        {edges.length === 0 ? (
          <p className="module-detail__empty">Sin cantos asignados.</p>
        ) : (
          <ul
            className="module-detail__preset-list"
            data-testid="component-detail-edges"
          >
            {edges.map((e) => (
              <li
                key={e.side}
                className="module-detail__preset"
                style={{ alignItems: 'center' }}
              >
                <span className="module-detail__preset-name">
                  Lado {e.side}
                </span>
                <span
                  className="module-detail__preset-dims"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: e.enabled
                      ? 'var(--success-700)'
                      : 'var(--text-muted)',
                  }}
                >
                  {e.enabled ? (
                    <>
                      <Check size={12} strokeWidth={2} aria-hidden />
                      Encintado
                    </>
                  ) : (
                    'Sin canto'
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="module-detail__section"
        aria-label="Posicionamiento y rotación"
      >
        <h3 className="module-detail__section-title">
          Posicionamiento y rotación
        </h3>
        <ul
          className="module-detail__preset-list"
          data-testid="component-detail-pose"
        >
          <li className="module-detail__preset">
            <span className="module-detail__preset-name">Rotación X</span>
            <span className="module-detail__preset-dims">
              {orDash(c.rotateX)}°
            </span>
          </li>
          <li className="module-detail__preset">
            <span className="module-detail__preset-name">Rotación Y</span>
            <span className="module-detail__preset-dims">
              {orDash(c.rotateY)}°
            </span>
          </li>
          <li className="module-detail__preset">
            <span className="module-detail__preset-name">Rotación Z</span>
            <span className="module-detail__preset-dims">
              {orDash(c.rotateZ)}°
            </span>
          </li>
          {c.xFormula ? (
            <li className="module-detail__preset">
              <span className="module-detail__preset-name">Fórmula X</span>
              <span className="module-detail__preset-dims">{c.xFormula}</span>
            </li>
          ) : null}
          {c.yFormula ? (
            <li className="module-detail__preset">
              <span className="module-detail__preset-name">Fórmula Y</span>
              <span className="module-detail__preset-dims">{c.yFormula}</span>
            </li>
          ) : null}
          {c.zFormula ? (
            <li className="module-detail__preset">
              <span className="module-detail__preset-name">Fórmula Z</span>
              <span className="module-detail__preset-dims">{c.zFormula}</span>
            </li>
          ) : null}
        </ul>
      </section>

      {c.optionRoles.length > 0 ? (
        <section
          className="module-detail__section"
          aria-label="Roles de opción"
        >
          <h3 className="module-detail__section-title">
            Roles de opción ({c.optionRoles.length})
          </h3>
          <div
            className="module-detail__roles"
            data-testid="component-detail-roles"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
            }}
          >
            {c.optionRoles.map((role) => (
              <span
                key={role}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: 'var(--space-1) var(--space-3)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                  background: 'var(--surface-muted)',
                }}
              >
                {role}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {perforations.length > 0 ? (
        <section
          className="module-detail__section"
          aria-label="Perforaciones"
        >
          <h3 className="module-detail__section-title">
            Perforaciones ({perforations.length})
          </h3>
          <ul
            className="module-detail__preset-list"
            data-testid="component-detail-perforations"
          >
            {perforations.map((p) => (
              <li key={p.id} className="module-detail__preset">
                <span className="module-detail__preset-name">
                  {p.type} · Ø {p.diameterMm} mm
                </span>
                <span className="module-detail__preset-dims">
                  prof. {p.depthMm} mm ·{' '}
                  {Math.round((p.relativePosition?.xPercent ?? 0) * 100)}% /{' '}
                  {Math.round((p.relativePosition?.yPercent ?? 0) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
