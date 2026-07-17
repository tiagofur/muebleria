/**
 * Module editor — Hardware tab.
 */

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { Hardware, OptionGroup } from '@muebles/domain';
import { CatalogPicker } from '../../catalogs/CatalogPicker';
import {
  moduleHardwareGridInputId,
  type HardwareLineDraft,
} from '../moduleHelpers';

export type ModuleEditorHardwarePanelProps = {
  readonly hardwareLines: readonly HardwareLineDraft[];
  readonly hardwareRoles: readonly OptionGroup[];
  readonly activeHardware: readonly Hardware[];
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (id: string, patch: Partial<HardwareLineDraft>) => void;
  readonly onGridKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  readonly hidden: boolean;
};

export function ModuleEditorHardwarePanel({
  hardwareLines,
  hardwareRoles,
  activeHardware,
  onAdd,
  onRemove,
  onUpdate,
  onGridKeyDown,
  hidden,
}: ModuleEditorHardwarePanelProps): ReactNode {
  return (
    <div
      className="module-editor__section"
      role="tabpanel"
      id="module-editor-panel-hardware"
      aria-labelledby="module-editor-tab-hardware"
      hidden={hidden}
      data-testid="module-editor-panel-hardware"
    >
      <div className="module-editor__section-header">
        <h4 className="module-editor__section-title">
          Herrajes ({hardwareLines.length})
        </h4>
        <button type="button" className="btn btn--small" onClick={onAdd}>
          Agregar herraje
        </button>
      </div>
      {hardwareLines.length === 0 ? (
        <p className="catalog-empty">Sin líneas de herraje.</p>
      ) : (
        <div
          className="module-part-list"
          data-testid="module-hardware-grid"
          onKeyDown={onGridKeyDown}
        >
          {hardwareLines.map((line, index) => (
            <div key={line.id} className="module-part-card">
              <div className="module-part-card__header">
                <h5 className="module-part-card__title">
                  Herraje {index + 1}
                </h5>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={() => onRemove(line.id)}
                >
                  Quitar
                </button>
              </div>
              <div className="module-editor__grid">
                <div className="catalog-form__field">
                  <label htmlFor={moduleHardwareGridInputId(line.id, 'mode')}>
                    Modo
                  </label>
                  <select
                    id={moduleHardwareGridInputId(line.id, 'mode')}
                    data-grid-row={line.id}
                    data-grid-field="mode"
                    value={line.mode}
                    onChange={(e) => {
                      const mode = e.target.value as 'role' | 'fixed';
                      onUpdate(line.id, {
                        mode,
                        optionRole:
                          mode === 'fixed'
                            ? line.optionRole || 'FIXED'
                            : line.optionRole === 'FIXED'
                              ? (hardwareRoles[0]?.code ?? '')
                              : line.optionRole,
                        hardwareId: mode === 'role' ? '' : line.hardwareId,
                      });
                    }}
                  >
                    <option value="role">Por rol de opción</option>
                    <option value="fixed">Herraje fijo</option>
                  </select>
                </div>
                <div className="catalog-form__field">
                  <label htmlFor={moduleHardwareGridInputId(line.id, 'qty')}>
                    Cantidad
                  </label>
                  <input
                    id={moduleHardwareGridInputId(line.id, 'qty')}
                    data-grid-row={line.id}
                    data-grid-field="qty"
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) =>
                      onUpdate(line.id, {
                        quantity: Number(e.target.value),
                      })
                    }
                  />
                </div>
                {line.mode === 'role' ? (
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-role-${line.id}`}>
                      Rol (optionRole)
                    </label>
                    <select
                      id={`hw-role-${line.id}`}
                      value={line.optionRole}
                      onChange={(e) =>
                        onUpdate(line.id, {
                          optionRole: e.target.value,
                        })
                      }
                    >
                      <option value="">Seleccionar grupo…</option>
                      {hardwareRoles.map((g) => (
                        <option key={g.id} value={g.code}>
                          {g.name} ({g.code})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <CatalogPicker
                    id={`hw-id-${line.id}`}
                    label="Herraje fijo"
                    placeholder="Seleccionar herraje…"
                    searchPlaceholder="Buscar herraje…"
                    value={line.hardwareId}
                    onChange={(hardwareId) =>
                      onUpdate(line.id, {
                        hardwareId,
                        optionRole: line.optionRole || 'FIXED',
                      })
                    }
                    items={activeHardware.map((h) => ({
                      id: h.id,
                      code: h.code,
                      name: h.name,
                      active: h.active,
                    }))}
                    data-testid={`module-hardware-picker-${line.id}`}
                  />
                )}
                <div className="catalog-form__field">
                  <label htmlFor={`hw-desc-${line.id}`}>
                    Descripción (opcional)
                  </label>
                  <input
                    id={`hw-desc-${line.id}`}
                    value={line.descriptionOverride}
                    onChange={(e) =>
                      onUpdate(line.id, {
                        descriptionOverride: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
