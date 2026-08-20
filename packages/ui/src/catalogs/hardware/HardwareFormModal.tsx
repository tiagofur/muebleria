/**
 * Create/edit hardware modal (SM) — Identidad / Compra / Vista 3D
 * disclosure (F069 shape + finish preset; F080 per-part finishes) / Maquinado
 * CNC disclosure (F127 drilling footprint).
 * Owns the preview disclosure state; resets it every time the modal opens
 * (F117 fix: it used to stay open between edit sessions).
 */

import {
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Hardware, HardwareUnit } from '@muebles/domain';
import {
  HARDWARE_FINISHES,
  HARDWARE_PART_ROLE_LABELS_ES,
  hardwarePartRolesForShape,
  matchHardwareFinish,
} from '@muebles/domain';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CatalogImage, Modal } from '../../common';
import { HardwareMachiningSection } from './HardwareMachiningSection';
import { UNIT_LABELS, type HardwareDraft } from './hardwareDraft';

export interface HardwareFormModalProps {
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
  readonly error: string | null;
  readonly canMutate: boolean;
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onClose: () => void;
}

export function HardwareFormModal({
  open,
  editingId,
  formId,
  draft,
  setDraft,
  error,
  canMutate,
  onUploadImage,
  resolveImageUrl,
  onSubmit,
  onClose,
}: HardwareFormModalProps): ReactNode {
  const [preview3dOpen, setPreview3dOpen] = useState(false);

  // Reset the disclosure each time the modal opens: editing an item with a
  // configured shape opens it, creating starts collapsed (F117 fix).
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setPreview3dOpen(Boolean(draft.previewShape));
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const selectedFinishId = matchHardwareFinish({
    color: draft.previewColor,
    metalness: draft.previewMetalness,
    roughness: draft.previewRoughness,
    clearcoat: draft.previewClearcoat,
  });

  /** F080: part-finish selectors appear for multi-part shapes only. */
  const partRoles = (() => {
    const validShapes: readonly string[] = [
      'knob',
      'bar-pull',
      'cup-pull',
      'hinge',
      'slide',
      'rail',
      'leg',
    ];
    if (!validShapes.includes(draft.previewShape)) return [];
    const roles = hardwarePartRolesForShape(
      draft.previewShape as NonNullable<Hardware['previewShape']>,
    );
    return roles.length >= 2 ? roles : [];
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId ? 'Editar herraje' : 'Nuevo herraje'}
      size="sm"
      dataTestId="hardware-form-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" form={formId}>
            Guardar
          </button>
        </>
      }
    >
      <form id={formId} className="catalog-form" onSubmit={onSubmit}>
        {error ? <p className="catalog-form__error">{error}</p> : null}

        <fieldset
          className="catalog-form__section"
          data-testid="hardware-form-identity"
        >
          <legend className="catalog-form__section-title">Identidad</legend>
          <div className="catalog-form__field">
            <label htmlFor="hw-code">Código</label>
            <input
              id="hw-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="hw-name">Nombre</label>
            <input
              id="hw-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div
            className="catalog-form__field"
            data-testid="hardware-image-field"
          >
            <label htmlFor="hw-image">Foto</label>
            <div className="catalog-form__image-row">
              <CatalogImage
                src={resolveImageUrl(draft.imageUrl || undefined)}
                alt={draft.name || 'Herraje'}
                size="md"
              />
              {canMutate && onUploadImage ? (
                <input
                  id="hw-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void onUploadImage(file)
                      .then((url) => setDraft({ ...draft, imageUrl: url }))
                      .catch(() => {
                        /* shell toasts */
                      });
                    e.target.value = '';
                  }}
                />
              ) : (
                <p className="catalog-form__hint">
                  {draft.imageUrl ? 'Foto cargada' : 'Sin foto'}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset
          className="catalog-form__section"
          data-testid="hardware-form-purchase"
        >
          <legend className="catalog-form__section-title">Compra</legend>
          <div className="catalog-form__field">
            <label htmlFor="hw-unit">Unidad</label>
            <select
              id="hw-unit"
              value={draft.unit}
              onChange={(e) =>
                setDraft({ ...draft, unit: e.target.value as HardwareUnit })
              }
            >
              <option value="piece">{UNIT_LABELS.piece}</option>
              <option value="set">{UNIT_LABELS.set}</option>
              <option value="meter">{UNIT_LABELS.meter}</option>
            </select>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="hw-cost">Costo unitario</label>
            <input
              id="hw-cost"
              type="number"
              min={0}
              step="any"
              value={draft.costPerUnit}
              onChange={(e) =>
                setDraft({ ...draft, costPerUnit: Number(e.target.value) })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="hw-package">
              Empaque (misma unidad)
            </label>
            <input
              id="hw-package"
              type="number"
              min={0}
              step="any"
              value={draft.packageSize}
              onChange={(e) =>
                setDraft({ ...draft, packageSize: e.target.value })
              }
              placeholder={
                draft.unit === 'meter'
                  ? 'ej. 4 (barra de 4 m)'
                  : 'Opcional'
              }
              data-testid="hardware-package-size"
            />
            <p className="catalog-form__hint">
              La lista de compra redondea el consumo hacia arriba a paquetes
              (ej. zoclo en barras de 4 m).
            </p>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="hw-notes">Notas</label>
            <textarea
              id="hw-notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </fieldset>

        {/* F069: 3D preview — shape + finish preset + color (progressive disclosure) */}
        <div className="catalog-form__disclosure" data-testid="hardware-preview-3d">
          <button
            type="button"
            className="catalog-form__disclosure-header"
            aria-expanded={preview3dOpen}
            onClick={() => setPreview3dOpen((o) => !o)}
            data-testid="hardware-preview-3d-toggle"
          >
            {preview3dOpen ? (
              <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
            )}
            <span className="catalog-form__disclosure-title">Vista 3D</span>
            <span className="catalog-form__disclosure-summary">
              {draft.previewShape
                ? 'Configurado'
                : 'Opcional — forma, acabado y color'}
            </span>
          </button>
          {preview3dOpen ? (
            <div
              className="catalog-form__disclosure-body"
              data-testid="hardware-preview-3d-body"
            >
              <div className="catalog-form__row">
                <label className="catalog-form__field">
                  <span>Forma (3D)</span>
                  <select
                    value={draft.previewShape}
                    onChange={(e) => setDraft({ ...draft, previewShape: e.target.value })}
                    data-testid="hardware-form-shape"
                  >
                    <option value="">— Sin forma —</option>
                    <option value="knob">Tirador (perilla)</option>
                    <option value="bar-pull">Tirador (barra)</option>
                    <option value="cup-pull">Tirador (copa)</option>
                    <option value="hinge">Bisagra</option>
                    <option value="slide">Corredera</option>
                    <option value="rail">Riel</option>
                    <option value="leg">Pata</option>
                  </select>
                </label>
                <label className="catalog-form__field">
                  <span>Acabado</span>
                  <select
                    value={selectedFinishId}
                    onChange={(e) => {
                      const finish = HARDWARE_FINISHES.find((f) => f.id === e.target.value);
                      if (finish) {
                        setDraft({
                          ...draft,
                          previewColor: finish.color,
                          previewMetalness: String(finish.metalness),
                          previewRoughness: String(finish.roughness),
                          previewClearcoat: String(finish.clearcoat),
                        });
                      }
                    }}
                    data-testid="hardware-form-finish"
                  >
                    <option value="">— Personalizado —</option>
                    {HARDWARE_FINISHES.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="catalog-form__row">
                <label className="catalog-form__field">
                  <span>Color</span>
                  <input
                    type="color"
                    value={draft.previewColor || '#9aa0a6'}
                    onChange={(e) => setDraft({ ...draft, previewColor: e.target.value })}
                    data-testid="hardware-form-color"
                  />
                </label>
                {draft.previewColor ? (
                  <span
                    className="material-color-swatch"
                    style={{ backgroundColor: draft.previewColor }}
                    aria-label={draft.previewColor}
                    data-testid="hardware-form-color-swatch"
                  />
                ) : null}
              </div>
              {partRoles.length > 0 ? (
                <>
                  <div
                    className="catalog-form__row"
                    data-testid="hardware-form-part-finishes"
                  >
                    {partRoles.map((role) => (
                      <label
                        key={role}
                        className="catalog-form__field"
                      >
                        <span>Acabado · {HARDWARE_PART_ROLE_LABELS_ES[role]}</span>
                        <select
                          value={draft.partFinishes[role]}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              partFinishes: {
                                ...draft.partFinishes,
                                [role]: e.target.value,
                              },
                            })
                          }
                          data-testid={`hardware-form-finish-${role}`}
                        >
                          <option value="">Igual al acabado general</option>
                          {HARDWARE_FINISHES.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="catalog-form__hint">
                    Cada parte puede llevar su propio acabado (F080). Vacío =
                    usa el acabado general de arriba.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* F127: CNC machining footprint (parts + drilling operations). */}
        <HardwareMachiningSection
          modalOpen={open}
          draft={draft}
          setDraft={setDraft}
        />
      </form>
    </Modal>
  );
}
