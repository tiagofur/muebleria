/**
 * Command palette (#54).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText, Package } from 'lucide-react';
import { CommandPalette, type CommandPaletteItem } from './CommandPalette';

afterEach(() => cleanup());

const items: CommandPaletteItem[] = [
  {
    id: 'nav:home',
    label: 'Inicio',
    group: 'Navegación',
  },
  {
    id: 'nav:projects',
    label: 'Cotizaciones',
    group: 'Navegación',
    icon: FileText,
  },
  {
    id: 'nav:modules',
    label: 'Muebles',
    group: 'Navegación',
    icon: Package,
  },
  {
    id: 'project:p1',
    label: 'Cocina Ana',
    group: 'Cotizaciones',
    keywords: 'Ana López',
  },
  {
    id: 'module:m1',
    label: 'MOD-01 Bajo 600',
    group: 'Muebles',
  },
];

describe('CommandPalette (#54)', () => {
  it('renders nothing when closed', () => {
    render(
      <CommandPalette
        open={false}
        onClose={vi.fn()}
        items={items}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('command-palette')).toBeNull();
  });

  it('filters items and selects with keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        items={items}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId('command-palette')).toBeTruthy();
    const input = screen.getByTestId('command-palette-input');
    await user.type(input, 'cocina');
    expect(screen.getByText('Cocina Ana')).toBeTruthy();
    expect(screen.queryByText('MOD-01 Bajo 600')).toBeNull();

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('project:p1');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no match', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        items={items}
        onSelect={vi.fn()}
      />,
    );
    await user.type(screen.getByTestId('command-palette-input'), 'zzzz-nope');
    expect(screen.getByText(/Sin resultados/i)).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        items={items}
        onSelect={vi.fn()}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('arrow keys move active option', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        items={items}
        onSelect={onSelect}
      />,
    );
    const list = screen.getByRole('listbox');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    // First arrow from 0 → 1 = Cotizaciones nav
    expect(onSelect).toHaveBeenCalledWith('nav:projects');
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(0);
  });
});
