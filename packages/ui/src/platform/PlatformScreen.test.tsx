// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformScreen } from './PlatformScreen';

const organization = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Taller Norte',
  slug: 'taller-norte',
  type: 'factory',
  license_plan: 'pro',
  license_expires_at: null,
  status: 'active',
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

  it('keeps global account authority in Platform and requires an audited reason', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const platformUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ana@example.com',
      name: 'Ana',
      platform_admin: false,
      account_status: 'active',
      created_at: '2026-08-29T00:00:00Z',
      memberships: [{ organization_id: 'org-1', organization_name: 'Taller Norte', organization_slug: 'taller-norte', roles: ['vendedor'], status: 'suspended', version: 2 }],
    };
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith('/platform/users')) return jsonOk([platformUser]);
      if (url.includes(':set-account-status')) return jsonOk({ user_id: platformUser.id, account_status: 'disabled', updated_at: '2026-08-29T01:00:00Z' });
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await actor.click(await screen.findByRole('tab', { name: /Usuarios Globales/ }));
    expect(await screen.findByText('Cuenta activa')).toBeTruthy();
    expect(screen.getByText(/suspended/)).toBeTruthy();
    await actor.click(screen.getByRole('button', { name: 'Deshabilitar cuenta' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar cambio' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await actor.type(screen.getByLabelText('Motivo *'), 'Cuenta comprometida');
    await actor.click(confirm);

    await waitFor(() => expect(requests.some(({ url }) => url.endsWith(`/platform/users/${platformUser.id}:set-account-status`))).toBe(true));
    const mutation = requests.find(({ url }) => url.includes(':set-account-status'))!;
    expect(new Headers(mutation.init?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(mutation.init?.body).toBe(JSON.stringify({ account_status: 'disabled', reason: 'Cuenta comprometida' }));
  });

  it('challenges an organization update and retries it with the same idempotency key', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let updateAttempts = 0;
    const updatedOrganization = { ...organization, name: 'Taller Norte Renovado', version: 2 };
    const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith(`/platform/organizations/${organization.id}`) && init?.method === 'PATCH') {
        updateAttempts += 1;
        if (updateAttempts === 1) {
          return jsonResponse({
            code: 'STEP_UP_REQUIRED',
            message: 'Confirmá tu identidad para continuar.',
            fieldErrors: {},
            requestId: '',
            retryable: false,
            details: { scope: 'platform_admin' },
          }, 403);
        }
        return jsonResponse(updatedOrganization);
      }
      if (url.endsWith('/auth/mfa/step-up')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body).toMatchObject({ scope: 'platform_admin', method: 'totp', code: '123456' });
        return jsonResponse({ scope: 'platform_admin', method: 'totp', expires_at: '2026-09-02T12:00:00Z' });
      }
      if (url.endsWith('/platform/organizations')) return jsonResponse([organization]);
      if (url.endsWith(`/organizations/${organization.id}/readiness`)) {
        return jsonResponse({
          organization_id: organization.id,
          organization_version: organization.version,
          ready: true,
          checks: [],
          checked_at: '2026-09-02T11:00:00Z',
        });
      }
      return jsonResponse([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await actor.click(await screen.findByRole('button', { name: 'Editar' }));
    await actor.clear(screen.getByLabelText('Nombre de la Organización'));
    await actor.type(screen.getByLabelText('Nombre de la Organización'), updatedOrganization.name);
    await actor.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    expect(await screen.findByTestId('step-up-modal')).toBeTruthy();
    expect(screen.queryByText('✓ Organización actualizada')).toBeNull();
    await actor.type(screen.getByLabelText(/Código de autenticación/i), '123456');
    await actor.click(screen.getByRole('button', { name: /Verificar/i }));

    expect(await screen.findByText('✓ Organización actualizada')).toBeTruthy();
    expect(updateAttempts).toBe(2);
    const keys = requests
      .filter(({ url, init }) => url.endsWith(`/platform/organizations/${organization.id}`) && init?.method === 'PATCH')
      .map(({ init }) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^web:/);
  });

  it('provisions through the canonical command and confirms only authoritative readiness', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const bootstrapUser = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'owner@example.com',
      name: 'Ana Owner',
      platform_admin: false,
      account_status: 'active',
      created_at: '2026-08-30T00:00:00Z',
      memberships: [],
    };
    const provisioned = {
      ...organization,
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Taller Atómico',
      slug: 'taller-atomico',
      member_count: 1,
      version: 2,
    };
    const jsonOk = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith('/platform/users')) return jsonOk([bootstrapUser]);
      if (url.endsWith('/organizations') && init?.method === 'POST') {
        return jsonOk({
          organization: provisioned,
          readiness: {
            organization_id: provisioned.id,
            organization_version: 2,
            ready: true,
            checks: [],
            checked_at: '2026-08-30T00:00:00Z',
          },
        }, 201);
      }
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await actor.click(await screen.findByRole('button', { name: /Nueva Organización/ }));
    await actor.type(screen.getByLabelText(/Nombre del Taller/), 'Taller Atómico');
    await actor.clear(screen.getByLabelText(/Slug identificador/));
    await actor.type(screen.getByLabelText(/Slug identificador/), 'taller-atomico');
    await actor.selectOptions(await screen.findByLabelText(/Administrador inicial/), bootstrapUser.id);
    await actor.click(screen.getByRole('button', { name: /^Crear Organización$/ }));

    expect(await screen.findByText('✓ Organización activa y lista para operar')).toBeTruthy();
    const request = requests.find(({ url, init }) => url.endsWith('/organizations') && init?.method === 'POST');
    expect(request).toBeTruthy();
    expect(JSON.parse(String(request?.init?.body))).toEqual(expect.objectContaining({
      name: 'Taller Atómico',
      slug: 'taller-atomico',
      bootstrap_admin_user_id: bootstrapUser.id,
    }));
    expect(new Headers(request?.init?.headers).get('Idempotency-Key')).toMatch(/^web:/);
  });

  it('never presents failed authoritative readiness as active and labels lifecycle controls', async () => {
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith(`/organizations/${organization.id}/readiness`)) return jsonOk({
        organization_id: organization.id,
        organization_version: 1,
        ready: false,
        checks: [{ code: 'bootstrap_admin', ready: false, blocking: true, message: 'Falta administrador inicial' }],
        checked_at: '2026-08-30T01:00:00Z',
      });
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    expect(await screen.findByText('No lista')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Entrar a Taller' }) as HTMLButtonElement).disabled).toBe(true);
    await actor.click(await screen.findByRole('button', { name: 'Estado y ciclo de vida' }));

    expect(await screen.findByRole('heading', { name: 'No lista para operar' })).toBeTruthy();
    expect(screen.getByText(/todavía no está lista para operar/)).toBeTruthy();
    expect(screen.queryByText('Organización habilitada para operar.')).toBeNull();
    expect(screen.getByText(/Bloqueado:/)).toBeTruthy();
    expect(screen.getByLabelText('Motivo (mínimo 4 caracteres) *')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar' })).toBe(document.activeElement));
  });

  it('fails closed when readiness cannot be loaded', async () => {
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith(`/organizations/${organization.id}/readiness`)) throw new TypeError('offline');
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    expect(await screen.findByText('Preparación sin verificar')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Entrar a Taller' }) as HTMLButtonElement).disabled).toBe(true);
    await actor.click(screen.getByRole('button', { name: 'Estado y ciclo de vida' }));

    expect(await screen.findByText(/No se puede confirmar que esté habilitada/)).toBeTruthy();
    expect(screen.queryByText('Organización habilitada para operar.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Lista para operar' })).toBeNull();
  });

  it('keeps committed lifecycle success when the follow-up readiness refresh fails', async () => {
    let resolveSuspend!: (response: Response) => void;
    let readinessAttempts = 0;
    const suspendResponse = new Promise<Response>((resolve) => { resolveSuspend = resolve; });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const readiness = {
      organization_id: organization.id,
      organization_version: 1,
      ready: true,
      checks: [],
      checked_at: '2026-08-30T01:00:00Z',
    };
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith(`/organizations/${organization.id}/readiness`)) {
        readinessAttempts += 1;
        if (readinessAttempts > 1) throw new TypeError('refresh unavailable');
        return jsonOk(readiness);
      }
      if (url.endsWith(`/organizations/${organization.id}:suspend`)) return suspendResponse;
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);
    await actor.click(await screen.findByRole('button', { name: 'Estado y ciclo de vida' }));
    await screen.findByRole('heading', { name: 'Lista para operar' });
    await actor.type(screen.getByLabelText('Motivo (mínimo 4 caracteres) *'), 'Riesgo operativo');
    await actor.click(screen.getByRole('button', { name: 'Suspender' }));

    expect(screen.getByText('Organización habilitada para operar.')).toBeTruthy();
    resolveSuspend(jsonOk({ organization: { ...organization, status: 'suspended', version: 2 } }));

    expect(await screen.findByText(/Acceso operativo suspendido/)).toBeTruthy();
    expect(await screen.findByText(/Cambio guardado/)).toBeTruthy();
    expect(screen.queryByText('No se pudo completar la acción.')).toBeNull();
    const request = requests.find(({ url }) => url.endsWith(`/${organization.id}:suspend`));
    expect(new Headers(request?.init?.headers).get('If-Match')).toBe('"v1"');
    expect(JSON.parse(String(request?.init?.body))).toEqual({ reason: 'Riesgo operativo' });
  });

  it('refetches a stale impact preview before committing offboarding', async () => {
    const bodies: unknown[] = [];
    let listAttempts = 0;
    let previewAttempts = 0;
    let commitAttempts = 0;
    const firstImpact = 'a'.repeat(64);
    const refreshedImpact = 'b'.repeat(64);
    const readiness = {
      organization_id: organization.id, organization_version: 1, ready: true, checks: [], checked_at: '2026-08-30T01:00:00Z',
    };
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/platform/organizations')) {
        listAttempts += 1;
        return json([{ ...organization, version: listAttempts > 1 ? 2 : 1 }]);
      }
      if (url.endsWith(`/organizations/${organization.id}/readiness`)) return json(readiness);
      if (url.endsWith(`/organizations/${organization.id}/offboarding-preview`)) {
        previewAttempts += 1;
        return json({ organization_id: organization.id, organization_version: previewAttempts, impact_version: previewAttempts > 1 ? refreshedImpact : firstImpact, blockers: [], warnings: [] });
      }
      if (url.endsWith(`/organizations/${organization.id}:begin-offboarding`)) {
        commitAttempts += 1;
        bodies.push(JSON.parse(String(init?.body)));
        if (commitAttempts === 1) return new Response(JSON.stringify({ code: 'IMPACT_VERSION_CONFLICT', message: 'stale', fieldErrors: {}, requestId: 'req-1', retryable: false, details: {} }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        return json({ organization: { ...organization, status: 'offboarding', version: 2 } });
      }
      return json([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);
    await actor.click(await screen.findByRole('button', { name: 'Estado y ciclo de vida' }));
    await actor.type(await screen.findByLabelText('Motivo (mínimo 4 caracteres) *'), 'Cierre solicitado');
    await actor.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    await actor.click(await screen.findByRole('button', { name: 'Iniciar cierre' }));
    await actor.click(await screen.findByRole('button', { name: 'Recargar estado' }));
    await waitFor(() => expect(previewAttempts).toBe(2));
    await actor.click(screen.getByRole('button', { name: 'Iniciar cierre' }));
    expect(await screen.findByText(/Cierre en curso/)).toBeTruthy();
    expect(bodies).toEqual([
      { reason: 'Cierre solicitado', impact_version: firstImpact },
      { reason: 'Cierre solicitado', impact_version: refreshedImpact },
    ]);
  });
});
