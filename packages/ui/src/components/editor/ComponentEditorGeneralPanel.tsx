/**
 * Component editor — General tab.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  COMPONENT_PLACEMENT_GROUPS,
  PLACEMENT_DESCRIPTION,
  sizeFormulasForPlacement,
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
  const convention = sizeFormulasForPlacement(draft.placement);
  const canApplyConvention =
    convention != null &&
    !draft.lengthFormula.trim() &&
    !draft.widthFormula.trim();

  return (
    <div
      role="tabpanel"
      id="component-editor-panel-general"
      aria-labelledby="component-editor-tab-general"
      hidden={hidden}
      data-testid="component-editor-panel-general"
      className="component-general__workspace"
    >
      <div className="component-general__main">
        <div className="component-general__card">
          <h3 className="component-general__card-title">Identidad del componente</h3>

          <div className="component-general__form-row">
            <div className="catalog-form__field component-general__field--code">
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
                aria-describedby={
                  editingId ? `${formId}-code-hint` : undefined
                }
              />
              {editingId ? (
                <p
                  id={`${formId}-code-hint`}
                  className="catalog-form__hint"
                  data-testid="input-code-hint"
                >
                  El código no se cambia al editar (identifica la pieza en el
                  catálogo).
                </p>
              ) : null}
            </div>

            <div className="catalog-form__field component-general__field--name">
              <label htmlFor={`${formId}-name`}>Nombre</label>
              <input
                id={`${formId}-name`}
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Ej: Puerta principal de gabinete"
                required
                data-testid="input-name"
              />
            </div>
          </div>

          <div className="catalog-form__field">
            <label htmlFor={`${formId}-placement`}>Ubicación / Posición de montaje</label>
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
          </div>

          <div className="catalog-form__field">
            <label htmlFor={`${formId}-notes`}>Notas / Descripción técnica</label>
            <textarea
              id={`${formId}-notes`}
              rows={4}
              value={draft.notes}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Especificaciones adicionales de fabricación o ensamble..."
              data-testid="input-notes"
            />
          </div>
        </div>
      </div>

      <div className="component-general__aside">
        <div className="component-general__card component-general__card--aside">
          <h3 className="component-general__card-title">Guía de Ubicación y Convenciones</h3>

          {placementHint ? (
            <div className="component-general__hint-box">
              <p
                className="component-general__placement-hint"
                data-testid="placement-hint"
              >
                {placementHint}
              </p>
            </div>
          ) : null}

          {convention ? (
            <div className="component-general__convention">
              <div className="component-general__convention-box">
                <span className="component-general__convention-label">
                  Convención de tamaño sugerida ({draft.placement}):
                </span>
                <div className="component-general__convention-formulas">
                  <div><span>Largo =</span> <code>{convention.lengthFormula}</code></div>
                  <div><span>Ancho =</span> <code>{convention.widthFormula}</code></div>
                </div>
                <p className="catalog-form__hint">
                  {canApplyConvention
                    ? 'Fórmulas de geometría vacías en este borrador.'
                    : 'Aplica solo si deseas sobreescribir las fórmulas de geometría.'}
                </p>
              </div>

              {canApplyConvention ? (
                <button
                  type="button"
                  className="btn btn--small component-general__convention-btn"
                  data-testid="apply-placement-convention"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      lengthFormula: convention.lengthFormula,
                      widthFormula: convention.widthFormula,
                    }))
                  }
                >
                  Aplicar convención en geometría
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
