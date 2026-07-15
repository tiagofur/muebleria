import { describe, expect, it } from 'vitest';
import {
  MAX_CATEGORY_DEPTH,
  UNCATEGORIZED_FILTER,
  assertCategoryPlacement,
  canPlaceCategory,
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  categoryDepth,
  categoryPath,
  childrenOf,
  collectDescendantIds,
  filterModulesByCategory,
  subtreeHeight,
} from './categories';
import { ValidationError } from './errors';
import type { Module, ModuleCategory } from './types';

const cats: readonly ModuleCategory[] = [
  { id: 'c1', name: 'Cocina', sortOrder: 0 },
  { id: 'c1a', name: 'Alacenas', parentId: 'c1', sortOrder: 0 },
  { id: 'c1a1', name: 'Esquineras', parentId: 'c1a', sortOrder: 0 },
  { id: 'c2', name: 'Dormitorio', sortOrder: 1 },
];

const modules: readonly Module[] = [
  {
    id: 'm1',
    code: 'A',
    name: 'Sin cat',
    boardParts: [],
    hardwareLines: [],
  },
  {
    id: 'm2',
    code: 'B',
    name: 'Cocina root',
    categoryId: 'c1',
    boardParts: [],
    hardwareLines: [],
  },
  {
    id: 'm3',
    code: 'C',
    name: 'Esquinera',
    categoryId: 'c1a1',
    boardParts: [],
    hardwareLines: [],
  },
];

describe('category hierarchy', () => {
  it('computes depth root=1 mid=2 leaf=3', () => {
    expect(categoryDepth('c1', cats)).toBe(1);
    expect(categoryDepth('c1a', cats)).toBe(2);
    expect(categoryDepth('c1a1', cats)).toBe(3);
    expect(MAX_CATEGORY_DEPTH).toBe(3);
  });

  it('lists children sorted', () => {
    expect(childrenOf(cats, undefined).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(childrenOf(cats, 'c1').map((c) => c.id)).toEqual(['c1a']);
  });

  it('collects descendants', () => {
    expect(collectDescendantIds('c1', cats).sort()).toEqual(['c1a', 'c1a1']);
  });

  it('subtree height', () => {
    expect(subtreeHeight('c1a1', cats)).toBe(1);
    expect(subtreeHeight('c1a', cats)).toBe(2);
    expect(subtreeHeight('c1', cats)).toBe(3);
  });

  it('rejects 4th level create under leaf', () => {
    expect(() =>
      assertCategoryPlacement('c1a1', cats, { name: 'Too deep' }),
    ).toThrow(ValidationError);
    expect(canPlaceCategory('c1a1', cats)).toBe(false);
    expect(canPlaceCategory('c1a', cats)).toBe(true);
  });

  it('rejects move that would exceed depth', () => {
    // Move c2 under c1a1 would make depth 4
    expect(canPlaceCategory('c1a1', cats, 'c2')).toBe(false);
    // Move c1a1 under c2 is ok (depth 2)
    expect(canPlaceCategory('c2', cats, 'c1a1')).toBe(true);
  });

  it('rejects parent under own descendant', () => {
    expect(() =>
      assertCategoryPlacement('c1a1', cats, { movingId: 'c1' }),
    ).toThrow(ValidationError);
  });

  it('filters modules by category subtree and uncategorized', () => {
    expect(filterModulesByCategory(modules, null, cats)).toHaveLength(3);
    expect(
      filterModulesByCategory(modules, UNCATEGORIZED_FILTER, cats).map(
        (m) => m.id,
      ),
    ).toEqual(['m1']);
    // c1 includes descendants
    expect(
      filterModulesByCategory(modules, 'c1', cats)
        .map((m) => m.id)
        .sort(),
    ).toEqual(['m2', 'm3']);
    expect(
      filterModulesByCategory(modules, 'c1a1', cats).map((m) => m.id),
    ).toEqual(['m3']);
  });

  it('cascade helpers', () => {
    const opts = cascadeOptions(cats, { level1Id: 'c1', level2Id: 'c1a' });
    expect(opts.level1.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(opts.level2.map((c) => c.id)).toEqual(['c1a']);
    expect(opts.level3.map((c) => c.id)).toEqual(['c1a1']);
    expect(
      cascadeSelectedCategoryId({
        level1Id: 'c1',
        level2Id: 'c1a',
        level3Id: 'c1a1',
      }),
    ).toBe('c1a1');
    expect(cascadeFromCategoryId('c1a1', cats)).toEqual({
      level1Id: 'c1',
      level2Id: 'c1a',
      level3Id: 'c1a1',
    });
    expect(categoryPath('c1a1', cats).map((c) => c.name)).toEqual([
      'Cocina',
      'Alacenas',
      'Esquineras',
    ]);
  });
});
