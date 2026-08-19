/**
 * Instalaciones — instalación en obra board (menu reorg).
 *
 * The last process step gets its own screen: what's CARGADO and on its way
 * to the client (loaded → installed), grouped per project. Shares the
 * ship-board layout with Embarques.
 *
 * Read-derive only; advancing goes through the shell callback so the server
 * enforces station scoping and writes the floor-status event (F094).
 */

import { useMemo, type ReactNode } from 'react';
import { Hammer, Mail, MapPin, Phone } from 'lucide-react';

import {
  normalizeItemFloorStatus,
  ITEM_FLOOR_STATUS_LABELS_ES,
  type ItemFloorStatus,
  type Customer,
  type Project,
  type ProjectItem,
} from '@muebles/domain';
import { EmptyState, PageHeader } from '../common';

type InstalacionesRow = {
  readonly itemId: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly currentStatus: ItemFloorStatus;
};

type InstalacionesProject = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerLabel: string;
  readonly customerAddress?: string;
  readonly customerPhone?: string;
  readonly customerEmail?: string;
  readonly toInstall: readonly InstalacionesRow[];
  readonly installedCount: number;
};

function rowFromItem(item: ProjectItem): InstalacionesRow {
  return {
    itemId: item.id,
    moduleName: item.moduleId,
    quantity: item.quantity,
    currentStatus: normalizeItemFloorStatus(item.floorStatus),
  };
}

/** Factory projects with loaded items to install (pure, testable). */
export function instalacionesProjects(
  projects: readonly Project[],
  customerFor?: (customerId: string) => Customer | undefined,
): readonly InstalacionesProject[] {
  const result: InstalacionesProject[] = [];
  for (const project of projects) {
    if (project.status !== 'accepted' && project.status !== 'produced') continue;
    const toInstall: InstalacionesRow[] = [];
    let installedCount = 0;
    for (const item of project.items) {
      const status = normalizeItemFloorStatus(item.floorStatus);
      if (status === 'loaded') toInstall.push(rowFromItem(item));
      else if (status === 'installed') installedCount++;
    }
    if (toInstall.length === 0) continue;
    const customer = customerFor?.(project.customerId);
    result.push({
      projectId: project.id,
      projectName: project.name,
      customerLabel: customer?.name ?? '',
      customerAddress: customer?.address,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      toInstall,
      installedCount,
    });
  }
  return result;
}

export function InstalacionesScreen({
  projects,
  canAdvance,
  onAdvance,
  customerFor,
  testId,
}: {
  /** Projects in the factory (accepted/produced), already role-filtered. */
  readonly projects: readonly Project[];
  readonly canAdvance: boolean;
  /** Advance one loaded item to installed (Marcar Instalado). */
  readonly onAdvance: (
    projectId: string,
    itemId: string,
    target: ItemFloorStatus,
  ) => void;
  /** Existing customer data for the installation destination and contact. */
  readonly customerFor?: (customerId: string) => Customer | undefined;
  readonly testId?: string;
}): ReactNode {
  const cards = useMemo(
    () => instalacionesProjects(projects, customerFor),
    [projects, customerFor],
  );
  const totalToInstall = cards.reduce((acc, c) => acc + c.toInstall.length, 0);
  const totalInstalled = cards.reduce((acc, c) => acc + c.installedCount, 0);

  return (
    <section
      className="ship-board"
      aria-label="Instalaciones"
      data-testid={testId ?? 'instalaciones-screen'}
    >
      <PageHeader
        title="Instalaciones"
        subtitle="Qué va cargado y en camino a obra. Al marcar instalado, la obra avanza en Estado de Planta."
        icon={<Hammer size={16} strokeWidth={1.5} />}
        contextualControls={
          <>
            <span className="ship-board__stat" data-testid="instalaciones-to-install">
              {totalToInstall} para instalar
            </span>
            {totalInstalled > 0 ? (
              <span
                className="ship-board__stat ship-board__stat--road"
                data-testid="instalaciones-installed"
              >
                {totalInstalled} instalados
              </span>
            ) : null}
          </>
        }
      />

      {cards.length === 0 ? (
        <EmptyState
          title="Nada para instalar"
          description="Cuando cargues muebles desde Embarques, aparecen acá para instalar en obra."
        />
      ) : (
        <ul className="ship-board__cards">
          {cards.map((card) => (
            <li
              key={card.projectId}
              className="ship-board__card"
              data-testid={`instalaciones-card-${card.projectId}`}
            >
              <div className="ship-board__card-header">
                <div>
                  <h3 className="ship-board__card-title">{card.projectName}</h3>
                  {card.customerLabel ? (
                    <p className="ship-board__card-customer">
                      {card.customerLabel}
                    </p>
                  ) : null}
                  {card.customerAddress || card.customerPhone || card.customerEmail ? (
                    <address
                      className="ship-board__customer-details"
                      aria-label={`Datos de contacto${
                        card.customerLabel ? ` de ${card.customerLabel}` : ''
                      }`}
                    >
                      {card.customerAddress ? (
                        <span className="ship-board__customer-detail">
                          <MapPin size={16} strokeWidth={1.5} aria-hidden />
                          <span>{card.customerAddress}</span>
                        </span>
                      ) : null}
                      {card.customerPhone ? (
                        <a
                          className="ship-board__customer-detail ship-board__customer-detail-link"
                          href={`tel:${card.customerPhone}`}
                        >
                          <Phone size={16} strokeWidth={1.5} aria-hidden />
                          <span>{card.customerPhone}</span>
                        </a>
                      ) : null}
                      {card.customerEmail ? (
                        <a
                          className="ship-board__customer-detail ship-board__customer-detail-link"
                          href={`mailto:${card.customerEmail}`}
                        >
                          <Mail size={16} strokeWidth={1.5} aria-hidden />
                          <span>{card.customerEmail}</span>
                        </a>
                      ) : null}
                    </address>
                  ) : null}
                </div>
                {card.installedCount > 0 ? (
                  <span className="ship-board__card-done">
                    {card.installedCount} instalados
                  </span>
                ) : null}
              </div>
              <div className="ship-board__section">
                <h4 className="ship-board__section-title">
                  En camino
                  <span className="ship-board__section-count">
                    {card.toInstall.length}
                  </span>
                </h4>
                <ul className="ship-board__list">
                  {card.toInstall.map((row) => (
                    <li
                      key={row.itemId}
                      className="ship-board__row"
                      data-testid={`instalaciones-install-${row.itemId}`}
                    >
                      <div className="ship-board__row-main">
                        <span className="ship-board__row-module">
                          {row.moduleName}
                        </span>
                        <span className="ship-board__row-meta">
                          {row.quantity}{' '}
                          {row.quantity === 1 ? 'mueble' : 'muebles'} · está en{' '}
                          {ITEM_FLOOR_STATUS_LABELS_ES[row.currentStatus]}
                        </span>
                      </div>
                      {canAdvance ? (
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() =>
                            onAdvance(card.projectId, row.itemId, 'installed')
                          }
                          data-testid={`instalaciones-advance-${row.itemId}`}
                        >
                          <Hammer size={16} strokeWidth={1.5} aria-hidden />
                          Marcar {ITEM_FLOOR_STATUS_LABELS_ES.installed}
                        </button>
                      ) : (
                        <span className="ship-board__row-waiting">
                          {ITEM_FLOOR_STATUS_LABELS_ES.installed}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
