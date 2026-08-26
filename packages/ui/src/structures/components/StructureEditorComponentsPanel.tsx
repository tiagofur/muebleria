/**
 * Structure editor — component instances tab.
 */

import {
  useMemo,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Component } from '@granete/domain';
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
      data-testid="structure-editor-panel-components"
    >
      <div
        className={
          preview
            ? 'structure-components-layout structure-components-layout--with-preview'
            : 'structure-components-layout'
        }
        data-testid="structure-editor-panel-components-body"
      >
        <div className="structure-components-list">
          <div className="structure-editor-panel-header">
            <h4 className="module-editor__section-title">
              Componentes ({draft.components.length})
            </h4>
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={onRequestAdd}
              data-testid="add-component-btn"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar
              componente
            </button>
          </div>

          {draft.components.length === 0 ? (
            <div className="structure-components-empty" data-testid="components-empty">
              <p className="catalog-empty">
                Sin componentes. El cuerpo necesita al menos una pieza
                (laterales, base, etc.).
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={onRequestAdd}
                data-testid="add-component-empty-cta"
              >
                <Plus size={16} strokeWidth={1.5} aria-hidden /> Agregar primer
                componente
              </button>
            </div>
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
                            <AlertTriangle
                              size={14}
                              strokeWidth={1.5}
                              aria-hidden
                            />
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
                            components: prev.components.filter(
                              (_, i) => i !== idx,
                            ),
                          }));
                        }}
                        data-testid={`remove-component-${idx}`}
                      >
                        Quitar
                      </button>
                    </div>
                    <div className="structure-editor__grid">
                      <div className="catalog-form__field structure-editor__field--narrow">
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
                    <InstanceOverridesEditor
                      overrides={comp.overrides}
                      testIdSuffix={String(idx)}
                      catalogHardware={catalogInput?.hardware}
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
            className="module-part-card structure-components-3d"
            data-testid="structure-components-3d-preview"
          >
            <div className="structure-editor-panel-header">
              <h4 className="module-editor__section-title">Vista 3D</h4>
              {preview.presets.length > 0 && onPreviewPresetChange ? (
                <select
                  className="structure-components-3d__preset"
                  value={previewPresetId || preview.presetId || ''}
                  onChange={(e) => onPreviewPresetChange(e.target.value)}
                  data-testid="structure-components-preset-select"
                  aria-label="Medida de prueba para el 3D"
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
            <p className="structure-components-3d__hint">
              Preview en vivo al armar el cuerpo (única vista 3D del editor).
            </p>

            {preview.error ? (
              <p className="catalog-form__error">{preview.error}</p>
            ) : null}

            {preview.empty && !preview.error ? (
              <p className="catalog-empty">
                Vista previa vacía. Agregá componentes a la izquierda.
              </p>
            ) : null}

            {!preview.empty ? (
              <div className="structure-components-3d__viewport">
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
