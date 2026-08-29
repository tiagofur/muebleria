// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformScreen } from './PlatformScreen';

const organization = {
  id: 'org-1',
  name: 'Taller Norte',
  slug: 'taller-norte',
  type: 'factory',
  license_plan: 'pro',
  license_expires_at: null,
  active: true,
  member_count: 2,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
  version: 1,
};

describe('PlatformScreen audit UX', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exposes an audit endpoint failure and retries it explicitly', async () => {
    let auditAttempts = 0;
    let auditShouldFail = true;
    const jsonOk = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
        if (url.endsWith('/audit')) {
          auditAttempts += 1;
          if (auditShouldFail) throw new TypeError('network unavailable');
          return jsonOk([]);
        }
        return jsonOk([]);
      }),
    );
    const user = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await user.click(await screen.findByRole('tab', { name: /Auditoría de Seguridad/ }));

    expect(await screen.findByText('No se pudo cargar la auditoría')).toBeTruthy();
    expect(screen.queryByText('No hay eventos de auditoría registrados para esta organización.')).toBeNull();

    auditShouldFail = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(auditAttempts).toBeGreaterThan(1));
    expect(await screen.findByText('No hay eventos de auditoría registrados para esta organización.')).toBeTruthy();
  });
});
