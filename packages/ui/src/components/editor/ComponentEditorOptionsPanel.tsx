/**
 * Component editor — option roles tab.
 *
 * Roles are picked via toggle chips (one per option group) instead of the old
 * touch-hostile native <select multiple>. Each chip shows the group kind
 * (Tablero / Herraje / Canto) as a badge and toggles inclusion on click.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { OptionGroup } from '@muebles/domain';
import type { ComponentDraft } from '../componentDraft';

export type ComponentEditorOptionsPanelProps = {
  readonly formId: string;
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly optionGroups: readonly OptionGroup[];
  readonly hidden: boolean;
};

function kindLabel(kind: OptionGroup['kind']): string {
  switch (kind) {
    case 'board':
      return 'Tablero';
    case 'hardware':
      return 'Herraje';
    case 'edge':
      return 'Canto';
    default:
      return kind;
  }
}

export function ComponentEditorOptionsPanel({
  draft,
  setDraft,
  optionGroups,
  hidden,
}: ComponentEditorOptionsPanelProps): ReactNode {
  const selected = draft.optionRoles
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const toggle = (code: string) => {
    const upper = code.toUpperCase();
    const next = selected.includes(upper)
      ? selected.filter((c) => c !== upper)
      : [...selected, upper];
    setDraft((prev) => ({ ...prev, optionRoles: next.join(', ') }));
  };

  return (
    <div
      role="tabpanel"
      id="component-editor-panel-options"
      aria-labelledby="component-editor-tab-options"
      hidden={hidden}
      data-testid="component-editor-panel-options"
    >
      <p className="component-options__intro">
        Elegí a qué grupos pertenece esta pieza. Cada grupo define qué material o
        herraje aplica al componente.
      </p>

      <div
        className="component-options__chips"
        role="group"
        aria-label="Roles de opción"
        data-testid="input-optionRoles"
      >
        {optionGroups.length === 0 ? (
          <p className="component-options__empty">
            No hay grupos de opciones definidos. Creá grupos en la sección
            correspondiente para asignarlos acá.
          </p>
        ) : (
          optionGroups.map((g) => {
            const active = selected.includes(g.code.toUpperCase());
            return (
              <button
                key={g.id}
                type="button"
                className={
                  'component-options__chip' +
                  (active ? ' component-options__chip--on' : '')
                }
                aria-pressed={active}
                data-testid={`option-role-${g.code}`}
                onClick={() => toggle(g.code)}
              >
                <span
                  className={
                    'component-options__chip-kind component-options__chip-kind--' +
                    g.kind
                  }
                >
                  {kindLabel(g.kind)}
                </span>
                <span className="component-options__chip-code">{g.code}</span>
                <span className="component-options__chip-name">{g.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
