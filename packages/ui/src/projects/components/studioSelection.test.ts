import { describe, expect, it } from 'vitest';
import {
  applySelectionClick,
  applySelectionRange,
  EMPTY_STUDIO_SELECTION,
  isSelected,
  modifiersFromPointer,
  primarySelectionKey,
  pruneSelection,
} from './studioSelection';

describe('studioSelection', () => {
  it('click simple selecciona uno y marca ancla', () => {
    const next = applySelectionClick(EMPTY_STUDIO_SELECTION, 'a#0', {});
    expect(next).toEqual({ keys: ['a#0'], anchorKey: 'a#0' });
    expect(primarySelectionKey(next)).toBe('a#0');
  });

  it('ctrl+click alterna sin perder la primaria', () => {
    const one = applySelectionClick(EMPTY_STUDIO_SELECTION, 'a#0', {});
    const two = applySelectionClick(one, 'b#0', { ctrlOrMeta: true });
    expect(two.keys).toEqual(['a#0', 'b#0']);
    expect(primarySelectionKey(two)).toBe('a#0');
    const back = applySelectionClick(two, 'a#0', { ctrlOrMeta: true });
    expect(back.keys).toEqual(['b#0']);
    expect(primarySelectionKey(back)).toBe('b#0');
  });

  it('shift+click en canvas añade sin alternar', () => {
    const one = applySelectionClick(EMPTY_STUDIO_SELECTION, 'a#0', {});
    const two = applySelectionClick(one, 'b#0', { shift: true });
    expect(two.keys).toEqual(['a#0', 'b#0']);
    const again = applySelectionClick(two, 'b#0', { shift: true });
    expect(again).toBe(two);
  });

  it('shift+click en lista hace rango según el orden visible', () => {
    const ordered = ['a#0', 'b#0', 'c#0', 'd#0'];
    const anchor = applySelectionClick(EMPTY_STUDIO_SELECTION, 'a#0', {});
    const range = applySelectionRange(anchor, ordered, 'c#0');
    expect(range.keys).toEqual(['a#0', 'b#0', 'c#0']);
    const reverse = applySelectionRange(range, ordered, 'd#0');
    expect(reverse.keys).toEqual(['a#0', 'b#0', 'c#0', 'd#0']);
  });

  it('rango sin ancla válida selecciona simple', () => {
    const range = applySelectionRange(
      EMPTY_STUDIO_SELECTION,
      ['a#0', 'b#0'],
      'b#0',
    );
    expect(range).toEqual({ keys: ['b#0'], anchorKey: 'b#0' });
  });

  it('prune saca claves inválidas y promueve la primaria', () => {
    const sel = { keys: ['a#0', 'b#0', 'c#0'], anchorKey: 'a#0' };
    const pruned = pruneSelection(sel, ['b#0', 'c#0']);
    expect(pruned.keys).toEqual(['b#0', 'c#0']);
    expect(primarySelectionKey(pruned)).toBe('b#0');
    expect(pruned.anchorKey).toBeNull();
  });

  it('prune no copia si nada cambia', () => {
    const sel = { keys: ['a#0'], anchorKey: 'a#0' };
    expect(pruneSelection(sel, ['a#0'])).toBe(sel);
  });

  it('modifiersFromPointer mapea ctrl o meta', () => {
    expect(
      modifiersFromPointer({ shiftKey: false, ctrlKey: true, metaKey: false }),
    ).toEqual({ shift: false, ctrlOrMeta: true });
    expect(
      modifiersFromPointer({ shiftKey: true, ctrlKey: false, metaKey: true }),
    ).toEqual({ shift: true, ctrlOrMeta: true });
  });

  it('isSelected consulta por clave', () => {
    const sel = applySelectionClick(EMPTY_STUDIO_SELECTION, 'a#0', {});
    expect(isSelected(sel, 'a#0')).toBe(true);
    expect(isSelected(sel, 'b#0')).toBe(false);
  });
});
