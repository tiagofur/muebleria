/**
 * Production order revision / stale-export detection (PROD-3.2 / #227).
 *
 * Design fingerprint covers quote items + kitchen placements (not floor status).
 * Export is stale when last export fingerprint ≠ current design fingerprint.
 */

import type { Project, ProjectItem, ProjectProductionState } from './types';

function stableChoices(choices: ProjectItem['optionChoices']): string {
  const keys = Object.keys(choices).sort();
  return keys.map((k) => `${k}=${choices[k] ?? ''}`).join('&');
}

function placementFingerprint(project: Project): string {
  const layout = project.kitchenLayout;
  if (!layout) return '';
  const placements = [...(layout.placements ?? [])]
    .map(
      (p) =>
        `${p.itemId}#${p.instanceIndex}@${p.wallId}:${p.offsetMm}:${p.elevation}:${p.mode ?? 'wall'}`,
    )
    .sort();
  const walls = [...(layout.walls ?? [])]
    .map((w) => `${w.id}:${w.lengthMm}:${w.angleDeg}`)
    .sort();
  return `w=${walls.join('|')};p=${placements.join('|')}`;
}

/**
 * Stable design fingerprint for production staleness.
 * Ignores floorStatus, notes, nestingImport, and commercial fields.
 */
export function computeProductionDesignFingerprint(project: Project): string {
  const items = [...project.items]
    .map((it) => {
      const preset = it.measurePresetId?.trim() || '';
      const pin =
        it.structureRevisionPin != null ? String(it.structureRevisionPin) : '';
      return `${it.id}|${it.moduleId}|q=${it.quantity}|m=${preset}|pin=${pin}|c=${stableChoices(it.optionChoices)}`;
    })
    .sort();
  const level = project.projectLevelChoices
    ? stableChoices(project.projectLevelChoices)
    : '';
  return `items=[${items.join(';')}];level={${level}};plan={${placementFingerprint(project)}}`;
}

/** Ensure production state exists (revision ≥ 1) when entering plant-ready. */
export function ensureProductionRevision(
  project: Project,
  nowIso: string,
): Project {
  const fingerprint = computeProductionDesignFingerprint(project);
  const existing = project.production;
  if (existing && existing.revision >= 1) {
    // Bump revision when design fingerprint diverged from freeze fingerprint.
    if (
      existing.fingerprint &&
      existing.fingerprint !== fingerprint
    ) {
      return {
        ...project,
        production: {
          ...existing,
          revision: existing.revision + 1,
          revisionAt: nowIso,
          fingerprint,
        },
      };
    }
    return project;
  }
  const production: ProjectProductionState = {
    revision: 1,
    revisionAt: nowIso,
    fingerprint,
  };
  return { ...project, production };
}

/** Record a factory export (pack / optimizer / etc.) against current design. */
export function recordProductionExport(
  project: Project,
  nowIso: string,
): Project {
  const fingerprint = computeProductionDesignFingerprint(project);
  const base = ensureProductionRevision(project, nowIso);
  const rev = base.production!.revision;
  return {
    ...base,
    production: {
      ...base.production!,
      fingerprint,
      lastExportRevision: rev,
      lastExportAt: nowIso,
      lastExportFingerprint: fingerprint,
    },
  };
}

export type ProductionStaleInfo = {
  readonly stale: boolean;
  readonly revision: number;
  readonly lastExportRevision: number | null;
  readonly lastExportAt: string | null;
  readonly neverExported: boolean;
  readonly messageEs: string | null;
};

/**
 * Whether the last factory export may not match current design.
 * neverExported → not "stale", but UI may still prompt first export.
 */
export function getProductionStaleInfo(project: Project): ProductionStaleInfo {
  const production = project.production;
  const revision = production?.revision ?? 0;
  const lastExportRevision = production?.lastExportRevision ?? null;
  const lastExportAt = production?.lastExportAt ?? null;
  const neverExported = !production?.lastExportFingerprint;

  if (neverExported) {
    return {
      stale: false,
      revision,
      lastExportRevision,
      lastExportAt,
      neverExported: true,
      messageEs: null,
    };
  }

  const current = computeProductionDesignFingerprint(project);
  const stale = current !== production!.lastExportFingerprint;
  return {
    stale,
    revision,
    lastExportRevision,
    lastExportAt,
    neverExported: false,
    messageEs: stale
      ? 'El diseño cambió después del último export de producción. Regenerá el pack antes de cortar.'
      : null,
  };
}
