import { describe, expect, it } from 'vitest';
import { deriveOpsExceptions } from './opsExceptions';
import type { Project } from './types';

const base = (over: Partial<Project>): Project =>
  ({ id: 'p1', name: 'Cocina Pérez', customerId: 'c', currency: 'MXN', marginFactor: 1, laborFixedCost: 0, status: 'draft', items: [], createdAt: '', updatedAt: '', ...over }) as Project;

describe('deriveOpsExceptions — delivery_risk (#1648)', () => {
  const now = '2026-11-20T15:00:00Z';
  it('una entrega atrasada es crítica aunque la obra aún no esté en fábrica', () => {
    const [ex] = deriveOpsExceptions([base({ committedDeliveryDate: '2026-11-17', commercialStatus: 'won' })], { now });
    expect(ex).toMatchObject({ kind: 'delivery_risk', severity: 'critical', truth: 'actual' });
    expect(ex?.message).toContain('atrasada (3 días)');
  });
  it('vence esta semana: atención; en dos días o menos: crítica', () => {
    expect(deriveOpsExceptions([base({ committedDeliveryDate: '2026-11-25' })], { now })[0]?.severity).toBe('warning');
    expect(deriveOpsExceptions([base({ committedDeliveryDate: '2026-11-22' })], { now })[0]?.severity).toBe('critical');
  });
  it('sin fecha, entregada o lejana no alerta', () => {
    expect(deriveOpsExceptions([base({})], { now })).toHaveLength(0);
    expect(deriveOpsExceptions([base({ committedDeliveryDate: '2026-12-20' })], { now })).toHaveLength(0);
    expect(
      deriveOpsExceptions(
        [base({ committedDeliveryDate: '2026-11-10', events: [{ id: 'e', projectId: 'p1', type: 'client_signed_off', at: '2026-11-09T10:00:00Z' }] })],
        { now },
      ),
    ).toHaveLength(0);
  });
  it('usa el día local explícito, el mismo que las listas', () => {
    // 2026-11-21T02:00Z ya es día 21 en UTC pero en UTC-6 sigue siendo 20.
    const late = deriveOpsExceptions([base({ committedDeliveryDate: '2026-11-20' })], { now: '2026-11-21T02:00:00Z', today: '2026-11-20' });
    expect(late[0]?.message).toBe('Entrega comprometida hoy (2026-11-20)');
  });
});
