import { describe, expect, it } from 'vitest';
import type { Project } from '@muebles/domain';
import {
  filterProductionQueue,
  filterProductionVisible,
  isProductionQueueStatus,
} from './productionHelpers';

function project(
  id: string,
  status: Project['status'],
  updatedAt: string,
): Project {
  return {
    id,
    name: id,
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status,
    items: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('productionHelpers (F038)', () => {
  it('isProductionQueueStatus only accepted/produced', () => {
    expect(isProductionQueueStatus('accepted')).toBe(true);
    expect(isProductionQueueStatus('produced')).toBe(true);
    expect(isProductionQueueStatus('draft')).toBe(false);
    expect(isProductionQueueStatus('quoted')).toBe(false);
  });

  it('filterProductionQueue keeps tab status sorted by updatedAt desc', () => {
    const list = [
      project('a', 'accepted', '2026-07-01T00:00:00.000Z'),
      project('b', 'produced', '2026-07-10T00:00:00.000Z'),
      project('c', 'accepted', '2026-07-12T00:00:00.000Z'),
      project('d', 'draft', '2026-07-15T00:00:00.000Z'),
    ];
    const accepted = filterProductionQueue(list, 'accepted');
    expect(accepted.map((p) => p.id)).toEqual(['c', 'a']);
    const produced = filterProductionQueue(list, 'produced');
    expect(produced.map((p) => p.id)).toEqual(['b']);
  });

  it('filterProductionVisible excludes drafts and quoted', () => {
    const list = [
      project('a', 'accepted', '2026-07-01T00:00:00.000Z'),
      project('b', 'produced', '2026-07-10T00:00:00.000Z'),
      project('c', 'quoted', '2026-07-12T00:00:00.000Z'),
    ];
    expect(filterProductionVisible(list).map((p) => p.id)).toEqual(['a', 'b']);
  });
});
