/**
 * Structure detail view — read-only chrome + sections (Fase 3 follow-up).
 * Mirrors ModuleDetailView structure but adapted to the Structure model:
 * no cost preview (structures are BOM templates, not quoteable on their own),
 * adds dedicated sections for dimensions, components, presets and revision
 * history.
 */

import type { ReactNode } from 'react';
import type { Component, Structure } from '@muebles/domain';
import { ChevronLeft, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { StructureRevisionBadge } from './StructureRevisionBadge';

export type StructureDetailViewProps = {
  readonly structure: Structure;
  readonly catalogComponents: readonly Component[];
  readonly onBack: () => void;
  readonly onEdit: (s: Structure) => void;
  readonly onDeactivate?: (id: string) => void;
  readonly onReactivate?: (id: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly canMutate: boolean;
};

function dim(d: number | undefined): string {
  return d && d > 0 ? String(d) : '—';
}

export function StructureDetailView({
  structure: s,
  catalogComponents,
  onBack,
  onEdit,
  onDeactivate,
  onReactivate,
  onDelete,
  canMutate,
}: StructureDetailViewProps): ReactNode {
  const dims = s.externalDims;
  const dimsLabel = dims
    ? `${dim(dims.width)} × ${dim(dims.height)} × ${dim(dims.depth)} mm`
    : 'Sin dimensiones';
  const componentCount = s.components?.length ?? 0;

  return (
    <div className="structure-detail" data-testid="structure-detail">
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
              <StructureRevisionBadge
                revision={s.revision ?? 1}
                variant="default"
              />
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
              {dimsLabel}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {componentCount} componente{componentCount === 1 ? '' : 's'}
              {(s.presets?.length ?? 0) > 0 ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  {s.presets!.length} preset
                  {s.presets!.length === 1 ? '' : 's'}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="workspace-chrome__actions">
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

      {s.notes ? (
        <p className="module-detail__notes" data-testid="structure-detail-notes">
          {s.notes}
        </p>
      ) : null}

      <section
        className="module-detail__section"
        aria-label="Componentes de la estructura"
      >
        <h3 className="module-detail__section-title">
          Componentes ({componentCount})
        </h3>
        {componentCount === 0 ? (
          <p className="module-detail__empty">
            Sin componentes. Agregá laterales, base u otras piezas para que la
            estructura pueda componer un mueble.
          </p>
        ) : (
          s.components!.map((inst, idx) => {
            const catComp = catalogComponents.find(
              (c) => c.id === inst.componentId,
            );
            const hasOverrides =
              inst.overrides &&
              Object.keys(inst.overrides).some((k) =>
                Boolean(
                  (inst.overrides as Record<string, unknown> | undefined)?.[k],
                ),
              );
            return (
              <div
                key={`${inst.componentId}-${idx}`}
                className="module-detail-row"
              >
                <span className="module-detail-row__code">
                  {catComp?.code ?? inst.componentId}
                </span>
                <div className="module-detail-row__main">
                  {catComp?.name ?? 'Componente'}
                  <span className="module-detail-row__sub">
                    {inst.placementOverride
                      ? `Ubicación ${inst.placementOverride}`
                      : (catComp?.placement ?? '—')}
                    {hasOverrides ? ' · con overrides' : ''}
                  </span>
                </div>
                <span className="module-detail-row__qty">×{inst.quantity}</span>
              </div>
            );
          })
        )}
      </section>

      {(s.presets?.length ?? 0) > 0 ? (
        <section
          className="module-detail__section"
          aria-label="Presets de medida"
        >
          <h3 className="module-detail__section-title">
            Presets de medida ({s.presets!.length})
          </h3>
          <ul
            className="module-detail__preset-list"
            data-testid="structure-detail-presets"
          >
            {s.presets!.map((pr) => (
              <li key={pr.id} className="module-detail__preset">
                <span className="module-detail__preset-name">
                  {pr.name?.trim() || 'Sin nombre'}
                </span>
                <span className="module-detail__preset-dims">
                  {pr.width} × {pr.height} × {pr.depth} mm
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {s.history && s.history.length > 0 ? (
        <section
          className="module-detail__section"
          aria-label="Historial de revisiones"
        >
          <h3 className="module-detail__section-title">
            Historial de revisiones ({s.history.length})
          </h3>
          <ul
            className="module-detail__preset-list"
            data-testid="structure-detail-history"
          >
            {s.history.map((rev) => (
              <li key={rev.revision} className="module-detail__preset">
                <span className="module-detail__preset-name">
                  rev. {rev.revision} — {rev.code} · {rev.name}
                </span>
                <span className="module-detail__preset-dims">
                  {rev.externalDims
                    ? `${rev.externalDims.width} × ${rev.externalDims.height} × ${rev.externalDims.depth} mm`
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
