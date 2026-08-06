import { describe, expect, it } from 'vitest';
import {
  isPastDragThreshold,
  MODULE_DRAG_THRESHOLD_PX,
} from './moduleDragGesture';

describe('moduleDragGesture', () => {
  it('click (no move) stays below threshold', () => {
    expect(isPastDragThreshold(100, 100, 100, 100)).toBe(false);
    expect(isPastDragThreshold(100, 100, 103, 102)).toBe(false);
  });

  it('past threshold becomes drag', () => {
    expect(
      isPastDragThreshold(100, 100, 100 + MODULE_DRAG_THRESHOLD_PX, 100),
    ).toBe(true);
    expect(isPastDragThreshold(0, 0, 10, 10)).toBe(true);
  });
});
