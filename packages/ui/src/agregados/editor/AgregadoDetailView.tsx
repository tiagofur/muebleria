/**
 * Agregado detail view — read-only workspace.
 * Shows composition summary: pieces, hardware, dims, notes.
 */

import type { ReactNode } from 'react';
import type { Agregado, Component, Hardware } from '@muebles/domain';
import { ChevronLeft, Layers, Pencil, Settings2, Trash2 } from 'lucide-react';
import { EngineeringDetailLayout } from '../../common/EngineeringDetailLayout';

export type AgregadoDetailViewProps = {
  readonly agregado: Agregado;
  readonly catalogComponents: readonly Component[];
  readonly catalogHardware: readonly Hardware[];
  readonly onBack: () => void;
  readonly onEdit: (a: Agregado) => void;
  readonly onDelete?: (id: string) => void;
  readonly canMutate: boolean;
};

function dimsSummary(a: Agregado): string {
  const d = a.externalDims;
  if (!d || (d.width === 0 && d.height === 0 && d.depth === 0)) return '—';
  return `${d.width} × ${d.height} × ${d.depth} mm`;
}

export function AgregadoDetailView({
  agregado: a,
  catalogComponents,
  catalogHardware,
  onBack,
  onEdit,
  onDelete,
  canMutate,
}: AgregadoDetailViewProps): ReactNode {
  const compLookup = new Map(catalogComponents.map((c) => [c.id, c]));
  const hwLookup = new Map(catalogHardware.map((h) => [h.id, h]));

  const chrome = (
    <header className="workspace-chrome" data-testid="agregado-detail-chrome">
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
          <span className="workspace-chrome__code">{a.code}</span>
          <div className="workspace-chrome__title-row">
            <h2 className="workspace-chrome__title">{a.name}</h2>
          </div>
          <p className="workspace-chrome__subtitle" data-testid="agregado-summary">
            {dimsSummary(a)}
          </p>
        </div>
      </div>

      <div className="workspace-chrome__total">
        <span className="workspace-chrome__total-label">Composición</span>
        <span className="workspace-chrome__total-value">
          {(a.components ?? []).length} piezas · {(a.hardwareLines ?? []).length} herrajes
        </span>
      </div>

      <div className="workspace-chrome__actions">
        {canMutate ? (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onEdit(a)}
              data-testid="agregado-detail-edit"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Editar
            </button>
            {onDelete ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => onDelete(a.id)}
                data-testid="agregado-detail-delete"
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

  const notes = a.notes ? (
    <p className="eng-detail__notes" data-testid="agregado-detail-notes">
      {a.notes}
    </p>
  ) : null;

  const primary = (
    <>
      {/* Components */}
      <section className="surface-card surface-card--lg" aria-label="Piezas de tablero">
        <h3 className="eng-detail__panel-title">
          <Layers size={15} style={{ display: 'inline', marginRight: 6 }} />
          Piezas de tablero ({(a.components ?? []).length})
        </h3>
        {(a.components ?? []).length === 0 ? (
          <p className="eng-detail__empty">Sin piezas definidas.</p>
        ) : (
          <ul className="eng-detail__list" data-testid="agregado-detail-components">
            {(a.components ?? []).map((inst, idx) => {
              const comp = compLookup.get(inst.componentId);
              return (
                <li key={idx} className="eng-detail__list-item">
                  <span className="eng-detail__list-main eng-detail__mono">
                    {comp ? `${comp.code} — ${comp.name}` : inst.componentId}
                  </span>
                  <span className="eng-detail__list-sub">× {inst.quantity}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Hardware */}
      <section className="surface-card surface-card--lg" aria-label="Herrajes incluidos">
        <h3 className="eng-detail__panel-title">
          <Settings2 size={15} style={{ display: 'inline', marginRight: 6 }} />
          Herrajes incluidos ({(a.hardwareLines ?? []).length})
        </h3>
        {(a.hardwareLines ?? []).length === 0 ? (
          <p className="eng-detail__empty">Sin herrajes definidos.</p>
        ) : (
          <ul className="eng-detail__list" data-testid="agregado-detail-hardware">
            {(a.hardwareLines ?? []).map((line, idx) => {
              const hw = line.hardwareId ? hwLookup.get(line.hardwareId) : undefined;
              return (
                <li key={idx} className="eng-detail__list-item">
                  <span className="eng-detail__list-main eng-detail__mono">
                    {hw ? `${hw.code} — ${hw.name}` : `Rol: ${line.optionRole}`}
                  </span>
                  <span className="eng-detail__list-sub">× {line.quantity}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );

  const secondary = (
    <section className="surface-card" aria-label="Dimensiones externas">
      <h3 className="eng-detail__panel-title">Dimensiones externas</h3>
      <dl className="eng-detail__defs">
        <div>
          <dt>Ancho (W)</dt>
          <dd>{a.externalDims?.width ?? '—'} mm</dd>
        </div>
        <div>
          <dt>Alto (H)</dt>
          <dd>{a.externalDims?.height ?? '—'} mm</dd>
        </div>
        <div>
          <dt>Profundidad (D)</dt>
          <dd>{a.externalDims?.depth ?? '—'} mm</dd>
        </div>
      </dl>
      {a.description && (
        <p className="eng-detail__notes" style={{ marginTop: 12 }}>
          {a.description}
        </p>
      )}
    </section>
  );

  return (
    <EngineeringDetailLayout
      dataTestId="agregado-detail"
      className="agregado-detail"
      chrome={chrome}
      notes={notes}
      primary={primary}
      secondary={secondary}
    />
  );
}
