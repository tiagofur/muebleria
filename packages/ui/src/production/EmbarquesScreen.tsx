/**
 * Embarques — despacho + instalación board (menu reorg).
 *
 * Cross-project view of the logistics tail: items EMBALADOS waiting to be
 * loaded onto transport, and loaded items on their way to installation.
 * The full per-project loading checklist (scan + "Liberar salida") stays in
 * the Órdenes hub despacho tab until it migrates here (M2 — see
 * roadmap-screens/00-overview.md); this screen links to it per project.
 *
 * Read-derive only; advancing goes through the shell callback so the server
 * enforces station scoping and writes the floor-status event (F094).
 */

import { useMemo, type ReactNode } from 'react';
import { Truck } from 'lucide-react';

import {
  normalizeItemFloorStatus,
  ITEM_FLOOR_STATUS_LABELS_ES,
  type ItemFloorStatus,
  type Project,
  type ProjectItem,
} from '@muebles/domain';
import { EmptyState } from '../common';

type EmbarquesRow = {
  readonly itemId: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly currentStatus: ItemFloorStatus;
};

type EmbarquesProject = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerLabel: string;
  readonly toLoad: readonly EmbarquesRow[];
  readonly onRoad: readonly EmbarquesRow[];
};

function rowFromItem(item: ProjectItem): EmbarquesRow {
  return {
    itemId: item.id,
    moduleName: item.moduleId,
    quantity: item.quantity,
    currentStatus: normalizeItemFloorStatus(item.floorStatus),
  };
}

/** Factory projects split into load/install sections (pure, testable). */
export function embarquesProjects(
  projects: readonly Project[],
  customerLabelFor?: (customerId: string) => string,
): readonly EmbarquesProject[] {
  const result: EmbarquesProject[] = [];
  for (const project of projects) {
    if (project.status !== 'accepted' && project.status !== 'produced') continue;
    const toLoad: EmbarquesRow[] = [];
    const onRoad: EmbarquesRow[] = [];
    for (const item of project.items) {
      const status = normalizeItemFloorStatus(item.floorStatus);
      if (status === 'packaged') toLoad.push(rowFromItem(item));
      else if (status === 'loaded') onRoad.push(rowFromItem(item));
    }
    if (toLoad.length === 0 && onRoad.length === 0) continue;
    result.push({
      projectId: project.id,
      projectName: project.name,
      customerLabel: customerLabelFor?.(project.customerId) ?? '',
      toLoad,
      onRoad,
    });
  }
  return result;
}

export function EmbarquesScreen({
  projects,
  canAdvance,
  onAdvance,
  customerLabelFor,
  onOpenDispatch,
  testId,
}: {
  /** Projects in the factory (accepted/produced), already role-filtered. */
  readonly projects: readonly Project[];
  readonly canAdvance: boolean;
  /** Advance one item: packaged → loaded (cargar) or loaded → installed. */
  readonly onAdvance: (
    projectId: string,
    itemId: string,
    target: ItemFloorStatus,
  ) => void;
  readonly customerLabelFor?: (customerId: string) => string;
  /** Opens the per-project loading checklist (Órdenes hub, tab despacho). */
  readonly onOpenDispatch?: (projectId: string) => void;
  readonly testId?: string;
}): ReactNode {
  const cards = useMemo(
    () => embarquesProjects(projects, customerLabelFor),
    [projects, customerLabelFor],
  );
  const totalToLoad = cards.reduce((acc, c) => acc + c.toLoad.length, 0);
  const totalOnRoad = cards.reduce((acc, c) => acc + c.onRoad.length, 0);

  const renderSection = (
    card: EmbarquesProject,
    rows: readonly EmbarquesRow[],
    label: string,
    target: ItemFloorStatus,
    testPrefix: string,
  ): ReactNode => (
    <div className="embarques__section">
      <h4 className="embarques__section-title">
        {label}
        <span className="embarques__section-count">{rows.length}</span>
      </h4>
      <ul className="embarques__list">
        {rows.map((row) => (
          <li
            key={row.itemId}
            className="embarques__row"
            data-testid={`${testPrefix}-${row.itemId}`}
          >
            <div className="embarques__row-main">
              <span className="embarques__row-module">{row.moduleName}</span>
              <span className="embarques__row-meta">
                {row.quantity} {row.quantity === 1 ? 'mueble' : 'muebles'} · está
                en {ITEM_FLOOR_STATUS_LABELS_ES[row.currentStatus]}
              </span>
            </div>
            {canAdvance ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onAdvance(card.projectId, row.itemId, target)}
                data-testid={`embarques-advance-${row.itemId}`}
              >
                <Truck size={16} strokeWidth={1.5} aria-hidden />
                Marcar {ITEM_FLOOR_STATUS_LABELS_ES[target]}
              </button>
            ) : (
              <span className="embarques__row-waiting">
                {ITEM_FLOOR_STATUS_LABELS_ES[target]}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="embarques" aria-label="Embarques" data-testid={testId ?? 'embarques-screen'}>
      <header className="embarques__header">
        <div className="embarques__title-row">
          <span className="embarques__title-icon" aria-hidden>
            <Truck size={20} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="embarques__title">Embarques</h2>
            <p className="embarques__subtitle">
              Qué está embalado esperando carga y qué va en camino a obra. El
              avance se refleja en Estado de Planta.
            </p>
          </div>
        </div>
        <div className="embarques__header-actions">
          <span className="embarques__stat" data-testid="embarques-to-load">
            {totalToLoad} para cargar
          </span>
          <span className="embarques__stat embarques__stat--road" data-testid="embarques-on-road">
            {totalOnRoad} en camino
          </span>
        </div>
      </header>

      {cards.length === 0 ? (
        <EmptyState
          title="Nada para despachar"
          description="Cuando haya muebles embalados o cargados, aparecen acá organizados por obra."
        />
      ) : (
        <ul className="embarques__cards">
          {cards.map((card) => (
            <li
              key={card.projectId}
              className="embarques__card"
              data-testid={`embarques-card-${card.projectId}`}
            >
              <div className="embarques__card-header">
                <div>
                  <h3 className="embarques__card-title">{card.projectName}</h3>
                  {card.customerLabel ? (
                    <p className="embarques__card-customer">{card.customerLabel}</p>
                  ) : null}
                </div>
                {onOpenDispatch ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onOpenDispatch(card.projectId)}
                    data-testid={`embarques-dispatch-${card.projectId}`}
                  >
                    Ver control de carga
                  </button>
                ) : null}
              </div>
              {card.toLoad.length > 0
                ? renderSection(card, card.toLoad, 'Para cargar', 'loaded', 'embarques-load')
                : null}
              {card.onRoad.length > 0
                ? renderSection(card, card.onRoad, 'En camino', 'installed', 'embarques-road')
                : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
