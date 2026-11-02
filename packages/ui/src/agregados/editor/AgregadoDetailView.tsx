/**
 * Agregado detail view — read-only workspace.
 * Shows composition summary: pieces, hardware, dims, notes.
 */

import type { ReactNode } from 'react';
import type { Agregado, Component, Hardware, OptionGroup } from '@granete/domain';
import { Box, ChevronLeft, Copy, Layers, MoreHorizontal, Pencil, Settings2, Trash2, FlaskConical } from 'lucide-react';
import { DropdownMenu } from '../../common/DropdownMenu';
import { EngineeringDetailLayout } from '../../common/EngineeringDetailLayout';
import { optionRoleLabel } from '../../optionGroups/optionRoleLabel';

export type AgregadoDetailViewProps = {
  readonly agregado: Agregado;
  readonly catalogComponents: readonly Component[];
  readonly catalogHardware: readonly Hardware[];
  readonly onBack: () => void;
  readonly onEdit: (a: Agregado) => void;
  readonly onView3D?: (a: Agregado) => void;
  /** #1369: abrir el modal «Simular cambio de receta». Ausente ⇒ botón oculto. */
  readonly onSimulateChange?: () => void;
  readonly onDelete?: (id: string) => void;
  /** Deep-copy request — the screen/store owns the copy (#1009 S5). */
  readonly onDuplicate?: (id: string) => void;
  readonly canMutate: boolean;
  /** Option groups — role labels prefer the group name (#403). */
  readonly optionGroups?: readonly OptionGroup[];
};

function dimsSummary(a: Agregado): string {
  const d = a.externalDims;
  if (!d || (d.width === 0 && d.height === 0 && d.depth === 0)) return '—';
  return `${d.width} × ${d.height} × ${d.depth} mm`;
}

/**
 * #529: human summary of the authored opening kinematics for the read-only
 * detail view (mirrors the editor's vocabulary; presentation-only).
 */
export function aperturaSummary(a: Agregado): string {
  const m = a.presentationMotion;
  if (!m) return 'Sin apertura';
  switch (m.kind) {
    case 'rotate':
      return `Batiente ${m.pivot === 'right' ? 'derecha' : 'izquierda'} · ${m.openAngleDeg}°`;
    case 'translate':
      return `Cajón extraíble · ${m.distanceMm} mm`;
    default:
      return 'Apertura por trayectoria (keyframes)';
  }
}

export function AgregadoDetailView({
  agregado: a,
  catalogComponents,
  catalogHardware,
  onBack,
  onEdit,
  onView3D,
  onSimulateChange,
  onDelete,
  onDuplicate,
  canMutate,
  optionGroups,
}: AgregadoDetailViewProps): ReactNode {
  const compLookup = new Map(catalogComponents.map((c) => [c.id, c]));
  const hwLookup = new Map(catalogHardware.map((h) => [h.id, h]));

  const bulkLines = a.hardwareLines ?? [];
  const members = a.rigidMembers ?? [];
  const placementItems = (a.components ?? []).flatMap((inst, compIdx) => {
    const comp = compLookup.get(inst.componentId);
    const compName = comp ? `${comp.code} — ${comp.name}` : inst.componentId;
    return (inst.overrides?.hardwarePlacements ?? []).map((p, pIdx) => ({
      key: `placement-${compIdx}-${pIdx}`,
      placement: p,
      component: inst,
      compName,
    }));
  });
  // #1451: los miembros de la receta también son herrajes del agregado —
  // el conteo y la lista los incluyen (antes eran invisibles en lectura).
  const totalHardwareCount = bulkLines.length + placementItems.length + members.length;

  // #1451: anclaje en vocabulario de taller — «borde izq. +10», «centro 0».
  function memberSideSummary(m: (typeof members)[number]): string {
    const x = m.placement.x;
    const offset = x.offsetFormula ?? x.offsetMm;
    const signed =
      typeof offset === 'number' && offset >= 0 ? `+${offset}` : `${offset}`;
    if (x.ref === 'max') return `borde der. ${signed}`;
    if (x.ref === 'center') return `centro ${signed}`;
    return `borde izq. ${signed}`;
  }

  function memberMoveSummary(m: (typeof members)[number]): string {
    if (m.actorMembership === 'body') return 'fijo al cajón';
    if (m.actorMembership !== undefined && m.actorMembership.startsWith('actor:')) {
      return `se mueve con «${m.actorMembership.slice('actor:'.length)}»`;
    }
    return 'sin membresía';
  }

  const BOM_ROLE_SUMMARY: Record<string, string> = {
    included_in_kit: 'incluido en el juego',
    separately_purchased: 'compra separada',
    non_purchasing: 'solo visual',
  };

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
            {dimsSummary(a)} · {aperturaSummary(a)}
          </p>
        </div>
      </div>

      <div className="workspace-chrome__total">
        <span className="workspace-chrome__total-label">Composición</span>
        <span className="workspace-chrome__total-value">
          {(a.components ?? []).length} piezas · {totalHardwareCount} herrajes
        </span>
      </div>

      <div className="workspace-chrome__actions">
        {onView3D ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => onView3D(a)}
            data-testid="agregado-detail-view-3d"
          >
            <Box size={16} strokeWidth={1.5} aria-hidden />
            Vista 3D
          </button>
        ) : null}
        {canMutate && onSimulateChange ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onSimulateChange}
            data-testid="agregado-detail-simulate"
          >
            <FlaskConical size={16} strokeWidth={1.5} aria-hidden />
            Simular cambio
          </button>
        ) : null}
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
            {onDelete || onDuplicate ? (
              <DropdownMenu
                ariaLabel="Más acciones del agregado"
                triggerLabel="Más"
                triggerIcon={<MoreHorizontal size={16} strokeWidth={1.5} />}
                sections={[
                  {
                    id: 'main',
                    items: [
                      ...(onDuplicate
                        ? [
                            {
                              id: 'duplicate',
                              label: 'Duplicar',
                              icon: <Copy size={16} strokeWidth={1.5} aria-hidden />,
                              onSelect: () => onDuplicate(a.id),
                            },
                          ]
                        : []),
                      ...(onDelete
                        ? [
                            {
                              id: 'delete',
                              label: 'Eliminar',
                              icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />,
                              onSelect: () => onDelete(a.id),
                            },
                          ]
                        : []),
                    ],
                  },
                ]}
              />
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

  // #1369: tarjeta «Receta» — visibilidad de la receta guardada sin abrir el
  // editor. Vive en la columna secundaria junto a las dimensiones: es un
  // resumen de referencia, no la composición que el usuario recorre.
  const recipeCard = (
    <section className="surface-card agregado-recipe-card" aria-label="Receta" data-testid="agregado-detail-recipe-card">
      <h3 className="eng-detail__panel-title">
        <FlaskConical size={15} style={{ display: 'inline', marginRight: 6 }} />
        Receta
      </h3>
      <p className="agregado-recipe-card__summary">
        {/* #1369 P2: 1 miembro / 1 set de variantes — pluralización correcta. */}
        {(a.rigidMembers ?? []).length} {(a.rigidMembers ?? []).length === 1 ? 'miembro' : 'miembros'} ·{' '}
        {(a.variantSets ?? []).length} {(a.variantSets ?? []).length === 1 ? 'set de variantes' : 'sets de variantes'} ·{' '}
        {a.commercialKitHardwareId
          ? `Kit: ${catalogHardware.find((h) => h.id === a.commercialKitHardwareId)?.code ?? a.commercialKitHardwareId}`
          : 'Sin kit comercial'}
      </p>
    </section>
  );

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

      {/* Hardware (#1451) — tres niveles de anclaje, mismos nombres que el editor */}
      <section className="surface-card surface-card--lg" aria-label="Herrajes">
        <h3 className="eng-detail__panel-title">
          <Settings2 size={15} style={{ display: 'inline', marginRight: 6 }} />
          Herrajes ({totalHardwareCount})
        </h3>
        {totalHardwareCount === 0 ? (
          <p className="eng-detail__empty">Sin herrajes definidos.</p>
        ) : (
          <>
            {members.length > 0 ? (
              <div className="agregado-detail__hw-group">
                <h4 className="eng-detail__group-title" data-testid="agregado-detail-hw-group-cajon">
                  Del cajón ({members.length})
                </h4>
                {a.commercialKitHardwareId ? (
                  <p className="eng-detail__list-sub">
                    Kit: {hwLookup.get(a.commercialKitHardwareId)?.code ?? a.commercialKitHardwareId} — el juego cotiza una vez.
                  </p>
                ) : null}
                <ul className="eng-detail__list" data-testid="agregado-detail-hardware-members">
                  {members.map((m, idx) => {
                    const hw =
                      m.source.kind === 'fixed' && m.source.fixed
                        ? hwLookup.get(m.source.fixed.hardwareId)
                        : undefined;
                    const label =
                      m.source.kind === 'variant'
                        ? `Variante del set ${m.source.variant?.variantSetId ?? ''}`
                        : hw
                        ? `${hw.code} — ${hw.name}`
                        : m.source.fixed?.hardwareId || 'Herraje';
                    return (
                      <li
                        key={`member-${idx}`}
                        className="eng-detail__list-item"
                        data-testid={`agregado-detail-hw-member-${idx}`}
                      >
                        <span className="eng-detail__list-main eng-detail__mono">
                          {label}
                          <small
                            className="eng-detail__list-meta"
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Del cajón · {memberSideSummary(m)} · {memberMoveSummary(m)} ·{' '}
                            {BOM_ROLE_SUMMARY[m.bomRole] ?? m.bomRole}
                          </small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {bulkLines.length > 0 ? (
              <div className="agregado-detail__hw-group">
                <h4 className="eng-detail__group-title">Por cantidad ({bulkLines.length})</h4>
                <ul className="eng-detail__list" data-testid="agregado-detail-hardware">
                  {bulkLines.map((line, idx) => {
                    const hw = line.hardwareId ? hwLookup.get(line.hardwareId) : undefined;
                    return (
                      <li key={`bulk-${idx}`} className="eng-detail__list-item" data-testid={`agregado-detail-bulk-hw-${idx}`}>
                        <span className="eng-detail__list-main eng-detail__mono">
                          {hw
                            ? `${hw.code} — ${hw.name}`
                            : `Rol: ${optionRoleLabel(line.optionRole, optionGroups)}`}
                          <small
                            className="eng-detail__list-meta"
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Presupuesto / Cantidad
                          </small>
                        </span>
                        <span className="eng-detail__list-sub">× {line.quantity}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {placementItems.length > 0 ? (
              <div className="agregado-detail__hw-group">
                <h4 className="eng-detail__group-title">De las piezas ({placementItems.length})</h4>
                <ul className="eng-detail__list" data-testid="agregado-detail-hardware-placements">
                  {placementItems.map(({ key, placement: p, component: inst, compName }) => {
                    const hw = p.hardwareId ? hwLookup.get(p.hardwareId) : undefined;
                    const posText = `Cara: ${p.anchorFace} · X: ${p.relativePosition.xFormula ?? p.relativePosition.xMm} · Y: ${p.relativePosition.yFormula ?? p.relativePosition.yMm}`;
                    return (
                      <li key={key} className="eng-detail__list-item" data-testid={`agregado-detail-${key}`}>
                        <span className="eng-detail__list-main eng-detail__mono">
                          {hw ? `${hw.code} — ${hw.name}` : p.hardwareId || 'Herraje'}
                          <small
                            className="eng-detail__list-meta"
                            style={{
                              display: 'block',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Posicionado 3D en {compName} ({posText})
                          </small>
                        </span>
                        <span className="eng-detail__list-sub">× {inst.quantity}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );

  const secondary = (
    <>
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
          <div data-testid="agregado-detail-apertura">
            <dt>Apertura</dt>
            <dd>{aperturaSummary(a)}</dd>
          </div>
        </dl>
        {a.description && (
          <p className="eng-detail__notes" style={{ marginTop: 12 }}>
            {a.description}
          </p>
        )}
      </section>
      {recipeCard}
    </>
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
