import { describe, it, expect, beforeEach } from 'vitest';
import { useQuoterStore } from './quoterStore';
import { seedCatalogExpandedLatAm } from '@muebles/domain';

describe('quoterStore Mobile (Fase 3)', () => {
  beforeEach(() => {
    useQuoterStore.setState({
      items: [],
      customerName: 'Cliente Particular',
      projectTitle: 'Presupuesto de Mobiliario',
      commercialMarginPercent: 35,
    });
  });

  it('agrega módulos al cotizador y calcula costos con @muebles/domain', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.addModuleToCart(mod);

    const state = useQuoterStore.getState();
    expect(state.items.length).toBe(1);
    expect(state.items[0].moduleId).toBe(mod.id);
    expect(state.items[0].unitPrice).toBeGreaterThan(0);
    expect(state.items[0].totalPrice).toBe(state.items[0].unitPrice);
    expect(state.items[0].m2Boards).toBeGreaterThan(0);

    const totals = state.getTotals();
    expect(totals.total).toBe(state.items[0].totalPrice);
    expect(totals.totalQuantity).toBe(1);
    expect(totals.marginAmount).toBeGreaterThan(0);
  });

  it('actualiza cantidades y recalcula el total de la cotización', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.addModuleToCart(mod);
    const itemId = useQuoterStore.getState().items[0].id;
    const unitPrice = useQuoterStore.getState().items[0].unitPrice;

    store.updateItemQuantity(itemId, 3);

    const updated = useQuoterStore.getState().items[0];
    expect(updated.quantity).toBe(3);
    expect(updated.totalPrice).toBe(unitPrice * 3);

    const totals = useQuoterStore.getState().getTotals();
    expect(totals.totalQuantity).toBe(3);
  });

  it('ajusta medidas de módulo y recalcula el costo en tiempo real', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.addModuleToCart(mod);
    const item = useQuoterStore.getState().items[0];
    const initialPrice = item.unitPrice;

    // Expand width
    store.updateItemDimensions(item.id, { lengthMm: item.lengthMm + 400 });

    const expanded = useQuoterStore.getState().items[0];
    expect(expanded.lengthMm).toBe(item.lengthMm + 400);
    expect(expanded.unitPrice).toBeGreaterThanOrEqual(initialPrice);
  });

  it('genera texto formateado para compartir por WhatsApp', () => {
    const store = useQuoterStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];

    store.setCustomerName('Estudio Arq. Gómez');
    store.setProjectTitle('Reforma Cocina');
    store.addModuleToCart(mod);

    const waText = useQuoterStore.getState().generateWhatsAppText();

    expect(waText).toContain('PRESUPUESTO ESTIMADO DE CARPINTERÍA');
    expect(waText).toContain('Estudio Arq. Gómez');
    expect(waText).toContain('Reforma Cocina');
    expect(waText).toContain(mod.name);
    expect(waText).toContain('TOTAL ESTIMADO');
  });
});
