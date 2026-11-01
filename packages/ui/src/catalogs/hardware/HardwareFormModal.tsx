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
import type { HardwareUnit , Hardware } from '@granete/domain';
import type { HardwareAssetService } from '@granete/storage';
import { CatalogImage, Modal } from '../../common';
import { Hardware3DSection } from './Hardware3DSection';
import { HardwareMachiningSection } from './HardwareMachiningSection';
import { HardwareDesignPartsSection } from './HardwareDesignPartsSection';
import { UNIT_LABELS, type HardwareDraft } from './hardwareDraft';

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
  /** Abre la edición de una parte (el padre cierra este modal y abre la de la parte). */
  readonly onEditKitPart?: (part: Hardware) => void;
  /** Quita la parte del juego (borra el link kit↔parte; la parte sigue existiendo). */
  readonly onRemoveKitPart?: (part: Hardware) => void;
  /** Agrega una parte nueva precargada con este kit. */
  readonly onAddKitPart?: () => void;
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
  onEditKitPart,
  onRemoveKitPart,
  onAddKitPart,
}: HardwareFormModalProps): ReactNode {
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

        {kitParts && kitParts.length > 0 && onEditKitPart ? (
          <fieldset className="catalog-form__section" data-testid="hardware-form-kit-parts">
            <legend className="catalog-form__section-title">
              Partes de este juego ({kitParts.length})
            </legend>
            {kitParts.map((part) => (
              <div
                key={part.id}
                className="catalog-kit-part-row"
                data-testid={`hardware-form-kit-part-${part.code}`}
              >
                <span className="catalog-kit-part-row__code">{part.code}</span>
                <span className="catalog-kit-part-row__name">{part.name}</span>
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
            ))}
            {onAddKitPart ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={onAddKitPart}
                data-testid="hardware-form-kit-part-add"
              >
                Agregar parte al juego
              </button>
            ) : null}
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

        {/* #1417: internal design parts (by SKP component name). */}
        <HardwareDesignPartsSection draft={draft} setDraft={setDraft} />
      </form>
    </Modal>
  );
}
