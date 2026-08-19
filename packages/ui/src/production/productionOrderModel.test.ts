import { describe, expect, it } from 'vitest';
import type { Project, ProductionCutRow } from '@muebles/domain';
import {
  PRODUCTION_ORDER_TABS,
  buildProductionOrderReadiness,
  isProductionOrderTab,
  parseProductionOrderTab,
  projectAllowsProductionOrder,
} from './productionOrderModel';

function baseProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const cutRow: ProductionCutRow = {
  quantity: 2,
  lengthMm: 720,
  widthMm: 560,
  description: 'Lateral',
  materialName: 'Blanco',
  grain: 0,
  L1: 0,
  L2: 0,
  W1: 0,
  W2: 0,
  moduleCode: 'M1',
  partCode: 'LAT',
};

describe('productionOrderModel (PROD-0.1 / 0.3)', () => {
  it('parses tabs and defaults to resumen', () => {
    expect(isProductionOrderTab('despiece')).toBe(true);
    expect(isProductionOrderTab('nope')).toBe(false);
    expect(isProductionOrderTab('exports')).toBe(false);
    expect(parseProductionOrderTab('vistas')).toBe('vistas');
    expect(parseProductionOrderTab('exports')).toBe('documentos');
    expect(parseProductionOrderTab('x')).toBe('resumen');
    expect(PRODUCTION_ORDER_TABS[0]).toBe('resumen');
    expect(PRODUCTION_ORDER_TABS).not.toContain('exports');
  });

  it('allows production order only for accepted|produced', () => {
    expect(projectAllowsProductionOrder(baseProject({ status: 'accepted' }))).toBe(
      true,
    );
    expect(projectAllowsProductionOrder(baseProject({ status: 'produced' }))).toBe(
      true,
    );
    expect(projectAllowsProductionOrder(baseProject({ status: 'draft' }))).toBe(
      false,
    );
    expect(projectAllowsProductionOrder(baseProject({ status: 'quoted' }))).toBe(
      false,
    );
  });

  it('readiness: ready when cut rows exist', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject(),
      cutRows: [cutRow],
    });
    expect(r.cutListOk).toBe(true);
    expect(r.cutRowCount).toBe(1);
    expect(r.moduleUnitCount).toBe(3);
    expect(r.moduleLineCount).toBe(2);
    expect(r.materialsResolved).toBe(true);
    expect(r.optimizerGenerable).toBe(true);
    expect(r.packGenerable).toBe(true);
    expect(r.readyToCut).toBe(true);
    expect(r.hasKitchenLayout).toBe(false);
  });

  it('readiness: cut failure is not ready', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject(),
      cutRows: null,
      cutListError: 'Módulo faltante',
    });
    expect(r.cutListOk).toBe(false);
    expect(r.readyToCut).toBe(false);
    expect(r.cutListError).toContain('Módulo');
  });

  it('readiness: empty cut rows not ready to cut', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject(),
      cutRows: [],
    });
    expect(r.cutListOk).toBe(true);
    expect(r.materialsResolved).toBe(false);
    expect(r.readyToCut).toBe(false);
  });

  it('detects kitchen layout and unplaced items', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject({
        kitchenLayout: {
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'i1',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 0,
              elevation: 'floor',
            },
          ],
        },
      }),
      cutRows: [cutRow],
    });
    expect(r.hasKitchenLayout).toBe(true);
    expect(r.hasPlacements).toBe(true);
    expect(r.hasUnplacedItems).toBe(true); // i2 not placed
  });
});
