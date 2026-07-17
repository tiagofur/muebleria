/**
 * Structure editor — component instances tab.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Component } from '@muebles/domain';
import { Plus } from 'lucide-react';
import { COMPONENT_PLACEMENTS } from '../../components';
import type { StructureDraft } from '../structureDraft';

export type StructureEditorComponentsPanelProps = {
  readonly draft: StructureDraft;
  readonly setDraft: Dispatch<SetStateAction<StructureDraft>>;
  readonly catalogComponents: readonly Component[];
  readonly onRequestAdd: () => void;
  readonly hidden: boolean;
};

export function StructureEditorComponentsPanel({
  draft,
  setDraft,
  catalogComponents,
  onRequestAdd,
  hidden,
}: StructureEditorComponentsPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="structure-editor-panel-components"
      aria-labelledby="structure-editor-tab-components"
      hidden={hidden}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h4 className="module-editor__section-title" style={{ margin: 0 }}>
          Componentes ({draft.components.length})
        </h4>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={onRequestAdd}
          data-testid="add-component-btn"
        >
          <Plus size={14} className="mr-1" /> Agregar componente
        </button>
      </div>

      {draft.components.length === 0 ? (
        <p className="catalog-empty" style={{ fontSize: 'var(--text-sm)' }}>
          Sin componentes. Agregá componentes reutilizables a esta estructura
          compuesta.
        </p>
      ) : (
        <div data-testid="component-instance-list">
          {draft.components.map((comp, idx) => {
            const catComp = catalogComponents.find(
              (c) => c.id === comp.componentId,
            );
            return (
              <div
                key={`${comp.componentId}-${idx}`}
                className="module-part-card"
                style={{ marginBottom: '0.5rem' }}
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
                                  placementOverride: e.target.value || undefined,
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
