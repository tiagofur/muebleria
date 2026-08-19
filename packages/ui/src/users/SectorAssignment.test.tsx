/**
 * F110 — SectorAssignment acceptance: shared Modal contract (dialog semantics,
 * Esc close, focus trap, focus restore) plus assignment logic.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SectorAssignment } from './SectorAssignment';

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAssignment(onClose = vi.fn(), role = 'gerente_produccion') {
  return render(
    <SectorAssignment
      baseUrl="http://api.test"
      token="tok"
      userId="u1"
      userName="Ana"
      role={role as never}
      onClose={onClose}
    />,
  );
}

describe('SectorAssignment — shared Modal contract (F110)', () => {
  it('exposes role=dialog with resolvable aria-labelledby title', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ userId: 'u1', sector: 'corte', assignedAt: '' }]),
    });
    renderAssignment();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(
      'Asignación de sectores',
    );
  });

  it('has an accessible name on the close button', () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    renderAssignment();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    renderAssignment(onClose);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the dialog', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    renderAssignment();

    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    }
  });

  it('returns focus to the trigger after closing', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Asignar sectores
          </button>
          {open && <SectorAssignment baseUrl="http://api.test" token="t" userId="u1" userName="Ana" role={'gerente_produccion' as never} onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Asignar sectores' });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});

describe('SectorAssignment — assignment logic (unchanged)', () => {
  it('initializes checkboxes from assigned sectors and saves the selection', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([{ userId: 'u1', sector: 'cutting', assignedAt: 'x' }]),
    });
    renderAssignment(onClose);

    const corte = await screen.findByLabelText('Corte');
    expect((corte as HTMLInputElement).checked).toBe(true);

    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://api.test/admin/users/u1/sectors',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ sectors: [{ sector: 'cutting' }] }),
      }),
    );
  });
});
