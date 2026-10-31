/**
 * Editor de plantillas de juego del taller (#1422 slice 2).
 *
 * Alta/edición/baja de plantillas declaradas: código, nombre, etiqueta del
 * agregado, motion y tabla de slots (clave, etiqueta, sufijo, rol,
 * membresía body|actor:<id>, ancla X y offset por defecto). La validación
 * estructural es la del dominio (validateHardwareKitTemplate — el mismo
 * contrato que aplica el servidor, 422 KIT_TEMPLATE_INVALID); el formulario
 * agrega sólo las reglas de fila del taller (código obligatorio).
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type { HardwareKitSlotTemplate, HardwareKitTemplateMotion } from '@granete/domain';
import { KIT_TEMPLATE_MAX_OFFSET_MM, validateHardwareKitTemplate } from '@granete/domain';
import type { WorkshopKitTemplateRow } from '@granete/storage';
import { Modal, ConfirmDialog } from '../../common';

export interface KitTemplateEditorModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Plantilla en edición, o null para una nueva. */
  readonly editing: WorkshopKitTemplateRow | null;
  readonly onSave: (row: WorkshopKitTemplateRow) => Promise<WorkshopKitTemplateRow>;
  readonly onDelete?: (id: string, expectedVersion: number) => Promise<void>;
}

interface SlotDraft {
  readonly key: string;
  readonly label: string;
  readonly suffix: string;
  readonly role: string;
  readonly membership: string;
  readonly anchorXRef: 'min' | 'max' | 'center';
  readonly offsetSign: 1 | -1;
  readonly offset: string;
}

const emptySlot = (): SlotDraft => ({
  key: '',
  label: '',
  suffix: '',
  role: '',
  membership: 'body',
  anchorXRef: 'min',
  offsetSign: 1,
  offset: '0',
});

const MOTION_OPTIONS: readonly { readonly value: HardwareKitTemplateMotion; readonly label: string }[] = [
  { value: 'none', label: 'Sin apertura' },
  { value: 'translate', label: 'Corredera (translate)' },
  { value: 'rotate_left', label: 'Puerta izq. (rotate)' },
  { value: 'rotate_right', label: 'Puerta der. (rotate)' },
];

export function KitTemplateEditorModal({
  open,
  onClose,
  editing,
  onSave,
  onDelete,
}: KitTemplateEditorModalProps): ReactNode {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [agregadoLabel, setAgregadoLabel] = useState('');
  const [motion, setMotion] = useState<HardwareKitTemplateMotion>('none');
  const [slots, setSlots] = useState<SlotDraft[]>([emptySlot()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(editing?.code ?? '');
    setLabel(editing?.labelEs ?? '');
    setAgregadoLabel(editing?.agregadoLabelEs ?? '');
    setMotion(editing?.motion ?? 'none');
    setSlots(
      editing?.slots.length
        ? editing.slots.map((s) => ({
            key: s.slot,
            label: s.labelEs,
            suffix: s.suffix,
            role: s.role,
            membership: s.membership,
            anchorXRef: s.anchorXRef,
            offsetSign: s.offsetSign,
            offset: String(s.defaultOffsetMm),
          }))
        : [emptySlot()],
    );
    setError(null);
    setSaving(false);
    setConfirmDelete(false);
  }, [open, editing]);

  const setSlot = (index: number, patch: Partial<SlotDraft>) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const buildRow = (): WorkshopKitTemplateRow | null => {
    if (!code.trim()) {
      setError('El código de la plantilla es obligatorio.');
      return null;
    }
    const row: WorkshopKitTemplateRow = {
      id: editing?.id ?? crypto.randomUUID(),
      code: code.trim(),
      labelEs: label.trim(),
      agregadoLabelEs: agregadoLabel.trim(),
      motion,
      version: editing?.version ?? 0,
      active: editing?.active ?? true,
      slots: slots.map<HardwareKitSlotTemplate>((s) => {
        const key = s.key.trim();
        const role = s.role.trim() || key;
        const rawSuffix = s.suffix.trim();
        return {
          slot: key,
          memberId: role,
          suffix: rawSuffix && !rawSuffix.startsWith('-') ? `-${rawSuffix}` : rawSuffix,
          labelEs: s.label.trim(),
          role,
          membership: s.membership.trim() || 'body',
          anchorXRef: s.anchorXRef,
          offsetSign: s.offsetSign,
          defaultOffsetMm: Number(s.offset.trim()),
        };
      }),
    };
    const issues = validateHardwareKitTemplate(row);
    if (issues.length > 0) {
      // Mensaje en español (copy): el texto del gemelo es inglés de dominio;
      // el campo basta para ubicar el problema en el formulario.
      setError(`Revisá los datos de la plantilla — campo «${issues[0]!.path}».`);
      return null;
    }
    return row;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const row = buildRow();
    if (!row) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(row);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la plantilla.');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(editing.id, editing.version);
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la plantilla.');
      setConfirmDelete(false);
      setSaving(false);
    }
  };

  const suffixHint = (key: string): string =>
    key.trim() ? `-${key.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '')}` : '-SUFIJO';

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={editing ? `Editar plantilla «${editing.code}»` : 'Nueva plantilla de juego'}
        size="lg"
        dataTestId="kit-template-editor"
        footer={
          <>
            {editing && onDelete ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                data-testid="kit-template-editor-delete"
              >
                Eliminar
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={saving}
              data-testid="kit-template-editor-cancel"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form="kit-template-editor-form"
              disabled={saving}
              data-testid="kit-template-editor-save"
            >
              {saving ? 'Guardando…' : 'Guardar plantilla'}
            </button>
          </>
        }
      >
        <form
          id="kit-template-editor-form"
          className="catalog-form"
          onSubmit={handleSubmit}
          data-testid="kit-template-editor-form"
        >
          {error ? (
            <p className="catalog-form__error" role="alert" data-testid="kit-template-editor-error">
              {error}
            </p>
          ) : null}

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Plantilla</legend>
            <div className="catalog-form__field">
              <label htmlFor="kt-code">Código</label>
              <input
                id="kt-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                required
                data-testid="kit-template-editor-code"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kt-label">Nombre</label>
              <input
                id="kt-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                data-testid="kit-template-editor-label"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kt-agregado">Tipo de ensamble</label>
              <input
                id="kt-agregado"
                value={agregadoLabel}
                onChange={(e) => setAgregadoLabel(e.target.value)}
                placeholder="Puerta, Cajón, Frente…"
                required
                data-testid="kit-template-editor-agregado"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kt-motion">Apertura del ensamble</label>
              <select
                id="kt-motion"
                value={motion}
                onChange={(e) => setMotion(e.target.value as HardwareKitTemplateMotion)}
                data-testid="kit-template-editor-motion"
              >
                {MOTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Partes del juego</legend>
            <p className="catalog-form__hint">
              Cada parte se crea como herraje «solo diseño» con el sufijo aplicado al
              código del juego. La membresía fija la cinemática: «body» se queda con
              el mueble, «actor:pieza» se mueve con el ensamble.
            </p>
            {slots.map((slot, index) => (
              <div className="catalog-form__field" key={index} data-testid={`kit-template-slot-${index}`}>
                <div className="catalog-form__row">
                  <label htmlFor={`kt-slot-key-${index}`}>Clave</label>
                  <input
                    id={`kt-slot-key-${index}`}
                    value={slot.key}
                    onChange={(e) => setSlot(index, { key: e.target.value })}
                    placeholder="cup_fixed"
                    autoComplete="off"
                    data-testid={`kit-template-slot-key-${index}`}
                  />
                  <label htmlFor={`kt-slot-label-${index}`}>Etiqueta</label>
                  <input
                    id={`kt-slot-label-${index}`}
                    value={slot.label}
                    onChange={(e) => setSlot(index, { label: e.target.value })}
                    placeholder="Copa (fija al mueble)"
                    data-testid={`kit-template-slot-label-${index}`}
                  />
                  <label htmlFor={`kt-slot-suffix-${index}`}>Sufijo</label>
                  <input
                    id={`kt-slot-suffix-${index}`}
                    value={slot.suffix}
                    onChange={(e) => setSlot(index, { suffix: e.target.value })}
                    placeholder={suffixHint(slot.key)}
                    data-testid={`kit-template-slot-suffix-${index}`}
                  />
                  <label htmlFor={`kt-slot-membership-${index}`}>Membresía</label>
                  <input
                    id={`kt-slot-membership-${index}`}
                    value={slot.membership}
                    onChange={(e) => setSlot(index, { membership: e.target.value })}
                    placeholder="body o actor:door"
                    list="kit-template-membership-options"
                    data-testid={`kit-template-slot-membership-${index}`}
                  />
                  <label htmlFor={`kt-slot-anchor-${index}`}>Ancla X</label>
                  <select
                    id={`kt-slot-anchor-${index}`}
                    value={slot.anchorXRef}
                    onChange={(e) => setSlot(index, { anchorXRef: e.target.value as SlotDraft['anchorXRef'] })}
                    data-testid={`kit-template-slot-anchor-${index}`}
                  >
                    <option value="min">mín</option>
                    <option value="center">centro</option>
                    <option value="max">máx</option>
                  </select>
                  <label htmlFor={`kt-slot-sign-${index}`}>Sentido</label>
                  <select
                    id={`kt-slot-sign-${index}`}
                    value={slot.offsetSign}
                    onChange={(e) => setSlot(index, { offsetSign: Number(e.target.value) as 1 | -1 })}
                    data-testid={`kit-template-slot-sign-${index}`}
                  >
                    <option value={1}>hacia mín (+1)</option>
                    <option value={-1}>hacia máx (−1)</option>
                  </select>
                  <label htmlFor={`kt-slot-offset-${index}`}>Offset (mm)</label>
                  <input
                    id={`kt-slot-offset-${index}`}
                    value={slot.offset}
                    onChange={(e) => setSlot(index, { offset: e.target.value })}
                    inputMode="decimal"
                    data-testid={`kit-template-slot-offset-${index}`}
                  />
                  {slots.length > 1 ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setSlots((prev) => prev.filter((_, i) => i !== index))}
                      data-testid={`kit-template-slot-remove-${index}`}
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            <datalist id="kit-template-membership-options">
              <option value="body" />
              <option value="actor:door" />
              <option value="actor:drawer" />
            </datalist>
            {slots.length < 12 ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setSlots((prev) => [...prev, emptySlot()])}
                data-testid="kit-template-slot-add"
              >
                Agregar parte
              </button>
            ) : null}
            <p className="catalog-form__hint">
              Máximo {KIT_TEMPLATE_MAX_OFFSET_MM} mm de offset y 12 partes por juego.
            </p>
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar plantilla"
        message={
          editing
            ? `¿Seguro que querés eliminar la plantilla «${editing.code} — ${editing.labelEs}»? Los juegos ya creados con ella no se tocan: la plantilla deja de ofrecerse en el asistente.`
            : ''
        }
        confirmLabel="Eliminar"
        dataTestId="kit-template-editor-delete-confirm"
        onConfirm={handleDelete}
      />
    </>
  );
}
