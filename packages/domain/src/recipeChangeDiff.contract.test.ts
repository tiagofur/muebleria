import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RecipeChangeContractError,
  parseRecipeChangeDiff,
  parseRecipeChangeSimulationResponse,
} from './recipeChangeDiff';

// #1369 — contract parity by fixture: Go produces the diff
// (engine.SimulateRecipeChange → recipe_change_diff_fixture_test.go freezes it),
// TS only consumes it. This test proves the TS types/parser accept the exact
// committed wire shape and read the classified rows the UI will render.
const fixturePath = join(__dirname, '..', '..', '..', 'contracts', 'fixtures', 'recipe-change-diff-canonical.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  readonly params: { widthMm: number; depthMm: number; heightMm: number };
  readonly expectedDiff: unknown;
};

describe('RecipeChangeDiff contract (TS consumes the Go-produced canonical fixture)', () => {
  it('parses the committed diff and exposes every classified section by declared id', () => {
    const diff = parseRecipeChangeDiff(fixture.expectedDiff);

    expect(diff.state).toBe('valid');
    expect(diff.candidateResolved).toBe(true);
    expect(diff.params).toEqual(fixture.params);

    const member = (id: string) => diff.members.find((m) => m.memberId === id);
    expect(member('locking_device_left')?.change).toBe('removed');
    expect(member('runner_mid')?.change).toBe('added');
    expect(member('runner_mid')?.translationAfterMm?.[0]).toBe(300);
    expect(member('side_right')?.change).toBe('moved');
    expect(member('side_right')?.translationDeltaMm).toEqual([-10, 0, 0]);
    expect(member('side_left')?.change).toBe('unchanged');
    expect(member('side_left')?.translationDeltaMm).toBeUndefined();

    const bottom = diff.boards.find((b) => b.componentId === 'comp-drawer-bottom');
    expect(bottom?.change).toBe('resized');
    expect(bottom?.before?.widthMm).toBe(565);
    expect(bottom?.after?.widthMm).toBe(545);

    expect(diff.variants).toEqual([
      expect.objectContaining({ variantSetId: 'vs-drawer-depth', change: 'unchanged' }),
    ]);

    const kit = (id: string) => diff.consumption.find((c) => c.hardwareId === id);
    expect(kit('hw-kit-drawer-synth')?.change).toBe('removed');
    expect(kit('hw-kit-drawer-premium')?.change).toBe('added');

    expect(diff.summary).toEqual({ added: 2, removed: 3, moved: 1, resized: 1, rejected: 0, totalChanges: 7 });
    // Rows arrive sorted by declared id (idempotent wire order).
    expect(diff.members.map((m) => m.memberId)).toEqual([...diff.members.map((m) => m.memberId)].sort());
  });

  it('parses the full simulation response envelope (If-Match for the apply travels as currentVersion)', () => {
    const res = parseRecipeChangeSimulationResponse({
      agregadoId: 'agr-sim',
      currentVersion: 3,
      diff: fixture.expectedDiff,
    });
    expect(res.agregadoId).toBe('agr-sim');
    expect(res.currentVersion).toBe(3);
    expect(res.diff.summary.totalChanges).toBe(7);
  });

  it('fails closed on an unknown state or change kind instead of rendering a guessed row', () => {
    const base = fixture.expectedDiff as Record<string, unknown>;
    expect(() => parseRecipeChangeDiff({ ...base, state: 'kinda_valid' })).toThrow(RecipeChangeContractError);
    const members = base.members as Record<string, unknown>[];
    expect(() =>
      parseRecipeChangeDiff({ ...base, members: [{ ...members[0], change: 'teleported' }] }),
    ).toThrow(/unknown change kind/);
    expect(() =>
      parseRecipeChangeDiff({
        ...base,
        variants: [{ variantSetId: 'vs-x', change: 'rejected' }],
      }),
    ).toThrow(/carries no rejection/);
    expect(() => parseRecipeChangeSimulationResponse({ agregadoId: '', currentVersion: 1, diff: base })).toThrow(
      RecipeChangeContractError,
    );
  });
});
