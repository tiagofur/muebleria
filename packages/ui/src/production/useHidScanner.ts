/**
 * Global HID barcode/QR scanner listener (F089 / #240).
 *
 * Scanner guns (USB / Bluetooth) behave like keyboards: they type the
 * payload very fast and finish with Enter. This hook captures those
 * bursts anywhere on the page — no input focus required — while leaving
 * normal typing alone: keystrokes aimed at an editable field are ignored,
 * and human-paced typing never builds a burst long enough to fire.
 */

import { useEffect, useRef } from 'react';

export type HidScannerOptions = {
  /** Called with the scanned code (chars + terminating Enter). */
  readonly onScan: (code: string) => void;
  /** Mount the listener (e.g. false while a blocking modal is up). Default true. */
  readonly enabled?: boolean;
  /** Minimum buffered chars to accept a scan. Default 2. */
  readonly minCodeLength?: number;
  /**
   * Max gap in ms between keystrokes to stay in the same burst.
   * Scanners emit 1–10ms per char; humans rarely sustain <80ms. Default 80.
   */
  readonly maxGapMs?: number;
  /** Drop the buffer after this much silence without Enter. Default 300. */
  readonly idleResetMs?: number;
};

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

export function useHidScanner({
  onScan,
  enabled = true,
  minCodeLength = 2,
  maxGapMs = 80,
  idleResetMs = 300,
}: HidScannerOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let lastKeyAt = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
      buffer = '';
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        reset();
        return;
      }
      if (isEditableTarget(e.target)) {
        reset();
        return;
      }
      if (e.key === 'Escape') {
        reset();
        return;
      }
      const now = e.timeStamp;
      if (e.key === 'Enter') {
        const code = buffer;
        const complete = code.length >= minCodeLength;
        reset();
        if (complete) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (buffer.length === 0 || now - lastKeyAt < maxGapMs) {
        buffer += e.key;
      } else {
        buffer = e.key;
      }
      lastKeyAt = now;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(reset, Math.max(idleResetMs, maxGapMs * 2));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [enabled, minCodeLength, maxGapMs, idleResetMs]);
}
