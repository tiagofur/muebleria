/**
 * Production order revision / stale-export detection (PROD-3.2 / #227).
 *
 * Design fingerprint covers quote items + kitchen placements (not floor status).
 * Export is stale when last export fingerprint ≠ current design fingerprint.
 */

import type {
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProjectProductionState,
} from './types';
import { ensureKitchenSpaces, isFreePlacement } from './kitchenLayout';

function stableChoices(choices: ProjectItem['optionChoices']): string {
  const keys = Object.keys(choices).sort();
  return keys.map((k) => `${k}=${choices[k] ?? ''}`).join('&');
}

function placementToken(p: ProjectItemPlacement): string {
  if (isFreePlacement(p)) {
    return `${p.itemId}#${p.instanceIndex}@free:${p.freeXMm ?? 0}:${p.freeYMm ?? 0}:${p.freeYawDeg ?? 0}`;
  }
  return `${p.itemId}#${p.instanceIndex}@${p.wallId}:${p.offsetMm}:${p.elevation}:${p.mode ?? 'wall'}`;
}

/**
 * Design fingerprint for kitchen plan. Covers all spaces + free coords.
 * Ignores activeSpaceId (view-only; not a design change).
 */
function placementFingerprint(project: Project): string {
  const layout = project.kitchenLayout;
  if (!layout) return '';
  const ensured = ensureKitchenSpaces(layout);
  const spaces = ensured.spaces ?? [];

  if (spaces.length > 0) {
    const spaceParts = spaces
      .map((space) => {
        const walls = [...space.walls]
          .map((w) => `${w.id}:${w.lengthMm}:${w.angleDeg}`)
          .sort()
          .join('|');
        const placements = [...space.placements]
          .map((p) => placementToken(p))
          .sort()
          .join('|');
        return `${space.id}{w=${walls};p=${placements}}`;
      })
      .sort();
    return spaceParts.join(';');
  }

  const placements = [...(ensured.placements ?? [])]
    .map((p) => placementToken(p))
    .sort();
  const walls = [...(ensured.walls ?? [])]
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
      // F144: free per-item dims are a design change — they must turn a
      // frozen production revision stale. Token only when present so legacy
      // fingerprints stay byte-identical (no mass false-stale on upgrade).
      const dimsToken = it.customDims
        ? `|d=${it.customDims.widthMm}x${it.customDims.heightMm}x${it.customDims.depthMm}`
        : '';
      return `${it.id}|${it.moduleId}|q=${it.quantity}|m=${preset}|pin=${pin}${dimsToken}|c=${stableChoices(it.optionChoices)}`;
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
