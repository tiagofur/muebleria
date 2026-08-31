/**
 * F106 — Page chrome composition: Producción, Almacén y Config screens render
 * through the shared PageHeader skeleton (docs/design.md §4.1a).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductionManagerDashboard } from './ProductionManagerDashboard';
import { FabricScreen } from './FabricScreen';
import { EmbarquesScreen } from './EmbarquesScreen';
import { InstalacionesScreen } from './InstalacionesScreen';
import { PurchasingScreen } from '../purchasing/PurchasingScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { UsersScreen } from '../users/UsersScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function expectSharedHeader(title: string): void {
  const header = screen.getByTestId('page-header');
  expect(
    within(header).getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
  ).toEqual([title]);
  expect(header.querySelector('.page-header__icon svg')).not.toBeNull();
}

describe('F106 page chrome — Producción, Almacén y Config', () => {
  it('Dashboard de Producción renders shared header with secondary-only actions', () => {
    render(
      <ProductionManagerDashboard
        projects={[]}
        customerLabelFor={() => '—'}
        onOpenProject={vi.fn()}
        onOpenOrder={vi.fn()}
      />,
    );
    expectSharedHeader('Dashboard de Producción');
    const header = screen.getByTestId('page-header');
    expect(header.querySelectorAll('.btn--primary')).toHaveLength(0);
    expect(within(header).getByRole('button', { name: /Actualizar/ })).toBeDefined();
  });

  it('Producción (estaciones) renders shared header with contextual controls', () => {
    render(
      <FabricScreen
        projects={[]}
        assignedSectors={null}
        canAdvance
        onAdvance={vi.fn()}
      />,
    );
    expectSharedHeader('Producción');
    expect(screen.getByTestId('fabric-total-waiting')).toBeDefined();
  });

  it('Embarques renders shared header with pending stat', () => {
    render(<EmbarquesScreen projects={[]} />);
    expectSharedHeader('Embarques');
    expect(screen.getByTestId('embarques-to-load')).toBeDefined();
  });

  it('Instalaciones renders shared header with to-install stat', () => {
    render(
      <InstalacionesScreen projects={[]} onOpenProject={vi.fn()} />,
    );
    expectSharedHeader('Instalaciones');
    expect(screen.getByTestId('instalaciones-to-install')).toBeDefined();
  });

  it('Almacén renders shared header with projects badge', () => {
    render(
      <PurchasingScreen
        projects={[]}
        role="admin"
        onTogglePick={vi.fn()}
        onReleaseMaterials={vi.fn()}
        currency="MXN"
      />,
    );
    expectSharedHeader('Almacén');
  });

  it('Ajustes renders shared header without actions', () => {
    render(
      <SettingsScreen
        settings={{
          defaultMarginFactor: 1.3,
          defaultLaborFixedCost: 0,
          defaultCurrency: 'MXN',
          vendedorCanViewCosts: false,
        }}
        onSave={vi.fn()}
      />,
    );
    expectSharedHeader('Ajustes');
  });

  it('Usuarios renders shared header; icon-only reload exposes aria-label', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
    );
    const root = ['organization', 'session', 'page-chrome'] as const;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <UsersScreen
          baseUrl="http://test/api"
          token="t"
          queryKeys={{ root, team: [...root, 'team'], invitations: [...root, 'invitations'] }}
        />
      </QueryClientProvider>,
    );
    expectSharedHeader('Usuarios');
    expect(
      screen.getByRole('button', { name: 'Recargar usuarios' }),
    ).toBeDefined();
  });
});
