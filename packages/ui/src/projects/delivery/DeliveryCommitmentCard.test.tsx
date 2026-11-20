// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@granete/domain';
import { DeliveryCommitmentCard } from './DeliveryCommitmentCard';

const project = (over: Partial<Project> = {}): Project =>
  ({ id: 'p1', name: 'Cocina', customerId: 'c', currency: 'MXN', marginFactor: 1, laborFixedCost: 0, status: 'accepted', items: [], createdAt: '', updatedAt: '', ...over }) as Project;

afterEach(cleanup);

describe('DeliveryCommitmentCard (#1648)', () => {
  it('sin fecha: compromete sólo con la fecha (sin motivo)', async () => {
    const onCommit = vi.fn(async () => ({ ok: true as const }));
    render(<DeliveryCommitmentCard project={project()} onCommit={onCommit} today="2026-11-20" />);
    expect(screen.getByTestId('delivery-committed-date').textContent).toContain('Sin fecha comprometida');
    fireEvent.click(screen.getByTestId('btn-commit-delivery'));
    expect(screen.queryByLabelText('Motivo del cambio')).toBeNull();
    fireEvent.change(screen.getByLabelText('Fecha de entrega'), { target: { value: '2026-12-15' } });
    fireEvent.click(screen.getByTestId('btn-save-delivery'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ date: '2026-12-15' }));
    await waitFor(() => expect(screen.queryByTestId('delivery-commitment-form')).toBeNull());
  });

  it('cambiar la fecha exige motivo antes de enviar y muestra el veredicto del servidor', async () => {
    const onCommit = vi.fn(async () => ({ ok: false as const, message: 'No se guardó la fecha: sin permiso' }));
    render(<DeliveryCommitmentCard project={project({ committedDeliveryDate: '2026-11-18' })} onCommit={onCommit} today="2026-11-20" />);
    expect(screen.getByTestId('delivery-card-status').textContent).toBe('Atrasado 2 días');
    fireEvent.click(screen.getByTestId('btn-commit-delivery'));
    fireEvent.change(screen.getByLabelText('Fecha de entrega'), { target: { value: '2026-11-30' } });
    fireEvent.click(screen.getByTestId('btn-save-delivery'));
    expect(screen.getByTestId('delivery-commitment-error').textContent).toContain('motivo');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Motivo del cambio'), { target: { value: ' falta de placa ' } });
    fireEvent.click(screen.getByTestId('btn-save-delivery'));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ date: '2026-11-30', reason: 'falta de placa' }));
    expect((await screen.findByTestId('delivery-commitment-error')).textContent).toContain('sin permiso');
  });

  it('sin permiso es de sólo lectura y una obra entregada muestra la fecha real', () => {
    render(
      <DeliveryCommitmentCard
        project={project({
          committedDeliveryDate: '2026-11-10',
          events: [{ id: 'e', projectId: 'p1', type: 'installation_completed', at: '2026-11-09T15:00:00Z' }],
        })}
        today="2026-11-20"
      />,
    );
    expect(screen.queryByTestId('btn-commit-delivery')).toBeNull();
    expect(screen.getByTestId('delivery-card-status').textContent).toBe('Entregado');
    expect(screen.getByTestId('delivery-actual')).toBeTruthy();
  });

  it('muestra el motivo del último cambio', () => {
    render(
      <DeliveryCommitmentCard
        project={project({
          committedDeliveryDate: '2026-12-22',
          events: [{ id: 'e', projectId: 'p1', type: 'delivery_date_changed', at: '2026-11-19T15:00:00Z', payload: { date: '2026-12-22', previousDate: '2026-12-15', reason: 'falta de placa' } }],
        })}
        today="2026-11-20"
      />,
    );
    expect(screen.getByTestId('delivery-last-change').textContent).toContain('falta de placa');
  });
});
