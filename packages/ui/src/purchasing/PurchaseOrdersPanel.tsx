/**
 * PurchaseOrdersPanel — Compras/Almacén Fase 3c: órdenes de compra con estados
 * (borrador → emitida → recibida, cancelada) y directorio de proveedores. La
 * recepción de una PO registra entradas de stock (nota = número de OC) y avanza
 * received_quantity; al completar todas las líneas la orden pasa a "recibida".
 *
 * Sub-tabs internos: Órdenes / Proveedores. Writes: admin/almacen (the screen
 * passes `canEdit`); gerente_produccion lee.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Truck,
  X,
} from 'lucide-react';
import {
  PO_STATUS_LABELS_ES,
  poCanCancel,
  poCanEmit,
  poCanReceive,
  poRemaining,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type StockMaterialKind,
  type Supplier,
} from '@muebles/domain';
import { EmptyState } from '../common';
import { Modal } from '../common/Modal';
import type { StockCatalogOption } from './StockPanel';
import { STOCK_KIND_LABELS_ES } from '@muebles/domain';

export type PoLineInput = {
  kind: StockMaterialKind;
  materialId: string;
  quantity: number;
};

export type PurchaseOrdersPanelProps = {
  readonly suppliers: readonly Supplier[];
  readonly orders: readonly PurchaseOrder[];
  readonly canEdit: boolean;
  /** `${kind}:${materialId}` → label de catálogo (para material selects). */
  readonly catalogOptions: ReadonlyArray<{
    kind: StockMaterialKind;
    items: readonly StockCatalogOption[];
  }>;
  readonly onSaveSupplier: (data: {
    id?: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }) => Promise<void>;
  readonly onDeactivateSupplier: (id: string) => Promise<void>;
  readonly onSavePurchaseOrder: (data: {
    id?: string;
    supplierId: string;
    notes?: string;
    items: readonly PoLineInput[];
  }) => Promise<void>;
  readonly onEmitPurchaseOrder: (id: string) => Promise<void>;
  readonly onCancelPurchaseOrder: (id: string) => Promise<void>;
  readonly onReceivePurchaseOrder: (
    id: string,
    lines: readonly PoLineInput[],
  ) => Promise<void>;
};

type PanelTab = 'ordenes' | 'proveedores';

/** Borrador editable del formulario de PO (líneas dinámicas). */
type PoDraftLine = {
  kind: StockMaterialKind;
  materialId: string;
  quantity: number;
};

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

export function PurchaseOrdersPanel({
  suppliers,
  orders,
  canEdit,
  catalogOptions,
  onSaveSupplier,
  onDeactivateSupplier,
  onSavePurchaseOrder,
  onEmitPurchaseOrder,
  onCancelPurchaseOrder,
  onReceivePurchaseOrder,
}: PurchaseOrdersPanelProps): ReactNode {
  const [tab, setTab] = useState<PanelTab>('ordenes');
  const [search, setSearch] = useState('');
  const [poModal, setPoModal] = useState<{
    mode: 'create' | 'edit';
    order?: PurchaseOrder;
  } | null>(null);
  const [supplierModal, setSupplierModal] = useState<{
    mode: 'create' | 'edit';
    supplier?: Supplier;
  } | null>(null);
  const [receiveModal, setReceiveModal] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplierById = useMemo(() => {
    const map: Record<string, Supplier> = {};
    for (const sp of suppliers) map[sp.id] = sp;
    return map;
  }, [suppliers]);

  const activeSuppliers = useMemo(
    () => suppliers.filter((sp) => sp.active),
    [suppliers],
  );

  const needle = search.trim().toLowerCase();
  const visibleOrders = useMemo(() => {
    if (!needle) return orders;
    return orders.filter((po) => {
      const supplier = supplierById[po.supplierId]?.name ?? po.supplierId;
      return (
        po.number.toLowerCase().includes(needle) ||
        supplier.toLowerCase().includes(needle)
      );
    });
  }, [orders, needle, supplierById]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  // ─── PO modal ────────────────────────────────────────────────────────────

  const poDraft = useMemo<{
    supplierId: string;
    notes: string;
    lines: PoDraftLine[];
  }>(() => {
    const order = poModal?.order;
    const fallbackKind: StockMaterialKind = 'herrajes';
    const firstOption = catalogOptions.find((c) => c.kind === fallbackKind)?.items[0];
    return {
      supplierId: order?.supplierId ?? activeSuppliers[0]?.id ?? '',
      notes: order?.notes ?? '',
      lines: order
        ? order.items.map((it) => ({
            kind: it.kind,
            materialId: it.materialId,
            quantity: it.quantity,
          }))
        : [
            {
              kind: fallbackKind,
              materialId: firstOption?.id ?? '',
              quantity: 1,
            },
          ],
    };
  }, [poModal, activeSuppliers, catalogOptions]);

  const [draft, setDraft] = useState(poDraft);
  // Reset the draft every time the modal opens (create vs edit, different PO).
  useEffect(() => {
    setDraft(poDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poModal]);

  const submitPo = (): void => {
    const lines = draft.lines
      .filter((l) => l.materialId !== '' && l.quantity > 0)
      .map((l) => ({ kind: l.kind, materialId: l.materialId, quantity: l.quantity }));
    if (!draft.supplierId) {
      setError('Elegí un proveedor');
      return;
    }
    if (lines.length === 0) {
      setError('Agregá al menos una línea con material y cantidad');
      return;
    }
    void run(async () => {
      await onSavePurchaseOrder({
        id: poModal?.mode === 'edit' ? poModal.order?.id : undefined,
        supplierId: draft.supplierId,
        notes: draft.notes,
        items: lines,
      });
      setPoModal(null);
    });
  };

  // ─── Receive modal ───────────────────────────────────────────────────────

  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const openReceive = (po: PurchaseOrder): void => {
    setReceiveModal(po);
    const qty: Record<string, number> = {};
    for (const it of po.items) {
      qty[`${it.kind}:${it.materialId}`] = Math.max(0, poRemaining(it));
    }
    setReceiveQtys(qty);
  };

  const submitReceive = (): void => {
    if (!receiveModal) return;
    const lines = receiveModal.items
      .map((it) => ({
        kind: it.kind,
        materialId: it.materialId,
        quantity: receiveQtys[`${it.kind}:${it.materialId}`] ?? 0,
      }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      setError('Ingresá al menos una cantidad > 0');
      return;
    }
    void run(async () => {
      await onReceivePurchaseOrder(receiveModal.id, lines);
      setReceiveModal(null);
    });
  };

  // ─── Supplier modal ──────────────────────────────────────────────────────

  const [supplierDraft, setSupplierDraft] = useState({
    name: '',
    contactName: '',
    email: '',
    phone: '',
    notes: '',
  });
  const openSupplierModal = (
    mode: 'create' | 'edit',
    supplier?: Supplier,
  ): void => {
    setSupplierModal({ mode, supplier });
    setSupplierDraft({
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      email: supplier?.email ?? '',
      phone: supplier?.phone ?? '',
      notes: supplier?.notes ?? '',
    });
  };

  const submitSupplier = (): void => {
    if (!supplierDraft.name.trim()) {
      setError('El nombre del proveedor es obligatorio');
      return;
    }
    void run(async () => {
      await onSaveSupplier({
        id: supplierModal?.mode === 'edit' ? supplierModal.supplier?.id : undefined,
        name: supplierDraft.name.trim(),
        contactName: supplierDraft.contactName.trim() || undefined,
        email: supplierDraft.email.trim() || undefined,
        phone: supplierDraft.phone.trim() || undefined,
        notes: supplierDraft.notes.trim() || undefined,
      });
      setSupplierModal(null);
    });
  };

  // ─── Rendering ───────────────────────────────────────────────────────────

  const renderOrdersTab = (): ReactNode => {
    if (orders.length === 0) {
      return (
        <div className="purch-panel__stock-empty">
          <EmptyState
            icon={ClipboardList}
            title="Sin órdenes de compra"
            description="Creá una orden a un proveedor; al emitirla, la recepción registra entradas de stock."
          />
          {canEdit ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => setPoModal({ mode: 'create' })}
              data-testid="purch-po-create-first"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              Nueva orden
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="purch-po-list">
        {visibleOrders.map((po) => {
          const supplier = supplierById[po.supplierId];
          const totalRemaining = po.items.reduce((s, it) => s + poRemaining(it), 0);
          const actions: ReactNode[] = [];
          if (canEdit && poCanEmit(po.status)) {
            actions.push(
              <button
                key="emit"
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => void run(() => onEmitPurchaseOrder(po.id))}
                data-testid={`purch-po-emit-${po.id}`}
              >
                <Truck size={12} strokeWidth={1.5} aria-hidden />
                Emitir
              </button>,
              <button
                key="edit"
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => setPoModal({ mode: 'edit', order: po })}
                data-testid={`purch-po-edit-${po.id}`}
              >
                <Pencil size={12} strokeWidth={1.5} aria-hidden />
                Editar
              </button>,
            );
          }
          if (canEdit && poCanReceive(po.status)) {
            actions.push(
              <button
                key="receive"
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => openReceive(po)}
                data-testid={`purch-po-receive-${po.id}`}
              >
                <PackageCheck size={12} strokeWidth={1.5} aria-hidden />
                Recibir
              </button>,
            );
          }
          if (canEdit && poCanCancel(po.status)) {
            actions.push(
              <button
                key="cancel"
                type="button"
                className="btn btn--danger btn--small"
                onClick={() => void run(() => onCancelPurchaseOrder(po.id))}
                data-testid={`purch-po-cancel-${po.id}`}
              >
                <X size={12} strokeWidth={1.5} aria-hidden />
                Cancelar
              </button>,
            );
          }
          return (
            <article
              key={po.id}
              className="purch-card"
              data-testid={`purch-po-card-${po.id}`}
            >
              <div className="purch-card__header">
                <div className="purch-card__titles">
                  <span className="purch-card__name">{po.number}</span>
                  <span className="purch-card__sub">
                    {supplier?.name ?? po.supplierId}
                    {po.notes ? ` · ${po.notes}` : ''}
                  </span>
                </div>
                <div className="purch-po-card__right">
                  <span
                    className={`purch-badge purch-badge--${
                      po.status === 'recibida' || po.status === 'cancelada'
                        ? po.status
                        : po.status === 'emitida'
                          ? 'despachado'
                          : 'pendiente'
                    }`}
                    data-testid={`purch-po-status-${po.id}`}
                  >
                    {PO_STATUS_LABELS_ES[po.status]}
                  </span>
                  {actions.length > 0 ? (
                    <div className="purch-card__actions">{actions}</div>
                  ) : null}
                </div>
              </div>
              <ul className="purch-card__rows">
                {po.items.map((it) => {
                  const label =
                    catalogOptions
                      .find((c) => c.kind === it.kind)
                      ?.items.find((o) => o.id === it.materialId)?.label ??
                    it.materialId;
                  const remaining = poRemaining(it);
                  const done = it.receivedQuantity >= it.quantity;
                  return (
                    <li
                      key={`${it.kind}:${it.materialId}`}
                      className="purch-row"
                    >
                      <span className="purch-row__name">
                        {label}
                        <code className="purch-row__code">
                          {STOCK_KIND_LABELS_ES[it.kind]}
                        </code>
                      </span>
                      <div className="purch-row__right">
                        <span className="purch-row__qty">
                          {formatQty(it.quantity)}{' '}
                          {it.kind === 'tableros'
                            ? 'planchas'
                            : it.kind === 'cintillas'
                              ? 'ml'
                              : ''}
                        </span>
                        <span
                          className={`purch-po-line-state ${done ? 'purch-po-line-state--done' : ''}`}
                          data-testid={`purch-po-line-${po.id}-${it.kind}-${it.materialId}`}
                        >
                          {done ? (
                            <>
                              <CheckCircle2 size={12} strokeWidth={1.5} aria-hidden />
                              {formatQty(it.receivedQuantity)} recibido
                            </>
                          ) : (
                            `${formatQty(it.receivedQuantity)}/${formatQty(it.quantity)} recibido · quedan ${formatQty(remaining)}`
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="purch-card__foot">
                <span>
                  Creada {formatDate(po.createdAt)}
                  {po.receivedAt ? ` · recibida ${formatDate(po.receivedAt)}` : ''}
                </span>
                {po.status === 'emitida' && totalRemaining > 0 ? (
                  <span className="purch-card__foot-note">
                    pendiente de recibir {formatQty(totalRemaining)} unidades
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
        {visibleOrders.length === 0 ? (
          <p className="purch-stock__no-results">Sin órdenes para la búsqueda.</p>
        ) : null}
      </div>
    );
  };

  const renderSuppliersTab = (): ReactNode => {
    if (suppliers.length === 0) {
      return (
        <div className="purch-panel__stock-empty">
          <EmptyState
            icon={Building2}
            title="Sin proveedores"
            description="Cargá tu directorio de proveedores para asociarlos a las órdenes de compra."
          />
          {canEdit ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => openSupplierModal('create')}
              data-testid="purch-supplier-create-first"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden />
              Nuevo proveedor
            </button>
          ) : null}
        </div>
      );
    }
    const visibleSuppliers = needle
      ? suppliers.filter((sp) =>
          (sp.name + ' ' + (sp.contactName ?? '')).toLowerCase().includes(needle),
        )
      : suppliers;
    return (
      <div className="purch-po-list">
        {visibleSuppliers.map((sp) => (
          <article
            key={sp.id}
            className={`purch-card ${sp.active ? '' : 'purch-card--inactive'}`}
            data-testid={`purch-supplier-card-${sp.id}`}
          >
            <div className="purch-card__header">
              <div className="purch-card__titles">
                <span className="purch-card__name">{sp.name}</span>
                <span className="purch-card__sub">
                  {[sp.contactName, sp.email, sp.phone].filter(Boolean).join(' · ') || '—'}
                </span>
              </div>
              <div className="purch-card__actions">
                {!sp.active ? (
                  <span className="purch-badge purch-badge--cancelada">Inactivo</span>
                ) : null}
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      onClick={() => openSupplierModal('edit', sp)}
                      data-testid={`purch-supplier-edit-${sp.id}`}
                    >
                      <Pencil size={12} strokeWidth={1.5} aria-hidden />
                      Editar
                    </button>
                    {sp.active ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--small"
                        onClick={() => void run(() => onDeactivateSupplier(sp.id))}
                        data-testid={`purch-supplier-deactivate-${sp.id}`}
                      >
                        Desactivar
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            {sp.notes ? (
              <p className="purch-supplier-notes">{sp.notes}</p>
            ) : null}
          </article>
        ))}
        {visibleSuppliers.length === 0 ? (
          <p className="purch-stock__no-results">Sin proveedores para la búsqueda.</p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="purch-purchasing">
      <div className="purch-purchasing__toolbar">
        <div
          className="purch-stock__filters"
          role="tablist"
          aria-label="Compras y proveedores"
        >
          {(['ordenes', 'proveedores'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`tab-btn ${tab === t ? 'tab-btn--active' : ''}`}
              onClick={() => setTab(t)}
              data-testid={`purch-po-tab-${t}`}
            >
              {t === 'ordenes' ? 'Órdenes de compra' : 'Proveedores'}
            </button>
          ))}
        </div>
        <label className="purch-stock__search">
          <Search size={14} strokeWidth={1.5} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === 'ordenes' ? 'Buscar por OC o proveedor…' : 'Buscar proveedor…'
            }
            aria-label="Buscar"
            data-testid="purch-po-search"
          />
        </label>
        {canEdit ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() =>
              tab === 'ordenes'
                ? setPoModal({ mode: 'create' })
                : openSupplierModal('create')
            }
            data-testid={`purch-po-new-${tab}`}
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            {tab === 'ordenes' ? 'Nueva orden' : 'Nuevo proveedor'}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="purch-stock__alert purch-stock__alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {tab === 'ordenes' ? renderOrdersTab() : renderSuppliersTab()}

      {/* ─── PO create/edit modal ─── */}
      <Modal
        open={poModal != null}
        onClose={() => setPoModal(null)}
        title={
          poModal?.mode === 'edit'
            ? `Editar ${poModal.order?.number ?? 'orden'}`
            : 'Nueva orden de compra'
        }
        size="lg"
        dataTestId="purch-po-modal"
      >
        {poModal ? (
          <div className="purch-po-form">
            {error ? (
              <div className="purch-stock__alert purch-stock__alert--error" role="alert">
                {error}
              </div>
            ) : null}
            <label className="purch-po-form__field">
              <span>Proveedor</span>
              <select
                value={draft.supplierId}
                onChange={(e) =>
                  setDraft({ ...draft, supplierId: e.target.value })
                }
                data-testid="purch-po-form-supplier"
              >
                {activeSuppliers.length === 0 ? (
                  <option value="">Sin proveedores activos</option>
                ) : null}
                {activeSuppliers.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="purch-po-form__field">
              <span>Nota</span>
              <input
                type="text"
                value={draft.notes}
                onChange={(e) =>
                  setDraft({ ...draft, notes: e.target.value })
                }
                placeholder="Referencia interna (opcional)"
                data-testid="purch-po-form-notes"
              />
            </label>
            <div className="purch-po-form__lines">
              <span className="purch-po-form__lines-title">Líneas</span>
              {draft.lines.map((line, i) => (
                <div key={i} className="purch-po-form__line">
                  <select
                    value={line.kind}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        lines: draft.lines.map((l, j) =>
                          j === i
                            ? {
                                kind: e.target.value as StockMaterialKind,
                                materialId: '',
                                quantity: l.quantity,
                              }
                            : l,
                        ),
                      })
                    }
                    aria-label={`Tipo de material línea ${i + 1}`}
                    data-testid={`purch-po-form-kind-${i}`}
                  >
                    {(['herrajes', 'tableros', 'cintillas'] as const).map((k) => (
                      <option key={k} value={k}>
                        {STOCK_KIND_LABELS_ES[k]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={line.materialId}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        lines: draft.lines.map((l, j) =>
                          j === i ? { ...l, materialId: e.target.value } : l,
                        ),
                      })
                    }
                    aria-label={`Material línea ${i + 1}`}
                    data-testid={`purch-po-form-material-${i}`}
                  >
                    <option value="">Seleccioná un material…</option>
                    {(
                      catalogOptions.find((c) => c.kind === line.kind)?.items ?? []
                    ).map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    step="any"
                    value={line.quantity}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        lines: draft.lines.map((l, j) =>
                          j === i ? { ...l, quantity: Number(e.target.value) } : l,
                        ),
                      })
                    }
                    aria-label={`Cantidad línea ${i + 1}`}
                    data-testid={`purch-po-form-qty-${i}`}
                  />
                  <button
                    type="button"
                    className="btn btn--danger btn--small"
                    disabled={draft.lines.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        lines: draft.lines.filter((_, j) => j !== i),
                      })
                    }
                    aria-label={`Quitar línea ${i + 1}`}
                  >
                    <X size={12} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() =>
                  setDraft({
                    ...draft,
                    lines: [
                      ...draft.lines,
                      {
                        kind: 'herrajes',
                        materialId: '',
                        quantity: 1,
                      },
                    ],
                  })
                }
                data-testid="purch-po-form-add-line"
              >
                <Plus size={12} strokeWidth={1.5} aria-hidden />
                Agregar línea
              </button>
            </div>
            <div className="purch-po-form__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPoModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={submitPo}
                data-testid="purch-po-form-save"
              >
                {poModal.mode === 'edit' ? 'Guardar cambios' : 'Crear orden'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ─── Receive modal ─── */}
      <Modal
        open={receiveModal != null}
        onClose={() => setReceiveModal(null)}
        title={`Recibir ${receiveModal?.number ?? ''}`}
        size="md"
        dataTestId="purch-po-receive-modal"
      >
        {receiveModal ? (
          <div className="purch-po-form">
            {error ? (
              <div className="purch-stock__alert purch-stock__alert--error" role="alert">
                {error}
              </div>
            ) : null}
            <p className="purch-po-form__hint">
              Las cantidades recibidas registran entradas de stock (nota con el
              número de orden).
            </p>
            {receiveModal.items.map((it) => {
              const remaining = poRemaining(it);
              const label =
                catalogOptions
                  .find((c) => c.kind === it.kind)
                  ?.items.find((o) => o.id === it.materialId)?.label ?? it.materialId;
              return (
                <label
                  key={`${it.kind}:${it.materialId}`}
                  className="purch-po-form__field"
                >
                  <span>
                    {label} · quedan {formatQty(remaining)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={receiveQtys[`${it.kind}:${it.materialId}`] ?? 0}
                    onChange={(e) =>
                      setReceiveQtys({
                        ...receiveQtys,
                        [`${it.kind}:${it.materialId}`]: Number(e.target.value),
                      })
                    }
                    aria-label={`Cantidad a recibir de ${label}`}
                    data-testid={`purch-po-receive-qty-${it.kind}-${it.materialId}`}
                  />
                </label>
              );
            })}
            <div className="purch-po-form__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setReceiveModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={submitReceive}
                data-testid="purch-po-receive-save"
              >
                <PackageCheck size={14} strokeWidth={1.5} aria-hidden />
                Registrar recepción
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ─── Supplier modal ─── */}
      <Modal
        open={supplierModal != null}
        onClose={() => setSupplierModal(null)}
        title={
          supplierModal?.mode === 'edit'
            ? `Editar ${supplierModal.supplier?.name ?? 'proveedor'}`
            : 'Nuevo proveedor'
        }
        size="md"
        dataTestId="purch-supplier-modal"
      >
        {supplierModal ? (
          <div className="purch-po-form">
            {error ? (
              <div className="purch-stock__alert purch-stock__alert--error" role="alert">
                {error}
              </div>
            ) : null}
            <label className="purch-po-form__field">
              <span>Nombre *</span>
              <input
                type="text"
                value={supplierDraft.name}
                onChange={(e) =>
                  setSupplierDraft({ ...supplierDraft, name: e.target.value })
                }
                data-testid="purch-supplier-form-name"
              />
            </label>
            <label className="purch-po-form__field">
              <span>Contacto</span>
              <input
                type="text"
                value={supplierDraft.contactName}
                onChange={(e) =>
                  setSupplierDraft({ ...supplierDraft, contactName: e.target.value })
                }
                data-testid="purch-supplier-form-contact"
              />
            </label>
            <label className="purch-po-form__field">
              <span>Email</span>
              <input
                type="email"
                value={supplierDraft.email}
                onChange={(e) =>
                  setSupplierDraft({ ...supplierDraft, email: e.target.value })
                }
                data-testid="purch-supplier-form-email"
              />
            </label>
            <label className="purch-po-form__field">
              <span>Teléfono</span>
              <input
                type="tel"
                value={supplierDraft.phone}
                onChange={(e) =>
                  setSupplierDraft({ ...supplierDraft, phone: e.target.value })
                }
                data-testid="purch-supplier-form-phone"
              />
            </label>
            <label className="purch-po-form__field">
              <span>Notas</span>
              <textarea
                value={supplierDraft.notes}
                onChange={(e) =>
                  setSupplierDraft({ ...supplierDraft, notes: e.target.value })
                }
                data-testid="purch-supplier-form-notes"
              />
            </label>
            <div className="purch-po-form__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSupplierModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={submitSupplier}
                data-testid="purch-supplier-form-save"
              >
                {supplierModal.mode === 'edit' ? 'Guardar cambios' : 'Crear proveedor'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
