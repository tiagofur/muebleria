/**
 * Tabular editor for `hardwarePlacements` attached to a component instance
 * (handles, hinges anchored to a board face at X%/Y%). Stateless — the parent
 * owns the placements array and is notified via onChange.
 *
 * Precursor to F070 (interactive 3D gizmo): the placements authored here are
 * the data the CNC perforation pipeline will consume later, and what the 3D
 * viewer renders via HardwareMesh. Percentages are stored in [0,100] (the
 * resolver contract — not [0,1]).
 */

import type { ReactNode } from 'react';
import type { AnchorFace, Hardware, HardwarePlacement } from '@muebles/domain';
import { CatalogPicker } from '../../catalogs/CatalogPicker';

export type HardwarePlacementsEditorProps = {
  readonly placements: readonly HardwarePlacement[];
  readonly catalogHardware: readonly Hardware[];
  readonly onChange: (
    next: readonly HardwarePlacement[] | undefined,
  ) => void;
  readonly testIdSuffix?: string;
};

const ANCHOR_FACE_OPTIONS: readonly { value: AnchorFace; label: string }[] = [
  { value: 'front', label: 'Frente' },
  { value: 'back', label: 'Fondo' },
  { value: 'left', label: 'Izquierda' },
  { value: 'right', label: 'Derecha' },
  { value: 'top', label: 'Arriba' },
  { value: 'bottom', label: 'Abajo' },
];

export function HardwarePlacementsEditor({
  placements,
  catalogHardware,
  onChange,
  testIdSuffix,
}: HardwarePlacementsEditorProps): ReactNode {
  const suffix = testIdSuffix ? `-${testIdSuffix}` : '';
  const pickerItems = catalogHardware.map((h) => ({
    id: h.id,
    code: h.code,
    name: h.name,
    active: h.active,
  }));

  const update = (idx: number, patch: Partial<HardwarePlacement>) => {
    onChange(
      placements.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  };

  const remove = (idx: number) => {
    const next = placements.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : undefined);
  };

  const add = () => {
    const firstHw = catalogHardware[0];
    onChange([
      ...placements,
      {
        hardwareId: firstHw?.id ?? '',
        anchorFace: 'front',
        relativePosition: { xPercent: 50, yPercent: 50 },
      },
    ]);
  };

  const updateRotation = (
    idx: number,
    axis: 'x' | 'y' | 'z',
    value: number,
  ) => {
    const current = placements[idx];
    if (!current) return;
    update(idx, {
      rotationDeg: { ...current.rotationDeg, [axis]: value },
    });
  };

  return (
    <div
      className="instance-hardware-placements"
      data-testid={`instance-hardware-placements${suffix}`}
    >
      <div className="module-editor__section-header">
        <h5 className="module-part-card__title">
          Herrajes ({placements.length})
        </h5>
        <button
          type="button"
          className="btn btn--small"
          onClick={add}
          disabled={catalogHardware.length === 0}
          data-testid={`instance-hardware-placements${suffix}-add`}
        >
          Añadir herraje
        </button>
      </div>
      {placements.length === 0 ? (
        <p className="catalog-empty">
          Sin herrajes posicionados en esta pieza.
        </p>
      ) : (
        <div className="module-part-list">
          {placements.map((p, idx) => (
            <div
              key={idx}
              className="module-part-card"
              data-testid={`instance-hardware-placement-${idx}${suffix}`}
            >
              <div className="module-part-card__header">
                <span className="module-part-card__title">
                  Herraje {idx + 1}
                </span>
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={() => remove(idx)}
                  data-testid={`instance-hardware-placement-${idx}${suffix}-remove`}
                >
                  Quitar
                </button>
              </div>
              <div className="module-editor__grid">
                <CatalogPicker
                  id={`hw-placement-hw-${idx}${suffix}`}
                  label="Herraje"
                  placeholder="Seleccionar herraje…"
                  searchPlaceholder="Buscar herraje…"
                  value={p.hardwareId}
                  onChange={(hardwareId) => update(idx, { hardwareId })}
                  items={pickerItems}
                  data-testid={`instance-hardware-placement-${idx}${suffix}-hw`}
                />
                <div className="catalog-form__field">
                  <label htmlFor={`hw-placement-face-${idx}${suffix}`}>
                    Cara
                  </label>
                  <select
                    id={`hw-placement-face-${idx}${suffix}`}
                    value={p.anchorFace}
                    onChange={(e) =>
                      update(idx, { anchorFace: e.target.value as AnchorFace })
                    }
                    data-testid={`instance-hardware-placement-${idx}${suffix}-face`}
                  >
                    {ANCHOR_FACE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="catalog-form__field catalog-form__field--narrow">
                  <label htmlFor={`hw-placement-x-${idx}${suffix}`}>X %</label>
                  <input
                    id={`hw-placement-x-${idx}${suffix}`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={p.relativePosition.xPercent}
                    onChange={(e) =>
                      update(idx, {
                        relativePosition: {
                          ...p.relativePosition,
                          xPercent: Number(e.target.value),
                        },
                      })
                    }
                    data-testid={`instance-hardware-placement-${idx}${suffix}-x`}
                  />
                </div>
                <div className="catalog-form__field catalog-form__field--narrow">
                  <label htmlFor={`hw-placement-y-${idx}${suffix}`}>Y %</label>
                  <input
                    id={`hw-placement-y-${idx}${suffix}`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={p.relativePosition.yPercent}
                    onChange={(e) =>
                      update(idx, {
                        relativePosition: {
                          ...p.relativePosition,
                          yPercent: Number(e.target.value),
                        },
                      })
                    }
                    data-testid={`instance-hardware-placement-${idx}${suffix}-y`}
                  />
                </div>
              </div>

              <div className="module-editor__grid">
                <div className="catalog-form__field catalog-form__field--narrow">
                  <label htmlFor={`hw-placement-rx-${idx}${suffix}`}>
                    Rot X (°)
                  </label>
                  <input
                    id={`hw-placement-rx-${idx}${suffix}`}
                    type="number"
                    value={p.rotationDeg?.x ?? 0}
                    onChange={(e) =>
                      updateRotation(idx, 'x', Number(e.target.value))
                    }
                    data-testid={`instance-hardware-placement-${idx}${suffix}-rx`}
                  />
                </div>
                <div className="catalog-form__field catalog-form__field--narrow">
                  <label htmlFor={`hw-placement-ry-${idx}${suffix}`}>
                    Rot Y (°)
                  </label>
                  <input
                    id={`hw-placement-ry-${idx}${suffix}`}
                    type="number"
                    value={p.rotationDeg?.y ?? 0}
                    onChange={(e) =>
                      updateRotation(idx, 'y', Number(e.target.value))
                    }
                    data-testid={`instance-hardware-placement-${idx}${suffix}-ry`}
                  />
                </div>
                <div className="catalog-form__field catalog-form__field--narrow">
                  <label htmlFor={`hw-placement-rz-${idx}${suffix}`}>
                    Rot Z (°)
                  </label>
                  <input
                    id={`hw-placement-rz-${idx}${suffix}`}
                    type="number"
                    value={p.rotationDeg?.z ?? 0}
                    onChange={(e) =>
                      updateRotation(idx, 'z', Number(e.target.value))
                    }
                    data-testid={`instance-hardware-placement-${idx}${suffix}-rz`}
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
