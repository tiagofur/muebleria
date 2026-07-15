/**
 * F019 — Toast system: queue, max 3, auto-dismiss, types, motion tokens.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ToastProvider,
  useToast,
  TOAST_DURATION_MS,
  TOAST_EXIT_MS,
  TOAST_MAX,
  type ToastType,
} from './Toast';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

function Probe(): ReactElement {
  const { toast } = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => toast({ type: 'success', message: 'Creado correctamente' })}
      >
        success
      </button>
      <button
        type="button"
        onClick={() => toast({ type: 'info', message: 'Info message' })}
      >
        info
      </button>
      <button
        type="button"
        onClick={() => toast({ type: 'warning', message: 'Warn message' })}
      >
        warning
      </button>
      <button
        type="button"
        onClick={() => toast({ type: 'error', message: 'Error message' })}
      >
        error
      </button>
      <button
        type="button"
        onClick={() => {
          toast({ type: 'success', message: 'One' });
          toast({ type: 'info', message: 'Two' });
          toast({ type: 'warning', message: 'Three' });
          toast({ type: 'error', message: 'Four' });
        }}
      >
        burst-4
      </button>
      <button
        type="button"
        onClick={() => toast({ type: 'success', message: '   ' })}
      >
        empty
      </button>
    </div>
  );
}

function renderWithProvider(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}

function visibleToasts(): HTMLElement[] {
  return screen
    .queryAllByTestId('ui-toast')
    .filter((el) => el.getAttribute('data-toast-phase') !== 'exit');
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useToast API (F019)', () => {
  it('throws outside ToastProvider', () => {
    function Bare(): ReactElement {
      useToast();
      return <div />;
    }
    expect(() => render(<Bare />)).toThrow(
      /useToast must be used within ToastProvider/,
    );
  });

  it('toast({ type, message }) renders in top-right viewport', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole('button', { name: 'success' }));

    const toastEl = await screen.findByTestId('ui-toast');
    expect(toastEl.textContent).toContain('Creado correctamente');
    expect(toastEl.getAttribute('data-toast-type')).toBe('success');

    const viewport = screen.getByTestId('ui-toast-viewport');
    expect(viewport).toBeTruthy();
    expect(viewport.contains(toastEl)).toBe(true);
  });

  it('supports success, info, warning, and error types', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    const types: ToastType[] = ['success', 'info', 'warning', 'error'];
    for (const type of types) {
      await user.click(screen.getByRole('button', { name: type }));
    }

    await waitFor(() => {
      expect(visibleToasts()).toHaveLength(3); // max 3; fourth would drop oldest
    });

    // Fire one at a time after cleanup via real timers exhaustion
    cleanup();
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProvider();

    for (const type of types) {
      cleanup();
      renderWithProvider();
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await u.click(screen.getByRole('button', { name: type }));
      const el = await screen.findByTestId('ui-toast');
      expect(el.getAttribute('data-toast-type')).toBe(type);
      expect(el.className).toContain(`ui-toast--${type}`);
    }
  });

  it('ignores empty / whitespace-only messages', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();
    await user.click(screen.getByRole('button', { name: 'empty' }));
    expect(screen.queryByTestId('ui-toast')).toBeNull();
  });
});

describe('Toast queue + max 3 (F019)', () => {
  it('keeps at most TOAST_MAX non-exiting toasts; oldest exits', async () => {
    expect(TOAST_MAX).toBe(3);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole('button', { name: 'burst-4' }));

    await waitFor(() => {
      const nonExit = visibleToasts();
      expect(nonExit.length).toBeLessThanOrEqual(TOAST_MAX);
    });

    // After exit animation of oldest, only Three newest remain as non-exit
    await act(async () => {
      vi.advanceTimersByTime(TOAST_EXIT_MS + 20);
    });

    const remaining = visibleToasts().map((el) => el.textContent ?? '');
    expect(remaining.length).toBeLessThanOrEqual(TOAST_MAX);
    // Oldest "One" should be gone (or exiting removed)
    expect(remaining.some((t) => t.includes('One'))).toBe(false);
    expect(remaining.some((t) => t.includes('Four'))).toBe(true);
  });
});

describe('Toast auto-dismiss (F019)', () => {
  it(`auto-dismisses after ${TOAST_DURATION_MS}ms with progress bar`, async () => {
    expect(TOAST_DURATION_MS).toBe(4000);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole('button', { name: 'success' }));
    expect(await screen.findByTestId('ui-toast')).toBeTruthy();
    expect(screen.getByTestId('ui-toast-progress')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });

    // Enter exit phase then unmount
    await act(async () => {
      vi.advanceTimersByTime(TOAST_EXIT_MS + 20);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('ui-toast')).toBeNull();
    });
  });

  it('manual close dismisses immediately (with exit)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProvider();

    await user.click(screen.getByRole('button', { name: 'info' }));
    expect(await screen.findByTestId('ui-toast')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Cerrar notificación' }),
    );

    await act(async () => {
      vi.advanceTimersByTime(TOAST_EXIT_MS + 20);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('ui-toast')).toBeNull();
    });
  });
});

describe('Toast CSS tokens + motion (F019)', () => {
  it('viewport is top-right; types use semantic tokens; enter/exit classes', () => {
    const css = read('toast.css');
    expect(css).toContain('.ui-toast-viewport');
    expect(css).toContain('top: var(--space-4)');
    expect(css).toContain('right: var(--space-4)');
    expect(css).toContain('z-index: 200');

    expect(css).toContain('.ui-toast--success');
    expect(css).toContain('var(--success-50)');
    expect(css).toContain('var(--success-500)');
    expect(css).toContain('.ui-toast--info');
    expect(css).toContain('var(--info-50)');
    expect(css).toContain('var(--info-500)');
    expect(css).toContain('.ui-toast--warning');
    expect(css).toContain('var(--warning-50)');
    expect(css).toContain('var(--warning-500)');
    expect(css).toContain('.ui-toast--error');
    expect(css).toContain('var(--danger-50)');
    expect(css).toContain('var(--danger-500)');

    expect(css).toContain('.ui-toast.is-enter');
    expect(css).toContain('.ui-toast.is-visible');
    expect(css).toContain('.ui-toast.is-exit');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('ui-toast-progress');
    expect(css).toContain('var(--duration-normal)');
  });

  it('source uses createPortal and Lucide icons', () => {
    const src = read('Toast.tsx');
    expect(src).toContain('createPortal');
    expect(src).toContain('CheckCircle2');
    expect(src).toContain('Info');
    expect(src).toContain('AlertTriangle');
    expect(src).toContain('AlertCircle');
    expect(src).toContain('TOAST_DURATION_MS = 4000');
    expect(src).toContain('TOAST_MAX = 3');
  });
});
