/**
 * Panel for managing Sub-assemblies (Agregados) in StructureEditorForm.
 */

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Agregado, ModuleAgregadoInstance } from '@muebles/domain';
import type { StructureDraft } from '../structureDraft';

export interface StructureEditorAgregadosPanelProps<
  T extends { readonly agregados: readonly ModuleAgregadoInstance[] } = {
    readonly agregados: readonly ModuleAgregadoInstance[];
  },
> {
  readonly draft: T;
  readonly setDraft: Dispatch<SetStateAction<T>>;
  readonly catalogAgregados?: readonly Agregado[];
  readonly hidden?: boolean;
}

export function StructureEditorAgregadosPanel<
  T extends { readonly agregados: readonly ModuleAgregadoInstance[] },
>({
  draft,
  setDraft,
  catalogAgregados = [],
  hidden = false,
}: StructureEditorAgregadosPanelProps<T>): ReactNode {
  const [selectedCatalogId, setSelectedCatalogId] = useState('');

  if (hidden) return null;

  const handleAddAgregado = () => {
    const agr = catalogAgregados.find((a) => a.id === selectedCatalogId) ?? catalogAgregados[0];
    if (!agr) return;

    const newInst: ModuleAgregadoInstance = {
      id: `agr-inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agregadoId: agr.id,
      name: agr.name,
      quantity: 1,
      layoutDirection: 'vertical',
      gapMm: 3,
      position: { zFormula: '100' },
      dimensions: { widthFormula: 'W - 36', heightFormula: '600' },
      mirrored: false,
    };

    setDraft((prev) => ({
      ...prev,
      agregados: [...prev.agregados, newInst],
    }));
  };

  const handleRemoveAgregado = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      agregados: prev.agregados.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateAgregado = (
    index: number,
    patch: Partial<ModuleAgregadoInstance>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      agregados: prev.agregados.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  return (
    <div
      className="structure-editor__panel structure-editor__agregados-panel"
      data-testid="structure-editor-agregados-panel"
    >
      <div className="structure-editor__panel-header">
        <div>
          <h3 className="structure-editor__panel-title">Sub-conjuntos / Agregados</h3>
          <p className="structure-editor__panel-subtitle">
            Añadí bloques reusables de cajones, puertas con bisagras o módulos internos a esta estructura.
          </p>
        </div>
      </div>

      {catalogAgregados.length === 0 ? (
        <p className="catalog-form__hint" data-testid="agregados-catalog-empty">
          No hay agregados registrados en el catálogo de ingeniería. Creá uno en el menú <strong>Ingeniería → Agregados</strong>.
        </p>
      ) : (
        <div className="structure-editor__agregado-add-bar">
          <select
            className="input-select"
            value={selectedCatalogId}
            onChange={(e) => setSelectedCatalogId(e.target.value)}
            data-testid="structure-agregado-select"
          >
            <option value="">-- Seleccionar Agregado del catálogo --</option>
            {catalogAgregados.map((a) => (
              <option key={a.id} value={a.id}>
                [{a.code}] {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleAddAgregado}
            disabled={!selectedCatalogId}
            data-testid="structure-add-agregado-btn"
          >
            + Añadir Sub-ensamble
          </button>
        </div>
      )}

      {draft.agregados.length === 0 ? (
        <div className="catalog-form__empty" data-testid="structure-agregados-empty">
          No hay sub-conjuntos agregados a esta estructura.
        </div>
      ) : (
        <div className="structure-editor__agregados-list">
          {draft.agregados.map((inst, idx) => {
            const template = catalogAgregados.find((a) => a.id === inst.agregadoId);
            return (
              <div
                key={inst.id ?? idx}
                className="structure-editor__agregado-card"
                data-testid={`structure-agregado-item-${idx}`}
              >
                <div className="structure-editor__agregado-header">
                  <div className="structure-editor__agregado-title-group">
                    <span className="structure-editor__agregado-code">
                      {template?.code ?? 'AGR'}
                    </span>
                    <strong className="structure-editor__agregado-name">
                      {inst.name || template?.name || 'Sub-ensamble'}
                    </strong>
                    {inst.mirrored ? (
                      <span className="badge badge--info">Espejeado</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn--icon btn--danger-ghost"
                    onClick={() => handleRemoveAgregado(idx)}
                    title="Eliminar este sub-ensamble"
                    data-testid={`structure-remove-agregado-${idx}`}
                  >
                    ✕
                  </button>
                </div>

                <div className="structure-editor__agregado-grid">
                  <div className="field-group">
                    <label className="field-label">Nombre personalizado</label>
                    <input
                      type="text"
                      className="input-text"
                      value={inst.name ?? ''}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, { name: e.target.value })
                      }
                      placeholder={template?.name ?? 'Ej. 3 Cajones'}
                      data-testid={`structure-agr-${idx}-name`}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Cantidad (N unidades)</label>
                    <input
                      type="number"
                      min={1}
                      className="input-text"
                      value={inst.quantity}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, {
                          quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })
                      }
                      data-testid={`structure-agr-${idx}-qty`}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Dirección Apilamiento</label>
                    <select
                      className="input-select"
                      value={inst.layoutDirection ?? 'none'}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, {
                          layoutDirection: e.target.value as any,
                        })
                      }
                      data-testid={`structure-agr-${idx}-direction`}
                    >
                      <option value="vertical">Vertical (apilar en Z)</option>
                      <option value="horizontal">Horizontal (apilar en X)</option>
                      <option value="none">Sin apilar (posición única)</option>
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="field-label">Luz / Separación (mm)</label>
                    <input
                      type="number"
                      min={0}
                      className="input-text"
                      value={inst.gapMm ?? 0}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, {
                          gapMm: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      data-testid={`structure-agr-${idx}-gap`}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Posición Z (formula/mm)</label>
                    <input
                      type="text"
                      className="input-text"
                      value={inst.position?.zFormula ?? ''}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, {
                          position: {
                            ...inst.position,
                            zFormula: e.target.value,
                          },
                        })
                      }
                      placeholder="Ej. 100 o B + 20"
                      data-testid={`structure-agr-${idx}-pos-z`}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Ancho Hueco W (formula/mm)</label>
                    <input
                      type="text"
                      className="input-text"
                      value={inst.dimensions?.widthFormula ?? ''}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, {
                          dimensions: {
                            ...inst.dimensions,
                            widthFormula: e.target.value,
                          },
                        })
                      }
                      placeholder="Ej. W - 36 (interior libre)"
                      data-testid={`structure-agr-${idx}-dim-w`}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label">Alto Hueco H (formula/mm)</label>
                    <input
                      type="text"
                      className="input-text"
                      value={inst.dimensions?.heightFormula ?? ''}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, {
                          dimensions: {
                            ...inst.dimensions,
                            heightFormula: e.target.value,
                          },
                        })
                      }
                      placeholder="Ej. 600 o PH - B"
                      data-testid={`structure-agr-${idx}-dim-h`}
                    />
                  </div>

                  <div className="field-group field-group--checkbox">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={inst.mirrored ?? false}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, { mirrored: e.target.checked })
                        }
                        data-testid={`structure-agr-${idx}-mirrored`}
                      />
                      Espejear mano (invertir lados izq ↔ der)
                    </label>
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
