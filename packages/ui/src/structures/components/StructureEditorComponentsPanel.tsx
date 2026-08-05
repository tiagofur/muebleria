/**
 * Structure editor — component instances tab.
 */

import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Component } from '@muebles/domain';
import { AlertTriangle, Plus } from 'lucide-react';
import { COMPONENT_PLACEMENTS } from '../../components';
import { Furniture3DViewer } from '../../common';
import { InstanceOverridesEditor } from '../../modules/components/InstanceOverridesEditor';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveStructure3DPreview } from '../structure3dPreview';
import type { StructureDraft } from '../structureDraft';

export type StructureEditorComponentsPanelProps = {
  readonly draft: StructureDraft;
  readonly setDraft: Dispatch<SetStateAction<StructureDraft>>;
  readonly catalogComponents: readonly Component[];
  readonly onRequestAdd: () => void;
  readonly hidden: boolean;
  readonly catalogInput?: Module3DCatalogInput;
  readonly previewPresetId?: string;
  readonly onPreviewPresetChange?: (id: string) => void;
};

export function StructureEditorComponentsPanel({
  draft,
  setDraft,
  catalogComponents,
  onRequestAdd,
  hidden,
  catalogInput,
  previewPresetId,
  onPreviewPresetChange,
}: StructureEditorComponentsPanelProps): ReactNode {
  const preview = useMemo(() => {
    if (!catalogInput) return null;
    return resolveStructure3DPreview(
      draft,
      catalogInput,
      previewPresetId || undefined,
    );
  }, [draft, catalogInput, previewPresetId]);
  return (
    <div
      role="tabpanel"
      id="structure-editor-panel-components"
      aria-labelledby="structure-editor-tab-components"
      hidden={hidden}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: preview ? 'repeat(auto-fit, minmax(300px, 1fr))' : '1fr',
          gap: '1.5rem',
          alignItems: 'start',
        }}
      >
        <div>
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
                        {catComp ? (
                          `${catComp.code} — ${catComp.name}`
                        ) : (
                          <span
                            className="catalog-form__warning"
                            title={`El componente ${comp.componentId} fue eliminado del catálogo. Quitá esta instancia o reactivá el componente.`}
                            data-testid={`orphan-component-${idx}`}
                          >
                            <AlertTriangle size={14} strokeWidth={1.5} aria-hidden />
                            Componente eliminado
                          </span>
                        )}
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
                    <InstanceOverridesEditor
                      overrides={comp.overrides}
                      testIdSuffix={String(idx)}
                      onChange={(next) => {
                        setDraft((prev) => ({
                          ...prev,
                          components: prev.components.map((c, i) =>
                            i === idx ? { ...c, overrides: next } : c,
                          ),
                        }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {preview ? (
          <div
            className="module-part-card"
            style={{
              padding: '1rem',
              backgroundColor: 'var(--bg-surface-elevated, var(--bg-surface))',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
            data-testid="structure-components-3d-preview"
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
                Vista 3D en vivo
              </h4>
              {preview.presets.length > 0 && onPreviewPresetChange ? (
                <select
                  value={previewPresetId || preview.presetId || ''}
                  onChange={(e) => onPreviewPresetChange(e.target.value)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: 'var(--text-xs)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                  }}
                  data-testid="structure-components-preset-select"
                >
                  {preview.presets.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name?.trim()
                        ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth})`
                        : `${pr.width}×${pr.height}×${pr.depth} mm`}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {preview.error ? (
              <p className="catalog-form__error">{preview.error}</p>
            ) : null}

            {preview.empty && !preview.error ? (
              <p className="catalog-empty" style={{ fontSize: 'var(--text-xs)' }}>
                Vista previa 3D vacía. Agregá componentes para visualizar.
              </p>
            ) : null}

            {!preview.empty ? (
              <div
                style={{
                  minHeight: '20rem',
                  width: '100%',
                  position: 'relative',
                }}
              >
                <Furniture3DViewer
                  parts={preview.parts}
                  width={preview.width}
                  height={preview.height}
                  depth={preview.depth}
                  testId="structure-components-3d-viewer"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
