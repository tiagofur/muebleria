/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from './PageHeader';
import { PageToolbar } from './PageToolbar';

afterEach(cleanup);

describe('PageHeader', () => {
  it('renders typed title and action slots with one visible primary action', () => {
    render(
      <PageHeader
        title="Cotizaciones"
        subtitle="Seguimiento comercial"
        primaryAction={<button type="button">Nueva cotización</button>}
        secondaryActions={<button type="button">Actualizar</button>}
        overflowActions={[{ id: 'templates', label: 'Plantillas', onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Cotizaciones' })).toBeTruthy();
    expect(screen.getByText('Seguimiento comercial')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nueva cotización' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Más acciones/ })).toBeTruthy();
  });

  it('opens overflow by keyboard and restores focus after escape', async () => {
    const user = userEvent.setup();
    render(
      <PageHeader
        title="Cotizaciones"
        overflowActions={[{ id: 'templates', label: 'Plantillas', onSelect: vi.fn() }]}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Más acciones/ });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Plantillas' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('PageToolbar', () => {
  it('places search and filter slots in one accessible toolbar', () => {
    render(
      <PageToolbar
        ariaLabel="Buscar y filtrar cotizaciones"
        search={<input aria-label="Buscar cotizaciones" />}
        filters={<button type="button">Activas</button>}
      />,
    );

    expect(screen.getByTestId('page-toolbar').getAttribute('aria-label')).toBe(
      'Buscar y filtrar cotizaciones',
    );
    expect(screen.getByRole('textbox', { name: 'Buscar cotizaciones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activas' })).toBeTruthy();
  });
});
