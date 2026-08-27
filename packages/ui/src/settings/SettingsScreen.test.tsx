/**
 * Settings screen (F031 / #37).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsScreen } from './SettingsScreen';
import type { WorkshopSettings } from '@granete/domain';

afterEach(() => cleanup());

const base: WorkshopSettings = {
  defaultMarginFactor: 1.35,
  defaultLaborFixedCost: 0,
  defaultCurrency: 'MXN',
  vendedorCanViewCosts: false,
  ptxExportMode: 'unified',
  defaultSawKerfMm: 4.4,
  defaultTrimMargins: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
  defaultDeductEdgeBand: true,
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
      workshopName: undefined,
      ptxExportMode: 'unified',
      defaultCutStrategy: 'saw-guillotine',
      defaultSawKerfMm: 4.4,
      defaultTrimMargins: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      defaultDeductEdgeBand: true,
      navMode: 'departmental',
    });
  });

  it('switches to engineering tab and saves engineering defaults', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SettingsScreen settings={base} onSave={onSave} />);

    // Click engineering tab
    await user.click(screen.getByTestId('settings-tab-tab-ingenieria'));

    expect(screen.getByTestId('settings-section-ingenieria')).toBeTruthy();
    const kerfInput = screen.getByTestId('settings-saw-kerf') as HTMLInputElement;
    expect(kerfInput.value).toBe('4.4');

    // Switch PTX mode to by-material
    await user.click(screen.getByTestId('settings-ptx-mode-by-material'));
    await user.clear(kerfInput);
    await user.type(kerfInput, '4.0');

    // Change trim top
    const trimTopInput = screen.getByTestId('settings-trim-top');
    await user.clear(trimTopInput);
    await user.type(trimTopInput, '15');

    // Toggle deduct edgeband
    await user.click(screen.getByTestId('settings-deduct-edgeband'));

    await user.click(screen.getByTestId('settings-save'));

    expect(onSave).toHaveBeenCalledWith({
      defaultMarginFactor: 1.35,
      defaultLaborFixedCost: 0,
      defaultCurrency: 'MXN',
      vendedorCanViewCosts: false,
      workshopName: undefined,
      ptxExportMode: 'by-material',
      defaultCutStrategy: 'saw-guillotine',
      defaultSawKerfMm: 4.0,
      defaultTrimMargins: { topMm: 15, bottomMm: 10, leftMm: 10, rightMm: 10 },
      defaultDeductEdgeBand: false,
      navMode: 'departmental',
    });
  });

  it('guarda el tipo de corte por defecto del taller (F133)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SettingsScreen settings={base} onSave={onSave} />);

    await user.click(screen.getByTestId('settings-tab-tab-ingenieria'));
    expect(screen.getByTestId('settings-section-cut-strategy')).toBeTruthy();

    // El radio refleja el settings (sin default → sierra marcada).
    expect(
      (screen.getByTestId('settings-cut-strategy-saw') as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.click(screen.getByTestId('settings-cut-strategy-nesting'));
    await user.click(screen.getByTestId('settings-save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCutStrategy: 'cnc-nesting' }),
    );
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

describe('SettingsScreen — Red de Ventas (#326)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('no muestra el tab de red de ventas sin salesNetwork (no-fábrica)', () => {
    render(<SettingsScreen settings={base} onSave={() => {}} />);
    expect(screen.queryByRole('tab', { name: /Red de Ventas/i })).toBeNull();
  });

  it('muestra el tab de red de ventas para fábricas y entra a la org conectada', async () => {
    const user = userEvent.setup();
    const onEnterOrg = vi.fn();
    const jsonOk = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/factory/organizations') && (!init || init.method === undefined)) {
        return jsonOk([]);
      }
      if (url.endsWith('/factory/organizations') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            organization: {
              id: 'org-store-9', name: 'Tienda Monterrey', slug: 'tienda-monterrey',
              type: 'store', active: true,
            },
            catalog_cloned: true,
            membership_granted: true,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return jsonOk({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SettingsScreen
        settings={base}
        onSave={() => {}}
        salesNetwork={{ baseUrl: 'http://test/api', token: 't', onEnterOrg }}
      />,
    );
    await user.click(screen.getByRole('tab', { name: /Red de Ventas/i }));
    expect(screen.getByTestId('sales-network')).toBeTruthy();
    expect(screen.getByTestId('sales-network-create')).toBeTruthy();

    // Crear una tienda conectada
    await user.type(await screen.findByLabelText(/Nombre/i), 'Tienda Monterrey');
    await user.click(screen.getByRole('button', { name: /Crear organización/i }));

    const created = await screen.findByTestId('sales-network-created');
    expect(created).toBeTruthy();
    await user.click(screen.getByTestId('sales-network-enter'));
    expect(onEnterOrg).toHaveBeenCalledWith('org-store-9', 'Tienda Monterrey');
  });
});
