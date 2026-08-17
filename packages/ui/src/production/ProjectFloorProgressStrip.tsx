import { useMemo } from 'react';

import {
  buildProjectFloorSummary,
  PRODUCTION_SECTOR_LABELS_ES,
  type ProjectFloorSummary,
  type FloorStageProgress,
} from '@muebles/domain';
import type { Project } from '@muebles/domain';

/**
 * Compact per-sector progress strip (F093 — Fase 1 visibilidad).
 * Answers "¿en qué proceso está esta obra?" for anyone with access to
 * the project (sales included). Pure presentation of
 * buildProjectFloorSummary — no floor mutation, no design data.
 */
export function ProjectFloorProgressStrip({
  project,
  testId,
}: {
  readonly project: Project;
  readonly testId?: string;
}) {
  const summary = useMemo(() => buildProjectFloorSummary(project), [project]);
  if (summary.totalItems === 0) return null;

  return (
    <div
      className="floor-strip"
      data-testid={testId ?? 'project-floor-strip'}
      role="img"
      aria-label={stripAriaLabel(summary)}
    >
      <span className="floor-strip__pct">{summary.percentage}%</span>
      <ol className="floor-strip__stages" aria-hidden>
        {summary.stages.map((stage) => (
          <FloorStripStage key={stage.sector} stage={stage} summary={summary} />
        ))}
      </ol>
    </div>
  );
}

function FloorStripStage({
  stage,
  summary,
}: {
  readonly stage: FloorStageProgress;
  readonly summary: ProjectFloorSummary;
}) {
  const done = stage.done >= stage.total;
  const active = summary.activeSector === stage.sector;
  const cls = done
    ? 'floor-strip__stage floor-strip__stage--done'
    : active
      ? 'floor-strip__stage floor-strip__stage--active'
      : 'floor-strip__stage';
  return (
    <li className={cls}>
      <span className="floor-strip__stage-label">
        {PRODUCTION_SECTOR_LABELS_ES[stage.sector]}
      </span>
      <span className="floor-strip__stage-count">
        {done ? '✓' : `${stage.done}/${stage.total}`}
      </span>
    </li>
  );
}

function stripAriaLabel(summary: ProjectFloorSummary): string {
  const active = summary.activeSector
    ? `Proceso actual: ${PRODUCTION_SECTOR_LABELS_ES[summary.activeSector]}`
    : 'Instalación completa';
  const detail = summary.stages
    .map(
      (s) =>
        `${PRODUCTION_SECTOR_LABELS_ES[s.sector]} ${s.done} de ${s.total}`,
    )
    .join(', ');
  return `${active}. Avance ${summary.percentage}%. ${detail}.`;
}

/**
 * One-line sector chip for queue cards: bottleneck sector + percentage.
 * Same derivation as the strip, tuned for dense lists.
 */
export function ProjectFloorStageChip({
  project,
  testId,
}: {
  readonly project: Project;
  readonly testId?: string;
}) {
  const summary = useMemo(() => buildProjectFloorSummary(project), [project]);
  if (summary.totalItems === 0) return null;
  const label = summary.activeSector
    ? PRODUCTION_SECTOR_LABELS_ES[summary.activeSector]
    : 'Instalado';

  return (
    <span
      className="floor-chip"
      data-testid={testId ?? `prod-stage-chip-${project.id}`}
    >
      <span className="floor-chip__label">{label}</span>
      <span className="floor-chip__pct">{summary.percentage}%</span>
    </span>
  );
}
