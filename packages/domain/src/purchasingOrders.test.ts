import { describe, expect, it } from 'vitest';
import {
  isValidPoStatus,
  poCanCancel,
  poCanEmit,
  poCanReceive,
  poFullyReceived,
  poRemaining,
  type PurchaseOrderItem,
} from './purchasingOrders';

const line = (quantity: number, received: number): PurchaseOrderItem => ({
  kind: 'herrajes',
  materialId: 'h1',
  quantity,
  receivedQuantity: received,
});

describe('purchase order lifecycle helpers', () => {
  it('validates known statuses only', () => {
    expect(isValidPoStatus('borrador')).toBe(true);
    expect(isValidPoStatus('emitida')).toBe(true);
    expect(isValidPoStatus('recibida')).toBe(true);
    expect(isValidPoStatus('cancelada')).toBe(true);
    expect(isValidPoStatus('pagada')).toBe(false);
    expect(isValidPoStatus(null)).toBe(false);
  });

  it('emits only from borrador', () => {
    expect(poCanEmit('borrador')).toBe(true);
    expect(poCanEmit('emitida')).toBe(false);
    expect(poCanEmit('recibida')).toBe(false);
    expect(poCanEmit('cancelada')).toBe(false);
  });

  it('cancels from borrador or emitida, never terminal', () => {
    expect(poCanCancel('borrador')).toBe(true);
    expect(poCanCancel('emitida')).toBe(true);
    expect(poCanCancel('recibida')).toBe(false);
    expect(poCanCancel('cancelada')).toBe(false);
  });

  it('receives only emitted orders', () => {
    expect(poCanReceive('emitida')).toBe(true);
    expect(poCanReceive('borrador')).toBe(false);
    expect(poCanReceive('recibida')).toBe(false);
    expect(poCanReceive('cancelada')).toBe(false);
  });

  it('fully received when every line reached its quantity', () => {
    expect(poFullyReceived([line(50, 50), line(4, 4)])).toBe(true);
    expect(poFullyReceived([line(50, 30), line(4, 4)])).toBe(false);
    expect(poFullyReceived([line(50, 51)])).toBe(true); // over-received counts
    expect(poFullyReceived([])).toBe(false); // empty order is never complete
  });

  it('remaining is quantity minus received, never negative', () => {
    expect(poRemaining(line(50, 30))).toBe(20);
    expect(poRemaining(line(50, 50))).toBe(0);
    expect(poRemaining(line(50, 60))).toBe(0);
  });
});
