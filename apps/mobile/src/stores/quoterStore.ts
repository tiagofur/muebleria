import { create } from 'zustand';
import {
  type Module,
  type ProjectItem,
  type Project,
  type OptionChoices,
  seedCatalogExpandedLatAm,
  resolveBom,
  calcProjectBreakdown,
} from '@muebles/domain';

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
    lines.push(`_Presupuesto emitido desde Muebles App Taller. Válido por 15 días._`);

    return lines.join('\n');
  },
}));
