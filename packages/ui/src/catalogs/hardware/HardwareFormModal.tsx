/**
 * Create/edit hardware modal (SM) — Identidad / Compra / Vista 3D
 * disclosure (F069 shape + finish preset; F080 per-part finishes) / Maquinado
 * CNC disclosure (F127 drilling footprint).
 * Owns the preview disclosure state; resets it every time the modal opens
 * (F117 fix: it used to stay open between edit sessions).
 */

import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  formatKitPartPlacementLabel,
  resolveKitPartConfig,
  type Agregado,
  type Hardware,
  type HardwareUnit,
  type KitPartPlacementConfig,
} from '@granete/domain';
import type { HardwareAssetService } from '@granete/storage';
import { CatalogImage, Modal } from '../../common';
import { Hardware3DSection } from './Hardware3DSection';
import { HardwareMachiningSection } from './HardwareMachiningSection';
import { HardwareDesignPartsSection } from './HardwareDesignPartsSection';
import { UNIT_LABELS, type HardwareDraft } from './hardwareDraft';

const KIT_PART_ACTOR_OPTIONS = [
  { value: 'body', label: 'Fija al mueble (no se mueve)' },
  { value: 'actor:drawer', label: 'Móvil — sale con el cajón' },
  { value: 'actor:door', label: 'Móvil — abre con la puerta' },
] as const;

const KIT_PART_XREF_OPTIONS = [
  { value: 'min', label: 'Izquierda' },
  { value: 'max', label: 'Derecha' },
  { value: 'center', label: 'Centro' },
] as const;

export interface HardwareFormModalProps {
  /** K4 #1032: saved identity of the edited item, shown in the title. */
  readonly identity?: { readonly code: string; readonly name: string };
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
  readonly error: string | null;
  readonly canMutate: boolean;
  readonly saving?: boolean;
  readonly assetService?: HardwareAssetService;
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onClose: () => void;
  /** #1422 owner: partes de diseño del kit en edición — indentadas dentro del formulario. */
  readonly kitParts?: readonly Hardware[];
  /** Receta (Agregado) vinculada al kit actual o al kit padre de la parte en edición. */
  readonly kitRecipe?: Agregado;
  /** Catálogo completo disponible para vincular partes existentes (#1435 / #1437). */
  readonly availableHardware?: readonly Hardware[];
  /** Abre la edición de una parte (el padre cierra este modal y abre la de la parte). */
  readonly onEditKitPart?: (part: Hardware) => void;
  /** Quita la parte del juego (borra el link kit↔parte; la parte sigue existiendo). */
  readonly onRemoveKitPart?: (part: Hardware) => void;
  /** Agrega una parte nueva precargada con este kit. */
  readonly onAddKitPart?: () => void;
  /** Vincula un herraje existente del catálogo como parte de este juego (#1435 / #1437). */
  readonly onLinkExistingPart?: (hardwareId: string) => void;
  /** Actualiza la apertura y posición de una parte directamente desde el modal del kit. */
  readonly onUpdateKitPartConfig?: (part: Hardware, next: KitPartPlacementConfig) => void;
}

export function HardwareFormModal({
  open,
  editingId,
  formId,
  draft,
  setDraft,
  error,
  canMutate,
  saving = false,
  assetService,
  onUploadImage,
  resolveImageUrl,
  onSubmit,
  onClose,
  identity,
  kitParts,
  kitRecipe,
  availableHardware,
  onEditKitPart,
  onRemoveKitPart,
  onAddKitPart,
  onLinkExistingPart,
  onUpdateKitPartConfig,
}: HardwareFormModalProps): ReactNode {
  const isKit = draft.unit === 'set' || Boolean(kitParts && kitParts.length > 0);
  const isKitChildPart = Boolean(draft.kitHardwareId);
  const childPartConfig = isKitChildPart
    ? resolveKitPartConfig(
        {
          id: editingId ?? undefined,
          code: draft.code,
          name: draft.name,
          previewShape: draft.previewShape || undefined,
          designParts: draft.designParts,
        },
        kitRecipe,
      )
    : null;

  const updateChildPartConfig = (patch: Partial<KitPartPlacementConfig>) => {
    if (!childPartConfig) return;
    const next: KitPartPlacementConfig = { ...childPartConfig, ...patch };
    const compName = draft.code.trim() || 'part';
    setDraft((prev) => ({
      ...prev,
      designParts: [
        {
          componentName: prev.code.trim() || compName,
          actorMembership: next.actorMembership,
          label: formatKitPartPlacementLabel(next),
          finishKey: '',
        },
      ],
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        identity
          ? `Editar herraje — ${identity.code} · ${identity.name}`
          : 'Nuevo herraje'
      }
      size="md"
      dataTestId="hardware-form-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            form={formId}
            disabled={saving}
            data-testid="hardware-form-submit-btn"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={formId} className="catalog-form" onSubmit={onSubmit}>
        {error ? <p className="catalog-form__error" role="alert">{error}</p> : null}

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

        {editingId && isKit && onEditKitPart ? (
          <fieldset className="catalog-form__section" data-testid="hardware-form-kit-parts">
            <legend className="catalog-form__section-title">
              Partes de este juego ({(kitParts ?? []).length})
            </legend>
            {(kitParts ?? []).length === 0 ? (
              <p className="catalog-form__hint" data-testid="hardware-form-kit-parts-empty">
                Este juego todavía no tiene partes vinculadas. Podés agregar una parte nueva o vincular una existente.
              </p>
            ) : null}
            {(kitParts ?? []).map((part) => {
              const partConfig = resolveKitPartConfig(
                {
                  id: part.id,
                  code: part.code,
                  name: part.name,
                  previewShape: part.previewShape,
                  designParts: part.designParts,
                },
                kitRecipe,
              );
              return (
                <div
                  key={part.id}
                  className="catalog-kit-part-card"
                  data-testid={`hardware-form-kit-part-${part.code}`}
                  style={{
                    border: '1px solid var(--border-subtle, #e0e0e0)',
                    borderRadius: 'var(--radius-md, 6px)',
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                    background: 'var(--surface-raised, #f9fafb)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div>
                      <span
                        className="catalog-kit-part-row__code"
                        style={{ fontWeight: 600, marginRight: '0.5rem' }}
                      >
                        {part.code}
                      </span>
                      <span className="catalog-kit-part-row__name">{part.name}</span>
                    </div>
                    <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => onEditKitPart(part)}
                        data-testid={`hardware-form-kit-part-edit-${part.code}`}
                      >
                        Editar
                      </button>
                      {onRemoveKitPart ? (
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          onClick={() => onRemoveKitPart(part)}
                          data-testid={`hardware-form-kit-part-remove-${part.code}`}
                        >
                          Quitar del juego
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {onUpdateKitPartConfig ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '0.5rem',
                        fontSize: '0.85rem',
                        paddingTop: '0.4rem',
                        borderTop: '1px solid var(--border-subtle, #eaeaea)',
                      }}
                    >
                      <label className="catalog-form__field" style={{ margin: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Al abrir</span>
                        <select
                          className="select select--sm"
                          value={partConfig.actorMembership}
                          onChange={(e) =>
                            onUpdateKitPartConfig(part, {
                              ...partConfig,
                              actorMembership: e.target.value,
                            })
                          }
                          data-testid={`hardware-form-kit-part-actor-${part.code}`}
                        >
                          {KIT_PART_ACTOR_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="catalog-form__field" style={{ margin: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Lado (Eje X)</span>
                        <select
                          className="select select--sm"
                          value={partConfig.xRef}
                          onChange={(e) => {
                            const nextRef = e.target.value as 'min' | 'max' | 'center';
                            const absOff = Math.abs(partConfig.xOffsetMm);
                            const nextOff =
                              nextRef === 'max' ? -absOff : nextRef === 'min' ? absOff : 0;
                            onUpdateKitPartConfig(part, {
                              ...partConfig,
                              xRef: nextRef,
                              xOffsetMm: nextOff,
                            });
                          }}
                          data-testid={`hardware-form-kit-part-xref-${part.code}`}
                        >
                          {KIT_PART_XREF_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="catalog-form__field" style={{ margin: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Offset X (mm)</span>
                        <input
                          type="number"
                          step="any"
                          style={{ height: '2rem', padding: '0.2rem 0.4rem' }}
                          value={partConfig.xOffsetMm}
                          onChange={(e) =>
                            onUpdateKitPartConfig(part, {
                              ...partConfig,
                              xOffsetMm: Number(e.target.value) || 0,
                            })
                          }
                          data-testid={`hardware-form-kit-part-xoffset-${part.code}`}
                        />
                      </label>

                      <label className="catalog-form__field" style={{ margin: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Offset Y (Prof)</span>
                        <input
                          type="number"
                          step="any"
                          style={{ height: '2rem', padding: '0.2rem 0.4rem' }}
                          value={partConfig.yOffsetMm}
                          onChange={(e) =>
                            onUpdateKitPartConfig(part, {
                              ...partConfig,
                              yOffsetMm: Number(e.target.value) || 0,
                            })
                          }
                          data-testid={`hardware-form-kit-part-yoffset-${part.code}`}
                        />
                      </label>

                      <label className="catalog-form__field" style={{ margin: 0 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Offset Z (Alto)</span>
                        <input
                          type="number"
                          step="any"
                          style={{ height: '2rem', padding: '0.2rem 0.4rem' }}
                          value={partConfig.zOffsetMm}
                          onChange={(e) =>
                            onUpdateKitPartConfig(part, {
                              ...partConfig,
                              zOffsetMm: Number(e.target.value) || 0,
                            })
                          }
                          data-testid={`hardware-form-kit-part-zoffset-${part.code}`}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {onAddKitPart ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={onAddKitPart}
                  data-testid="hardware-form-kit-part-add"
                >
                  Crear parte nueva
                </button>
              ) : null}
              {onLinkExistingPart && availableHardware && availableHardware.length > 0 ? (
                <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                  <label htmlFor="link-existing-part-select" className="visually-hidden">
                    Vincular parte existente
                  </label>
                  <select
                    id="link-existing-part-select"
                    className="select select--sm"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onLinkExistingPart(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    data-testid="hardware-form-link-existing-part"
                  >
                    <option value="" disabled>
                      + Vincular herraje existente…
                    </option>
                    {availableHardware
                      .filter((h) => h.id !== editingId && !h.kitHardwareId && h.unit !== 'set')
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.code} — {h.name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
            </div>
          </fieldset>
        ) : null}

        {isKitChildPart && childPartConfig ? (
          <fieldset
            className="catalog-form__section"
            data-testid="hardware-part-kinematics-section"
          >
            <legend className="catalog-form__section-title">
              Apertura y posición de esta parte
            </legend>
            <p className="catalog-form__hint">
              Configurá si esta pieza queda fija al mueble o se mueve al abrir, y en qué lado y posición se ubica.
            </p>
            <div className="catalog-form__row">
              <label className="catalog-form__field">
                <span>Al abrir</span>
                <select
                  value={childPartConfig.actorMembership}
                  onChange={(e) => updateChildPartConfig({ actorMembership: e.target.value })}
                  data-testid="hardware-part-kinematics-actor"
                >
                  {KIT_PART_ACTOR_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="catalog-form__field">
                <span>Lado (Eje X)</span>
                <select
                  value={childPartConfig.xRef}
                  onChange={(e) => {
                    const nextRef = e.target.value as 'min' | 'max' | 'center';
                    const absOff = Math.abs(childPartConfig.xOffsetMm);
                    const nextOff =
                      nextRef === 'max' ? -absOff : nextRef === 'min' ? absOff : 0;
                    updateChildPartConfig({ xRef: nextRef, xOffsetMm: nextOff });
                  }}
                  data-testid="hardware-part-kinematics-xref"
                >
                  {KIT_PART_XREF_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="catalog-form__row">
              <label className="catalog-form__field">
                <span>Offset X (mm)</span>
                <input
                  type="number"
                  step="any"
                  value={childPartConfig.xOffsetMm}
                  onChange={(e) =>
                    updateChildPartConfig({ xOffsetMm: Number(e.target.value) || 0 })
                  }
                  data-testid="hardware-part-kinematics-xoffset"
                />
              </label>
              <label className="catalog-form__field">
                <span>Offset Y — Profundidad (mm)</span>
                <input
                  type="number"
                  step="any"
                  value={childPartConfig.yOffsetMm}
                  onChange={(e) =>
                    updateChildPartConfig({ yOffsetMm: Number(e.target.value) || 0 })
                  }
                  data-testid="hardware-part-kinematics-yoffset"
                />
              </label>
              <label className="catalog-form__field">
                <span>Offset Z — Altura (mm)</span>
                <input
                  type="number"
                  step="any"
                  value={childPartConfig.zOffsetMm}
                  onChange={(e) =>
                    updateChildPartConfig({ zOffsetMm: Number(e.target.value) || 0 })
                  }
                  data-testid="hardware-part-kinematics-zoffset"
                />
              </label>
            </div>
          </fieldset>
        ) : null}

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

        {/* #667 M2: 3D model & mounting + generic procedural preview */}
        <Hardware3DSection
          draft={draft}
          setDraft={setDraft}
          canMutate={canMutate}
          assetService={assetService}
        />

        {/* F127: CNC machining footprint (parts + drilling operations). */}
        <HardwareMachiningSection
          modalOpen={open}
          draft={draft}
          setDraft={setDraft}
        />

        {/* #1417: internal design parts (by SKP component name) — only for standalone non-kit hardware. */}
        {!isKit && !isKitChildPart ? (
          <HardwareDesignPartsSection draft={draft} setDraft={setDraft} />
        ) : null}
      </form>
    </Modal>
  );
}
