/**
 * #1445 — the shared body scroll lock: overlapping surfaces (Modal,
 * FullscreenDialog, CommandPalette) hold ONE ref-counted lock. Regression
 * coverage for the #1432 class of bug across every consumer of the helper.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { Modal, MODAL_CLOSE_MS } from './Modal';
import { FullscreenDialog } from './FullscreenDialog';
import { CommandPalette, type CommandPaletteItem } from '../shell/CommandPalette';
import { acquireBodyScrollLock } from './bodyScrollLock';

const here = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const paletteItems: CommandPaletteItem[] = [
  { id: 'p1', label: 'Ir a Proyectos', group: 'Navegación' },
];

function ModalHarness({ open }: { open: boolean }) {
  return (
    <Modal open={open} onClose={() => {}} title="Modal">
      cuerpo
    </Modal>
  );
}

describe('acquireBodyScrollLock (helper directo)', () => {
  it('captures the original overflow once and restores it at the last release', () => {
    document.body.style.overflow = 'auto';
    const release1 = acquireBodyScrollLock();
    expect(document.body.style.overflow).toBe('hidden');
    const release2 = acquireBodyScrollLock();
    release1();
    expect(document.body.style.overflow).toBe('hidden');
    release2();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('ignores a double release (idempotent release fn)', () => {
    document.body.style.overflow = '';
    const release = acquireBodyScrollLock();
    release();
    release();
    expect(document.body.style.overflow).toBe('');
    // The counter must be balanced: a fresh lock restores '' (not a stale
    // previous value from the double release).
    const release2 = acquireBodyScrollLock();
    release2();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('solapes entre superficies (#1445)', () => {
  it('CommandPalette closing over an open Modal keeps the lock and the Modal restores the original', () => {
    document.body.style.overflow = 'auto';
    const palette = render(
      <CommandPalette open onClose={() => {}} items={paletteItems} onSelect={() => {}} />,
    );
    expect(document.body.style.overflow).toBe('hidden');

    const modal = render(<ModalHarness open />);
    expect(document.body.style.overflow).toBe('hidden');

    // The palette closes while the modal stays open: the lock must survive.
    palette.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    modal.unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  // Discriminating order (review B1): the surface that opened FIRST releases
  // FIRST, while the modal's lock is still held. With the old per-surface
  // pattern the FS release would restore '' too early (assert fails), and an
  // old Modal would restore 'hidden' at the end (final assert fails).
  it('FullscreenDialog releasing first over a closing Modal neither drops nor sticks the lock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    document.body.style.overflow = '';
    function FSHarness() {
      const [open, setOpen] = useState(true);
      return (
        <FullscreenDialog open={open} onClose={() => setOpen(false)} title="FS">
          contenido
        </FullscreenDialog>
      );
    }
    const fs = render(<FSHarness />);
    expect(document.body.style.overflow).toBe('hidden');

    const modal = render(<ModalHarness open />);
    act(() => {
      modal.rerender(<ModalHarness open={false} />);
    });

    // FS (first holder) releases while the modal is still inside its exit
    // window: the modal's lock must keep the body locked.
    fs.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MODAL_CLOSE_MS);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Modal' })).toBeNull();
    });
    // The modal was the LAST holder: its release must restore the original.
    expect(document.body.style.overflow).toBe('');
  });

  it('every consumer takes the lock through the shared helper (source contract)', () => {
    for (const file of ['Modal.tsx', 'FullscreenDialog.tsx']) {
      expect(readFileSync(join(here, file), 'utf8')).toContain(
        'acquireBodyScrollLock',
      );
    }
    expect(
      readFileSync(join(here, '../shell/CommandPalette.tsx'), 'utf8'),
    ).toContain('acquireBodyScrollLock');
  });
});
