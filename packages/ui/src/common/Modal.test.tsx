/**
 * F018 — Modal acceptance: a11y, Esc/overlay close, focus trap, sizes, motion.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Modal, MODAL_CLOSE_MS, type ModalSize } from './Modal';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

function Harness({
  size = 'md' as ModalSize,
  footer,
  startOpen = true,
}: {
  size?: ModalSize;
  footer?: ReactNode;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open trigger
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Test modal"
        size={size}
        footer={footer}
      >
        <p>Modal body content</p>
        <button type="button">Body action</button>
        <input aria-label="Name field" />
      </Modal>
    </div>
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  vi.useRealTimers();
});

describe('Modal a11y (F018)', () => {
  it('exposes role=dialog, aria-modal, and aria-labelledby title', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy!);
    expect(title?.textContent).toBe('Test modal');
  });

  it('renders sticky header close control and optional footer slot', () => {
    render(
      <Harness
        footer={
          <>
            <button type="button">Cancelar</button>
            <button type="button">Guardar</button>
          </>
        }
      />,
    );
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
    expect(document.querySelector('.ui-modal__header')).toBeTruthy();
    expect(document.querySelector('.ui-modal__footer')).toBeTruthy();
    expect(document.querySelector('.ui-modal__body')).toBeTruthy();
  });

  it('does not render dialog when closed', () => {
    render(<Harness startOpen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Modal close interactions (F018)', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.querySelector('.ui-modal-root.is-closing')).toBeTruthy();
    });
  });

  it('closes on overlay click', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const overlay = screen.getByTestId('ui-modal-overlay');
    await user.click(overlay);
    await waitFor(() => {
      expect(document.querySelector('.ui-modal-root.is-closing')).toBeTruthy();
    });
  });

  it('closes on header X button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => {
      expect(document.querySelector('.ui-modal-root.is-closing')).toBeTruthy();
    });
  });

  it('unmounts after close animation duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    render(<Harness />);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(MODAL_CLOSE_MS);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('Modal focus trap (F018)', () => {
  it('moves initial focus inside the dialog', async () => {
    render(<Harness />);
    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('traps Tab within the dialog (wraps last → first)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
        true,
      );
    });

    // Cycle Tab enough times to wrap; every focused element must stay in dialog
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('traps Shift+Tab within the dialog (wraps first → last)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
        true,
      );
    });

    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true });
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('Modal body scroll lock (F018)', () => {
  it('sets document.body overflow hidden while open and restores on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    document.body.style.overflow = 'auto';
    render(<Harness />);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    await vi.advanceTimersByTimeAsync(MODAL_CLOSE_MS);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('Modal sizes (F018)', () => {
  it.each([
    ['sm', 'ui-modal--sm'],
    ['md', 'ui-modal--md'],
    ['lg', 'ui-modal--lg'],
  ] as const)('applies size class for %s', (size, className) => {
    render(<Harness size={size} />);
    const panel = document.querySelector('.ui-modal');
    expect(panel?.classList.contains(className)).toBe(true);
    expect(document.querySelector('.ui-modal-root')?.getAttribute('data-modal-size')).toBe(
      size,
    );
  });

  it('defaults to md when size omitted', () => {
    render(
      <Modal open onClose={() => undefined} title="Default size">
        body
      </Modal>,
    );
    expect(document.querySelector('.ui-modal--md')).toBeTruthy();
  });
});

describe('Modal open/close animation classes (F018)', () => {
  it('uses is-open while open and is-closing after close request', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => {
      expect(document.querySelector('.ui-modal-root.is-open')).toBeTruthy();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      const root = document.querySelector('.ui-modal-root');
      expect(root?.classList.contains('is-closing')).toBe(true);
      expect(root?.classList.contains('is-open')).toBe(false);
    });
  });
});

describe('Modal CSS contract (F018)', () => {
  it('defines sizes sm 480 / md 680 / lg 900 and overlay token', () => {
    const css = read('modal.css');
    expect(css).toContain('max-width: 480px');
    expect(css).toContain('max-width: 680px');
    expect(css).toContain('max-width: 900px');
    expect(css).toContain('var(--surface-overlay)');
    expect(css).toContain('var(--shadow-lg)');
    expect(css).toContain('var(--surface-card)');
    expect(css).toContain('var(--duration-slow)');
    expect(css).toContain('scale(');
    expect(css).toContain('opacity');
    expect(css).toContain('prefers-reduced-motion: no-preference');
    expect(css).toContain('.ui-modal-root.is-open');
    expect(css).toContain('.ui-modal-root.is-closing');
    expect(css).toContain('position: sticky');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('source uses createPortal, role=dialog, and Lucide X', () => {
    const src = read('Modal.tsx');
    expect(src).toContain("from 'react-dom'");
    expect(src).toContain('createPortal');
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal');
    expect(src).toContain('aria-labelledby');
    expect(src).toContain('Escape');
    expect(src).toContain("from 'lucide-react'");
    expect(src).toContain('overflow = \'hidden\'');
  });
});
