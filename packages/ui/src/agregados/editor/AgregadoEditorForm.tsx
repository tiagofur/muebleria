/**
 * Agregado editor form — tabs: General, Piezas, Herrajes.
 * Full-page editor, no modal. Follows ComponentEditorForm pattern.
 */

import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Component, Hardware, HardwareLine, ModuleComponentInstance } from '@granete/domain';
import { Plus, Trash2 } from 'lucide-react';
import { WorkspaceTabs, type TabDefinition } from '../../common/Tabs';
import { COMPONENT_PLACEMENTS } from '../../components';
import { InstanceOverridesEditor } from '../../modules/components/InstanceOverridesEditor';
import { HardwarePlacementsEditor } from '../../modules/components/HardwarePlacementsEditor';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import type { AgregadoDraft } from '../agregadoDraft';
import { AgregadoEditorGeneralPanel } from './AgregadoEditorGeneralPanel';
import { AgregadoEditorPreview3D } from './AgregadoEditorPreview3D';

export type AgregadoEditorTab = 'general' | 'components' | 'hardware';

export type AgregadoEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  readonly editorTab: AgregadoEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<AgregadoEditorTab>>;
  readonly draft: AgregadoDraft;
  readonly setDraft: Dispatch<SetStateAction<AgregadoDraft>>;
  readonly editingId: string | null;
  readonly catalogComponents: readonly Component[];
  readonly catalogHardware: readonly Hardware[];
  /** Full catalog for the live 3D preview. When omitted, the Piezas tab falls
   * back to a single-column layout with no preview. */
  readonly catalogInput?: Module3DCatalogInput;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
};

const TABS: { id: AgregadoEditorTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'components', label: 'Piezas' },
  { id: 'hardware', label: 'Herrajes' },
];

export function AgregadoEditorForm({
  formId,
  error,
  onSubmit,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  catalogComponents,
  catalogHardware,
  catalogInput,
  resolveImageUrl,
}: AgregadoEditorFormProps): ReactNode {

  const addComponentInstance = () => {
    const first = catalogComponents[0];
    if (!first) return;
    setDraft((prev) => ({
      ...prev,
      components: [...prev.components, { componentId: first.id, quantity: 1 }],
    }));
  };

  const removeComponentInstance = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== idx),
    }));
  };

  const updateComponentInstance = (idx: number, patch: Partial<ModuleComponentInstance>) => {
    setDraft((prev) => ({
      ...prev,
      components: prev.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  };

  const addHardwareLine = () => {
    const first = catalogHardware[0];
    setDraft((prev) => ({
      ...prev,
      hardwareLines: [
        ...prev.hardwareLines,
        {
          id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          quantity: 1,
          optionRole: 'HERRAJE',
          hardwareId: first?.id,
        },
      ],
    }));
  };

  const removeHardwareLine = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.filter((_, i) => i !== idx),
    }));
  };

  const updateHardwareLine = (idx: number, patch: Partial<HardwareLine>) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    }));
  };

  const totalHardwarePlacements = draft.components.reduce(
    (acc, c) => acc + (c.overrides?.hardwarePlacements?.length ?? 0),
    0,
  );

  const tabBadge: Partial<Record<AgregadoEditorTab, number>> = {
    components: draft.components.length,
    hardware: draft.hardwareLines.length + totalHardwarePlacements,
  };

  const tabDefs: readonly TabDefinition<AgregadoEditorTab>[] = TABS.map(
    (tab) => ({
      id: tab.id,
      label: tab.label,
      count: tabBadge[tab.id] || undefined,
    }),
  );

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className="catalog-form agregado-editor"
      noValidate
    >
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Tabs */}
      <WorkspaceTabs
        tabs={tabDefs}
        activeTab={editorTab}
        onTabChange={setEditorTab}
        ariaLabel="Secciones del editor de agregado"
        idPrefix="agregado-editor"
        testIdPrefix="agregado-editor"
      />

      {/* Tab: General */}
      {editorTab === 'general' && (
        <AgregadoEditorGeneralPanel
          formId={formId}
          draft={draft}
          setDraft={setDraft}
          setEditorTab={setEditorTab}
        />
      )}

      {/* Tab: Piezas */}
      {editorTab === 'components' && (
        <div
          className="agregado-editor__panel"
          id="agregado-editor-panel-components"
          role="tabpanel"
          aria-labelledby="agregado-editor-tab-components"
          data-testid="agregado-tab-components"
        >
          <div
            className={
              catalogInput
                ? 'agregado-editor__components-layout agregado-editor__components-layout--with-preview'
                : 'agregado-editor__components-layout'
            }
          >
            <div className="agregado-editor__components-list">
              <div className="agregado-editor__panel-header">
                <p className="catalog-form__hint">
                  Piezas de tablero que componen este sub-ensamble. Cada pieza usará W, H, D locales del agregado.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={addComponentInstance}
                  disabled={catalogComponents.length === 0}
                  data-testid="agregado-add-component"
                >
                  <Plus size={14} /> Añadir Pieza
                </button>
              </div>

              {draft.components.length === 0 ? (
                <div className="agregado-editor__empty-slot">
                  No hay piezas en este sub-ensamble.
                </div>
              ) : (
                <ul className="agregado-editor__item-list">
                  {draft.components.map((comp, idx) => {
                    const info = catalogComponents.find((c) => c.id === comp.componentId);
                    return (
                      <li
                        key={idx}
                        className="agregado-editor__item-row agregado-editor__item-row--block"
                      >
                        <div className="agregado-editor__item-header agregado-editor__item-header--flex">
                          <strong className="agregado-editor__item-title">
                            {info ? `${info.code} — ${info.name}` : comp.componentId}
                          </strong>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small btn--icon-only"
                            aria-label="Eliminar pieza"
                            onClick={() => removeComponentInstance(idx)}
                            data-testid={`agregado-comp-${idx}-remove`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        <div className="agregado-editor__item-fields agregado-editor__item-fields--grid">
                          <div className="catalog-form__field">
                            <label className="catalog-form__label">Componente</label>
                            <select
                              className="catalog-form__select"
                              value={comp.componentId}
                              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                updateComponentInstance(idx, { componentId: e.target.value })
                              }
                              data-testid={`agregado-comp-${idx}-select`}
                            >
                              {catalogComponents.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.code} — {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="catalog-form__field">
                            <label className="catalog-form__label">Cantidad</label>
                            <input
                              type="number"
                              min={1}
                              className="catalog-form__input"
                              value={comp.quantity}
                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateComponentInstance(idx, {
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              data-testid={`agregado-comp-${idx}-qty`}
                            />
                          </div>

                          <div className="catalog-form__field">
                            <label className="catalog-form__label">Ubicación (opcional)</label>
                            <select
                              className="catalog-form__select"
                              value={comp.placementOverride ?? ''}
                              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                updateComponentInstance(idx, {
                                  placementOverride: (e.target.value as any) || undefined,
                                })
                              }
                              data-testid={`agregado-comp-${idx}-placement`}
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

                        {info?.notes && (
                          <p className="agregado-editor__item-hint">{info.notes}</p>
                        )}

                        <InstanceOverridesEditor
                          overrides={comp.overrides}
                          testIdSuffix={String(idx)}
                          onChange={(nextOverrides) =>
                            updateComponentInstance(idx, { overrides: nextOverrides })
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {catalogInput ? (
              <AgregadoEditorPreview3D
                draft={draft}
                catalogInput={catalogInput}
                resolveMediaUrl={resolveImageUrl}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Tab: Herrajes */}
      {editorTab === 'hardware' && (
        <div
          className="agregado-editor__panel"
          id="agregado-editor-panel-hardware"
          role="tabpanel"
          aria-labelledby="agregado-editor-tab-hardware"
          data-testid="agregado-tab-hardware"
        >
          <div
            className={
              catalogInput
                ? 'agregado-editor__components-layout agregado-editor__components-layout--with-preview'
                : 'agregado-editor__components-layout'
            }
          >
            <div className="agregado-editor__components-list">
              <div className="agregado-editor__panel-header">
                <p className="catalog-form__hint">
                  Herrajes en cantidad (solo costo, sin posición): tornillería,
                  perfiles, insumos. Para jaladeras/bisagras con posición 3D, usá la
                  sección de abajo.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={addHardwareLine}
                  data-testid="agregado-add-hardware"
                >
                  <Plus size={14} /> Añadir Herraje
                </button>
              </div>

              {draft.hardwareLines.length === 0 ? (
                <div className="agregado-editor__empty-slot">
                  No hay herrajes en este sub-ensamble.
                </div>
              ) : (
                <ul className="agregado-editor__item-list">
                  {draft.hardwareLines.map((hw, idx) => (
                    <li key={idx} className="agregado-editor__item-row">
                      <div className="agregado-editor__item-fields">
                        <div className="catalog-form__field">
                          <label className="catalog-form__label">Herraje específico</label>
                          <select
                            className="catalog-form__select"
                            value={hw.hardwareId ?? ''}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                              updateHardwareLine(idx, {
                                hardwareId: e.target.value || undefined,
                              })
                            }
                            data-testid={`agregado-hw-${idx}-select`}
                          >
                            <option value="">(Por Rol)</option>
                            {catalogHardware.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.code} — {h.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="catalog-form__field">
                          <label className="catalog-form__label">Rol de opción</label>
                          <input
                            type="text"
                            className="catalog-form__input"
                            value={hw.optionRole}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updateHardwareLine(idx, { optionRole: e.target.value })
                            }
                            placeholder="BISAGRA / CORREDERA / JALADERA"
                            data-testid={`agregado-hw-${idx}-role`}
                          />
                        </div>
                        <div className="catalog-form__field catalog-form__field--narrow">
                          <label className="catalog-form__label">Cantidad</label>
                          <input
                            type="number"
                            min={1}
                            className="catalog-form__input"
                            value={hw.quantity}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              updateHardwareLine(idx, {
                                quantity: Math.max(1, Number(e.target.value) || 1),
                              })
                            }
                            data-testid={`agregado-hw-${idx}-qty`}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small btn--icon-only"
                        aria-label="Eliminar herraje"
                        onClick={() => removeHardwareLine(idx)}
                        data-testid={`agregado-hw-${idx}-remove`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Posición 3D de herrajes, unificado en este tab. Ancla cada herraje
                  a una pieza del agregado (cara + X%/Y% + rotación) — lo que se ve
                  en el 3D y alimenta las perforaciones. */}
              <div
                className="agregado-editor__hardware-placements"
                data-testid="agregado-hardware-placements"
              >
                <h4 className="module-editor__section-title">
                  Herrajes posicionados (3D + costo automático)
                </h4>
                <p className="catalog-form__hint">
                  Cada herraje acá se cotiza según la cantidad de posiciones (no lo
                  sumes también a la lista de arriba). Es lo que se ve en la Vista 3D
                  y la base de las perforaciones.
                </p>
                {draft.components.length === 0 ? (
                  <p className="catalog-empty">
                    Agregá piezas en la pestaña Piezas para posicionar herrajes.
                  </p>
                ) : (
                  draft.components.map((comp, idx) => {
                    const info = catalogComponents.find(
                      (c) => c.id === comp.componentId,
                    );
                    return (
                      <div
                        key={idx}
                        className="agregado-editor__piece-hardware"
                        data-testid={`agregado-piece-hardware-${idx}`}
                      >
                        <h5 className="module-part-card__title">
                          {info ? `${info.code} — ${info.name}` : comp.componentId}
                        </h5>
                        <HardwarePlacementsEditor
                          placements={comp.overrides?.hardwarePlacements ?? []}
                          catalogHardware={catalogHardware}
                          testIdSuffix={`hw-pc-${idx}`}
                          onChange={(next) => {
                            const current = comp.overrides ?? {};
                            if (!next || next.length === 0) {
                              const { hardwarePlacements: _omit, ...rest } = current;
                              void _omit;
                              updateComponentInstance(idx, {
                                overrides:
                                  Object.keys(rest).length > 0 ? rest : undefined,
                              });
                            } else {
                              updateComponentInstance(idx, {
                                overrides: { ...current, hardwarePlacements: next },
                              });
                            }
                          }}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {catalogInput ? (
              <AgregadoEditorPreview3D
                draft={draft}
                catalogInput={catalogInput}
                resolveMediaUrl={resolveImageUrl}
              />
            ) : null}
          </div>
        </div>
      )}
    </form>
  );
}
