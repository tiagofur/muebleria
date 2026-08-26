/**
 * Individual Agregado Card in Structure/Module Editor Agregados Panel.
 */

import type { ReactNode } from 'react';
import type { Agregado, Hardware, ModuleAgregadoInstance, OptionGroup } from '@granete/domain';
import {
  ChevronDown,
  ChevronRight,
  Trash2,
  Maximize2,
  Move,
  Layers,
  Settings,
  Settings2,
} from 'lucide-react';
import { getOptionRolesForAgregado } from './agregadoRoleHelpers';

export interface StructureAgregadoCardProps {
  readonly idx: number;
  readonly inst: ModuleAgregadoInstance;
  readonly catalogAgregados: readonly Agregado[];
  readonly catalogHardware?: readonly Hardware[];
  readonly optionGroups?: readonly OptionGroup[];
  readonly isOpen: boolean;
  readonly defaultOpen: boolean;
  readonly isPendingRemove: boolean;
  readonly onToggleExpand: (key: string, defaultOpen: boolean) => void;
  readonly onRemove: (idx: number) => void;
  readonly onUpdate: (idx: number, patch: Partial<ModuleAgregadoInstance>) => void;
}

export function StructureAgregadoCard({
  idx,
  inst,
  catalogAgregados,
  catalogHardware = [],
  optionGroups = [],
  isOpen,
  defaultOpen,
  isPendingRemove,
  onToggleExpand,
  onRemove,
  onUpdate,
}: StructureAgregadoCardProps): ReactNode {
  const template = catalogAgregados.find((a) => a.id === inst.agregadoId);
  const itemKey = inst.id || `agr-${idx}`;

  const hasDimW = Boolean(inst.dimensions?.widthFormula?.trim());
  const hasDimH = Boolean(inst.dimensions?.heightFormula?.trim());
  const hasDimD = Boolean(inst.dimensions?.depthFormula?.trim());
  const hasDimensions = hasDimW || hasDimH || hasDimD;

  const hasPosX = Boolean(inst.position?.xFormula?.trim());
  const hasPosY = Boolean(inst.position?.yFormula?.trim());
  const hasPosZ = Boolean(inst.position?.zFormula?.trim());
  const hasPosition = hasPosX || hasPosY || hasPosZ;

  const overrideCount = Object.keys(inst.optionOverrides ?? {}).length;

  return (
    <div
      className={[
        'structure-editor__agregado-card',
        !isOpen ? 'structure-editor__agregado-card--collapsed' : '',
        isPendingRemove ? 'structure-editor__agregado-card--removing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`structure-agregado-item-${idx}`}
    >
      <div className="structure-editor__agregado-header">
        <button
          type="button"
          className="structure-editor__agregado-toggle-btn"
          onClick={() => onToggleExpand(itemKey, defaultOpen)}
          aria-expanded={isOpen}
          aria-controls={`structure-agr-body-${idx}`}
          data-testid={`structure-agregado-toggle-${idx}`}
        >
          {isOpen ? (
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
          )}
          <span className="structure-editor__agregado-code">
            {template?.code ?? 'AGR'}
          </span>
          <strong className="structure-editor__agregado-name">
            {inst.name || template?.name || 'Agregado'}
          </strong>

          {!isOpen && (
            <div
              className="structure-editor__agregado-summary"
              data-testid={`structure-agr-summary-${idx}`}
            >
              {hasDimensions && (
                <span
                  className="structure-editor__agregado-chip"
                  title="Dimensiones del hueco (W × H × D)"
                >
                  <Maximize2 size={11} aria-hidden />{' '}
                  {inst.dimensions?.widthFormula || '—'} ×{' '}
                  {inst.dimensions?.heightFormula || '—'} ×{' '}
                  {inst.dimensions?.depthFormula || '—'}
                </span>
              )}

              {hasPosition && (
                <span
                  className="structure-editor__agregado-chip"
                  title="Posición 3D (X, Y, Z)"
                >
                  <Move size={11} aria-hidden /> (
                  {inst.position?.xFormula || '0'},{' '}
                  {inst.position?.yFormula || '0'},{' '}
                  {inst.position?.zFormula || '0'})
                </span>
              )}

              <span
                className="structure-editor__agregado-chip"
                title="Cantidad y distribución"
              >
                <Layers size={11} aria-hidden /> Cant: {inst.quantity}
                {inst.layoutDirection && inst.layoutDirection !== 'none'
                  ? ` (${inst.layoutDirection})`
                  : ''}
              </span>

              {inst.mirrored && (
                <span className="structure-editor__agregado-chip structure-editor__agregado-chip--accent">
                  Espejado
                </span>
              )}

              {overrideCount > 0 && (
                <span
                  className="structure-editor__agregado-chip"
                  title="Redefiniciones de opciones activas"
                >
                  <Settings2 size={11} aria-hidden /> {overrideCount}{' '}
                  {overrideCount === 1 ? 'override' : 'overrides'}
                </span>
              )}
            </div>
          )}
        </button>

        <button
          type="button"
          className={
            isPendingRemove
              ? 'btn btn--icon btn--danger'
              : 'btn btn--icon btn--danger-ghost'
          }
          onClick={(e) => {
            e.stopPropagation();
            onRemove(idx);
          }}
          title={
            isPendingRemove
              ? 'Hacer click de nuevo para confirmar eliminación'
              : 'Eliminar este agregado'
          }
          data-testid={`structure-remove-agregado-${idx}`}
        >
          <Trash2 size={15} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      {isPendingRemove ? (
        <p className="structure-editor__agregado-confirm-hint">
          ¿Eliminar? Hacé click de nuevo en el botón para confirmar.
        </p>
      ) : null}

      {isOpen && (
        <div
          id={`structure-agr-body-${idx}`}
          className="structure-editor__agregado-body"
          data-testid={`structure-agr-body-${idx}`}
        >
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
                    onUpdate(idx, {
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
                    onUpdate(idx, {
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
                    onUpdate(idx, {
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
                    onUpdate(idx, {
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
                    onUpdate(idx, {
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
                    onUpdate(idx, {
                      position: {
                        ...inst.position,
                        zFormula: e.target.value,
                      },
                    })
                  }
                  placeholder="Ej. B o B+18"
                  data-testid={`structure-agr-${idx}-pos-z`}
                />
                <span className="catalog-form__hint">Desde base/piso (mm/fórmula)</span>
              </div>
            </div>
          </fieldset>

          <fieldset className="structure-editor__agregado-fieldset">
            <legend className="structure-editor__agregado-legend">
              <Layers size={14} aria-hidden /> Distribución, Repeticiones y Espejado
            </legend>
            <div className="structure-editor__agregado-grid-4col">
              <div className="catalog-form__field">
                <label className="catalog-form__label">Cantidad</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className="catalog-form__input"
                  value={inst.quantity}
                  onChange={(e) =>
                    onUpdate(idx, {
                      quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  data-testid={`structure-agr-${idx}-qty`}
                />
                <span className="catalog-form__hint">Repeticiones (1–20)</span>
              </div>

              <div className="catalog-form__field">
                <label className="catalog-form__label">Dirección Repetición</label>
                <select
                  className="catalog-form__input"
                  value={inst.layoutDirection ?? 'none'}
                  onChange={(e) =>
                    onUpdate(idx, {
                      layoutDirection: e.target.value as
                        | 'vertical'
                        | 'horizontal'
                        | 'none',
                    })
                  }
                  disabled={inst.quantity <= 1}
                  data-testid={`structure-agr-${idx}-layout-dir`}
                >
                  <option value="none">Sin distribución</option>
                  <option value="vertical">Vertical (apilados)</option>
                  <option value="horizontal">Horizontal (en hilera)</option>
                </select>
                <span className="catalog-form__hint">Eje de reparto</span>
              </div>

              <div className="catalog-form__field">
                <label className="catalog-form__label">Separación (Gap mm)</label>
                <input
                  type="number"
                  min={0}
                  className="catalog-form__input"
                  value={inst.gapMm ?? 0}
                  onChange={(e) =>
                    onUpdate(idx, {
                      gapMm: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                  disabled={inst.quantity <= 1}
                  data-testid={`structure-agr-${idx}-gap`}
                />
                <span className="catalog-form__hint">Luz entre unidades</span>
              </div>

              <div className="catalog-form__field catalog-form__field--checkbox-inline">
                <label className="catalog-form__checkbox-label">
                  <input
                    type="checkbox"
                    checked={inst.mirrored ?? false}
                    onChange={(e) =>
                      onUpdate(idx, { mirrored: e.target.checked })
                    }
                    data-testid={`structure-agr-${idx}-mirrored`}
                  />
                  <span>Espejar en X (invertir apertura)</span>
                </label>
                <span className="catalog-form__hint">
                  Apertura derecha vs izquierda
                </span>
              </div>
            </div>
          </fieldset>

          {template && (
            <fieldset className="structure-editor__agregado-fieldset">
              <legend className="structure-editor__agregado-legend">
                <Settings size={14} aria-hidden /> Redefinición de Opciones (Overrides)
              </legend>
              <p className="catalog-form__hint">
                Asigná qué herraje o material usar para los roles variables de
                este agregado. Si no seleccionás ninguno, se usa la opción del
                proyecto.
              </p>

              <div className="structure-editor__agregado-overrides-grid">
                {getOptionRolesForAgregado(template, optionGroups).map((role) => {
                  const currentVal = inst.optionOverrides?.[role] ?? '';
                  const group = optionGroups.find((g) => g.code === role);

                  return (
                    <div key={role} className="catalog-form__field">
                      <label className="catalog-form__label">
                        Rol <code>{role}</code>
                        {group ? ` (${group.name})` : ''}
                      </label>
                      <select
                        className="catalog-form__input"
                        value={currentVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          const nextOverrides = {
                            ...(inst.optionOverrides ?? {}),
                          };
                          if (!val) {
                            delete nextOverrides[role];
                          } else {
                            nextOverrides[role] = val;
                          }
                          const finalOverrides =
                            Object.keys(nextOverrides).length > 0
                              ? nextOverrides
                              : undefined;
                          onUpdate(idx, { optionOverrides: finalOverrides });
                        }}
                        data-testid={`structure-agr-${idx}-override-${role}`}
                      >
                        <option value="">
                          (Heredar de la cotización / automático)
                        </option>
                        {catalogHardware
                          .filter((h) => !group || group.optionIds.includes(h.id))
                          .map((h) => (
                            <option key={h.id} value={h.id}>
                              [{h.code}] {h.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
