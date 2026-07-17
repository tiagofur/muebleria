/**
 * Component editor — option roles tab.
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

export function ComponentEditorOptionsPanel({
  formId,
  draft,
  setDraft,
  optionGroups,
  hidden,
}: ComponentEditorOptionsPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="component-editor-panel-options"
      aria-labelledby="component-editor-tab-options"
      hidden={hidden}
      data-testid="component-editor-panel-options"
    >
      <div className="catalog-form__field">
        <label htmlFor={`${formId}-optionRoles`}>Roles de Opción</label>
        <select
          id={`${formId}-optionRoles`}
          multiple
          value={draft.optionRoles
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)}
          onChange={(e) => {
            const selected = Array.from(
              e.target.selectedOptions,
              (opt) => opt.value,
            );
            setDraft((prev) => ({
              ...prev,
              optionRoles: selected.join(', '),
            }));
          }}
          required
          data-testid="input-optionRoles"
          className="catalog-form__multi-select"
        >
          {optionGroups.map((g) => (
            <option key={g.id} value={g.code}>
              {g.code} — {g.name} (
              {g.kind === 'board'
                ? 'Tablero'
                : g.kind === 'hardware'
                  ? 'Herraje'
                  : 'Canto'}
              )
            </option>
          ))}
        </select>
        <p className="text-small text-muted mt-1">
          Grupos de opciones que aplican a este componente. Mantené Ctrl/Cmd para
          seleccionar múltiples.
        </p>
      </div>
    </div>
  );
}
