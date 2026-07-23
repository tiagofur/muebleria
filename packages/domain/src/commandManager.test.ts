/**
 * CommandManager tests (F061, PRD §4.3).
 */

import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import { CommandManager, type Command } from './commandManager';

function makeCommand(
  label: string,
  apply: (n: number) => number,
): Command<number> {
  let prev = 0;
  return {
    execute: (state) => {
      prev = state;
      return apply(state);
    },
    undo: () => prev,
    describe: () => label,
  };
}

describe('CommandManager', () => {
  it('execute applies the command and pushes to undo stack', () => {
    const mgr = new CommandManager<number>();
    const result = mgr.execute(0, makeCommand('add 1', (n) => n + 1));
    expect(result).toBe(1);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  it('undo reverts the last command and pushes to redo stack', () => {
    const mgr = new CommandManager<number>();
    mgr.execute(0, makeCommand('add 1', (n) => n + 1));
    const result = mgr.undo(1);
    expect(result).toBe(0);
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);
  });

  it('redo re-applies the undone command', () => {
    const mgr = new CommandManager<number>();
    mgr.execute(0, makeCommand('add 1', (n) => n + 1));
    mgr.undo(1);
    const result = mgr.redo(0);
    expect(result).toBe(1);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  it('execute clears the redo stack (standard undo/redo semantics)', () => {
    const mgr = new CommandManager<number>();
    mgr.execute(0, makeCommand('add 1', (n) => n + 1));
    mgr.execute(1, makeCommand('add 2', (n) => n + 2));
    mgr.undo(3); // back to 1
    expect(mgr.canRedo()).toBe(true);
    // New execute clears redo.
    mgr.execute(1, makeCommand('add 10', (n) => n + 10));
    expect(mgr.canRedo()).toBe(false);
  });

  it('undo on empty stack returns state unchanged', () => {
    const mgr = new CommandManager<number>();
    expect(mgr.undo(42)).toBe(42);
  });

  it('redo on empty stack returns state unchanged', () => {
    const mgr = new CommandManager<number>();
    expect(mgr.redo(42)).toBe(42);
  });

  it('respects the stack limit (default 50)', () => {
    const mgr = new CommandManager<number>(3);
    mgr.execute(0, makeCommand('a', (n) => n + 1));
    mgr.execute(1, makeCommand('b', (n) => n + 1));
    mgr.execute(2, makeCommand('c', (n) => n + 1));
    mgr.execute(3, makeCommand('d', (n) => n + 1));
    // Limit 3: oldest (a) trimmed.
    expect(mgr.undoLabel()).toBe('d');
    mgr.undo(4); // undo d
    expect(mgr.undoLabel()).toBe('c');
    mgr.undo(3); // undo c
    expect(mgr.undoLabel()).toBe('b');
    mgr.undo(2); // undo b
    // a was trimmed — nothing more to undo.
    expect(mgr.canUndo()).toBe(false);
  });

  it('undoLabel / redoLabel return describe() or null', () => {
    const mgr = new CommandManager<number>();
    expect(mgr.undoLabel()).toBeNull();
    expect(mgr.redoLabel()).toBeNull();
    mgr.execute(0, makeCommand('my action', (n) => n + 1));
    expect(mgr.undoLabel()).toBe('my action');
    mgr.undo(1);
    expect(mgr.redoLabel()).toBe('my action');
  });

  it('clear empties both stacks', () => {
    const mgr = new CommandManager<number>();
    mgr.execute(0, makeCommand('x', (n) => n + 1));
    mgr.undo(1);
    mgr.clear();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
  });

  it('sequence execute/undo/redo maintains state consistent', () => {
    const mgr = new CommandManager<number>();
    let state = 0;
    state = mgr.execute(state, makeCommand('+1', (n) => n + 1));
    expect(state).toBe(1);
    state = mgr.execute(state, makeCommand('+2', (n) => n + 2));
    expect(state).toBe(3);
    state = mgr.undo(state); // undo +2
    expect(state).toBe(1);
    state = mgr.undo(state); // undo +1
    expect(state).toBe(0);
    state = mgr.redo(state); // redo +1
    expect(state).toBe(1);
    state = mgr.redo(state); // redo +2
    expect(state).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Project commands smoke tests
// ---------------------------------------------------------------------------

describe('projectCommands smoke', () => {
  it('addProjectItemCommand adds then removes on undo', async () => {
    const { addProjectItemCommand } = await import('./projectCommands');
    const project: Project = {
      id: 'p1',
      name: 'Test',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };
    const item = {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 2,
      optionChoices: {},
    };
    const cmd = addProjectItemCommand(item);
    const withItem = cmd.execute(project);
    expect(withItem.items).toHaveLength(1);
    const withoutItem = cmd.undo(withItem);
    expect(withoutItem.items).toHaveLength(0);
  });

  it('changeQuantityCommand changes then restores on undo', async () => {
    const { changeQuantityCommand } = await import('./projectCommands');
    const project: Project = {
      id: 'p1',
      name: 'Test',
      customerId: 'c1',
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'item-1',
          moduleId: 'mod-1',
          quantity: 1,
          optionChoices: { INTERIOR: 'mat-1' },
        },
      ],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };
    const cmd = changeQuantityCommand('item-1', 5, project);
    const changed = cmd.execute(project);
    expect(changed.items[0]!.quantity).toBe(5);
    const restored = cmd.undo(changed);
    expect(restored.items[0]!.quantity).toBe(1);
  });
});
