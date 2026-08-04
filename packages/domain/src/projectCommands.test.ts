/**
 * Tests for projectCommands — specifically reorderProjectItemsCommand.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { Project, ProjectItem } from './types';
import { reorderProjectItemsCommand } from './projectCommands';

function makeItem(id: string): ProjectItem {
  return {
    id,
    moduleId: `mod-${id}`,
    quantity: 1,
    optionChoices: {},
  };
}

function makeProject(itemIds: string[]): Project {
  return {
    id: 'prj-1',
    name: 'Test Project',
    customerId: 'cust-1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: itemIds.map(makeItem),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('reorderProjectItemsCommand', () => {
  it('moves item forward (lower index → higher index)', () => {
    const project = makeProject(['a', 'b', 'c', 'd', 'e']);
    const cmd = reorderProjectItemsCommand(1, 3); // b → position 3
    const result = cmd.execute(project);
    expect(result.items.map((i) => i.id)).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('moves item backward (higher index → lower index)', () => {
    const project = makeProject(['a', 'b', 'c', 'd', 'e']);
    const cmd = reorderProjectItemsCommand(3, 1); // d → position 1
    const result = cmd.execute(project);
    expect(result.items.map((i) => i.id)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('noop when from === to', () => {
    const project = makeProject(['a', 'b', 'c']);
    const cmd = reorderProjectItemsCommand(1, 1);
    const result = cmd.execute(project);
    expect(result.items).toBe(project.items); // same reference = no mutation
    expect(result.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('clamps fromIndex to valid range', () => {
    const project = makeProject(['a', 'b', 'c']);
    const cmd = reorderProjectItemsCommand(99, 0);
    const result = cmd.execute(project);
    // fromIndex 99 is clamped to 2 (last index), moved to 0
    expect(result.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('clamps toIndex to valid range', () => {
    const project = makeProject(['a', 'b', 'c']);
    const cmd = reorderProjectItemsCommand(0, 99);
    const result = cmd.execute(project);
    // toIndex 99 is clamped to 2 (last index)
    expect(result.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('undoes a forward move', () => {
    const project = makeProject(['a', 'b', 'c', 'd', 'e']);
    const cmd = reorderProjectItemsCommand(1, 3);
    const moved = cmd.execute(project);
    const restored = cmd.undo(moved);
    expect(restored.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('undoes a backward move', () => {
    const project = makeProject(['a', 'b', 'c', 'd', 'e']);
    const cmd = reorderProjectItemsCommand(3, 1);
    const moved = cmd.execute(project);
    const restored = cmd.undo(moved);
    expect(restored.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('undoes noop correctly', () => {
    const project = makeProject(['a', 'b', 'c']);
    const cmd = reorderProjectItemsCommand(1, 1);
    const moved = cmd.execute(project);
    const restored = cmd.undo(moved);
    expect(restored.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves first item to last position', () => {
    const project = makeProject(['a', 'b', 'c']);
    const cmd = reorderProjectItemsCommand(0, 2);
    const result = cmd.execute(project);
    expect(result.items.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves last item to first position', () => {
    const project = makeProject(['a', 'b', 'c']);
    const cmd = reorderProjectItemsCommand(2, 0);
    const result = cmd.execute(project);
    expect(result.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('produces correct describe text', () => {
    const cmd = reorderProjectItemsCommand(0, 1);
    expect(cmd.describe()).toBe('Reordenar mueble');
  });

  it('updates the updatedAt timestamp', () => {
    const project = makeProject(['a', 'b']);
    const cmd = reorderProjectItemsCommand(0, 1);
    const result = cmd.execute(project);
    expect(result.updatedAt).not.toBe(project.updatedAt);
  });
});
