/**
 * Module editor — Components tab (instance list for this furniture).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Component } from '@muebles/domain';
import { Plus } from 'lucide-react';
import { COMPONENT_PLACEMENTS } from '../../components';
import type { ModuleDraft } from '../moduleHelpers';

export type ModuleEditorComponentsPanelProps = {
  readonly draft: ModuleDraft;
  readonly setDraft: Dispatch<SetStateAction<ModuleDraft>>;
  readonly catalogComponents: readonly Component[];
  readonly composedEnabled: boolean;
  readonly onRequestAdd: () => void;
  readonly hidden: boolean;
};

export function ModuleEditorComponentsPanel({
  draft,
  setDraft,
  catalogComponents,
  composedEnabled,
  onRequestAdd,
  hidden,
}: ModuleEditorComponentsPanelProps): ReactNode {
  return (
    <div
      className="module-editor__section"
      role="tabpanel"
      id="module-editor-panel-components"
      aria-labelledby="module-editor-tab-components"
      hidden={hidden}
      data-testid="module-editor-panel-components"
    >
      <div className="module-editor__section-header">
        <h4 className="module-editor__section-title">
          Componentes del mueble ({draft.components.length})
        </h4>
        <button
          type="button"
          className="btn btn--small"
          disabled={!composedEnabled}
          onClick={onRequestAdd}
          data-testid="add-component-btn"
        >
          <Plus size={14} className="mr-1" /> Agregar componente
        </button>
      </div>
      <p className="catalog-empty" style={{ marginTop: 0 }}>
        Puertas, entrepaños y otros reutilizables del catálogo. Requiere
        estructura base.
      </p>
      {!composedEnabled ? (
        <p className="catalog-empty" data-testid="composed-section">
          Seleccioná una estructura en la pestaña Estructura para agregar
          componentes.
        </p>
      ) : draft.components.length === 0 ? (
        <p className="catalog-empty" data-testid="composed-section">
          Sin componentes propios. Agregá reutilizables o cotizá solo con el
          cuerpo de la estructura.
        </p>
      ) : (
        <div className="module-part-list" data-testid="component-instance-list">
          {draft.components.map((comp, idx) => {
            const catComp = catalogComponents.find(
              (c) => c.id === comp.componentId,
            );
            return (
              <div
                key={`${comp.componentId}-${idx}`}
                className="module-part-card"
                data-testid={`component-instance-${idx}`}
              >
                <div className="module-part-card__header">
                  <h5 className="module-part-card__title">
                    {catComp
                      ? `${catComp.code} — ${catComp.name}`
                      : comp.componentId}
                  </h5>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        components: prev.components.filter((_, i) => i !== idx),
                      }));
                    }}
                    data-testid={`remove-component-${idx}`}
                  >
                    Quitar
                  </button>
                </div>
                <div className="module-editor__grid">
                  <div className="catalog-form__field module-editor__field--narrow">
                    <label>Cantidad</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={comp.quantity}
                      onChange={(e) => {
                        const qty = Math.max(1, Number(e.target.value));
                        setDraft((prev) => ({
                          ...prev,
                          components: prev.components.map((c, i) =>
                            i === idx ? { ...c, quantity: qty } : c,
                          ),
                        }));
                      }}
                      data-testid={`component-qty-${idx}`}
                    />
                  </div>
                  <div className="catalog-form__field">
                    <label>Ubicación (opcional)</label>
                    <select
                      value={comp.placementOverride ?? ''}
                      onChange={(e) => {
                        setDraft((prev) => ({
                          ...prev,
                          components: prev.components.map((c, i) =>
                            i === idx
                              ? {
                                  ...c,
                                  placementOverride:
                                    e.target.value || undefined,
                                }
                              : c,
                          ),
                        }));
                      }}
                      data-testid={`component-placement-${idx}`}
                    >
                      <option value="">— Del componente —</option>
                      {COMPONENT_PLACEMENTS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
