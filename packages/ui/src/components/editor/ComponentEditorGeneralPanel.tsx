/**
 * Component editor — General tab.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  COMPONENT_PLACEMENT_GROUPS,
  PLACEMENT_DESCRIPTION,
  type ComponentDraft,
} from '../componentDraft';

export type ComponentEditorGeneralPanelProps = {
  readonly formId: string;
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly editingId: string | null;
  readonly hidden: boolean;
};

export function ComponentEditorGeneralPanel({
  formId,
  draft,
  setDraft,
  editingId,
  hidden,
}: ComponentEditorGeneralPanelProps): ReactNode {
  const placementHint = PLACEMENT_DESCRIPTION[draft.placement];
  return (
    <div
      role="tabpanel"
      id="component-editor-panel-general"
      aria-labelledby="component-editor-tab-general"
      hidden={hidden}
      data-testid="component-editor-panel-general"
    >
      <div className="module-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-code`}>Código</label>
          <input
            id={`${formId}-code`}
            value={draft.code}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, code: e.target.value }))
            }
            placeholder="Ej: COM-PUE-01"
            required
            disabled={!!editingId}
            data-testid="input-code"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-name`}>Nombre</label>
          <input
            id={`${formId}-name`}
            value={draft.name}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="Ej: Puerta"
            required
            data-testid="input-name"
          />
        </div>
      </div>

      <div className="module-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-placement`}>Ubicación</label>
          <select
            id={`${formId}-placement`}
            value={draft.placement}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, placement: e.target.value }))
            }
            required
            data-testid="input-placement"
          >
            {COMPONENT_PLACEMENT_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {placementHint ? (
            <p
              className="component-general__placement-hint"
              data-testid="placement-hint"
            >
              {placementHint}
            </p>
          ) : null}
        </div>
      </div>

      <div className="catalog-form__field">
        <label htmlFor={`${formId}-notes`}>Notas / Descripción técnica</label>
        <textarea
          id={`${formId}-notes`}
          rows={3}
          value={draft.notes}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, notes: e.target.value }))
          }
          placeholder="Especificaciones adicionales..."
          data-testid="input-notes"
        />
      </div>
    </div>
  );
}
