// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectPaymentsPanel } from './ProjectPaymentsPanel';
import { ReceivablesPanel, receivableAgeDays, receivableTotalsByCurrency } from './ReceivablesPanel';

const PROJECT = '56000000-0000-4000-8000-000000000001';
const PAYMENT = '56000000-0000-4000-8000-0000000000aa';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT,
    currency: 'MXN',
    acceptedQuote: { quoteRevisionId: '56000000-0000-4000-8000-0000000000q1', revisionNumber: 2, saleTotal: 10000, currency: 'MXN' },
    payments: [
      {
        id: PAYMENT, projectId: PROJECT, kind: 'deposit', amount: 4000, currency: 'MXN', paymentMethod: 'transfer',
        reference: 'TRF-1', receivedAt: '2026-11-10T12:00:00Z', recordedAt: '2026-11-10T12:00:00Z', origin: 'command',
      },
    ],
    paidTotal: 4000,
    balance: 6000,
    otherCurrencyPayments: 0,
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPanel(fetchMock: ReturnType<typeof vi.fn>, canRecord = true) {
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectPaymentsPanel
        baseUrl="http://api.test/api"
        token="tok"
        projectId={PROJECT}
        projectCurrency="MXN"
        queryKey={['project-payments', PROJECT]}
        canRecord={canRecord}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectPaymentsPanel (#1649)', () => {
  it('muestra total, cobrado y saldo tal como los calcula el servidor', async () => {
    renderPanel(vi.fn(async () => json(200, summary())));
    expect((await screen.findByTestId('payments-quote-total')).textContent).toContain('10,000.00 MXN (Q2)');
    expect((screen.getByTestId('payments-paid-total')).textContent).toContain('4,000.00 MXN');
    expect((screen.getByTestId('payments-balance')).textContent).toContain('6,000.00 MXN');
    expect((screen.getByTestId(`payment-row-${PAYMENT}`)).textContent).toContain('Anticipo');
  });

  it('registra un pago con Idempotency-Key y recarga; el reintento tras un error reutiliza la misma clave', async () => {
    const keys: string[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '');
        attempt += 1;
        if (attempt === 1) return json(503, { code: 'INTERNAL_ERROR', message: 'caído', fieldErrors: {}, requestId: '', retryable: true, details: {} });
        return json(201, { ...summary().payments[0], id: '56000000-0000-4000-8000-0000000000bb', kind: 'payment' });
      }
      return json(200, summary());
    });
    renderPanel(fetchMock);
    fireEvent.click(await screen.findByTestId('btn-record-payment'));
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '1500' } });
    fireEvent.click(screen.getByTestId('btn-confirm-payment'));
    expect(await screen.findByTestId('payment-form-error')).toBeTruthy();
    expect((screen.getByLabelText(/Monto/) as HTMLInputElement).value).toBe('1500');

    fireEvent.click(screen.getByTestId('btn-confirm-payment'));
    await waitFor(() => expect(screen.queryByTestId('btn-confirm-payment')).toBeNull());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]!.length).toBeGreaterThanOrEqual(16);
  });

  it('anular exige motivo y no se ofrece sin permiso de registro', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ reason: 'cargado dos veces' });
        return json(200, { ...summary().payments[0], void: { reason: 'cargado dos veces', voidedAt: '2026-11-12T00:00:00Z' } });
      }
      return json(200, summary());
    });
    renderPanel(fetchMock);
    fireEvent.click(await screen.findByTestId(`btn-void-${PAYMENT}`));
    const confirm = screen.getByTestId('btn-confirm-void') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'cargado dos veces' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId('void-dialog')).toBeNull());

    cleanup();
    renderPanel(vi.fn(async () => json(200, summary())), false);
    await screen.findByTestId('payments-table');
    expect(screen.queryByTestId('btn-record-payment')).toBeNull();
    expect(screen.queryByTestId(`btn-void-${PAYMENT}`)).toBeNull();
  });

  it('distingue sin permiso de error de red', async () => {
    renderPanel(vi.fn(async () => json(403, { code: 'FORBIDDEN', message: 'no', fieldErrors: {}, requestId: '', retryable: false, details: {} })));
    expect((await screen.findByTestId('payments-error')).textContent).toContain('no están disponibles para tu usuario');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });
});

describe('ReceivablesPanel (#1649)', () => {
  const items = [
    { projectId: 'p1', projectName: 'Cocina', customerId: 'c1', customerName: 'Ana', currency: 'MXN', quoteRevisionId: 'q1', quoteRevisionNumber: 1, saleTotal: 1000, paidTotal: 400, balance: 600, acceptedAt: '2026-11-01T00:00:00Z' },
    { projectId: 'p2', projectName: 'Placard', customerId: 'c2', customerName: 'Beto', currency: 'MXN', quoteRevisionId: 'q2', quoteRevisionNumber: 3, saleTotal: 500, paidTotal: 500, balance: 0, acceptedAt: '2026-10-01T00:00:00Z' },
    { projectId: 'p3', projectName: 'Baño', customerId: 'c1', customerName: 'Ana', currency: 'USD', quoteRevisionId: 'q3', quoteRevisionNumber: 1, saleTotal: 300, paidTotal: 0, balance: 300, acceptedAt: '2026-11-15T00:00:00Z' },
  ];

  function renderReceivables(customerId?: string) {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { items })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <ReceivablesPanel baseUrl="http://api.test/api" token="tok" queryKey={['r', customerId]} customerId={customerId} now={new Date('2026-11-17T00:00:00Z')} />
      </QueryClientProvider>,
    );
  }

  it('lista sólo saldos pendientes, ordena por antigüedad y no suma monedas distintas', async () => {
    renderReceivables();
    await screen.findByTestId('receivables-table');
    expect(screen.queryByTestId('receivable-row-p2')).toBeNull();
    const rows = screen.getAllByTestId(/receivable-row-/).map((r) => r.getAttribute('data-testid'));
    expect(rows).toEqual(['receivable-row-p1', 'receivable-row-p3']);
    expect((screen.getByTestId('receivables-total-MXN')).textContent).toContain('600.00 MXN');
    expect((screen.getByTestId('receivables-total-USD')).textContent).toContain('300.00 USD');
  });

  it('cuenta corriente de un cliente incluye obras saldadas', async () => {
    renderReceivables('c2');
    expect(await screen.findByTestId('receivable-row-p2')).toBeTruthy();
    expect(screen.queryByTestId('receivable-row-p1')).toBeNull();
  });

  it('antigüedad desde la aceptación real', () => {
    expect(receivableAgeDays(items[0] as never, new Date('2026-11-17T00:00:00Z'))).toBe(16);
    expect(receivableAgeDays({ ...items[0], acceptedAt: undefined } as never, new Date())).toBeNull();
    expect([...receivableTotalsByCurrency(items as never).entries()]).toEqual([['MXN', 600], ['USD', 300]]);
  });
});
