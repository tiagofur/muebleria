/**
 * ProjectOverviewPanel — transversal view of one obra (OC-091): the whole
 * story from a single context. Stage, released revision, committed
 * installation and actionable blockers first, then links into each area
 * workspace (engineering, production, shipping, installation, costs). Pure
 * domain derivations only — the panel never computes business state itself.
 */

import type { ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  Factory,
  TriangleAlert,
  Truck,
  Wrench,
} from 'lucide-react';
import {
  PROJECT_STAGE_LABELS_ES,
  deriveProjectStage,
  getProductionStaleInfo,
  surveyFabricationBlockers,
  blockingPunchItems,
  openFieldIssues,
  openInstallationVisits,
  type Project,
} from '@granete/domain';
import '../projects.css';
import './projectOverview.css';

export interface ProjectOverviewNav {
  readonly onOpenInProduction?: (projectId: string) => void;
  readonly onOpenEngineering?: (projectId: string) => void;
  readonly onOpenShipments?: (projectId: string) => void;
  readonly onOpenInstallation?: (projectId: string) => void;
}

export interface ProjectOverviewPanelProps {
  readonly project: Project;
  readonly nav: ProjectOverviewNav;
  readonly testId?: string;
}

interface BlockerLine {
  readonly id: string;
  readonly message: string;
}

function deriveBlockers(project: Project): readonly BlockerLine[] {
  const blockers: BlockerLine[] = [];

  // Same rule as the release gate: a missing structured survey falls back to
  // the legacy stamp — not a blocker by itself.
  if (project.siteSurvey) {
    for (const blocker of surveyFabricationBlockers(project.siteSurvey)) {
      blockers.push({ id: `survey-${blocker.kind}-${blocker.spaceId ?? 'all'}`, message: blocker.message });
    }
  }

  if (project.status === 'produced') {
    const stale = getProductionStaleInfo(project);
    if (stale.stale && stale.messageEs) {
      blockers.push({ id: 'stale-revision', message: stale.messageEs });
    }
  }

  for (const punch of blockingPunchItems(project.installation)) {
    blockers.push({ id: `punch-${punch.id}`, message: `Punch bloqueante: ${punch.description}` });
  }

  for (const issue of openFieldIssues(project.installation)) {
    blockers.push({ id: `field-${issue.id}`, message: `Incidencia en obra: ${issue.description}` });
  }

  return blockers;
}

export function ProjectOverviewPanel({
  project,
  nav,
  testId = 'project-overview-panel',
}: ProjectOverviewPanelProps): ReactNode {
  const stage = deriveProjectStage(project);
  const release = project.productionRelease;
  const stale = getProductionStaleInfo(project);
  const nextVisit = openInstallationVisits(project.installation)[0];
  const installationDate = nextVisit?.date ?? project.installationScheduledDate;
  const blockers = deriveBlockers(project);

  const links = [
    {
      id: 'engineering',
      label: 'Ingeniería / Release',
      icon: <Wrench strokeWidth={1.5} size={16} aria-hidden="true" />,
      detail: release
        ? `Liberada rev. ${release.projectVersion} · ${release.releasedAt.slice(0, 10)}`
        : 'Sin liberación a producción',
      href: nav.onOpenEngineering,
    },
    {
      id: 'production',
      label: 'Producción',
      icon: <Factory strokeWidth={1.5} size={16} aria-hidden="true" />,
      detail: stale.stale ? 'Diseño cambió tras el último export' : 'Abrir el hub de fábrica',
      href: nav.onOpenInProduction,
    },
    {
      id: 'shipping',
      label: 'Embarque',
      icon: <Truck strokeWidth={1.5} size={16} aria-hidden="true" />,
      detail: 'Control de carga y despacho',
      href: nav.onOpenShipments,
    },
    {
      id: 'installation',
      label: 'Instalación',
      icon: <ClipboardCheck strokeWidth={1.5} size={16} aria-hidden="true" />,
      detail: installationDate ? `Comprometida: ${installationDate}` : 'Sin fecha comprometida',
      href: nav.onOpenInstallation,
    },
  ];

  return (
    <div className="project-overview" data-testid={testId}>
      <div className="project-overview__facts">
        <div className="project-overview__fact">
          <span className="project-overview__fact-label">Etapa</span>
          <span className="project-overview__fact-value">{PROJECT_STAGE_LABELS_ES[stage]}</span>
        </div>
        <div className="project-overview__fact">
          <span className="project-overview__fact-label">Revisión liberada</span>
          <span className="project-overview__fact-value" data-testid="project-overview-release">
            {release ? `v${release.projectVersion}` : '—'}
          </span>
        </div>
        <div className="project-overview__fact">
          <span className="project-overview__fact-label">Instalación comprometida</span>
          <span className="project-overview__fact-value" data-testid="project-overview-installation">
            {installationDate ?? '—'}
          </span>
        </div>
        <div className="project-overview__fact">
          <span className="project-overview__fact-label">Levantamiento</span>
          <span className="project-overview__fact-value">
            {project.siteSurvey
              ? project.siteSurvey.verifiedAt
                ? 'Verificado'
                : 'Sin verificar'
              : '—'}
          </span>
        </div>
      </div>

      {blockers.length > 0 ? (
        <div className="project-overview__blockers" data-testid="project-overview-blockers">
          <h4 className="project-overview__blockers-title">
            <TriangleAlert strokeWidth={1.5} size={16} aria-hidden="true" /> Bloqueos ({blockers.length})
          </h4>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker.id}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="project-overview__ok" data-testid="project-overview-ok">
          <CheckCircle2 strokeWidth={1.5} size={16} aria-hidden="true" /> Sin bloqueos abiertos
        </p>
      )}

      <div className="project-overview__links">
        {links.map((link) => (
          <button
            key={link.id}
            type="button"
            className="project-overview__link"
            disabled={!link.href}
            title={link.href ? `Abrir ${link.label}` : 'No disponible en este contexto'}
            onClick={() => link.href?.(project.id)}
            data-testid={`project-overview-link-${link.id}`}
          >
            <span className="project-overview__link-icon">{link.icon}</span>
            <span className="project-overview__link-body">
              <span className="project-overview__link-label">{link.label}</span>
              <span className="project-overview__link-detail">{link.detail}</span>
            </span>
            <ArrowRight strokeWidth={1.5} size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
