/**
 * Instalaciones — Project detail: the installation subprocess of ONE obra.
 *
 * Back navigation to the Instalaciones list, the units still to install on
 * site (En camino) and the full installation job panel — visits, field
 * issues, punch items and the gated client closeout (OC-070..OC-074). The
 * home screen stays a project list; the process work lives here.
 */

import type { ReactNode } from 'react';
import { ArrowLeft, Hammer, Mail, MapPin, Phone } from 'lucide-react';

import {
  ITEM_FLOOR_STATUS_LABELS_ES,
  normalizeItemFloorStatus,
  type ItemFloorStatus,
  type Project,
} from '@muebles/domain';
import { InstallationJobPanel, type InstallationJobPanelHandlers } from './InstallationJobPanel';
import { installationJobCardView } from './installationJobView';

export type InstalacionesProjectDetailProps = {
  readonly project: Project;
  readonly customerName?: string;
  readonly customerAddress?: string;
  readonly customerPhone?: string;
  readonly customerEmail?: string;
  /** Advance one loaded item to installed (Marcar Instalado). */
  readonly canAdvance?: boolean;
  readonly onAdvance?: (projectId: string, itemId: string, target: ItemFloorStatus) => void;
  /** Installation roles may work the job (visits, issues, punch). */
  readonly canManageJob?: boolean;
  /** Closeout roles may sign off and close the project. */
  readonly canCloseout?: boolean;
  readonly jobHandlers?: InstallationJobPanelHandlers;
  readonly onBack?: () => void;
  readonly testId?: string;
};

export function InstalacionesProjectDetail({
  project,
  customerName = '',
  customerAddress,
  customerPhone,
  customerEmail,
  canAdvance = false,
  onAdvance,
  canManageJob = false,
  canCloseout = false,
  jobHandlers,
  onBack,
  testId,
}: InstalacionesProjectDetailProps): ReactNode {
  const view = installationJobCardView(project);
  const toInstall = project.items.filter(
    (item) => normalizeItemFloorStatus(item.floorStatus) === 'loaded',
  );

  return (
    <section
      className="instalaciones-detail"
      aria-label={`Instalación — ${project.name}`}
      data-testid={testId ?? 'instalaciones-detail'}
    >
      <header className="instalaciones-detail__header">
        {onBack ? (
          <button
            type="button"
            className="btn btn--ghost instalaciones-detail__back"
            onClick={onBack}
            data-testid="instalaciones-back"
          >
            <ArrowLeft size={18} strokeWidth={1.5} aria-hidden /> Instalaciones
          </button>
        ) : null}
        <div className="instalaciones-detail__bar">
        <div className="instalaciones-detail__project-info">
          <h2 className="instalaciones-detail__title">{project.name}</h2>
          {customerName ? (
            <p className="instalaciones-detail__customer">{customerName}</p>
          ) : null}
          {customerAddress || customerPhone || customerEmail ? (
            <address
              className="ship-board__customer-details"
              aria-label={`Datos de contacto${customerName ? ` de ${customerName}` : ''}`}
            >
              {customerAddress ? (
                <span className="ship-board__customer-detail">
                  <MapPin size={16} strokeWidth={1.5} aria-hidden />
                  <span>{customerAddress}</span>
                </span>
              ) : null}
              {customerPhone ? (
                <a
                  className="ship-board__customer-detail ship-board__customer-detail-link"
                  href={`tel:${customerPhone}`}
                >
                  <Phone size={16} strokeWidth={1.5} aria-hidden />
                  <span>{customerPhone}</span>
                </a>
              ) : null}
              {customerEmail ? (
                <a
                  className="ship-board__customer-detail ship-board__customer-detail-link"
                  href={`mailto:${customerEmail}`}
                >
                  <Mail size={16} strokeWidth={1.5} aria-hidden />
                  <span>{customerEmail}</span>
                </a>
              ) : null}
            </address>
          ) : null}
        </div>
        <div className="instalaciones-detail__summary">
          <span
            className={
              view.jobStatus === 'completed'
                ? 'status-badge status-badge--done'
                : view.jobStatus === 'in_progress'
                  ? 'status-badge status-badge--progress'
                  : 'status-badge status-badge--open'
            }
          >
            Instalación: {view.jobStatusLabel}
          </span>
          <span className="instalaciones-detail__units">
            {view.units.installed}/{view.units.total} unidades instaladas
          </span>
        </div>
        </div>
      </header>

      {toInstall.length > 0 ? (
        <div className="ship-board__section">
          <h3 className="ship-board__section-title">
            <Hammer size={14} strokeWidth={1.5} aria-hidden />
            En camino
            <span className="ship-board__section-count">{toInstall.length}</span>
          </h3>
          <ul className="ship-board__list">
            {toInstall.map((item) => (
              <li
                key={item.id}
                className="ship-board__row"
                data-testid={`instalaciones-install-${item.id}`}
              >
                <div className="ship-board__row-main">
                  <span className="ship-board__row-module">{item.moduleId}</span>
                  <span className="ship-board__row-meta">
                    {item.quantity} {item.quantity === 1 ? 'mueble' : 'muebles'} · está en{' '}
                    {ITEM_FLOOR_STATUS_LABELS_ES[
                      normalizeItemFloorStatus(item.floorStatus)
                    ]}
                  </span>
                </div>
                {canAdvance && onAdvance ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => onAdvance(project.id, item.id, 'installed')}
                    data-testid={`instalaciones-advance-${item.id}`}
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
      ) : null}

      {jobHandlers ? (
        <InstallationJobPanel
          project={project}
          canManage={canManageJob}
          canCloseout={canCloseout}
          handlers={jobHandlers}
        />
      ) : null}
    </section>
  );
}
