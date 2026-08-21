/**
 * ProjectStalenessBanner (OC-023).
 * Alerts users when production release or engineering artifacts are stale due to
 * post-release edits or release revocation.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, FileSpreadsheet, RefreshCw } from 'lucide-react';
import {
  getProjectStalenessReport,
  STALENESS_REASON_LABELS_ES,
  type Project,
} from '@muebles/domain';

export interface ProjectStalenessBannerProps {
  readonly project: Project;
  readonly onOpenReleaseModal?: () => void;
  readonly onOpenChangeOrderModal?: () => void;
}

export function ProjectStalenessBanner({
  project,
  onOpenReleaseModal,
  onOpenChangeOrderModal,
}: ProjectStalenessBannerProps): ReactNode {
  const report = getProjectStalenessReport(project);

  if (!report.isStale) {
    return null;
  }

  return (
    <div
      className="project-staleness-banner"
      role="alert"
      data-testid="project-staleness-banner"
    >
      <div className="project-staleness-banner__header">
        <AlertTriangle
          className="project-staleness-banner__icon"
          size={18}
          aria-hidden="true"
        />
        <div className="project-staleness-banner__title-box">
          <strong className="project-staleness-banner__title">
            Atención: Cambios detectados post-liberación (Estado Desactualizado / Stale)
          </strong>
          <p className="project-staleness-banner__description">
            {report.reasons
              .map((r) => STALENESS_REASON_LABELS_ES[r] ?? r)
              .join('. ')}
            . Los planos, despiece y listas de corte actuales no coinciden con la orden liberada a taller.
          </p>
        </div>
      </div>

      <div className="project-staleness-banner__actions">
        {onOpenChangeOrderModal ? (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onOpenChangeOrderModal}
            data-testid="btn-staleness-change-order"
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            Crear Change Order
          </button>
        ) : null}

        {onOpenReleaseModal ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={onOpenReleaseModal}
            data-testid="btn-staleness-rerelease"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Re-evaluar Liberación
          </button>
        ) : null}
      </div>
    </div>
  );
}
