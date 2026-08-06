import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import {
  countFloorStatuses,
  nextItemFloorStatus,
  normalizeItemFloorStatus,
  setProjectItemFloorStatus,
} from './productionFloor';

function project(): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {}, floorStatus: 'cut' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('productionFloor (PROD-3.1)', () => {
  it('normalizes missing status to pending', () => {
    expect(normalizeItemFloorStatus(undefined)).toBe('pending');
    expect(normalizeItemFloorStatus('nope')).toBe('pending');
  });

  it('advances pipeline with nextItemFloorStatus', () => {
    expect(nextItemFloorStatus('pending')).toBe('cut');
    expect(nextItemFloorStatus('cut')).toBe('edged');
    expect(nextItemFloorStatus('installed')).toBeNull();
  });

  it('sets floor status on one item', () => {
    const next = setProjectItemFloorStatus(project(), 'i1', 'assembled', '2026-02-01T00:00:00.000Z');
    expect(next.items[0]!.floorStatus).toBe('assembled');
    expect(next.items[1]!.floorStatus).toBe('cut');
    expect(next.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('counts statuses', () => {
    const c = countFloorStatuses(project());
    expect(c.pending).toBe(1);
    expect(c.cut).toBe(1);
    expect(c.assembled).toBe(0);
  });
});
