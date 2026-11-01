/**
 * #1445 — the shared body scroll lock: overlapping surfaces (Modal,
 * FullscreenDialog, CommandPalette) hold ONE ref-counted lock. Regression
 * coverage for the #1432 class of bug across every consumer of the helper.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Modal, MODAL_CLOSE_MS } from './Modal';
import { FullscreenDialog } from './FullscreenDialog';
import { CommandPalette, type CommandPaletteItem } from '../shell/CommandPalette';
import { acquireBodyScrollLock } from './bodyScrollLock';

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

  it('Modal closing inside its exit window over FullscreenDialog does not drop or stick the lock', async () => {
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

    // Modal finishes its closing animation; FS lock must survive it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MODAL_CLOSE_MS + 50));
    });
    expect(screen.queryByRole('dialog', { name: 'Modal' })).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    fs.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
