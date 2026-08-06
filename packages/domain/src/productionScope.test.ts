import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import {
  listProductionSpaceOptions,
  projectScopedToProductionSpace,
  itemIdsForProductionSpace,
} from './productionScope';

function multiSpaceProject(): Project {
  return {
    id: 'p1',
    name: 'Obra multi',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
      { id: 'i3', moduleId: 'm3', quantity: 1, optionChoices: {} },
    ],
    kitchenLayout: {
      walls: [],
      placements: [],
      spaces: [
        {
          id: 'cocina',
          name: 'Cocina',
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
        {
          id: 'bano',
          name: 'Baño',
          walls: [{ id: 'w2', lengthMm: 2000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'i2',
              instanceIndex: 0,
              wallId: 'w2',
              offsetMm: 0,
              elevation: 'floor',
            },
          ],
        },
      ],
      activeSpaceId: 'cocina',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('productionScope (PROD-4.4)', () => {
  it('lists spaces when multi-ambiente', () => {
    const opts = listProductionSpaceOptions(multiSpaceProject());
    expect(opts).toHaveLength(2);
    expect(opts[0]!.name).toBe('Cocina');
    expect(opts[0]!.itemCount).toBe(1);
  });

  it('scopes project items and walls to a space', () => {
    const scoped = projectScopedToProductionSpace(multiSpaceProject(), 'bano');
    expect(scoped.items.map((i) => i.id)).toEqual(['i2']);
    expect(scoped.kitchenLayout?.walls[0]?.id).toBe('w2');
    expect(itemIdsForProductionSpace(multiSpaceProject(), 'cocina').has('i1')).toBe(
      true,
    );
  });
});
