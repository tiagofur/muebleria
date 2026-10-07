/**
 * Tabular editor for `hardwarePlacements` attached to a component instance
 * (handles, hinges anchored to a board face at X%/Y%). Stateless — the parent
 * owns the placements array and is notified via onChange.
 *
 * Each row picks its concrete hardware two ways (#1046): a hardware OPTION
 * GROUP (the concrete item — Blum vs Hafele vs económica — is chosen later as
 * a project choice) or a SPECIFIC catalog hardware. Group placements resolve
 * before drilling/machining/demand; here they only author intent.
 *
 * Precursor to F070 (interactive 3D gizmo): the placements authored here are
 * the data the CNC perforation pipeline will consume later, and what the 3D
 * viewer renders via HardwareMesh. Percentages are stored in [0,100] (the
 * resolver contract — not [0,1]).
 */

import type { ReactNode } from 'react';
import type { AnchorFace, Hardware, HardwarePlacement, OptionGroup } from '@granete/domain';
import { CatalogPicker } from '../../catalogs/CatalogPicker';
import { formatMoneyDisplay } from '../../common/formatMoneyDisplay';

export type HardwarePlacementsEditorProps = {
  readonly placements: readonly HardwarePlacement[];
  readonly catalogHardware: readonly Hardware[];
  /**
   * Hardware-kind option groups available for the "por grupo" mode (#1046).
   * Undefined/empty keeps the editor specific-only (backwards compatible).
   */
  readonly optionGroups?: readonly OptionGroup[];
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

/**
 * Members of a hardware option group with their unit cost — the same hint
 * everywhere a group is picked (#1046): placements editor and the agregado's
 * "en cantidad" list. The choice happens later, at quote time; what the
 * author sees here is what each member costs.
 */
export function hardwareGroupMembersHint(
  group: Pick<OptionGroup, 'optionIds'>,
  catalogHardware: readonly Hardware[],
): string {
  const members = group.optionIds
    .map((id) => catalogHardware.find((h) => h.id === id))
    .filter((h): h is Hardware => Boolean(h));
  if (members.length === 0) return 'Sin miembros activos.';
  return members
    .map((h) => `${h.code} — ${h.name} (${formatMoneyDisplay(h.costPerUnit, { showCurrency: false })})`)
    .join(' · ');
}

export function HardwarePlacementsEditor({
  placements,
  catalogHardware,
  optionGroups,
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
  const hardwareGroups = (optionGroups ?? []).filter((g) => g.kind === 'hardware');

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
        relativePosition: { xMm: 50, yMm: 50 },
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

  const membersHintFor = (group: OptionGroup): string =>
    hardwareGroupMembersHint(group, catalogHardware);

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
      <p className="catalog-form__hint">
        Posición en mm o fórmula (ej. 50, W / 2, L - 80) desde la esquina de la
        cara. Es la base de las perforaciones.
      </p>
      {placements.length === 0 ? (
        <p className="catalog-empty">
          Sin herrajes posicionados en esta pieza.
        </p>
      ) : (
        <div className="module-part-list">
          {placements.map((p, idx) => {
            const mode =
              p.optionRole && !p.hardwareId ? 'grupo' : 'especifico';
            const selectedGroup = hardwareGroups.find(
              (g) => g.code === p.optionRole,
            );
            return (
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
                {hardwareGroups.length > 0 ? (
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-placement-mode-${idx}${suffix}`}>
                      Modo
                    </label>
                    <select
                      id={`hw-placement-mode-${idx}${suffix}`}
                      value={mode}
                      onChange={(e) => {
                        if (e.target.value === 'grupo') {
                          update(idx, {
                            hardwareId: undefined,
                            optionRole:
                              hardwareGroups.find((g) => g.code === p.optionRole)?.code ??
                              hardwareGroups[0]?.code ??
                              '',
                          });
                        } else {
                          update(idx, {
                            hardwareId:
                              catalogHardware.find((h) => h.id === p.hardwareId)?.id ??
                              catalogHardware[0]?.id ??
                              '',
                            optionRole: undefined,
                          });
                        }
                      }}
                      data-testid={`instance-hardware-placement-${idx}${suffix}-mode`}
                    >
                      <option value="especifico">Herraje específico</option>
                      <option value="grupo">Grupo de opciones</option>
                    </select>
                  </div>
                ) : null}
                {mode === 'grupo' ? (
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-placement-group-${idx}${suffix}`}>
                      Grupo de herrajes
                    </label>
                    <select
                      id={`hw-placement-group-${idx}${suffix}`}
                      value={p.optionRole ?? ''}
                      onChange={(e) => update(idx, { optionRole: e.target.value })}
                      data-testid={`instance-hardware-placement-${idx}${suffix}-group`}
                    >
                      {!p.optionRole ? <option value="">Seleccionar grupo…</option> : null}
                      {!hardwareGroups.some((g) => g.code === p.optionRole) && p.optionRole ? (
                        <option value={p.optionRole}>{p.optionRole} (guardado)</option>
                      ) : null}
                      {hardwareGroups.map((g) => (
                        <option key={g.id} value={g.code}>
                          {g.name} ({g.code})
                        </option>
                      ))}
                    </select>
                    {selectedGroup ? (
                      <p
                        className="catalog-form__hint"
                        data-testid={`instance-hardware-placement-${idx}${suffix}-members`}
                      >
                        Se elige al cotizar: {membersHintFor(selectedGroup)}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <CatalogPicker
                    id={`hw-placement-hw-${idx}${suffix}`}
                    label="Herraje"
                    placeholder="Seleccionar herraje…"
                    searchPlaceholder="Buscar herraje…"
                    value={p.hardwareId ?? ''}
                    onChange={(hardwareId) => update(idx, { hardwareId })}
                    items={pickerItems}
                    data-testid={`instance-hardware-placement-${idx}${suffix}-hw`}
                  />
                )}
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
                <div className="catalog-form__field">
                  <label htmlFor={`hw-placement-x-${idx}${suffix}`}>X (mm o fórmula)</label>
                  <input
                    id={`hw-placement-x-${idx}${suffix}`}
                    type="text"
                    className="catalog-form__input"
                    placeholder="ej: 50 ó W / 2"
                    value={p.relativePosition.xFormula ?? p.relativePosition.xMm}
                    onChange={(e) => {
                      const val = e.target.value;
                      const num = Number(val);
                      const isSimpleNum = !isNaN(num) && val.trim() !== '';
                      update(idx, {
                        relativePosition: {
                          ...p.relativePosition,
                          xMm: isSimpleNum ? num : (p.relativePosition.xMm ?? 0),
                          xFormula: isSimpleNum ? undefined : val,
                        },
                      });
                    }}
                    data-testid={`instance-hardware-placement-${idx}${suffix}-x`}
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor={`hw-placement-y-${idx}${suffix}`}>Y (mm o fórmula)</label>
                  <input
                    id={`hw-placement-y-${idx}${suffix}`}
                    type="text"
                    className="catalog-form__input"
                    placeholder="ej: 50 ó L - 80"
                    value={p.relativePosition.yFormula ?? p.relativePosition.yMm}
                    onChange={(e) => {
                      const val = e.target.value;
                      const num = Number(val);
                      const isSimpleNum = !isNaN(num) && val.trim() !== '';
                      update(idx, {
                        relativePosition: {
                          ...p.relativePosition,
                          yMm: isSimpleNum ? num : (p.relativePosition.yMm ?? 0),
                          yFormula: isSimpleNum ? undefined : val,
                        },
                      });
                    }}
                    data-testid={`instance-hardware-placement-${idx}${suffix}-y`}
                  />
                </div>
              </div>

              <div className="module-editor__grid module-editor__grid--rotations">
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
            );
          })}
        </div>
      )}
    </div>
  );
}
