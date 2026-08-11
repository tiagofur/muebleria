/**
 * Panel for managing Sub-assemblies (Agregados) in StructureEditorForm and
 * ModuleEditorForm. Generic over T so it works for both StructureDraft and
 * ModuleDraft.
 *
 * Polish pack (critique 2026-08-11):
 *  - Terminology: single label "Agregados" everywhere.
 *  - Formula legend: W/H/B/D variables shown inline.
 *  - Remove button: Lucide Trash2 + soft-delete (ghost class, confirm tooltip).
 *  - Fallback: removed catalogAgregados[0] silent fallback.
 *  - CSS: migrated to catalog-form__field / input-base tokens.
 *  - Select placeholder: proper disabled option.
 */

import {
  useState,
  useCallback,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Agregado, ModuleAgregadoInstance } from '@muebles/domain';
import {
  ChevronDown,
  ChevronRight,
  Trash2,
  Maximize2,
  Move,
  Layers,
  Settings,
} from 'lucide-react';

export interface StructureEditorAgregadosPanelProps<
  T extends { agregados?: ModuleAgregadoInstance[] },
> {
  readonly draft: T;
  readonly setDraft: Dispatch<SetStateAction<T>>;
  readonly catalogAgregados: readonly Agregado[];
  readonly hidden?: boolean;
}

function FormulaLegend(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="structure-editor__formula-legend"
      data-testid="formula-legend"
    >
      <button
        type="button"
        className="structure-editor__formula-legend-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Variables de fórmulas (W, H, D, B)</span>
      </button>
      {open ? (
        <div className="structure-editor__formula-legend-body">
          <p>
            Podés usar números exactos en milímetros (ej. <code>500</code>) o
            fórmulas paramétricas con estas variables:
          </p>
          <ul>
            <li><code>W</code> = Ancho exterior del mueble / estructura.</li>
            <li><code>H</code> = Alto exterior del mueble / estructura.</li>
            <li><code>D</code> = Profundidad exterior del mueble.</li>
            <li><code>B</code> = Alto de zoclo / patas (mm).</li>
          </ul>
          <p className="structure-editor__formula-legend-example">
            Ejemplos: <code>W - 36</code> (para puertas con laterales de 18mm),{' '}
            <code>H - B - 36</code> (alto util sobre zoclo), <code>B + 18</code>{' '}
            (elevación X/Z).
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function StructureEditorAgregadosPanel<
  T extends { agregados?: ModuleAgregadoInstance[] },
>({
  draft,
  setDraft,
  catalogAgregados,
  hidden = false,
}: StructureEditorAgregadosPanelProps<T>): ReactNode {
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');
  const [pendingRemove, setPendingRemove] = useState<{
    index: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const clearPending = useCallback(() => {
    if (pendingRemove) {
      clearTimeout(pendingRemove.timer);
      setPendingRemove(null);
    }
  }, [pendingRemove]);

  if (hidden) return null;

  const handleAddAgregado = () => {
    if (!selectedCatalogId) return;

    const template = catalogAgregados.find((a) => a.id === selectedCatalogId);

    const newInst: ModuleAgregadoInstance = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              const v = c === 'x' ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            }),
      agregadoId: selectedCatalogId,
      name: template?.name ?? '',
      quantity: 1,
      layoutDirection: 'none',
      gapMm: 0,
      mirrored: false,
      position: {
        xFormula: '',
        yFormula: '',
        zFormula: '',
      },
      dimensions: {
        widthFormula: '',
        heightFormula: '',
        depthFormula: '',
      },
    };

    setDraft((prev) => ({
      ...prev,
      agregados: [...(prev.agregados ?? []), newInst],
    }));
  };

  const handleRemoveAgregado = (index: number) => {
    if (pendingRemove?.index === index) {
      clearTimeout(pendingRemove.timer);
      setPendingRemove(null);
      setDraft((prev) => ({
        ...prev,
        agregados: (prev.agregados ?? []).filter((_, i) => i !== index),
      }));
      return;
    }
    clearPending();
    const timer = setTimeout(() => setPendingRemove(null), 3500);
    setPendingRemove({ index, timer });
  };

  const handleUpdateAgregado = (
    index: number,
    patch: Partial<ModuleAgregadoInstance>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      agregados: (prev.agregados ?? []).map((item, i) =>
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
          <h3 className="structure-editor__panel-title">Agregados</h3>
          <p className="structure-editor__panel-subtitle">
            Puertas, cajones o módulos internos incorporados a esta pieza, con
            posicionamiento 3D (X, Y, Z) y dimensiones del hueco (W, H, D).
          </p>
        </div>
      </div>

      {catalogAgregados.length === 0 ? (
        <p className="catalog-form__hint" data-testid="agregados-catalog-empty">
          No hay agregados en el catálogo. Creá uno en{' '}
          <strong>Ingeniería → Agregados</strong>.
        </p>
      ) : (
        <div className="structure-editor__agregado-add-bar">
          <select
            className="catalog-form__input"
            value={selectedCatalogId}
            onChange={(e) => setSelectedCatalogId(e.target.value)}
            data-testid="structure-agregado-select"
          >
            <option value="" disabled>
              Elegir agregado del catálogo…
            </option>
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
            + Agregar
          </button>
        </div>
      )}

      {(draft.agregados ?? []).length > 0 ? <FormulaLegend /> : null}

      {(draft.agregados ?? []).length === 0 ? (
        <div className="catalog-form__empty" data-testid="structure-agregados-empty">
          No hay agregados añadidos todavía.
        </div>
      ) : (
        <div className="structure-editor__agregados-list">
          {(draft.agregados ?? []).map((inst, idx) => {
            const template = catalogAgregados.find((a) => a.id === inst.agregadoId);
            const isPendingRemove = pendingRemove?.index === idx;
            return (
              <div
                key={inst.id ?? idx}
                className={
                  isPendingRemove
                    ? 'structure-editor__agregado-card structure-editor__agregado-card--removing'
                    : 'structure-editor__agregado-card'
                }
                data-testid={`structure-agregado-item-${idx}`}
              >
                <div className="structure-editor__agregado-header">
                  <div className="structure-editor__agregado-title-group">
                    <span className="structure-editor__agregado-code">
                      {template?.code ?? 'AGR'}
                    </span>
                    <strong className="structure-editor__agregado-name">
                      {inst.name || template?.name || 'Agregado'}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className={
                      isPendingRemove
                        ? 'btn btn--icon btn--danger'
                        : 'btn btn--icon btn--danger-ghost'
                    }
                    onClick={() => handleRemoveAgregado(idx)}
                    title={
                      isPendingRemove
                        ? 'Hacer click de nuevo para confirmar eliminación'
                        : 'Eliminar este agregado'
                    }
                    data-testid={`structure-remove-agregado-${idx}`}
                  >
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>

                {isPendingRemove ? (
                  <p className="structure-editor__agregado-confirm-hint">
                    ¿Eliminar? Hacé click de nuevo en el botón para confirmar.
                  </p>
                ) : null}

                <fieldset className="structure-editor__agregado-fieldset">
                  <legend className="structure-editor__agregado-legend">
                    <Maximize2 size={14} aria-hidden /> Dimensiones del Hueco / Sub-espacio
                  </legend>
                  <div className="structure-editor__agregado-grid-3col">
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Ancho hueco (W)</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.dimensions?.widthFormula ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            dimensions: {
                              ...inst.dimensions,
                              widthFormula: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. W - 36"
                        data-testid={`structure-agr-${idx}-dim-w`}
                      />
                      <span className="catalog-form__hint">mm o fórmula rel a W</span>
                    </div>

                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Alto hueco (H)</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.dimensions?.heightFormula ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            dimensions: {
                              ...inst.dimensions,
                              heightFormula: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. H - B - 36"
                        data-testid={`structure-agr-${idx}-dim-h`}
                      />
                      <span className="catalog-form__hint">mm o fórmula rel a H</span>
                    </div>

                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Profundidad hueco (D)</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.dimensions?.depthFormula ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            dimensions: {
                              ...inst.dimensions,
                              depthFormula: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. D - 18"
                        data-testid={`structure-agr-${idx}-dim-d`}
                      />
                      <span className="catalog-form__hint">mm o fórmula rel a D</span>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="structure-editor__agregado-fieldset">
                  <legend className="structure-editor__agregado-legend">
                    <Move size={14} aria-hidden /> Posición Espacial 3D (X, Y, Z)
                  </legend>
                  <div className="structure-editor__agregado-grid-3col">
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Posición X (Ancho / Lateral)</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.position?.xFormula ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            position: {
                              ...inst.position,
                              xFormula: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. 18 o W/2"
                        data-testid={`structure-agr-${idx}-pos-x`}
                      />
                      <span className="catalog-form__hint">Desde lateral izq (mm/fórmula)</span>
                    </div>

                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Posición Y (Profundidad)</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.position?.yFormula ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            position: {
                              ...inst.position,
                              yFormula: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. 0 o 18"
                        data-testid={`structure-agr-${idx}-pos-y`}
                      />
                      <span className="catalog-form__hint">Desde frente (mm/fórmula)</span>
                    </div>

                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Posición Z (Elevación / Vertical)</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.position?.zFormula ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            position: {
                              ...inst.position,
                              zFormula: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. B + 18 o 100"
                        data-testid={`structure-agr-${idx}-pos-z`}
                      />
                      <span className="catalog-form__hint">Desde la base (mm/fórmula)</span>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="structure-editor__agregado-fieldset">
                  <legend className="structure-editor__agregado-legend">
                    <Layers size={14} aria-hidden /> Distribución y Repetición
                  </legend>
                  <div className="structure-editor__agregado-grid-3col">
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Cantidad (N)</label>
                      <input
                        type="number"
                        min={1}
                        className="catalog-form__input"
                        value={inst.quantity}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                          })
                        }
                        data-testid={`structure-agr-${idx}-qty`}
                      />
                    </div>

                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Dirección de apilamiento</label>
                      <select
                        className="catalog-form__input"
                        value={inst.layoutDirection ?? 'none'}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            layoutDirection: e.target.value as any,
                          })
                        }
                        data-testid={`structure-agr-${idx}-direction`}
                      >
                        <option value="vertical">Vertical (columna)</option>
                        <option value="horizontal">Horizontal (fila)</option>
                        <option value="none">Sin apilar</option>
                      </select>
                    </div>

                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Separación (gapMm)</label>
                      <input
                        type="number"
                        min={0}
                        className="catalog-form__input"
                        value={inst.gapMm ?? 0}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, {
                            gapMm: Math.max(0, parseFloat(e.target.value) || 0),
                          })
                        }
                        data-testid={`structure-agr-${idx}-gap`}
                      />
                      <span className="catalog-form__hint">mm luz entre unidades</span>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="structure-editor__agregado-fieldset">
                  <legend className="structure-editor__agregado-legend">
                    <Settings size={14} aria-hidden /> Opción y Orientación
                  </legend>
                  <div className="structure-editor__agregado-grid-2col">
                    <div className="catalog-form__field">
                      <label className="catalog-form__label">Nombre borrador / etiqueta</label>
                      <input
                        type="text"
                        className="catalog-form__input"
                        value={inst.name ?? ''}
                        onChange={(e) =>
                          handleUpdateAgregado(idx, { name: e.target.value })
                        }
                        placeholder={template?.name ?? 'Ej. Puerta Principal'}
                        data-testid={`structure-agr-${idx}-name`}
                      />
                    </div>

                    <div className="catalog-form__field catalog-form__field--checkbox">
                      <label className="catalog-form__checkbox-label">
                        <input
                          type="checkbox"
                          checked={inst.mirrored ?? false}
                          onChange={(e) =>
                            handleUpdateAgregado(idx, { mirrored: e.target.checked })
                          }
                          data-testid={`structure-agr-${idx}-mirrored`}
                        />
                        Espejear (invertir izq ↔ der)
                      </label>
                    </div>
                  </div>
                </fieldset>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
