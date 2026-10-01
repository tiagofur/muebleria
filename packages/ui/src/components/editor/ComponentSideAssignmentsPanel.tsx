/**
 * #915 UI: per-face hardware profile assignments — one row per canonical
 * board face; choosing a profile persists immediately (PUT), removing
 * restores inheritance (DELETE). Presentational: data and writes come from
 * the caller's hook. The mounting face and the tool entry face stay recipe
 * concerns — this panel only declares which solution applies per face.
 */

import type { ReactNode } from 'react';
import type { BoardFace } from '@granete/domain';
import { Layers } from 'lucide-react';

export interface ComponentSideAssignmentView {
  readonly side: string;
  readonly profileId: string;
}

export interface ComponentProfileOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly revision: string;
  readonly active: boolean;
}

const FACE_LABELS: readonly { value: BoardFace; label: string }[] = [
  { value: 'front', label: 'Frontal' },
  { value: 'back', label: 'Posterior' },
  { value: 'left', label: 'Izquierda' },
  { value: 'right', label: 'Derecha' },
  { value: 'top', label: 'Superior' },
  { value: 'bottom', label: 'Inferior' },
];

export interface ComponentSideAssignmentsPanelProps {
  readonly hidden: boolean;
  /** Saved component id; null (new component) renders the save-first hint. */
  readonly componentId: string | null;
  readonly authenticated: boolean;
  readonly assignments: readonly ComponentSideAssignmentView[];
  readonly profiles: readonly ComponentProfileOption[];
  readonly canMutate: boolean;
  readonly savingSide: string | null;
  readonly error: string | null;
  readonly onSet: (side: BoardFace, profileId: string) => void | Promise<void>;
  readonly onRemove: (side: BoardFace) => void | Promise<void>;
}

export function ComponentSideAssignmentsPanel({
  hidden,
  componentId,
  authenticated,
  assignments,
  profiles,
  canMutate,
  savingSide,
  error,
  onSet,
  onRemove,
}: ComponentSideAssignmentsPanelProps): ReactNode {
  if (hidden) return null;

  const assignedBySide = new Map(assignments.map((a) => [a.side, a.profileId]));
  const selectable = profiles.filter((p) => p.active);

  return (
    <section
      aria-label="Perfiles por cara"
      style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
      data-testid="component-side-assignments-panel"
    >
      <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
        <Layers size={14} strokeWidth={1.5} aria-hidden />
        Perfiles de herrajes por cara
      </h3>
      <p className="catalog-form__hint" style={{ margin: 0 }}>
        Declará qué perfil aplica a cada cara canónica del componente. La cara de montaje la verifica el contacto y la
        cara de entrada de herramienta la define la receta.
      </p>

      {!authenticated ? (
        <p className="catalog-form__hint" data-testid="side-assignments-auth-hint">
          Iniciá sesión para asignar perfiles por cara.
        </p>
      ) : !componentId ? (
        <p className="catalog-form__hint" data-testid="side-assignments-save-hint">
          Guardá el componente para asignar perfiles por cara.
        </p>
      ) : (
        <>
          {error ? (
            <p className="catalog-form__error" data-testid="side-assignments-error">
              {error}
            </p>
          ) : null}
          {FACE_LABELS.map(({ value, label }) => {
            const assigned = assignedBySide.get(value);
            const saving = savingSide === value;
            return (
              <div
                key={value}
                className="catalog-form__row"
                style={{ alignItems: 'center', gap: 'var(--space-2)' }}
                data-testid={`side-assignment-row-${value}`}
              >
                <label className="catalog-form__field" style={{ flex: 1 }}>
                  <span>{label}</span>
                  <select
                    value={assigned ?? ''}
                    disabled={!canMutate || saving}
                    onChange={(e) => {
                      const profileId = e.target.value;
                      if (profileId === '') {
                        if (assigned) void onRemove(value);
                        return;
                      }
                      void onSet(value, profileId);
                    }}
                    data-testid={`side-assignment-select-${value}`}
                  >
                    <option value="">— Heredado (sin perfil) —</option>
                    {selectable.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.code} — {profile.name} ({profile.revision})
                      </option>
                    ))}
                  </select>
                </label>
                {assigned ? (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost btn--danger"
                    disabled={!canMutate || saving}
                    onClick={() => void onRemove(value)}
                    data-testid={`side-assignment-remove-${value}`}
                  >
                    Quitar
                  </button>
                ) : null}
                {saving ? (
                  <span className="catalog-form__hint">Guardando…</span>
                ) : null}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
