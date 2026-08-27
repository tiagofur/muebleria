/**
 * Component editor — option roles tab.
 *
 * #403 / MT-2: a board component follows exactly ONE material selection, so
 * role selection is exclusive (clicking a group replaces the current binding;
 * clicking the active group clears it). Roles are shown as chips with the
 * group kind badge and the workshop-facing group name. Drafts authored before
 * this contract may carry several roles: they stay visible and an inline
 * warning surfaces the ambiguity instead of silently honoring only the first.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { hasAmbiguousOptionRoles } from '@granete/domain';
import type { OptionGroup } from '@granete/domain';
import type { ComponentDraft } from '../componentDraft';
import { optionRolesSummary } from '../../optionGroups/optionRoleLabel';

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

  // Exclusive selection: the binding role is single (#403). Clicking the
  // active chip clears it; clicking another replaces the previous binding.
  const toggle = (code: string) => {
    const upper = code.toUpperCase();
    const next = selected.includes(upper)
      ? selected.filter((c) => c !== upper)
      : [upper];
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
        Elegí qué selección de material sigue esta pieza. Una pieza de tablero
        sigue un único rol: todas las piezas con el mismo rol cambian juntas de
        material.
      </p>

      {hasAmbiguousOptionRoles(draft.optionRoles.split(',')) ? (
        <p
          className="component-options__warning"
          data-testid="component-options-ambiguity-warning"
          role="alert"
        >
          Este componente tiene varios roles declarados (
          {optionRolesSummary(selected, optionGroups)}). El motor usa sólo el
          primero y el resto quedaría sin efecto. Dejá un único rol.
        </p>
      ) : null}

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
