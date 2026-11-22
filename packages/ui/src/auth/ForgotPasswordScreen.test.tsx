// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function submit(delivery: 'queued' | 'not_configured') {
  const fetchImpl = vi.fn(async () => jsonResponse({ status: 'accepted', email_delivery: delivery })) as unknown as typeof fetch;
  const actor = userEvent.setup();
  render(<ForgotPasswordScreen baseUrl="http://api.test" fetchImpl={fetchImpl} onBackToLogin={() => {}} />);
  await actor.type(screen.getByLabelText('Email *'), 'ana@example.com');
  await actor.click(screen.getByRole('button', { name: 'Pedir enlace' }));
  return fetchImpl;
}

describe('ForgotPasswordScreen (#1646)', () => {
  afterEach(() => cleanup());

  it('announces the emailed one-time link when the server queued it', async () => {
    const fetchImpl = await submit('queued');
    expect(await screen.findByText(/en unos minutos te llega/)).toBeTruthy();
    expect(screen.getByText(/El enlace vence en una hora y sirve una sola vez/)).toBeTruthy();
    expect(screen.queryByText(/todavía no envía correos/)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('says plainly that this server does not send email and points to the admin', async () => {
    await submit('not_configured');
    expect(await screen.findByText(/Este servidor todavía no envía correos/)).toBeTruthy();
    expect(screen.queryByText(/te llega/)).toBeNull();
  });
});
