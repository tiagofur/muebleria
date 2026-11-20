import { describe, expect, it } from 'vitest';
import {
  compareByCommittedDelivery,
  deliveryDaysLabelEs,
  isDeliveryAttention,
  localIsoDate,
  projectDeliveryInfo,
  summarizeDeliveryRisk,
} from './projectDelivery';
import type { ProjectEvent } from './projectLifecycle';

const ev = (type: ProjectEvent['type'], at: string): ProjectEvent => ({ id: `e-${type}-${at}`, projectId: 'p', type, at });

describe('projectDeliveryInfo (#1648)', () => {
  const today = '2026-11-20';
  it('sin fecha comprometida no es "en fecha"', () => {
    expect(projectDeliveryInfo({}, today).status).toBe('none');
  });
  it('clasifica atrasado / vence esta semana / en fecha', () => {
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-19' }, today)).toMatchObject({ status: 'overdue', daysToCommitted: -1 });
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-20' }, today)).toMatchObject({ status: 'due_soon', daysToCommitted: 0 });
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-27' }, today).status).toBe('due_soon');
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-28' }, today).status).toBe('on_track');
  });
  it('la entrega real sale del log de eventos, no de la fecha comprometida', () => {
    const info = projectDeliveryInfo(
      { committedDeliveryDate: '2026-11-01', events: [ev('installation_started', '2026-11-02T10:00:00Z'), ev('client_signed_off', '2026-11-05T10:00:00Z'), ev('installation_completed', '2026-11-04T10:00:00Z')] },
      today,
    );
    expect(info).toMatchObject({ status: 'delivered', deliveredAt: '2026-11-04T10:00:00Z' });
    expect(isDeliveryAttention(info)).toBe(false);
  });
  it('una obra perdida o cancelada no figura como atrasada', () => {
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-01', commercialStatus: 'lost' }, today).status).toBe('closed');
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-01', commercialStatus: 'cancelled' }, today).status).toBe('closed');
  });
  it('etiquetas y orden', () => {
    expect(deliveryDaysLabelEs(projectDeliveryInfo({ committedDeliveryDate: '2026-11-17' }, today))).toBe('Atrasado 3 días');
    expect(deliveryDaysLabelEs(projectDeliveryInfo({ committedDeliveryDate: '2026-11-21' }, today))).toBe('Vence mañana');
    const sorted = [{ committedDeliveryDate: undefined }, { committedDeliveryDate: '2026-12-01' }, { committedDeliveryDate: '2026-11-25' }].sort(compareByCommittedDelivery);
    expect(sorted.map((p) => p.committedDeliveryDate)).toEqual(['2026-11-25', '2026-12-01', undefined]);
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
  it('cerrar una obra cancelada no la vuelve «Entregado»; un cierre normal sí cuenta', () => {
    const closed = [ev('project_closed', '2026-11-10T10:00:00Z')];
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-01', commercialStatus: 'cancelled', events: closed }, today).status).toBe('closed');
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-01', commercialStatus: 'lost', events: closed }, today).status).toBe('closed');
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-01', commercialStatus: 'won', events: closed }, today).status).toBe('delivered');
    const signed = [ev('client_signed_off', '2026-11-09T10:00:00Z')];
    expect(projectDeliveryInfo({ committedDeliveryDate: '2026-11-01', commercialStatus: 'cancelled', events: signed }, today).status).toBe('delivered');
  });
  it('resume atrasados y vencen esta semana para el dashboard', () => {
    expect(
      summarizeDeliveryRisk(
        [
          { committedDeliveryDate: '2026-11-18' },
          { committedDeliveryDate: '2026-11-19' },
          { committedDeliveryDate: '2026-11-22' },
          { committedDeliveryDate: '2026-12-20' },
          { committedDeliveryDate: '2026-11-01', commercialStatus: 'lost' },
          {},
        ],
        today,
      ),
    ).toEqual({ overdue: 2, dueSoon: 1, tracked: 4 });
  });
});
