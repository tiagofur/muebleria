import { create } from 'zustand';
import { apiClient } from '../services/apiClient';
import {
  loadPersistedIntention,
  savePersistedIntention,
  clearPersistedIntention,
} from '../services/quoterIntentionStorage';
import { useCatalogStore } from './catalogStore';
import {
  type Module,
  type ProjectItem,
  type Project,
  type OptionChoices,
  type Customer,
  seedCatalogExpandedLatAm,
  resolveBom,
  calcProjectBreakdown,
} from '@granete/domain';

export interface QuoterCartItem {
  id: string;
  moduleId: string;
  moduleName: string;
  moduleCode: string;
  category: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  quantity: number;
  selectedPresetId?: string;
  unitPrice: number;
  totalPrice: number;
  m2Boards: number;
  mEdges: number;
}

export interface QuoterTotals {
  subtotalMaterials: number;
  subtotalHardware: number;
  subtotalLabor: number;
  subtotalDirect: number;
  marginAmount: number;
  total: number;
  totalM2: number;
  totalQuantity: number;
}

export interface QuoterState {
  items: QuoterCartItem[];
  customerName: string;
  projectTitle: string;
  commercialMarginPercent: number;

  // Actions
  setCustomerName: (name: string) => void;
  setProjectTitle: (title: string) => void;
  setCommercialMarginPercent: (margin: number) => void;
  addModuleToCart: (module: Module) => void;
  removeCartItem: (itemId: string) => void;
  updateItemQuantity: (itemId: string, quantity: number) => void;
  updateItemDimensions: (
    itemId: string,
    dims: { lengthMm?: number; widthMm?: number; heightMm?: number }
  ) => void;
  applyMeasurePreset: (itemId: string, presetId: string) => void;
  clearCart: () => void;
  getTotals: () => QuoterTotals;
  generateWhatsAppText: () => string;
  /**
   * Persist the street quote as a DRAFT project on the server so the office
   * picks it up in the web app (#715): ONE POST /projects with
   * inline_customer_name — the server creates Customer + Project in the same
   * transaction and mints the customer identity. No dedupe by name, no
   * separate POST /customers. Returns the server-authoritative project id.
   */
  saveAsQuote: () => Promise<{ projectId: string; customerName: string }>;
  /**
   * #715 internal: the uncommitted save intention (payload digest +
   * project id). POST /projects has no Idempotency-Key wrapper — its retry
   * contract is a client-stable project id, so the same semantic payload
   * retries with the same id (409 ⇒ reconcile by read-back) and any edit
   * mints a fresh one. Persisted (fingerprint + projectId only) so the
   * retry survives app restart/crash after a lost response; cleared once
   * the server commits.
   */
  pendingSaveIntention: { fingerprint: string; projectId: string } | null;
}

/** Customer shape returned by GET /customers/{id} and 201 inline_customer. */
interface ServerCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  active?: boolean;
}

/** 201 body of POST /projects with inline_customer_name (#712): flat project
 * fields plus the server-minted customer. */
interface InlineProjectCreateResponse {
  id: string;
  customer_id: string;
  inline_customer?: ServerCustomer;
}

/**
 * v4 UUID over Math.random for runtimes without crypto.randomUUID (Hermes /
 * RN 0.76). It is a client-side intention id validated by the server as a
 * UUID — not a secret — so non-crypto randomness is acceptable here.
 */
export function uuidV4Fallback(): string {
  const hex = () =>
    Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  const variant = ((Math.floor(Math.random() * 0xffff) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${variant}-${hex()}${hex()}${hex()}`;
}

function newProjectIntentionId(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === 'function'
    ? c.randomUUID()
    : uuidV4Fallback();
}

/** HTTP status carried by the apiClient's DomainError (context.status). */
function httpStatusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; context?: { status?: unknown } };
  const status = e.context?.status ?? e.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Deterministic digest (two-lane FNV-1a) of the semantic payload. The
 * fingerprint identifies the intention across retries AND app restarts
 * without persisting any commercial payload — only this digest + the
 * project id are stored.
 */
function fingerprintOf(payload: string): string {
  const lanes = [0x811c9dc5, 0x01000193];
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    for (let l = 0; l < lanes.length; l++) {
      lanes[l] = Math.imul(lanes[l] ^ code, 0x01000193) >>> 0;
    }
  }
  return lanes.map((h) => h.toString(16).padStart(8, '0')).join('');
}

/**
 * One-shot hydration of the persisted intention (#715 restart safety).
 * Adopted only while no in-session intention exists — a save made in this
 * session always wins over the persisted row. A load failure (corrupt row,
 * read error) rejects and un-memoizes so the next attempt re-reads; every
 * attempt is fail-closed on its own.
 */
let intentionHydration: Promise<void> | null = null;
function ensureIntentionHydrated(): Promise<void> {
  intentionHydration ??= loadPersistedIntention()
    .then((persisted) => {
      if (
        persisted &&
        useQuoterStore.getState().pendingSaveIntention === null
      ) {
        useQuoterStore.setState({ pendingSaveIntention: persisted });
      }
    })
    .catch((err: unknown) => {
      intentionHydration = null;
      throw err;
    });
  return intentionHydration;
}

/** @visibleForTesting — re-run hydration after simulating an app restart. */
export function __resetQuoterIntentionHydration(): void {
  intentionHydration = null;
}

/**
 * Adopt the server-owned customer into the mobile catalog store (by id), the
 * same reconciliation the web store does after the atomic create. No parallel
 * store: catalogStore keeps owning the customer list.
 */
function reconcileCatalogCustomer(raw: ServerCustomer): void {
  const catalog = useCatalogStore.getState();
  if (catalog.customers.some((c) => c.id === raw.id)) return;
  const customer: Customer = {
    id: raw.id,
    name: raw.name,
    email: raw.email || undefined,
    phone: raw.phone || undefined,
    address: raw.address || undefined,
    notes: raw.notes || undefined,
    active: raw.active ?? true,
  };
  useCatalogStore.setState({ customers: [...catalog.customers, customer] });
}

function calculateItemCosts(
  module: Module,
  lengthMm: number,
  widthMm: number,
  heightMm: number,
  quantity: number,
  commercialMarginPercent: number
): { unitPrice: number; totalPrice: number; m2Boards: number; mEdges: number } {
  const dummyItem: ProjectItem = {
    id: 'temp-item',
    moduleId: module.id,
    quantity,
    optionChoices: {} as OptionChoices,
  };

  try {
    const dummyProject: Project = {
      id: 'temp-project',
      name: 'Cotización Express',
      customerId: 'cust-1',
      currency: 'ARS',
      laborFixedCost: 0,
      status: 'draft',
      items: [dummyItem],
      marginFactor: 1 + commercialMarginPercent / 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const breakdown = calcProjectBreakdown(dummyProject, seedCatalogExpandedLatAm);

    const totalPrice = Math.round(breakdown.salePrice);
    const unitPrice = quantity > 0 ? Math.round(totalPrice / quantity) : totalPrice;

    // BOM calculation for board surface m2
    const bom = resolveBom(module, {}, seedCatalogExpandedLatAm);

    let m2 = 0;
    for (const part of bom.boardParts) {
      m2 += (part.lengthMm * part.widthMm) / 1_000_000;
    }

    return {
      unitPrice,
      totalPrice,
      m2Boards: Math.round(m2 * 100) / 100,
      mEdges: Math.round(bom.boardParts.length * 1.5 * 10) / 10,
    };
  } catch {
    // Fallback estimation if custom formula required
    const baseEst = ((lengthMm * widthMm * heightMm) / 1_000_000) * 250;
    const unitPrice = Math.max(120, Math.round(baseEst));
    return {
      unitPrice,
      totalPrice: unitPrice * quantity,
      m2Boards: 1.8,
      mEdges: 8.0,
    };
  }
}

export const useQuoterStore = create<QuoterState>((set, get) => ({
  items: [],
  customerName: 'Cliente Particular',
  projectTitle: 'Presupuesto de Mobiliario',
  commercialMarginPercent: 35,
  pendingSaveIntention: null,

  setCustomerName: (name) => set({ customerName: name }),
  setProjectTitle: (title) => set({ projectTitle: title }),
  setCommercialMarginPercent: (margin) => {
    set({ commercialMarginPercent: margin });
    const { items } = get();
    const updated = items.map((it) => {
      const mod = seedCatalogExpandedLatAm.modules.find((m) => m.id === it.moduleId);
      if (!mod) return it;
      const costs = calculateItemCosts(
        mod,
        it.lengthMm,
        it.widthMm,
        it.heightMm,
        it.quantity,
        margin
      );
      return { ...it, ...costs };
    });
    set({ items: updated });
  },

  addModuleToCart: (module) => {
    const lengthMm = module.externalDims?.width ?? module.presets?.[0]?.width ?? 800;
    const widthMm = module.externalDims?.depth ?? module.presets?.[0]?.depth ?? 600;
    const heightMm = module.externalDims?.height ?? module.presets?.[0]?.height ?? 860;
    const quantity = 1;

    const costs = calculateItemCosts(
      module,
      lengthMm,
      widthMm,
      heightMm,
      quantity,
      get().commercialMarginPercent
    );

    const newItem: QuoterCartItem = {
      id: `quote-item-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      moduleId: module.id,
      moduleName: module.name,
      moduleCode: module.code,
      category: module.furnitureType || module.categoryId || 'estandar',
      lengthMm,
      widthMm,
      heightMm,
      quantity,
      ...costs,
    };

    set((state) => ({ items: [...state.items, newItem] }));
  },

  removeCartItem: (itemId) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== itemId) }));
  },

  updateItemQuantity: (itemId, quantity) => {
    if (quantity < 1) return;
    set((state) => ({
      items: state.items.map((it) => {
        if (it.id !== itemId) return it;
        const mod = seedCatalogExpandedLatAm.modules.find((m) => m.id === it.moduleId);
        if (!mod) return { ...it, quantity, totalPrice: it.unitPrice * quantity };
        const costs = calculateItemCosts(
          mod,
          it.lengthMm,
          it.widthMm,
          it.heightMm,
          quantity,
          state.commercialMarginPercent
        );
        return { ...it, quantity, ...costs };
      }),
    }));
  },

  updateItemDimensions: (itemId, dims) => {
    set((state) => ({
      items: state.items.map((it) => {
        if (it.id !== itemId) return it;
        const newL = dims.lengthMm ?? it.lengthMm;
        const newW = dims.widthMm ?? it.widthMm;
        const newH = dims.heightMm ?? it.heightMm;

        const mod = seedCatalogExpandedLatAm.modules.find((m) => m.id === it.moduleId);
        if (!mod) return it;
        const costs = calculateItemCosts(
          mod,
          newL,
          newW,
          newH,
          it.quantity,
          state.commercialMarginPercent
        );
        return {
          ...it,
          lengthMm: newL,
          widthMm: newW,
          heightMm: newH,
          ...costs,
        };
      }),
    }));
  },

  applyMeasurePreset: (itemId, presetId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;

    const mod = seedCatalogExpandedLatAm.modules.find((m) => m.id === item.moduleId);
    if (!mod || !mod.presets) return;

    const preset = mod.presets.find((p) => p.id === presetId);
    if (!preset) return;

    get().updateItemDimensions(itemId, {
      lengthMm: preset.width,
      widthMm: preset.depth,
      heightMm: preset.height,
    });
  },

  clearCart: () => set({ items: [] }),

  getTotals: () => {
    const { items, commercialMarginPercent } = get();
    let total = 0;
    let totalM2 = 0;
    let totalQuantity = 0;

    for (const it of items) {
      total += it.totalPrice;
      totalM2 += it.m2Boards * it.quantity;
      totalQuantity += it.quantity;
    }

    const subtotalDirect = Math.round(total / (1 + commercialMarginPercent / 100));
    const subtotalMaterials = Math.round(subtotalDirect * 0.58);
    const subtotalHardware = Math.round(subtotalDirect * 0.22);
    const subtotalLabor = Math.round(subtotalDirect * 0.20);
    const marginAmount = total - subtotalDirect;

    return {
      subtotalMaterials,
      subtotalHardware,
      subtotalLabor,
      subtotalDirect,
      marginAmount,
      total,
      totalM2: Math.round(totalM2 * 100) / 100,
      totalQuantity,
    };
  },

  generateWhatsAppText: () => {
    const { items, customerName, projectTitle, getTotals } = get();
    const totals = getTotals();

    if (items.length === 0) return 'Cotización vacía.';

    const lines: string[] = [
      `📐 *PRESUPUESTO ESTIMADO DE CARPINTERÍA*`,
      `👤 *Cliente:* ${customerName}`,
      `🏷️ *Proyecto:* ${projectTitle}`,
      `📅 *Fecha:* ${new Date().toLocaleDateString()}`,
      `-----------------------------------------`,
      `*DETALLE DE MÓDULOS:*`,
    ];

    items.forEach((it, idx) => {
      lines.push(
        `${idx + 1}. *${it.moduleName}* (${it.quantity} un.)\n` +
          `   • Medidas: ${it.lengthMm} × ${it.widthMm} × ${it.heightMm} mm\n` +
          `   • Subtotal: $${it.totalPrice.toLocaleString('es-AR')}`
      );
    });

    lines.push(`-----------------------------------------`);
    lines.push(`📦 *Módulos Totales:* ${totals.totalQuantity}`);
    lines.push(`📊 *Superficie Placas:* ~${totals.totalM2} m²`);
    lines.push(`💰 *TOTAL ESTIMADO:* *$${totals.total.toLocaleString('es-AR')}*`);
    lines.push(`-----------------------------------------`);
    lines.push(`_Presupuesto emitido desde Granete App Taller. Válido por 15 días._`);

    return lines.join('\n');
  },

  // --- saveAsQuote (server persistence) ----------------------------------------
  // #715: the whole save is ONE server-side transaction. POST /projects with
  // customer_id '' + inline_customer_name creates Customer + Project together
  // (#712); the server mints the customer id and returns the authoritative
  // pair in the 201 body. Mobile never POSTs /customers and never dedupes by
  // name — a typed name is a new customer by design (the picker for existing
  // customers belongs to the web app). The intention (digest + project id)
  // is persisted FAIL-CLOSED (durable write confirmed → memory → POST) so a
  // retry after restart/lost-response reuses the same id (409 ⇒ validated
  // read-back) instead of duplicating the pair. Item option choices are
  // empty — the office finishes them in the web editor; module/preset/
  // quantity carry over intact.

  saveAsQuote: async () => {
    const { customerName, projectTitle, items, commercialMarginPercent } =
      get();
    if (items.length === 0) {
      throw new Error('El carrito está vacío');
    }
    // Restart safety (#715): adopt the persisted intention (if any) before
    // deciding the project id, so a retry after app restart reuses it. A
    // load failure propagates — never mint a fresh id over an unreadable
    // intention that may hide an unrecoverable prior commit.
    await ensureIntentionHydrated();
    const { pendingSaveIntention } = get();

    const trimmedName = customerName.trim() || 'Cliente Particular';

    const body = {
      name: projectTitle.trim() || `Cotización ${trimmedName}`,
      customer_id: '',
      inline_customer_name: trimmedName,
      currency: 'MXN',
      margin_factor: 1 + commercialMarginPercent / 100,
      labor_fixed_cost: 0,
      status: 'draft',
      items: items.map((it) => ({
        module_id: it.moduleId,
        quantity: it.quantity,
        ...(it.selectedPresetId
          ? { measure_preset_id: it.selectedPresetId }
          : {}),
        option_choices: {},
      })),
    };

    // Same semantic payload ⇒ same project id (safe retry, in-session and
    // across restarts); any edit to the draft ⇒ new intention, new id.
    const fingerprint = fingerprintOf(JSON.stringify(body));
    const projectId =
      pendingSaveIntention?.fingerprint === fingerprint
        ? pendingSaveIntention.projectId
        : newProjectIntentionId();
    const intention = { fingerprint, projectId };
    // FAIL-CLOSED (#715 review): confirm the durable write BEFORE adopting
    // the intention or sending anything. If it fails: 0 POST /projects,
    // 0 customers, 0 projects, honest error — no best-effort continue that
    // could strand a committed pair behind a lost id.
    try {
      await savePersistedIntention(intention);
    } catch (err) {
      throw new Error(
        `No se pudo registrar el intento de guardado de forma segura: ${(err as Error)?.message ?? 'error de almacenamiento'}`,
      );
    }
    set({ pendingSaveIntention: intention });

    try {
      const created = await apiClient.post<InlineProjectCreateResponse>(
        '/projects',
        { id: projectId, ...body },
      );
      if (
        !created.id ||
        !created.customer_id ||
        created.customer_id !== created.inline_customer?.id
      ) {
        throw new Error(
          'El servidor no devolvió el par cliente+cotización creado',
        );
      }
      reconcileCatalogCustomer(created.inline_customer);
      set({ pendingSaveIntention: null });
      await clearPersistedIntention();
      return { projectId: created.id, customerName: trimmedName };
    } catch (err) {
      if (httpStatusOf(err) !== 409) {
        // Fallo honesto: la transacción server-side dejó 0 clientes y 0
        // cotizaciones nuevas. El draft queda intacto, la intención queda
        // persistida y un reintento (incluso tras reinicio) reutiliza el
        // mismo projectId.
        throw err;
      }
      // 409: esta intención ya podría haber hecho commit (respuesta
      // perdida). Reconciliar desde la verdad del servidor — pero sólo si
      // el read-back es coherente con ESTA intención; nunca un 409 ciego.
      const existing = await apiClient.get<{
        id: string;
        customer_id: string;
        name?: string;
      }>(`/projects/${projectId}`);
      if (
        existing.id !== projectId ||
        !existing.customer_id ||
        (existing.name ?? '') !== body.name
      ) {
        throw new Error(
          'El reintento encontró una cotización que no coincide con esta intención',
        );
      }
      const customer = await apiClient.get<ServerCustomer>(
        `/customers/${existing.customer_id}`,
      );
      reconcileCatalogCustomer(customer);
      set({ pendingSaveIntention: null });
      await clearPersistedIntention();
      return { projectId: existing.id, customerName: trimmedName };
    }
  },
}));
