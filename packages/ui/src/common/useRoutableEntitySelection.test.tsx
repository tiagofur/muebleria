/**
 * useRoutableEntitySelection tests — list→detail selection synced with the
 * shell URL handoff.
 *
 * #1149: the toggle must notify the shell from OUTSIDE the setState updater.
 * An updater has to stay pure — React may run it during render, and
 * StrictMode runs it twice — so calling onSelectionChange (navigate →
 * BrowserRouter setState) from inside it updated the router mid-render.
 * These tests render under StrictMode so an impure updater shows up as a
 * duplicated shell notification.
 * @vitest-environment jsdom
 */

import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoutableEntitySelection } from './useRoutableEntitySelection';

function renderSelection(
  initial: Partial<Parameters<typeof useRoutableEntitySelection>[0]> = {},
) {
  return renderHook(
    (props: Parameters<typeof useRoutableEntitySelection>[0]) =>
      useRoutableEntitySelection(props),
    {
      initialProps: { knownIds: ['ent-1', 'ent-2'], ...initial },
      wrapper: StrictMode,
    },
  );
}

describe('useRoutableEntitySelection', () => {
  it('starts from the openEntityId prop without notifying the shell', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderSelection({ openEntityId: 'ent-2', onSelectionChange });
    expect(result.current.selectedId).toBe('ent-2');
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('toggle selects an entity and notifies the shell exactly once (#1149)', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderSelection({ onSelectionChange });
    expect(result.current.selectedId).toBeNull();

    act(() => result.current.toggleSelectedId('ent-1'));

    expect(result.current.selectedId).toBe('ent-1');
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith('ent-1');
  });

  it('toggling the selected entity clears it and notifies null once', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderSelection({ onSelectionChange });

    act(() => result.current.toggleSelectedId('ent-1'));
    act(() => result.current.toggleSelectedId('ent-1'));

    expect(result.current.selectedId).toBeNull();
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('setSelectedId notifies the shell with the new selection', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderSelection({ onSelectionChange });

    act(() => result.current.setSelectedId('ent-2'));

    expect(result.current.selectedId).toBe('ent-2');
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith('ent-2');
  });

  it('syncs state FROM openEntityId changes without notifying the shell', () => {
    const onSelectionChange = vi.fn();
    const { result, rerender } = renderSelection({ openEntityId: null, onSelectionChange });

    rerender({ knownIds: ['ent-1', 'ent-2'], openEntityId: 'ent-1', onSelectionChange });
    expect(result.current.selectedId).toBe('ent-1');

    rerender({ knownIds: ['ent-1', 'ent-2'], openEntityId: null, onSelectionChange });
    expect(result.current.selectedId).toBeNull();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('drops the selection when the selected entity disappears from the list', () => {
    const onSelectionChange = vi.fn();
    const { result, rerender } = renderSelection({ onSelectionChange });

    act(() => result.current.toggleSelectedId('ent-1'));
    expect(result.current.selectedId).toBe('ent-1');

    rerender({ knownIds: ['ent-2'], onSelectionChange });
    expect(result.current.selectedId).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });
});
