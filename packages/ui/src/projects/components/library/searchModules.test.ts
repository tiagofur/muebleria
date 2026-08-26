import { describe, expect, it } from 'vitest';
import type { CategoryNode, Module } from '@granete/domain';
import { normalizeSearchText, searchModules } from './searchModules';

function buildModule(
  id: string,
  code: string,
  name: string,
  categoryId?: string,
): Module {
  return {
    id,
    code,
    name,
    ...(categoryId ? { categoryId } : {}),
    hardwareLines: [],
  } as Module;
}

const categories: readonly CategoryNode[] = [
  { id: 'cat-cocina', name: 'Cocina', sortOrder: 1 },
  { id: 'cat-bajos', name: 'Bajos', parentId: 'cat-cocina', sortOrder: 1 },
  { id: 'cat-altos', name: 'Altos', parentId: 'cat-cocina', sortOrder: 2 },
  { id: 'cat-bano', name: 'Baño', sortOrder: 2 },
];

const modules: readonly Module[] = [
  buildModule('m1', 'MOD-BM-600', 'Bajo mesada 600', 'cat-bajos'),
  buildModule('m2', 'MOD-AM-800', 'Alacena 800', 'cat-altos'),
  buildModule('m3', 'MOD-VAN-500', 'Vanitory 500', 'cat-bano'),
  buildModule('m4', 'MOD-GEN', 'Mueble genérico'),
];

describe('normalizeSearchText', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeSearchText('Alacena AÑOS')).toBe('alacena anos');
  });

  it('collapses repeated whitespace and trims', () => {
    expect(normalizeSearchText('  bajo   mesada  ')).toBe('bajo mesada');
  });
});

describe('searchModules', () => {
  it('empty query returns all modules in catalog order', () => {
    expect(searchModules(modules, '', categories)).toHaveLength(4);
    expect(searchModules(modules, '   ', categories).map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });

  it('matches by name (tolerant to accents/case)', () => {
    const hits = searchModules(modules, 'vanitory', categories);
    expect(hits.map((m) => m.id)).toEqual(['m3']);
  });

  it('matches by code', () => {
    const hits = searchModules(modules, 'bm-600', categories);
    expect(hits.map((m) => m.id)).toEqual(['m1']);
  });

  it('matches by category name including ancestors', () => {
    const hits = searchModules(modules, 'bajos', categories);
    expect(hits.map((m) => m.id)).toEqual(['m1']);
  });

  it('AND-matches multi-word queries across name and code', () => {
    const hits = searchModules(modules, 'bajo 600', categories);
    expect(hits.map((m) => m.id)).toEqual(['m1']);
  });

  it('returns no results when nothing matches', () => {
    expect(searchModules(modules, 'xyz-inexistente', categories)).toEqual([]);
  });

  it('works without categories', () => {
    const hits = searchModules(modules, 'generico');
    expect(hits.map((m) => m.id)).toEqual(['m4']);
  });
});
