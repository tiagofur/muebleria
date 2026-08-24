/**
 * Instalaciones — installation home: a LIST of projects with installation
 * work (canonical process-screen pattern: the home is a project list; the
 * process work — visits, field issues, punch, closeout — lives in the
 * per-project detail screen, docs/operational-ux.md §4).
 */

import { useMemo, type ReactNode } from 'react';
import { Hammer, MapPin, Phone } from 'lucide-react';

import {
  normalizeItemFloorStatus,
  type Customer,
  type Project,
} from '@muebles/domain';
import { EmptyState, PageHeader } from '../common';
import { installationJobCardView, type InstallationJobCardView } from './installationJobView';

export type InstalacionesCard = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerLabel: string;
  readonly customerAddress?: string;
  readonly customerPhone?: string;
  readonly toInstallCount: number;
  readonly installedCount: number;
  readonly job: InstallationJobCardView;
};

function cardFromProject(
  project: Project,
  customer?: Customer,
): InstalacionesCard | null {
  if (project.status !== 'accepted' && project.status !== 'produced') return null;
  let toInstall = 0;
  let installed = 0;
  for (const item of project.items ?? []) {
    const status = normalizeItemFloorStatus(item.floorStatus);
    if (status === 'loaded') toInstall++;
    else if (status === 'installed') installed++;
  }
  const job = installationJobCardView(project);
  const hasJobWork =
    job.hasJob &&
    ((project.installation?.visits.length ?? 0) > 0 ||
      (project.installation?.fieldIssues.length ?? 0) > 0 ||
      (project.installation?.punchItems.length ?? 0) > 0 ||
      job.closeoutSigned);
  if (toInstall === 0 && !hasJobWork) return null;
  return {
    projectId: project.id,
    projectName: project.name,
    customerLabel: customer?.name ?? '',
    customerAddress: customer?.address,
    customerPhone: customer?.phone,
    toInstallCount: toInstall,
    installedCount: installed,
    job,
  };
}

/** Projects with active installation work (pure, testable). */
export function instalacionesProjects(
  projects: readonly Project[],
  customerFor?: (customerId: string) => Customer | undefined,
): readonly InstalacionesCard[] {
  const cards: InstalacionesCard[] = [];
  for (const project of projects) {
    const card = cardFromProject(project, customerFor?.(project.customerId));
    if (card) cards.push(card);
  }
  return cards;
}

export function InstalacionesScreen({
  projects,
  onOpenProject,
  customerFor,
  testId,
}: {
  /** Projects in the factory (accepted/produced), already role-filtered. */
  readonly projects: readonly Project[];
  /** Open the per-project installation detail screen. */
  readonly onOpenProject: (projectId: string) => void;
  /** Existing customer data for the installation destination and contact. */
  readonly customerFor?: (customerId: string) => Customer | undefined;
  readonly testId?: string;
}): ReactNode {
  const cards = useMemo(
    () => instalacionesProjects(projects, customerFor),
    [projects, customerFor],
  );
  const totalToInstall = cards.reduce((acc, c) => acc + c.toInstallCount, 0);

  return (
    <section
      className="ship-board"
      aria-label="Instalaciones"
      data-testid={testId ?? 'instalaciones-screen'}
    >
      <PageHeader
        title="Instalaciones"
        subtitle="Obras con instalación en curso o pendiente. Abrí una obra para gestionar visitas, incidencias, punch list y cierre."
        icon={<Hammer size={16} strokeWidth={1.5} />}
        contextualControls={
          <span className="ship-board__stat" data-testid="instalaciones-to-install">
            {totalToInstall} para instalar
          </span>
        }
      />

      {cards.length === 0 ? (
        <EmptyState
          title="Nada para instalar"
          description="Cuando cargues muebles desde Embarques, las obras aparecen acá para instalar en obra."
        />
      ) : (
        <ul className="ship-board__cards">
          {cards.map((card) => (
            <li
              key={card.projectId}
              className="ship-board__card card-open-host"
              data-testid={`instalaciones-card-${card.projectId}`}
            >
              <div className="ship-board__card-header">
                <div>
                  <h3 className="ship-board__card-title">
                    <button
                      type="button"
                      className="card-open"
                      onClick={() => onOpenProject(card.projectId)}
                      data-testid={`instalaciones-open-${card.projectId}`}
                      aria-label={`Abrir instalación ${card.projectName}`}
                    >
                      {card.projectName}
                    </button>
                  </h3>
                  {card.customerLabel ? (
                    <p className="ship-board__card-customer">{card.customerLabel}</p>
                  ) : null}
                  {card.customerAddress ? (
                    <p className="instalaciones-list__address">
                      <MapPin size={14} strokeWidth={1.5} aria-hidden />
                      <span>{card.customerAddress}</span>
                    </p>
                  ) : null}
                  {card.customerPhone ? (
                    <a
                      className="instalaciones-list__address instalaciones-list__address--link"
                      href={`tel:${card.customerPhone}`}
                    >
                      <Phone size={14} strokeWidth={1.5} aria-hidden />
                      <span>{card.customerPhone}</span>
                    </a>
                  ) : null}
                </div>
              </div>
              <p className="instalaciones-list__summary">
                <span
                  className={
                    card.job.jobStatus === 'completed'
                      ? 'status-badge status-badge--done'
                      : card.job.jobStatus === 'in_progress'
                        ? 'status-badge status-badge--progress'
                        : 'status-badge status-badge--open'
                  }
                >
                  {card.job.jobStatusLabel}
                </span>
                <span className="instalaciones-list__meta">
                  {card.job.units.installed}/{card.job.units.total} unidades instaladas
                  {card.toInstallCount > 0 ? ` · ${card.toInstallCount} en camino` : ''}
                  {card.job.openVisitCount > 0
                    ? ` · ${card.job.openVisitCount} visita${card.job.openVisitCount === 1 ? '' : 's'}`
                    : ''}
                  {card.job.openIssueCount > 0
                    ? ` · ${card.job.openIssueCount} incidencia${card.job.openIssueCount === 1 ? '' : 's'}`
                    : ''}
                  {card.job.blockingPunchCount > 0
                    ? ` · ${card.job.blockingPunchCount} punch bloqueante${card.job.blockingPunchCount === 1 ? '' : 's'}`
                    : ''}
                  {card.job.closed ? ' · obra cerrada' : ''}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
