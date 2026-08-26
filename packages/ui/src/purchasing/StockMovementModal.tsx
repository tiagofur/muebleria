/**
 * StockMovementModal — recepción / salida / ajuste de stock (Fase 3b).
 * Un solo formulario guiado por `type`: entrada/salida usan cantidad positiva
 * (el signo lo decide el tipo); ajuste va firmado y exige nota (conteo físico).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { PackageMinus, PackagePlus, SlidersHorizontal } from 'lucide-react';
import {
  STOCK_KIND_LABELS_ES,
  STOCK_MOVEMENT_LABELS_ES,
  type StockMaterialKind,
  type StockMovementType,
} from '@granete/domain';
import { Modal } from '../common';
import type { StockCatalogOption } from './StockPanel';

export type StockMovementModalProps = {
  readonly type: StockMovementType;
  /** Prefilled row context (Recibir/Salida/Ajustar por fila). */
  readonly initialKind?: StockMaterialKind;
  readonly initialMaterialId?: string;
  readonly catalogOptions: ReadonlyArray<{
    kind: StockMaterialKind;
    items: readonly StockCatalogOption[];
  }>;
  readonly labels: Readonly<Record<string, string>>;
  readonly onClose: () => void;
  readonly onSubmit: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    note?: string;
  }) => Promise<void>;
};

const TITLES: Readonly<Record<StockMovementType, string>> = {
  entrada: 'Recibir stock',
  salida: 'Registrar salida',
  ajuste: 'Ajustar stock',
  despacho: 'Despacho',
};

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function StockMovementModal({
  type,
  initialKind,
  initialMaterialId,
  catalogOptions,
  labels,
  onClose,
  onSubmit,
}: StockMovementModalProps): ReactNode {
  const [kind, setKind] = useState<StockMaterialKind>(initialKind ?? 'herrajes');
  const [materialId, setMaterialId] = useState(initialMaterialId ?? '');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionsForKind = useMemo(
    () => catalogOptions.find((o) => o.kind === kind)?.items ?? [],
    [catalogOptions, kind],
  );

  const submit = async (): Promise<void> => {
    const qty = Number(quantity);
    if (!materialId) {
      setError('Elegí un material');
      return;
    }
    if (!Number.isFinite(qty) || (type !== 'ajuste' && qty <= 0) || (type === 'ajuste' && qty === 0)) {
      setError(
        type === 'ajuste'
          ? 'El ajuste no puede ser cero'
          : 'Ingresá una cantidad mayor a cero',
      );
      return;
    }
    if (type === 'ajuste' && note.trim() === '') {
      setError('El ajuste requiere una nota (conteo físico, motivo)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        kind,
        materialId,
        type,
        quantity: qty,
        note: note.trim() ? note.trim() : undefined,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo registrar el movimiento',
      );
      setSaving(false);
    }
  };

  const Icon =
    type === 'entrada' ? PackagePlus : type === 'salida' ? PackageMinus : SlidersHorizontal;

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLES[type]}
      size="sm"
      dataTestId="purch-stock-modal"
      footer={
        <div className="purch-stock-modal__footer">
          {error ? (
            <span className="purch-stock-modal__error" data-testid="purch-stock-modal-error">
              {error}
            </span>
          ) : null}
          <div className="purch-stock-modal__actions">
            <button type="button" className="btn btn--secondary btn--small" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => void submit()}
              disabled={saving}
              data-testid="purch-stock-modal-submit"
            >
              <Icon size={14} strokeWidth={1.5} aria-hidden />
              {saving ? 'Guardando…' : STOCK_MOVEMENT_LABELS_ES[type]}
            </button>
          </div>
        </div>
      }
    >
      <div className="purch-stock-modal__form">
        <label className="purch-stock-modal__field">
          <span className="purch-stock-modal__label">Tipo de material</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as StockMaterialKind);
              setMaterialId('');
            }}
            data-testid="purch-stock-kind"
          >
            {(['herrajes', 'tableros', 'cintillas'] as const).map((k) => (
              <option key={k} value={k}>
                {STOCK_KIND_LABELS_ES[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="purch-stock-modal__field">
          <span className="purch-stock-modal__label">Material</span>
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            data-testid="purch-stock-material"
          >
            <option value="">— Elegir —</option>
            {optionsForKind.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="purch-stock-modal__field">
          <span className="purch-stock-modal__label">
            {type === 'ajuste' ? 'Cantidad (firmada: − quita, + suma)' : 'Cantidad'}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={type === 'ajuste' ? undefined : 0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={type === 'ajuste' ? '-3 o +5' : '0'}
            data-testid="purch-stock-quantity"
          />
        </label>
        <label className="purch-stock-modal__field">
          <span className="purch-stock-modal__label">
            Nota {type === 'ajuste' ? '(obligatoria)' : '(opcional)'}
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              type === 'entrada'
                ? 'N° de orden / proveedor'
                : type === 'ajuste'
                  ? 'Conteo físico, motivo…'
                  : 'Motivo de la salida…'
            }
            data-testid="purch-stock-note"
          />
        </label>
        {initialMaterialId ? (
          <p className="purch-stock-modal__hint">
            {labels[`${kind}:${initialMaterialId}`] ?? ''}
          </p>
        ) : null}
      </div>
      <p className="purch-stock-modal__units">
        {formatQty(Number(quantity) || 0)} — {TITLES[type].toLowerCase()} con signo según tipo
      </p>
    </Modal>
  );
}
