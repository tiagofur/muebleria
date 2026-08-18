/**
 * Version history panel for projects (#200).
 * Shows snapshot timeline with labels, dates, and restore capability.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { History, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import type {
  Project,
  ProjectVersion,
  ProjectStatus,
} from '@muebles/domain';
import {
  currentVersion,
  diffVersions,
} from '@muebles/domain';

export type VersionHistoryPanelProps = {
  readonly project: Project;
  readonly onRestore: (version: number) => void;
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Borrador',
  quoted: 'Cotizado',
  accepted: 'Aceptado',
  produced: 'Producido',
};

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  draft: 'status-badge--draft',
  quoted: 'status-badge--quoted',
  accepted: 'status-badge--accepted',
  produced: 'status-badge--produced',
};

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'ahora mismo';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `hace ${diffD}d`;
  return new Date(iso).toLocaleDateString('es-AR');
}

function VersionCard({
  version,
  isCurrent,
  isExpanded,
  onToggle,
  onRestore,
  diff,
}: {
  readonly version: ProjectVersion;
  readonly isCurrent: boolean;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onRestore: () => void;
  readonly diff?: {
    readonly itemAdded: boolean;
    readonly itemRemoved: boolean;
    readonly itemChanged: boolean;
    readonly statusChanged: boolean;
    readonly notesChanged: boolean;
  };
}): ReactNode {
  return (
    <div
      className={`version-card${isCurrent ? ' version-card--current' : ''}`}
      data-testid={`version-card-${version.version}`}
    >
      <button
        type="button"
        className="version-card__header"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        {isExpanded ? (
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
        )}
        <span className="version-card__number">v{version.version}</span>
        <span className={`status-badge ${STATUS_CLASSES[version.status]}`}>
          {STATUS_LABELS[version.status]}
        </span>
        <span className="version-card__time">
          {formatRelativeTime(version.snapshotAt)}
        </span>
        {isCurrent && (
          <span className="version-card__current-badge">Actual</span>
        )}
      </button>

      {isExpanded && (
        <div className="version-card__details">
          {version.label && (
            <p className="version-card__label">{version.label}</p>
          )}
          <p className="version-card__meta">
            {version.items.length} mueble{version.items.length === 1 ? '' : 's'}
            {version.notes && ' · Con notas'}
            {version.kitchenLayout && ' · Plano cocina'}
          </p>
          {diff && (
            <div className="version-card__diff">
              {diff.statusChanged && (
                <span className="version-card__diff-item">Cambio de estado</span>
              )}
              {diff.itemAdded && (
                <span className="version-card__diff-item">+ Mueble(s) agregado(s)</span>
              )}
              {diff.itemRemoved && (
                <span className="version-card__diff-item">- Mueble(s) eliminado(s)</span>
              )}
              {diff.itemChanged && (
                <span className="version-card__diff-item">~ Mueble(s) modificado(s)</span>
              )}
              {diff.notesChanged && (
                <span className="version-card__diff-item">~ Notas modificadas</span>
              )}
            </div>
          )}
          {!isCurrent && (
            <button
              type="button"
              className="btn btn--small btn--ghost version-card__restore"
              onClick={onRestore}
              data-testid={`version-restore-${version.version}`}
              aria-label={`Restaurar versión ${version.version}`}
            >
              <RotateCcw size={12} strokeWidth={1.5} aria-hidden />
              Restaurar esta versión
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function VersionHistoryPanel({
  project,
  onRestore,
}: VersionHistoryPanelProps): ReactNode {
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const version = currentVersion(project);
  const history = project.history ?? [];

  const cards = useMemo(() => {
    const result: Array<{
      version: ProjectVersion;
      isCurrent: boolean;
      diff?: ReturnType<typeof diffVersions>;
    }> = [];

    // Current state (not yet snapshotted)
    result.push({
      version: {
        version,
        name: project.name,
        status: project.status,
        items: project.items,
        projectLevelChoices: project.projectLevelChoices,
        measureDefaults: project.measureDefaults,
        kitchenLayout: project.kitchenLayout,
        notes: project.notes,
        priceSnapshot: project.priceSnapshot,
        snapshotAt: project.updatedAt,
      },
      isCurrent: true,
    });

    // Historical snapshots
    for (let i = 0; i < history.length; i++) {
      const snap = history[i];
      if (!snap) continue;
      const nextSnap = i === 0 ? undefined : history[i - 1];
      const diff = nextSnap ? diffVersions(snap, nextSnap) : undefined;
      result.push({ version: snap, isCurrent: false, diff });
    }

    return result;
  }, [project, version, history]);

  if (history.length === 0) {
    return (
      <div className="version-history version-history--empty">
        <History size={16} strokeWidth={1.5} aria-hidden />
        <p className="version-history__empty-text">
          Sin versiones guardadas. Las versiones se crean automáticamente al
          cambiar de estado.
        </p>
      </div>
    );
  }

  return (
    <div className="version-history" data-testid="version-history-panel">
      <div className="version-history__header">
        <History size={16} strokeWidth={1.5} aria-hidden />
        <h3 className="version-history__title">
          Historial de versiones
        </h3>
        <span className="version-history__count">
          {history.length} versión{history.length === 1 ? '' : 'es'}
        </span>
      </div>
      <div className="version-history__list">
        {cards.map((card) => (
          <VersionCard
            key={card.version.version}
            version={card.version}
            isCurrent={card.isCurrent}
            isExpanded={expandedVersion === card.version.version}
            onToggle={() =>
              setExpandedVersion(
                expandedVersion === card.version.version
                  ? null
                  : card.version.version,
              )
            }
            onRestore={() => setRestoringVersion(card.version.version)}
            diff={card.diff}
          />
        ))}
      </div>

      <ConfirmDialog
        open={restoringVersion !== null}
        onClose={() => setRestoringVersion(null)}
        title={restoringVersion !== null ? `Restaurar versión ${restoringVersion}` : ''}
        message="Se guardará el estado actual como snapshot antes de restaurar."
        confirmLabel="Restaurar"
        tone="primary"
        onConfirm={() => {
          if (restoringVersion !== null) onRestore(restoringVersion);
        }}
        dataTestId="version-restore-confirm"
      />
    </div>
  );
}
