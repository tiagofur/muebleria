/**
 * Command pattern + undo/redo for project mutations (PRD §4.3).
 *
 * Each mutation is encapsulated in a Command with execute() and undo().
 * The CommandManager maintains two stacks with a configurable limit (default 50).
 *
 * Designed to be pure domain logic (no React) so it's 100% testable.
 * The UI hook (useUndoRedo) wires keyboard shortcuts and React state sync.
 */

/**
 * A reversible mutation. `execute()` applies the change; `undo()` reverts it.
 * `describe()` returns a human-readable label for UI (e.g. undo menu).
 */
export interface Command<T> {
  readonly execute: (state: T) => T;
  readonly undo: (state: T) => T;
  readonly describe: () => string;
}

/**
 * Manages undo/redo stacks for a state container.
 * Pure logic — no side effects, no React.
 */
export class CommandManager<T> {
  private readonly undoStack: Command<T>[] = [];
  private readonly redoStack: Command<T>[] = [];
  private readonly limit: number;

  constructor(limit = 50) {
    this.limit = limit;
  }

  /**
   * Execute a command and push it onto the undo stack.
   * Clears the redo stack (standard undo/redo semantics).
   */
  execute(state: T, command: Command<T>): T {
    const next = command.execute(state);
    this.undoStack.push(command);
    // Trim oldest if over limit.
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    return next;
  }

  /**
   * Undo the last command. Returns the reverted state, or `state` unchanged
   * if the undo stack is empty.
   */
  undo(state: T): T {
    const command = this.undoStack.pop();
    if (!command) return state;
    const prev = command.undo(state);
    this.redoStack.push(command);
    return prev;
  }

  /**
   * Redo the last undone command. Returns the re-applied state, or `state`
   * unchanged if the redo stack is empty.
   */
  redo(state: T): T {
    const command = this.redoStack.pop();
    if (!command) return state;
    const next = command.execute(state);
    this.undoStack.push(command);
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Description of the next undo (for UI labels like "Deshacer: Agregar mueble").
   */
  undoLabel(): string | null {
    const cmd = this.undoStack[this.undoStack.length - 1];
    return cmd ? cmd.describe() : null;
  }

  /**
   * Description of the next redo.
   */
  redoLabel(): string | null {
    const cmd = this.redoStack[this.redoStack.length - 1];
    return cmd ? cmd.describe() : null;
  }

  /**
   * Clear both stacks (e.g. when switching projects).
   */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
