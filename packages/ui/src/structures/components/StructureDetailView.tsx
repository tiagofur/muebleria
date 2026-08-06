/**
 * Structure detail view — engineering read-only workspace (wave 2).
 * Primary: external dims + component instances. Secondary: presets + revision
 * history (disclosure). Chrome: dims metric, Vista 3D, edit actions.
 */

import type { ReactNode } from 'react';
import type { Component, Structure } from '@muebles/domain';
import { Box, ChevronLeft, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { EngineeringDetailLayout } from '../../common/EngineeringDetailLayout';
import { StructureRevisionBadge } from './StructureRevisionBadge';

export type StructureDetailViewProps = {
  readonly structure: Structure;
  readonly catalogComponents: readonly Component[];
  readonly onBack: () => void;
  readonly onEdit: (s: Structure) => void;
  readonly onView3D?: (s: Structure) => void;
  readonly onDeactivate?: (id: string) => void;
  readonly onReactivate?: (id: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly canMutate: boolean;
};

function dim(d: number | undefined): string {
  return d && d > 0 ? String(d) : '—';
}

function dimsLabel(
  dims: Structure['externalDims'],
): string {
  if (!dims) return 'Sin dimensiones';
  return `${dim(dims.width)} × ${dim(dims.height)} × ${dim(dims.depth)} mm`;
}

function hasInstanceOverrides(
  overrides: Record<string, unknown> | undefined | null,
): boolean {
  if (!overrides) return false;
  return Object.keys(overrides).some((k) => Boolean(overrides[k]));
}

export function StructureDetailView({
  structure: s,
  catalogComponents,
  onBack,
  onEdit,
  onView3D,
  onDeactivate,
  onReactivate,
  onDelete,
  canMutate,
}: StructureDetailViewProps): ReactNode {
  const dims = s.externalDims;
  const label = dimsLabel(dims);
  const componentCount = s.components?.length ?? 0;
  const presetCount = s.presets?.length ?? 0;
  const historyCount = s.history?.length ?? 0;
  const revision = s.revision ?? 1;

  const chrome = (
    <header
      className="workspace-chrome"
      data-testid="structure-detail-chrome"
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
          <span className="workspace-chrome__code">{s.code}</span>
          <div className="workspace-chrome__title-row">
            <h2 className="workspace-chrome__title">{s.name}</h2>
            <StructureRevisionBadge structure={s} />
            {s.active === false ? (
              <span className="status-badge badge-inactive">Inactivo</span>
            ) : null}
          </div>
          <p
            className={
              dims
                ? 'workspace-chrome__subtitle'
                : 'workspace-chrome__subtitle workspace-chrome__subtitle--muted'
            }
            data-testid="structure-dim-summary"
          >
            {label}
            <span className="workspace-chrome__dot" aria-hidden>
              ·
            </span>
            {componentCount} componente{componentCount === 1 ? '' : 's'}
            {presetCount > 0 ? (
              <>
                <span className="workspace-chrome__dot" aria-hidden>
                  ·
                </span>
                {presetCount} preset{presetCount === 1 ? '' : 's'}
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div
        className="workspace-chrome__total"
        data-testid="structure-detail-metric"
      >
        <span className="workspace-chrome__total-label">Exterior</span>
        {dims ? (
          <span className="workspace-chrome__total-value">{label}</span>
        ) : (
          <span className="workspace-chrome__total-value workspace-chrome__total-value--muted">
            Sin dims
          </span>
        )}
      </div>
      <div className="workspace-chrome__actions">
        {onView3D ? (
          <button
            type="button"
            className="btn"
            onClick={() => onView3D(s)}
            data-testid="structure-detail-view-3d"
          >
            <Box size={16} strokeWidth={1.5} aria-hidden />
            Vista 3D
          </button>
        ) : null}
        {canMutate ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onEdit(s)}
              data-testid="structure-detail-edit"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Editar
            </button>
            {s.active !== false && onDeactivate ? (
              <button
                type="button"
                className="btn"
                onClick={() => onDeactivate(s.id)}
                title="Desactivar"
              >
                <EyeOff size={16} strokeWidth={1.5} aria-hidden />
                Desactivar
              </button>
            ) : null}
            {s.active === false && onReactivate ? (
              <button
                type="button"
                className="btn"
                onClick={() => onReactivate(s.id)}
                title="Reactivar"
              >
                <Eye size={16} strokeWidth={1.5} aria-hidden />
                Reactivar
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => onDelete(s.id)}
                data-testid="structure-detail-delete"
              >
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                Eliminar
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );

  const notes = s.notes ? (
    <p className="eng-detail__notes" data-testid="structure-detail-notes">
      {s.notes}
    </p>
  ) : null;

  const primary = (
    <>
      <section
        className="surface-card surface-card--lg"
        aria-label="Dimensiones exteriores"
      >
        <h3 className="eng-detail__panel-title">Dimensiones exteriores</h3>
        {dims ? (
          <dl
            className="eng-detail__defs"
            data-testid="structure-detail-dims"
          >
            <div>
              <dt>Ancho × Alto × Prof.</dt>
              <dd>{label}</dd>
            </div>
          </dl>
        ) : (
          <p className="eng-detail__empty">
            Sin dimensiones documentadas. Definilas al editar la estructura.
          </p>
        )}
      </section>

      <section
        className="surface-card surface-card--lg"
        aria-label="Componentes de la estructura"
        data-testid="structure-detail-components"
      >
        <h3 className="eng-detail__panel-title">
          Componentes ({componentCount})
        </h3>
        {componentCount === 0 ? (
          <p className="eng-detail__empty">
            Sin componentes. Agregá laterales, base u otras piezas para que la
            estructura pueda componer un mueble.
          </p>
        ) : (
          <ul className="eng-detail__instance-list">
            {s.components!.map((inst, idx) => {
              const catComp = catalogComponents.find(
                (c) => c.id === inst.componentId,
              );
              const overrides = inst.overrides as
                | Record<string, unknown>
                | undefined;
              const hasOverrides = hasInstanceOverrides(overrides);
              return (
                <li
                  key={`${inst.componentId}-${idx}`}
                  className="eng-detail__instance-row"
                >
                  <span className="eng-detail__instance-code">
                    {catComp?.code ?? inst.componentId}
                  </span>
                  <div className="eng-detail__instance-main">
                    {catComp?.name ?? 'Componente'}
                    <span className="eng-detail__instance-sub">
                      {inst.placementOverride
                        ? `Ubicación ${inst.placementOverride}`
                        : (catComp?.placement ?? '—')}
                      {hasOverrides ? ' · con overrides' : ''}
                    </span>
                  </div>
                  <span className="eng-detail__instance-qty">
                    ×{inst.quantity}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );

  const secondary = (
    <>
      <section
        className="surface-card"
        aria-label="Presets de medida"
        data-testid="structure-detail-presets-section"
      >
        <h3 className="eng-detail__panel-title">
          Presets de medida
          {presetCount > 0 ? ` (${presetCount})` : null}
        </h3>
        <p className="eng-detail__panel-hint">
          Tamaños de preview de ingeniería (no son la lista comercial del
          mueble).
        </p>
        {presetCount === 0 ? (
          <p className="eng-detail__empty">Sin presets definidos.</p>
        ) : (
          <ul
            className="eng-detail__kv-list"
            data-testid="structure-detail-presets"
          >
            {s.presets!.map((pr) => (
              <li key={pr.id} className="eng-detail__kv-item">
                <span className="eng-detail__kv-name">
                  {pr.name?.trim() || 'Sin nombre'}
                </span>
                <span className="eng-detail__kv-value">
                  {pr.width} × {pr.height} × {pr.depth} mm
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details
        className="eng-detail__disclosure"
        data-testid="structure-detail-history"
      >
        <summary>
          Historial de revisiones
          <span className="eng-detail__disclosure-summary">
            rev. actual {revision}
            {historyCount > 0
              ? ` · ${historyCount} anterior${historyCount === 1 ? '' : 'es'}`
              : ' · sin historial'}
          </span>
        </summary>
        <div className="eng-detail__disclosure-body">
          {historyCount === 0 ? (
            <p className="eng-detail__empty">
              Todavía no hay revisiones anteriores publicadas.
            </p>
          ) : (
            <ul className="eng-detail__kv-list">
              {s.history!.map((rev) => (
                <li key={rev.revision} className="eng-detail__kv-item">
                  <span className="eng-detail__kv-name">
                    rev. {rev.revision} — {rev.code} · {rev.name}
                  </span>
                  <span className="eng-detail__kv-value">
                    {rev.externalDims
                      ? `${rev.externalDims.width} × ${rev.externalDims.height} × ${rev.externalDims.depth} mm`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </>
  );

  return (
    <EngineeringDetailLayout
      dataTestId="structure-detail"
      className="structure-detail"
      chrome={chrome}
      notes={notes}
      primary={primary}
      secondary={secondary}
    />
  );
}
