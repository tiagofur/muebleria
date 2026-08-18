import { describe, expect, it } from 'vitest';
import {
  applyStockMovement,
  stockMovementDelta,
  stockStatus,
  stockUnitLabel,
  stockUnitPlural,
  stockValue,
  roleCanManageStock,
} from './index';

describe('stock (Fase 3b)', () => {
  it('stockStatus derives the alert state from balance vs minimum', () => {
    expect(stockStatus(0, 10)).toBe('agotado');
    expect(stockStatus(-1, 0)).toBe('agotado');
    expect(stockStatus(10, 10)).toBe('bajo');
    expect(stockStatus(5, 10)).toBe('bajo');
    expect(stockStatus(11, 10)).toBe('ok');
  });

  it('stockMovementDelta signs per type (ajuste signed)', () => {
    expect(stockMovementDelta('entrada', 50)).toBe(50);
    expect(stockMovementDelta('salida', 3)).toBe(-3);
    expect(stockMovementDelta('despacho', 12)).toBe(-12);
    expect(stockMovementDelta('ajuste', -5)).toBe(-5);
    expect(stockMovementDelta('ajuste', 2)).toBe(2);
  });

  it('applyStockMovement adds the delta to the balance', () => {
    expect(applyStockMovement(10, -4)).toBe(6);
    expect(applyStockMovement(6, 4)).toBe(10);
  });

  it('stockUnitLabel maps kinds to stock units', () => {
    expect(stockUnitLabel('tableros')).toBe('plancha');
    expect(stockUnitLabel('cintillas')).toBe('ml');
    expect(stockUnitLabel('herrajes')).toBe('pieza');
    expect(stockUnitLabel('herrajes', 'set')).toBe('juego');
    expect(stockUnitLabel('herrajes', 'meter')).toBe('metro');
  });

  it('stockUnitPlural pluralizes except ml', () => {
    expect(stockUnitPlural('plancha', 4)).toBe('planchas');
    expect(stockUnitPlural('plancha', 1)).toBe('plancha');
    expect(stockUnitPlural('ml', 4)).toBe('ml');
    expect(stockUnitPlural('pieza', 12)).toBe('piezas');
  });

  it('roleCanManageStock: admin/almacen write, gerente reads only', () => {
    expect(roleCanManageStock('admin')).toBe(true);
    expect(roleCanManageStock('almacen')).toBe(true);
    expect(roleCanManageStock('gerente_produccion')).toBe(false);
    expect(roleCanManageStock('produccion')).toBe(false);
    expect(roleCanManageStock('ingeniero')).toBe(false);
    expect(roleCanManageStock(null)).toBe(false);
  });

  it('stockValue = quantity × unit price (catalog fields per kind)', () => {
    expect(stockValue(14, 714.43)).toBeCloseTo(10002.02, 2);
    expect(stockValue(320.5, 12)).toBeCloseTo(3846, 1);
    expect(stockValue(50, 0.5)).toBe(25);
    expect(stockValue(6, 0)).toBe(0);
  });

  it('stockValue returns null when the price is missing (untracked)', () => {
    expect(stockValue(10, undefined)).toBeNull();
    expect(stockValue(10, Number.NaN)).toBeNull();
    expect(stockValue(10, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
