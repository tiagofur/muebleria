/**
 * DropdownMenu — a11y + behavior tests.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  type DropdownMenuSection,
} from './DropdownMenu';

afterEach(cleanup);

function Harness({
  sections,
  triggerLabel = 'Más',
  ariaLabel = 'Más acciones',
}: {
  sections: readonly DropdownMenuSection[];
  triggerLabel?: string;
  ariaLabel?: string;
}) {
  return (
    <DropdownMenu
      ariaLabel={ariaLabel}
      triggerLabel={triggerLabel}
      sections={sections}
    />
  );
}

describe('DropdownMenu', () => {
  it('renders a disabled trigger and no menu until clicked', () => {
    const sections: DropdownMenuSection[] = [
      { id: 'main', items: [{ id: 'a', label: 'A', onSelect: () => {} }] },
    ];
    render(<Harness sections={sections} />);
    expect(screen.getByRole('button', { name: /Más/ })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click and lists all items with role=menuitem', async () => {
    const user = userEvent.setup();
    const sections: DropdownMenuSection[] = [
      {
        id: 'g1',
        label: 'Producción',
        items: [{ id: 'a', label: 'Optimizer', onSelect: () => {} }],
      },
      {
        id: 'g2',
        label: 'Comercial',
        items: [
          { id: 'b', label: 'Cotización', onSelect: () => {} },
          { id: 'c', label: 'PDF', onSelect: () => {} },
        ],
      },
    ];
    render(<Harness sections={sections} />);
    await user.click(screen.getByRole('button', { name: /Más/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(
      ['Optimizer', 'Cotización', 'PDF'],
    );
  });

  it('calls onSelect and closes on item click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const sections: DropdownMenuSection[] = [
      { id: 'main', items: [{ id: 'a', label: 'Hacer', onSelect }] },
    ];
    render(<Harness sections={sections} />);
    await user.click(screen.getByRole('button', { name: /Más/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Hacer' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to trigger', async () => {
    const user = userEvent.setup();
    const sections: DropdownMenuSection[] = [
      { id: 'main', items: [{ id: 'a', label: 'Item', onSelect: () => {} }] },
    ];
    render(<Harness sections={sections} />);
    const trigger = screen.getByRole('button', { name: /Más/ });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on outside click', async () => {
    const user = userEvent.setup();
    const sections: DropdownMenuSection[] = [
      { id: 'main', items: [{ id: 'a', label: 'Item', onSelect: () => {} }] },
    ];
    render(
      <div>
        <button type="button">Outside</button>
        <Harness sections={sections} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: /Más/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disabled items are not clickable', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const sections: DropdownMenuSection[] = [
      {
        id: 'main',
        items: [{ id: 'a', label: 'Off', onSelect, disabled: true }],
      },
    ];
    render(<Harness sections={sections} />);
    await user.click(screen.getByRole('button', { name: /Más/ }));
    await user.click(screen.getByRole('menuitem', { name: /Off/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing visible when sections list is empty', () => {
    render(<Harness sections={[]} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('exposes aria-haspopup="menu" and aria-expanded on the trigger', async () => {
    const user = userEvent.setup();
    const sections: DropdownMenuSection[] = [
      { id: 'main', items: [{ id: 'a', label: 'Item', onSelect: () => {} }] },
    ];
    render(<Harness sections={sections} />);
    const trigger = screen.getByRole('button', { name: /Más/ });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
