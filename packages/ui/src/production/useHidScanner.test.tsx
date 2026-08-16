/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useHidScanner } from './useHidScanner';

afterEach(() => cleanup());

function Probe({
  onScan,
  enabled = true,
  maxGapMs,
}: {
  onScan: (code: string) => void;
  enabled?: boolean;
  maxGapMs?: number;
}) {
  useHidScanner({ onScan, enabled, maxGapMs });
  return (
    <div>
      <input type="text" data-testid="probe-input" />
    </div>
  );
}

/** Fire a scanner burst: chars + Enter, synchronously (tiny gaps, like a gun). */
function fireHidScan(code: string): void {
  for (const ch of code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
  }
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
  );
}

function fireKey(key: string, target?: EventTarget): void {
  const event = new KeyboardEvent('keydown', {
    key,
    cancelable: true,
    bubbles: true,
  });
  (target ?? window).dispatchEvent(event);
}

describe('useHidScanner (F089)', () => {
  it('captures a scanner burst ending in Enter', () => {
    const onScan = vi.fn();
    render(<Probe onScan={onScan} />);
    fireHidScan('GAB-01');
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('GAB-01');
  });

  it('ignores keystrokes aimed at an editable field', () => {
    const onScan = vi.fn();
    render(<Probe onScan={onScan} />);
    const input = document.querySelector('input')!;
    fireKey('G', input);
    fireKey('A', input);
    fireKey('B', input);
    fireKey('Enter', input);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('does not fire for human-paced typing (gap resets the buffer)', () => {
    const onScan = vi.fn();
    render(<Probe onScan={onScan} maxGapMs={0} />);
    // With maxGapMs 0 every key starts a new burst → buffer never reaches 2.
    fireHidScan('GAB-01');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('requires min length and ignores lone Enter', () => {
    const onScan = vi.fn();
    render(<Probe onScan={onScan} />);
    fireKey('Enter');
    expect(onScan).not.toHaveBeenCalled();
    fireHidScan('X');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('clears the buffer on Escape and ignores modifier combos', () => {
    const onScan = vi.fn();
    render(<Probe onScan={onScan} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B' }));
    fireKey('Escape');
    fireHidScan('01');
    expect(onScan).toHaveBeenCalledWith('01');
  });

  it('stops listening when disabled', () => {
    const onScan = vi.fn();
    const { rerender } = render(<Probe onScan={onScan} enabled />);
    rerender(<Probe onScan={onScan} enabled={false} />);
    fireHidScan('GAB-01');
    expect(onScan).not.toHaveBeenCalled();
  });
});
