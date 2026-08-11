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
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

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

/** Compact formula variable legend — collapses to keep the form clean. */
function FormulaLegend(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="agr-formula-legend">
      <button
        type="button"
        className="agr-formula-legend__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={2} aria-hidden />
        ) : (
          <ChevronRight size={13} strokeWidth={2} aria-hidden />
        )}
        Variables de fórmulas
      </button>
      {open ? (
        <dl className="agr-formula-legend__body">
          <dt>W</dt><dd>Ancho exterior</dd>
          <dt>H</dt><dd>Alto exterior</dd>
          <dt>D</dt><dd>Profundidad exterior</dd>
          <dt>B</dt><dd>Espesor de tablero</dd>
        </dl>
      ) : null}
    </div>
  );
}

/** One pending-remove state is tracked by index; clears on next action. */
type RemoveState = { index: number; timer: ReturnType<typeof setTimeout> } | null;

export function StructureEditorAgregadosPanel<
  T extends { readonly agregados: readonly ModuleAgregadoInstance[] },
>({
  draft,
  setDraft,
  catalogAgregados = [],
  hidden = false,
}: StructureEditorAgregadosPanelProps<T>): ReactNode {
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [pendingRemove, setPendingRemove] = useState<RemoveState>(null);

  const clearPending = useCallback(() => {
    setPendingRemove((prev) => {
      if (prev) clearTimeout(prev.timer);
      return null;
    });
  }, []);

  if (hidden) return null;

  const handleAddAgregado = () => {
    if (!selectedCatalogId) return;
    const agr = catalogAgregados.find((a) => a.id === selectedCatalogId);
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
    if (pendingRemove?.index === index) {
      // Second click → confirmed remove
      clearTimeout(pendingRemove.timer);
      setPendingRemove(null);
      setDraft((prev) => ({
        ...prev,
        agregados: prev.agregados.filter((_, i) => i !== index),
      }));
      return;
    }
    // First click → enter confirm state
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
          <h3 className="structure-editor__panel-title">Agregados</h3>
          <p className="structure-editor__panel-subtitle">
            Puertas, cajones o módulos internos que se incorporan a esta pieza.
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
              Elegir agregado…
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

      {draft.agregados.length > 0 ? <FormulaLegend /> : null}

      {draft.agregados.length === 0 ? (
        <div className="catalog-form__empty" data-testid="structure-agregados-empty">
          No hay agregados añadidos todavía.
        </div>
      ) : (
        <div className="structure-editor__agregados-list">
          {draft.agregados.map((inst, idx) => {
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
                    {inst.mirrored ? (
                      <span className="badge badge--info">Espejeado</span>
                    ) : null}
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

                <div className="structure-editor__agregado-grid">
                  <div className="catalog-form__field">
                    <label className="catalog-form__label">
                      Nombre personalizado
                    </label>
                    <input
                      type="text"
                      className="catalog-form__input"
                      value={inst.name ?? ''}
                      onChange={(e) =>
                        handleUpdateAgregado(idx, { name: e.target.value })
                      }
                      placeholder={template?.name ?? 'Ej. 3 Cajones'}
                      data-testid={`structure-agr-${idx}-name`}
                    />
                  </div>

                  <div className="catalog-form__field">
                    <label className="catalog-form__label">
                      Cantidad
                    </label>
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
                    <label className="catalog-form__label">
                      Apilamiento
                    </label>
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
                    <label className="catalog-form__label">
                      Separación (mm)
                    </label>
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
                  </div>

                  <div className="catalog-form__field">
                    <label className="catalog-form__label">
                      Posición Z
                    </label>
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
                      placeholder="Ej. 100 o B + 20"
                      data-testid={`structure-agr-${idx}-pos-z`}
                    />
                    <span className="catalog-form__hint">
                      Distancia desde la base (mm o fórmula)
                    </span>
                  </div>

                  <div className="catalog-form__field">
                    <label className="catalog-form__label">
                      Ancho hueco
                    </label>
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
                    <span className="catalog-form__hint">
                      mm o fórmula — W = ancho exterior
                    </span>
                  </div>

                  <div className="catalog-form__field">
                    <label className="catalog-form__label">
                      Alto hueco
                    </label>
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
                      placeholder="Ej. 600 o H - B"
                      data-testid={`structure-agr-${idx}-dim-h`}
                    />
                    <span className="catalog-form__hint">
                      mm o fórmula — H = alto exterior
                    </span>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
