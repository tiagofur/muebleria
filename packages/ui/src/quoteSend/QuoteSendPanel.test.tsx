// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuoteSendPanel, bytesToBase64, isQuoteRevisionSendable, type QuoteSendPdfResult, type QuoteSendRevision } from './QuoteSendPanel';

const PROJECT = '16500000-0000-4000-8000-000000000001';
const REV = '16500000-0000-4000-8000-000000000003';
const DELIVERY = '16500000-0000-4000-8000-000000000009';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function list(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    emailDeliveryAvailable: true,
    customerEmailAvailable: true,
    customerPhoneAvailable: true,
    customerEmail: 'ana@cliente.test',
    customerPhone: '+52 55 1234 5678',
    ...overrides,
  };
}

const delivery = (overrides: Record<string, unknown> = {}) => ({
  id: DELIVERY, projectId: PROJECT, quoteRevisionId: REV, revisionNumber: 2, channel: 'email',
  recipient: 'ana@cliente.test', status: 'queued', requestedAt: '2026-11-22T10:00:00Z', ...overrides,
});

const published: QuoteSendRevision = { id: REV, revisionNumber: 2, status: 'published', exportable: true };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

type BuildPdf = (quoteRevisionId: string, variant: 'detailed' | 'summary') => Promise<QuoteSendPdfResult>;

function renderPanel(
  fetchMock: ReturnType<typeof vi.fn>,
  revisions: readonly QuoteSendRevision[] = [published],
  buildPdf = vi.fn<BuildPdf>(async () => ({ ok: true, bytes: PDF, fileName: 'Cotizacion-Q2-listado.pdf' })),
) {
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <QuoteSendPanel baseUrl="http://api.test/api" token="tok" projectId={PROJECT} queryKey={['qd', PROJECT]} revisions={revisions} buildPdf={buildPdf} />
    </QueryClientProvider>,
  );
  return buildPdf;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('QuoteSendPanel (#1650)', () => {
  it('sends the exact PDF bytes by email and shows it queued, not sent', async () => {
    let sentBody: Record<string, unknown> | null = null;
    let listed = list();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(':send-email')) {
        sentBody = JSON.parse(String(init?.body));
        listed = list({ items: [delivery({ pdfSha256: 'ab'.repeat(32), pdfBytes: 8, pdfFileName: 'Cotizacion-Q2-listado.pdf', variant: 'detailed' })] });
        return json(201, listed.items[0]);
      }
      return json(200, listed);
    });
    const buildPdf = renderPanel(fetchMock);
    expect(await screen.findByText('Se envía a ana@cliente.test.')).toBeTruthy();
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Mensaje para el cliente (opcional)'), { target: { value: 'Cualquier duda, avisame.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar por email' }));
    await waitFor(() => expect(sentBody).not.toBeNull());
    expect(buildPdf).toHaveBeenCalledWith(REV, 'detailed');
    expect(sentBody).toMatchObject({ variant: 'detailed', fileName: 'Cotizacion-Q2-listado.pdf', pdfBase64: bytesToBase64(PDF), note: 'Cualquier duda, avisame.' });
    expect(sentBody).not.toHaveProperty('to');
    expect((await screen.findByTestId('quote-send-notice')).textContent).toContain('en cola');
    expect(await screen.findByTestId('quote-delivery-queued')).toBeTruthy();
    expect(screen.getByText(/En cola de envío/)).toBeTruthy();
  });

  it('disables each channel with its reason instead of failing', async () => {
    renderPanel(vi.fn(async () => json(200, list({ emailDeliveryAvailable: false, customerPhoneAvailable: false, customerPhone: '55 1234 5678' }))));
    expect((await screen.findByTestId('quote-send-email-blocked')).textContent).toContain('todavía no envía correos');
    expect(screen.getByTestId('quote-send-whatsapp-blocked').textContent).toContain('código de país');
    expect((screen.getByRole('button', { name: 'Enviar por email' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Preparar WhatsApp' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('customer without email or phone: actions disabled with the reason', async () => {
    renderPanel(vi.fn(async () => json(200, list({ customerEmailAvailable: false, customerPhoneAvailable: false, customerEmail: undefined, customerPhone: undefined }))));
    expect((await screen.findByTestId('quote-send-email-blocked')).textContent).toContain('no tiene un email');
    expect(screen.getByTestId('quote-send-whatsapp-blocked').textContent).toContain('no tiene teléfono');
  });

  it('WhatsApp stays unconfirmed until the user confirms it', async () => {
    let listed = list();
    let confirmed = false;
    const prepared = delivery({ channel: 'whatsapp', recipient: '+525512345678', status: 'prepared' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(':prepare-whatsapp')) {
        listed = list({ items: [prepared] });
        return json(201, { delivery: prepared, whatsappUrl: 'https://wa.me/525512345678?text=Hola', message: 'Hola Ana, te comparto la cotización Q2.' });
      }
      if (url.endsWith(':confirm')) {
        confirmed = true;
        const done = { ...prepared, status: 'confirmed', sentAt: '2026-11-22T10:05:00Z' };
        listed = list({ items: [done] });
        return json(200, done);
      }
      return json(200, listed);
    });
    renderPanel(fetchMock);
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar WhatsApp' }));
    const link = await screen.findByRole('link', { name: 'Abrir WhatsApp' });
    // One primary action per state: confirming the WhatsApp send.
    const primaries = document.querySelectorAll('.btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.textContent).toBe('Ya lo envié');
    expect(link.getAttribute('href')).toBe('https://wa.me/525512345678?text=Hola');
    expect(await screen.findByText(/Preparada, sin confirmar/)).toBeTruthy();
    expect(confirmed).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ya lo envié' }));
    expect(await screen.findByText(/Enviada \(confirmada\)/)).toBeTruthy();
    expect(confirmed).toBe(true);
  });

  it('only published or accepted revisions with a frozen quote are sendable', async () => {
    expect(isQuoteRevisionSendable(published)).toBe(true)
    expect(isQuoteRevisionSendable({ ...published, status: 'accepted' })).toBe(true);
    expect(isQuoteRevisionSendable({ ...published, status: 'draft' })).toBe(false);
    expect(isQuoteRevisionSendable({ ...published, status: 'superseded' })).toBe(false);
    expect(isQuoteRevisionSendable({ ...published, exportable: false })).toBe(false);
    renderPanel(vi.fn(async () => json(200, list())), [{ ...published, status: 'draft' }]);
    expect(await screen.findByTestId('quote-send-none')).toBeTruthy();
  });

  it('shows a PDF build failure without calling the server', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json(200, list()));
    renderPanel(fetchMock, [published], vi.fn<BuildPdf>(async () => ({ ok: false, message: 'La revisión congelada no tiene líneas' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar por email' }));
    expect((await screen.findByTestId('quote-send-error')).textContent).toContain('no tiene líneas');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith(':send-email'))).toBe(false);
  });
});

describe('QuoteSendPanel idempotency intents (#1650)', () => {
  it('a definitive refusal and an edited input start a new Idempotency-Key', async () => {
    const keys: string[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(':send-email')) {
        keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        attempt += 1;
        if (attempt === 1) {
          return json(409, { code: 'QUOTE_DELIVERY_NO_RECIPIENT', message: 'el cliente no tiene un email válido', fieldErrors: {}, requestId: 'r', retryable: false, details: {} });
        }
        return json(201, delivery());
      }
      return json(200, list());
    });
    renderPanel(fetchMock);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar por email' }));
    expect((await screen.findByTestId('quote-send-error')).textContent).toContain('no tiene un email');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar por email' }));
    await screen.findByTestId('quote-send-notice');
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
