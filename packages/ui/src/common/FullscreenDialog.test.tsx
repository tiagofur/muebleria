/**
 * F110 — FullscreenDialog acceptance: same contract as Modal (portal,
 * role=dialog + aria-labelledby, focus trap, Esc, focus restore).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FullscreenDialog } from './FullscreenDialog';

afterEach(cleanup);

function Harness({ escapeEnabled = true }: { escapeEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <FullscreenDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Presentación"
        escapeEnabled={escapeEnabled}
        dataTestId="fs-dialog"
      >
        <button type="button">Primera acción</button>
        <button type="button">Última acción</button>
      </FullscreenDialog>
    </div>
  );
}

describe('FullscreenDialog (F110)', () => {
  it('renders in a portal with the dialog contract and labelled title', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByTestId('fs-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.body.contains(dialog)).toBe(true);
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Presentación');
  });

  it('traps Tab focus inside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    const first = screen.getByRole('button', { name: 'Primera acción' });
    const last = screen.getByRole('button', { name: 'Última acción' });
    expect(document.activeElement).toBe(first);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(last);
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(first);
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('fs-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('can delegate Escape to the caller (nested overlays)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Nested() {
      const [open, setOpen] = useState(true);
      return (
        <FullscreenDialog
          open={open}
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          title="Capa interna"
          escapeEnabled={false}
        >
          <p>Contenido</p>
        </FullscreenDialog>
      );
    }
    render(<Nested />);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
