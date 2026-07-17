/**
 * Simple installation checklist on a project (#139).
 */

import { useMemo, type ReactNode } from 'react';
import type {
  InstallationChecklistItem,
  Project,
} from '@muebles/domain';
import { DEFAULT_INSTALLATION_CHECKLIST } from '@muebles/domain';

export type InstallationChecklistPanelProps = {
  readonly project: Project;
  readonly canEdit: boolean;
  readonly onChange: (items: readonly InstallationChecklistItem[]) => void;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function InstallationChecklistPanel({
  project,
  canEdit,
  onChange,
}: InstallationChecklistPanelProps): ReactNode {
  const items = useMemo(() => {
    if (project.installationChecklist && project.installationChecklist.length > 0) {
      return project.installationChecklist;
    }
    return DEFAULT_INSTALLATION_CHECKLIST.map((c) => ({
      id: newId(),
      label: c.label,
      done: c.done,
    }));
  }, [project.installationChecklist]);

  // Seed default into parent once when empty so it persists
  const ensureSeeded = () => {
    if (
      !project.installationChecklist ||
      project.installationChecklist.length === 0
    ) {
      onChange(
        DEFAULT_INSTALLATION_CHECKLIST.map((c) => ({
          id: newId(),
          label: c.label,
          done: false,
        })),
      );
    }
  };

  const toggle = (id: string) => {
    ensureSeeded();
    const base =
      project.installationChecklist && project.installationChecklist.length > 0
        ? project.installationChecklist
        : items;
    onChange(
      base.map((c) => (c.id === id ? { ...c, done: !c.done } : c)),
    );
  };

  const doneCount = items.filter((c) => c.done).length;

  return (
    <div
      className="project-detail__section"
      data-testid="installation-checklist"
    >
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">
          Checklist de instalación ({doneCount}/{items.length})
        </h3>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((c) => (
          <li key={c.id} style={{ marginBottom: 8 }}>
            <label
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                cursor: canEdit ? 'pointer' : 'default',
              }}
            >
              <input
                type="checkbox"
                checked={c.done}
                disabled={!canEdit}
                onChange={() => {
                  if (!canEdit) return;
                  if (
                    !project.installationChecklist ||
                    project.installationChecklist.length === 0
                  ) {
                    const seeded = DEFAULT_INSTALLATION_CHECKLIST.map((d) => ({
                      id: newId(),
                      label: d.label,
                      done: d.label === c.label,
                    }));
                    onChange(seeded);
                    return;
                  }
                  toggle(c.id);
                }}
                data-testid={`checklist-item-${c.id}`}
              />
              <span
                style={{
                  textDecoration: c.done ? 'line-through' : undefined,
                  opacity: c.done ? 0.65 : 1,
                }}
              >
                {c.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
