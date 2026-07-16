/**
 * Settings screen (F031 / #37).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsScreen } from './SettingsScreen';

afterEach(() => cleanup());

const base = {
  defaultMarginFactor: 1.35,
  defaultLaborFixedCost: 0,
  defaultCurrency: 'MXN',
  vendedorCanViewCosts: false,
};

describe('SettingsScreen (#37 / F044)', () => {
  it('renders defaults and saves valid values', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SettingsScreen settings={base} onSave={onSave} />);

    expect(screen.getByRole('heading', { name: /Ajustes/i })).toBeTruthy();
    const margin = screen.getByLabelText(/Factor de margen/i) as HTMLInputElement;
    expect(margin.value).toBe('1.35');

    await user.clear(margin);
    await user.type(margin, '1.5');
    await user.clear(screen.getByLabelText(/Mano de obra fija/i));
    await user.type(screen.getByLabelText(/Mano de obra fija/i), '200');
    await user.click(screen.getByTestId('settings-vendedor-can-view-costs'));
    await user.click(screen.getByTestId('settings-save'));

    expect(onSave).toHaveBeenCalledWith({
      defaultMarginFactor: 1.5,
      defaultLaborFixedCost: 200,
      defaultCurrency: 'MXN',
      vendedorCanViewCosts: true,
    });
  });

  it('rejects non-positive margin', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SettingsScreen settings={base} onSave={onSave} />);
    await user.clear(screen.getByLabelText(/Factor de margen/i));
    await user.type(screen.getByLabelText(/Factor de margen/i), '0');
    await user.click(screen.getByTestId('settings-save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/margen/i);
  });
});
