/**
 * @vitest-environment jsdom
 *
 * #1648 — the server is the authority on expiry: a QUOTE_EXPIRED verdict
 * switches the accept modal to the explicit acknowledgement even while the
 * client still computes the quote as valid (a day change it has not seen).
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuoteRevisionDetail } from '@granete/storage';
import { AcceptQuoteModal } from './ReconciliationCommandPanels';

const revision = {
  id: '16480000-0000-4000-8000-0000000000aa',
  projectId: '16480000-0000-4000-8000-0000000000bb',
  revisionNumber: 3,
  status: 'published',
  sourceType: 'manual',
  createdAt: '2026-11-01T00:00:00Z',
  items: [],
  validUntil: '2099-01-31',
} as unknown as QuoteRevisionDetail;

afterEach(() => cleanup());

describe('AcceptQuoteModal — veredicto QUOTE_EXPIRED del servidor (#1648)', () => {
  it('vigente para el cliente: confirma sin casilla extra', () => {
    render(
      <AcceptQuoteModal open onClose={vi.fn()} quoteRevision={revision} submitting={false} error={null} onConfirm={vi.fn()} today="2099-01-10" />,
    );
    expect(screen.queryByTestId('accept-quote-expired-ack')).toBeNull();
    expect(screen.getByTestId('confirm-accept-quote-btn')).toBeEnabled();
  });

  it('si el servidor dice vencida, pide la confirmación explícita y la envía', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <AcceptQuoteModal
        open
        onClose={vi.fn()}
        quoteRevision={revision}
        submitting={false}
        error={{ kind: 'expired', title: 'Cotización vencida', message: 'La cotización está vencida.' }}
        onConfirm={onConfirm}
        today="2099-01-10"
      />,
    );
    expect(screen.getByTestId('accept-quote-expired-warning')).toBeVisible();
    // The typed verdict is shown as the warning, not as a generic error alert.
    expect(screen.queryByTestId('command-error-alert')).toBeNull();
    expect(screen.getByTestId('confirm-accept-quote-btn')).toBeDisabled();
    await user.click(screen.getByTestId('accept-quote-expired-ack'));
    await user.click(screen.getByTestId('confirm-accept-quote-btn'));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});
