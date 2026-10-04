/**
 * Create/edit hardware profile modal (#914): identity (code/name/description/
 * revision) + the hardware lines that compose it — picker over the EXISTING
 * hardware catalog (never a second product list; the canonical code/price
 * stays there and is shown read-only next to each line). Recipe bodies are
 * a later surface: the modal shows a read-only note when the profile
 * carries one.
 */

import {
  useId,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Hardware } from '@granete/domain';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, formatMoneyDisplay } from '../../common';
import {
  emptyProfileItemDraft,
  type HardwareProfileDraft,
  type HardwareProfileItemDraft,
} from './hardwareProfileDraft';

export interface HardwareProfileFormModalProps {
  /** K4 #1032: saved identity of the edited item, shown in the title. */
  readonly identity?: { readonly code: string; readonly name: string };
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: HardwareProfileDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareProfileDraft>>;
  readonly hardware: readonly Hardware[];
  readonly error: string | null;
  readonly canMutate: boolean;
  readonly saving?: boolean;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onClose: () => void;
}

export function HardwareProfileFormModal({
  open,
  editingId,
  formId,
  draft,
  setDraft,
  hardware,
  error,
  saving = false,
  onSubmit,
  onClose,
  identity,
}: HardwareProfileFormModalProps): ReactNode {
  const itemFieldId = useId();
  const hardwareById = new Map(hardware.map((h) => [h.id, h]));

  const setItem = (index: number, patch: Partial<HardwareProfileItemDraft>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const addItem = () => {
    setDraft((current) => ({
      ...current,
      items: [...current.items, emptyProfileItemDraft()],
    }));
  };

  const removeItem = (index: number) => {
    setDraft((current) => ({
      ...current,
      items: current.items.filter((_, i) => i !== index),
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        identity
          ? `Editar perfil de herrajes — ${identity.code} · ${identity.name}`
          : 'Nuevo perfil de herrajes'
      }
      size="md"
      dataTestId="hardware-profile-form-modal"
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
            data-testid="hardware-profile-form-submit-btn"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={formId} className="catalog-form" onSubmit={onSubmit}>
        {error ? <p className="catalog-form__error">{error}</p> : null}

        <label className="catalog-form__field">
          <span>Código</span>
          <input
            value={draft.code}
            onChange={(e) => setDraft((current) => ({ ...current, code: e.target.value }))}
            placeholder="PERF-SPAX-50"
            maxLength={64}
            data-testid="hardware-profile-code-input"
            required
          />
        </label>

        <label className="catalog-form__field">
          <span>Nombre</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
            placeholder="Unión lateral SPAX 4x50"
            maxLength={120}
            data-testid="hardware-profile-name-input"
            required
          />
        </label>

        <label className="catalog-form__field">
          <span>Descripción</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
            placeholder="Opcional"
            maxLength={200}
            data-testid="hardware-profile-description-input"
          />
        </label>

        <label className="catalog-form__field">
          <span>Revisión técnica</span>
          <input
            value={draft.revision}
            onChange={(e) => setDraft((current) => ({ ...current, revision: e.target.value }))}
            placeholder="rev-1"
            maxLength={64}
            data-testid="hardware-profile-revision-input"
            required
          />
          <small className="catalog-form__hint">
            Cambiar el contenido técnico exige una nueva revisión: los releases pinean revisiones exactas.
          </small>
        </label>

        <fieldset className="catalog-form__fieldset" data-testid="hardware-profile-items-editor">
          <legend>Herrajes del perfil</legend>
          {draft.items.length === 0 ? (
            <p className="catalog-form__hint">
              Agregá los herrajes del catálogo que componen esta solución y su cantidad por aplicación.
            </p>
          ) : null}
          {draft.items.map((item, index) => {
            const selected = item.hardwareId ? hardwareById.get(item.hardwareId) : undefined;
            return (
              <div className="catalog-form__row" key={`profile-item-${index}`} data-testid="hardware-profile-item-row">
                <label className="catalog-form__field">
                  <span>Herraje</span>
                  <select
                    value={item.hardwareId}
                    onChange={(e) => setItem(index, { hardwareId: e.target.value })}
                    data-testid="hardware-profile-item-hardware-select"
                  >
                    <option value="">Elegí un herraje…</option>
                    {hardware.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.code} — {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="catalog-form__field catalog-form__field--narrow">
                  <span>Cantidad</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => setItem(index, { quantity: e.target.value })}
                    data-testid="hardware-profile-item-quantity-input"
                  />
                </label>
                <label className="catalog-form__field">
                  <span>Rol (opcional)</span>
                  <input
                    value={item.applicationRole}
                    onChange={(e) => setItem(index, { applicationRole: e.target.value })}
                    placeholder="tornillo, excéntrica…"
                    maxLength={64}
                    data-testid="hardware-profile-item-role-input"
                  />
                </label>
                {selected ? (
                  <span className="catalog-form__hint" data-testid="hardware-profile-item-canonical">
                    {selected.code} · {formatMoneyDisplay(selected.costPerUnit)} / {selected.unit}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn--small btn--ghost btn--danger"
                  aria-label={`Quitar herraje ${index + 1}`}
                  onClick={() => removeItem(index)}
                  data-testid="hardware-profile-item-remove-btn"
                >
                  <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn--small"
            onClick={addItem}
            data-testid="hardware-profile-item-add-btn"
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Agregar herraje
          </button>
        </fieldset>

        <p className="catalog-form__hint" data-testid="hardware-profile-recipe-note">
          El cuerpo técnico de la receta se gestiona con el equipo Granete y viaja pineado en los releases de la biblioteca.
        </p>
      </form>
    </Modal>
  );
}
