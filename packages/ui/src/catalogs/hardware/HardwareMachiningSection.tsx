/**
 * "Maquinado CNC" disclosure for the hardware form modal (F127).
 *
 * Edits the structured machining footprint (parts → operations) carried by
 * the HardwareDraft. Validation itself lives in the domain
 * (validateMachiningProfile) and runs on submit from HardwareCatalog.
 */

import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  HardwareMachiningProfile,
  MachiningEntryFace,
  MachiningOperation,
  MachiningOperationKind,
} from '@muebles/domain';
import { countMachiningOperations } from '@muebles/domain';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { HardwareDraft } from './hardwareDraft';

const OPERATION_KIND_LABELS_ES: Record<MachiningOperationKind, string> = {
  blind_hole: 'Taladro ciego',
  through_hole: 'Taladro pasante',
  counterbore: 'Escareado',
  screw_pilot: 'Piloto de tornillo',
};

const ENTRY_FACE_LABELS_ES: Record<MachiningEntryFace, string> = {
  anchor: 'Cara del anclaje',
  opposite: 'Cara opuesta',
};

function newOperation(kind: MachiningOperationKind): MachiningOperation {
  const defaults: Record<MachiningOperationKind, MachiningOperation> = {
    blind_hole: {
      id: `op-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind,
      diameterMm: 8,
      depthMm: 15,
      xMm: 0,
      yMm: 0,
      face: 'anchor',
    },
    through_hole: {
      id: `op-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind,
      diameterMm: 8,
      xMm: 0,
      yMm: 0,
      face: 'anchor',
    },
    counterbore: {
      id: `op-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind,
      diameterMm: 10,
      depthMm: 5,
      innerDiameterMm: 5,
      xMm: 0,
      yMm: 0,
      face: 'anchor',
    },
    screw_pilot: {
      id: `op-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      kind,
      diameterMm: 5,
      depthMm: 10,
      xMm: 0,
      yMm: 0,
      face: 'anchor',
    },
  };
  return defaults[kind];
}

export interface HardwareMachiningSectionProps {
  /** Modal open flag — resets the disclosure between edit sessions (F117). */
  readonly modalOpen: boolean;
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
}

export function HardwareMachiningSection({
  modalOpen,
  draft,
  setDraft,
}: HardwareMachiningSectionProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [wasModalOpen, setWasModalOpen] = useState(false);
  if (modalOpen && !wasModalOpen) {
    setWasModalOpen(true);
    setOpen(Boolean(draft.machining));
  } else if (!modalOpen && wasModalOpen) {
    setWasModalOpen(false);
  }

  const machining = draft.machining;
  const parts = machining?.parts ?? [];

  const setParts = (next: HardwareMachiningProfile | null) => {
    setDraft((prev) => ({
      ...prev,
      machining: next && next.parts.length > 0 ? next : null,
    }));
  };

  const updatePart = (partIndex: number, patch: Partial<{ role: string }>) => {
    setParts({
      parts: parts.map((part, i) =>
        i === partIndex ? { ...part, ...patch } : part,
      ),
    });
  };

  const removePart = (partIndex: number) => {
    setParts({ parts: parts.filter((_, i) => i !== partIndex) });
  };

  const updateOperation = (
    partIndex: number,
    opIndex: number,
    patch: Partial<MachiningOperation>,
  ) => {
    setParts({
      parts: parts.map((part, i) =>
        i === partIndex
          ? {
              ...part,
              operations: part.operations.map((op, j) =>
                j === opIndex ? { ...op, ...patch } : op,
              ),
            }
          : part,
      ),
    });
  };

  const removeOperation = (partIndex: number, opIndex: number) => {
    setParts({
      parts: parts.map((part, i) =>
        i === partIndex
          ? {
              ...part,
              operations:
                part.operations.length > 1
                  ? part.operations.filter((_, j) => j !== opIndex)
                  : part.operations,
            }
          : part,
      ),
    });
  };

  const summary = machining
    ? `${parts.length} ${parts.length === 1 ? 'parte' : 'partes'} · ${countMachiningOperations(machining)} ${countMachiningOperations(machining) === 1 ? 'operación' : 'operaciones'}`
    : 'Opcional — perforaciones para CNC';

  return (
    <div className="catalog-form__disclosure" data-testid="hardware-machining">
      <button
        type="button"
        className="catalog-form__disclosure-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="hardware-machining-toggle"
      >
        {open ? (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
        )}
        <span className="catalog-form__disclosure-title">Maquinado CNC</span>
        <span className="catalog-form__disclosure-summary">{summary}</span>
      </button>
      {open ? (
        <div
          className="catalog-form__disclosure-body"
          data-testid="hardware-machining-body"
        >
          <p className="catalog-form__hint">
            Huella de perforación del herraje: cada parte (taza, cazuela,
            placa…) declara sus operaciones en mm, medidas desde el punto donde
            se ancla el herraje. El tornillo de un minifix o la placa de una
            bisagra van como partes separadas.
          </p>
          <div className="hardware-machining__parts">
            {parts.map((part, partIndex) => (
              <div
                className="hardware-machining__part"
                key={part.id}
                data-testid={`hardware-machining-part-${partIndex}`}
              >
              <div className="hardware-machining__part-header">
                <label className="catalog-form__field">
                  <span>Rol de la parte</span>
                  <input
                    value={part.role}
                    onChange={(e) => updatePart(partIndex, { role: e.target.value })}
                    placeholder="ej. taza, cazuela, placa, perno"
                    required
                    data-testid={`hardware-machining-role-${partIndex}`}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--small btn--ghost btn--danger"
                  aria-label={`Quitar parte ${part.role || partIndex + 1}`}
                  onClick={() => removePart(partIndex)}
                >
                  <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                  Quitar
                </button>
              </div>
              <div className="hardware-machining__ops">
                {part.operations.map((op, opIndex) => (
                  <div
                    className="hardware-machining__op"
                    key={op.id}
                    data-testid={`hardware-machining-op-${partIndex}-${opIndex}`}
                  >
                    <div className="hardware-machining__op-header">
                      <span className="hardware-machining__op-title">
                        {op.label?.trim()
                          ? op.label
                          : `Operación ${opIndex + 1}`}
                      </span>
                      {part.operations.length > 1 ? (
                        <button
                          type="button"
                          className="btn btn--small btn--ghost btn--danger"
                          aria-label={`Quitar operación ${opIndex + 1} de ${part.role || 'la parte'}`}
                          onClick={() => removeOperation(partIndex, opIndex)}
                        >
                          <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    <div className="hardware-machining__op-grid">
                      <label className="catalog-form__field">
                        <span>Tipo</span>
                        <select
                          value={op.kind}
                          onChange={(e) => {
                            const kind = e.target.value as MachiningOperationKind;
                            updateOperation(partIndex, opIndex, {
                              ...newOperation(kind),
                              id: op.id,
                              label: op.label,
                              xMm: op.xMm,
                              yMm: op.yMm,
                              face: op.face,
                            });
                          }}
                          data-testid={`hardware-machining-kind-${partIndex}-${opIndex}`}
                        >
                          {(
                            Object.keys(OPERATION_KIND_LABELS_ES) as MachiningOperationKind[]
                          ).map((kind) => (
                            <option key={kind} value={kind}>
                              {OPERATION_KIND_LABELS_ES[kind]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="catalog-form__field">
                        <span>Diámetro (mm)</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={op.diameterMm}
                          onChange={(e) =>
                            updateOperation(partIndex, opIndex, {
                              diameterMm: Number(e.target.value),
                            })
                          }
                          required
                          data-testid={`hardware-machining-diameter-${partIndex}-${opIndex}`}
                        />
                      </label>
                      {op.kind !== 'through_hole' ? (
                        <label className="catalog-form__field">
                          <span>Profundidad (mm)</span>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={op.depthMm ?? 0}
                            onChange={(e) =>
                              updateOperation(partIndex, opIndex, {
                                depthMm: Number(e.target.value),
                              })
                            }
                            required
                            data-testid={`hardware-machining-depth-${partIndex}-${opIndex}`}
                          />
                        </label>
                      ) : null}
                      {op.kind === 'counterbore' ? (
                        <label className="catalog-form__field">
                          <span>Ø interior (mm)</span>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={op.innerDiameterMm ?? 0}
                            onChange={(e) =>
                              updateOperation(partIndex, opIndex, {
                                innerDiameterMm: Number(e.target.value),
                              })
                            }
                            required
                            data-testid={`hardware-machining-inner-${partIndex}-${opIndex}`}
                          />
                        </label>
                      ) : null}
                      <label className="catalog-form__field">
                        <span>Offset X (mm)</span>
                        <input
                          type="number"
                          step="any"
                          value={op.xMm}
                          onChange={(e) =>
                            updateOperation(partIndex, opIndex, {
                              xMm: Number(e.target.value),
                            })
                          }
                          data-testid={`hardware-machining-x-${partIndex}-${opIndex}`}
                        />
                      </label>
                      <label className="catalog-form__field">
                        <span>Offset Y (mm)</span>
                        <input
                          type="number"
                          step="any"
                          value={op.yMm}
                          onChange={(e) =>
                            updateOperation(partIndex, opIndex, {
                              yMm: Number(e.target.value),
                            })
                          }
                          data-testid={`hardware-machining-y-${partIndex}-${opIndex}`}
                        />
                      </label>
                      <label className="catalog-form__field">
                        <span>Cara de entrada</span>
                        <select
                          value={op.face}
                          onChange={(e) =>
                            updateOperation(partIndex, opIndex, {
                              face: e.target.value as MachiningEntryFace,
                            })
                          }
                          data-testid={`hardware-machining-face-${partIndex}-${opIndex}`}
                        >
                          {(
                            Object.keys(ENTRY_FACE_LABELS_ES) as MachiningEntryFace[]
                          ).map((face) => (
                            <option key={face} value={face}>
                              {ENTRY_FACE_LABELS_ES[face]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="catalog-form__field hardware-machining__label-field">
                        <span>Nombre (opcional)</span>
                        <input
                          value={op.label ?? ''}
                          onChange={(e) =>
                            updateOperation(partIndex, opIndex, {
                              label: e.target.value,
                            })
                          }
                          placeholder="ej. Taza 35 mm"
                          data-testid={`hardware-machining-label-${partIndex}-${opIndex}`}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hardware-machining__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() =>
                    setParts({
                      parts: parts.map((part, i) =>
                        i === partIndex
                          ? {
                              ...part,
                              operations: [
                                ...part.operations,
                                newOperation('blind_hole'),
                              ],
                            }
                          : part,
                      ),
                    })
                  }
                  data-testid={`hardware-machining-add-op-${partIndex}`}
                >
                  <Plus size={14} strokeWidth={1.5} aria-hidden />
                  Operación
                </button>
              </div>
              </div>
            ))}
          </div>
          <div className="hardware-machining__actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={() =>
                setParts({
                  parts: [
                    ...parts,
                    {
                      id: `part-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                      role: '',
                      operations: [newOperation('blind_hole')],
                    },
                  ],
                })
              }
              data-testid="hardware-machining-add-part"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              Parte
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
