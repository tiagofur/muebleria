/**
 * Operations exceptions (OC-090) — pure cross-project derivation of what
 * needs attention right now: installation at risk, material shortages, stale
 * production revisions, stalled queues, high WIP, open QC/rework, cost
 * overruns and preliminary measures that would silently reach fabrication.
 *
 * Every exception is actionable (message + actionHint + project deep link)
 * and carries a Data Truth label. Reference: docs/operational-core-v1.md §12,
 * docs/operational-ux.md §2.3/§11, issue #305.
 */

import type { Project } from './types';
import { getProductionStaleInfo } from './productionRevision';
import { surveyFabricationBlockers } from './siteSurvey';
import {
  openFieldIssues,
  openInstallationVisits,
  blockingPunchItems,
} from './installation';
import { openQualityIssues, reworkCostSummary } from './quality';
import { computeJobCostSummary } from './jobCosting';

export const OPS_EXCEPTION_KINDS = [
  'installation_risk',
  'survey_preliminary',
  'material_shortage',
  'stale_revision',
  'stalled_queue',
  'high_wip',
  'qc_rework',
  'cost_overrun',
] as const;
export type OpsExceptionKind = (typeof OPS_EXCEPTION_KINDS)[number];

export type OpsExceptionSeverity = 'critical' | 'warning' | 'info';

export interface OpsException {
  readonly kind: OpsExceptionKind;
  readonly severity: OpsExceptionSeverity;
  readonly projectId: string;
  readonly projectName: string;
  readonly message: string;
  readonly actionHint: string;
  readonly truth: 'actual' | 'estimated' | 'proxy' | 'missing';
}

export interface OpsExceptionsOptions {
  readonly now?: string;
  /** Open shortage lines per project (computed by the shell from stock + planning). */
  readonly shortageLines?: ReadonlyMap<string, number>;
  /** Material consumption inputs for the cost variance roll-up (server-valued). */
  readonly materialConsumptions?: ReadonlyMap<string, number>;
  /** Part instances currently in progress per project (cut/cnc/edge WIP). */
  readonly wipPartCounts?: ReadonlyMap<string, number>;
  /** WIP threshold per project before flagging high_wip. */
  readonly wipThreshold?: number;
  /** Stalled window in days without lifecycle events for active projects. */
  readonly stalledDays?: number;
  /** Cost variance percent threshold (actual vs estimated) before flagging. */
  readonly costOverrunPercent?: number;
}

const SEVERITY_ORDER: Readonly<Record<OpsExceptionSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return (to - from) / 86_400_000;
}

function lastEventAt(project: Project): string | null {
  const events = project.events ?? [];
  let last: string | null = null;
  for (const e of events) {
    if (!last || e.at > last) last = e.at;
  }
  return last;
}

/* ── Per-kind derivations ──────────────────────────────────────────────────── */

function installationRiskExceptions(
  project: Project,
  now: string,
): readonly OpsException[] {
  const out: OpsException[] = [];
  const due = project.installationScheduledDate;
  const visit = openInstallationVisits(project.installation)[0];
  const blockers = blockingPunchItems(project.installation).length;
  const openIssues = openFieldIssues(project.installation).length;
  const target = visit?.date ?? due;
  if (!target) {
    if (project.status === 'produced' && (blockers > 0 || openIssues > 0)) {
      out.push({
        kind: 'installation_risk',
        severity: 'warning',
        projectId: project.id,
        projectName: project.name,
        message: 'Obra producida con punch/incidencias abiertas y sin fecha de instalación comprometida',
        actionHint: 'Agendar la instalación en la obra',
        truth: 'actual',
      });
    }
    return out;
  }
  const days = daysBetween(now.slice(0, 10), target);
  if (days < 0) {
    out.push({
      kind: 'installation_risk',
      severity: 'critical',
      projectId: project.id,
      projectName: project.name,
      message: `Instalación comprometida el ${target} está vencida (${Math.abs(Math.round(days))} días)`,
      actionHint: 'Abrir la instalación y reprogramar o cerrar',
      truth: 'actual',
    });
    return out;
  }
  if (days <= 7) {
    const punchSuffix = blockers > 0 ? ` · ${blockers} punch bloqueantes` : '';
    const issueSuffix = openIssues > 0 ? ` · ${openIssues} incidencias abiertas` : '';
    out.push({
      kind: 'installation_risk',
      severity: days <= 3 ? 'critical' : 'warning',
      projectId: project.id,
      projectName: project.name,
      message: `Instalación ${visit ? 'con visita' : 'comprometida'} el ${target} (${Math.round(days)} días)${punchSuffix}${issueSuffix}`,
      actionHint: 'Abrir la instalación y preparar la visita',
      truth: 'actual',
    });
  }
  return out;
}

function surveyPreliminaryExceptions(project: Project): readonly OpsException[] {
  if (!project.siteSurvey) return [];
  const blockers = surveyFabricationBlockers(project.siteSurvey);
  if (blockers.length === 0) return [];
  const preliminary = blockers.filter((b) => b.kind === 'preliminary_space');
  const kind = preliminary.length > 0 ? 'medidas preliminares' : 'medidas sin aprobar';
  return [
    {
      kind: 'survey_preliminary',
      severity: 'critical',
      projectId: project.id,
      projectName: project.name,
      message: `Levantamiento con ${kind}: ${blockers[0]!.message}`,
      actionHint: 'Resolver en Levantamiento (aprobación: ingeniería)',
      truth: 'actual',
    },
  ];
}

function staleRevisionExceptions(project: Project): readonly OpsException[] {
  if (project.status !== 'produced') return [];
  const stale = getProductionStaleInfo(project);
  if (!stale.stale) return [];
  return [
    {
      kind: 'stale_revision',
      severity: 'critical',
      projectId: project.id,
      projectName: project.name,
      message: `Diseño cambió tras la última liberación (rev. ${stale.revision} ≠ exportada ${stale.lastExportRevision ?? '—'})`,
      actionHint: 'Regenerar el pack de producción antes de cortar',
      truth: 'actual',
    },
  ];
}

function stalledQueueExceptions(
  project: Project,
  now: string,
  stalledDays: number,
): readonly OpsException[] {
  if (project.status !== 'accepted') return [];
  const last = lastEventAt(project);
  if (!last) return [];
  const idle = daysBetween(last, now);
  if (idle < stalledDays) return [];
  return [
    {
      kind: 'stalled_queue',
      severity: 'warning',
      projectId: project.id,
      projectName: project.name,
      message: `Obra aceptada sin avance hace ${Math.round(idle)} días (último evento ${last.slice(0, 10)})`,
      actionHint: 'Revisar la obra: ingeniería o release frenados',
      truth: 'actual',
    },
  ];
}

function highWipExceptions(
  project: Project,
  wipCounts: ReadonlyMap<string, number>,
  threshold: number,
): readonly OpsException[] {
  const count = wipCounts.get(project.id);
  if (count === undefined || count <= threshold) return [];
  return [
    {
      kind: 'high_wip',
      severity: 'warning',
      projectId: project.id,
      projectName: project.name,
      message: `${count} piezas en proceso (umbral ${threshold}) — WIP alto en corte/CNC/enchape`,
      actionHint: 'Priorizar terminado antes de empezar más piezas',
      truth: 'actual',
    },
  ];
}

function qcReworkExceptions(project: Project): readonly OpsException[] {
  const open = openQualityIssues(project.quality);
  if (open.length === 0) return [];
  return [
    {
      kind: 'qc_rework',
      severity: 'warning',
      projectId: project.id,
      projectName: project.name,
      message: `${open.length} issue${open.length === 1 ? '' : 's'} de calidad abiertos`,
      actionHint: 'Abrir Producción → QC de la obra',
      truth: 'actual',
    },
  ];
}

function costOverrunExceptions(
  project: Project,
  materialConsumptions: ReadonlyMap<string, number>,
  overrunPercent: number,
): readonly OpsException[] {
  const costing = project.costing;
  if (!costing?.baseline) return [];
  const rework = reworkCostSummary(project.quality);
  const materialTotal = materialConsumptions.get(project.id);
  const input = {
    baseline: costing.baseline,
    timeEntries: costing.timeEntries,
    laborRatePerHour: costing.laborRatePerHour,
    rework: { materialCost: rework.materialCost, laborMinutes: rework.laborMinutes },
    otherCosts: costing.otherCosts,
    ...(materialTotal !== undefined
      ? {
          material: {
            lines: [
              {
                materialId: '__aggregate__',
                quantity: 1,
                unitCost: materialTotal,
                amount: materialTotal,
                basis: 'catalog' as const,
                truth: 'proxy' as const,
              },
            ],
            total: materialTotal,
            truth: 'proxy' as const,
            missingValuationMaterialIds: [] as string[],
          },
        }
      : {}),
  };
  const summary = computeJobCostSummary(input);
  if (summary.variance == null || summary.estimatedDirectCost == null) return [];
  const percent = (summary.variance / summary.estimatedDirectCost) * 100;
  if (percent <= overrunPercent) return [];
  return [
    {
      kind: 'cost_overrun',
      severity: percent >= overrunPercent * 2 ? 'critical' : 'warning',
      projectId: project.id,
      projectName: project.name,
      message: `Costo real ${Math.round(percent)}% sobre el estimado (varianza ${Math.round(summary.variance)})`,
      actionHint: 'Abrir Costos de la obra y revisar desvíos',
      truth: materialTotal === undefined ? 'missing' : 'proxy',
    },
  ];
}

/* ── Aggregate ─────────────────────────────────────────────────────────────── */

/**
 * Derive the owner/manager exception list across projects (OC-090). Pure and
 * tolerant: each project contributes only the exceptions its real data
 * supports — no invented KPIs, no decorative cards.
 */
export function deriveOpsExceptions(
  projects: readonly Project[],
  options: OpsExceptionsOptions = {},
): readonly OpsException[] {
  const now = options.now ?? new Date().toISOString();
  const stalledDays = options.stalledDays ?? 14;
  const wipThreshold = options.wipThreshold ?? 20;
  const overrunPercent = options.costOverrunPercent ?? 10;
  const shortages = options.shortageLines ?? new Map<string, number>();
  const wipCounts = options.wipPartCounts ?? new Map<string, number>();
  const materials = options.materialConsumptions ?? new Map<string, number>();

  const out: OpsException[] = [];
  for (const project of projects) {
    if (project.status !== 'accepted' && project.status !== 'produced') continue;
    out.push(...installationRiskExceptions(project, now));
    out.push(...surveyPreliminaryExceptions(project));
    out.push(...staleRevisionExceptions(project));
    out.push(...stalledQueueExceptions(project, now, stalledDays));
    out.push(...highWipExceptions(project, wipCounts, wipThreshold));
    out.push(...qcReworkExceptions(project));
    out.push(...costOverrunExceptions(project, materials, overrunPercent));

    const shortage = shortages.get(project.id);
    if (shortage !== undefined && shortage > 0) {
      out.push({
        kind: 'material_shortage',
        severity: 'critical',
        projectId: project.id,
        projectName: project.name,
        message: `${shortage} líneas de material con faltante para la obra`,
        actionHint: 'Abrir Almacén → planificación de la obra y generar OC',
        truth: 'actual',
      });
    }
  }
  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.projectId.localeCompare(b.projectId),
  );
}
