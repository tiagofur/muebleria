/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import type { Project } from '@granete/domain';
import { LifecyclePanel } from './LifecyclePanel';

afterEach(() => {
  cleanup();
});

const baseProject: Project = {
  id: 'p-1',
  name: 'Cocina Integral Roble',
  customerId: 'cust-1',
  currency: 'MXN',
  marginFactor: 1.35,
  laborFixedCost: 2000,
  status: 'accepted',
  commercialStatus: 'won',
  items: [
    {
      id: 'item-1',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: {},
    },
  ],
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('LifecyclePanel — anticipo real (OC-013)', () => {
  it('muestra el estado vacío cuando no hay anticipo y registra uno con monto/referencia', async () => {
    const onRecordDeposit = vi.fn().mockResolvedValue(undefined);
    render(
      <LifecyclePanel
        project={baseProject}
        onOpenReleaseModal={() => {}}
        onOpenChangeOrderModal={() => {}}
        onRecordDeposit={onRecordDeposit}
      />,
    );

    expect(screen.getByTestId('lifecycle-deposit-summary').textContent).toContain(
      'Sin anticipo registrado',
    );

    fireEvent.click(screen.getByTestId('btn-record-deposit'));
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/Referencia/), { target: { value: 'TRANSF-0042' } });

    const confirm = screen.getByTestId('btn-confirm-deposit') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(onRecordDeposit).toHaveBeenCalledTimes(1));
    expect(onRecordDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, currency: 'MXN', reference: 'TRANSF-0042' }),
    );
  });

  it('deshabilita el botón de confirmar con un monto inválido', () => {
    render(
      <LifecyclePanel
        project={baseProject}
        onOpenReleaseModal={() => {}}
        onOpenChangeOrderModal={() => {}}
        onRecordDeposit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('btn-record-deposit'));
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '0' } });

    expect((screen.getByTestId('btn-confirm-deposit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('muestra el último anticipo registrado desde los eventos del proyecto', () => {
    const withDeposit: Project = {
      ...baseProject,
      events: [
        {
          id: 'evt-1',
          projectId: 'p-1',
          type: 'deposit_received',
          at: '2026-08-05T12:00:00Z',
          byUserId: 'u-1',
          payload: { amount: 5000, currency: 'MXN', reference: 'TRANSF-0042' },
        },
      ],
    };

    render(
      <LifecyclePanel
        project={withDeposit}
        onOpenReleaseModal={() => {}}
        onOpenChangeOrderModal={() => {}}
      />,
    );

    const summary = screen.getByTestId('lifecycle-deposit-summary');
    expect(summary.textContent).toContain('5,000');
    expect(summary.textContent).toContain('TRANSF-0042');
  });

  it('oculta el formulario cuando no hay callback de registro', () => {
    render(
      <LifecyclePanel
        project={baseProject}
        onOpenReleaseModal={() => {}}
        onOpenChangeOrderModal={() => {}}
      />,
    );

    expect(screen.queryByTestId('btn-record-deposit')).toBeNull();
    expect(screen.queryByTestId('lifecycle-deposit-form')).toBeNull();
  });
});
