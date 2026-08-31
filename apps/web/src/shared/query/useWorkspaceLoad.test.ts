/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionGeneration, sessionScopeFromSession,
  type SessionGeneration, type SessionScope,
} from './sessionScope';
import { useWorkspaceLoad } from './useWorkspaceLoad';
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT',
  { configurable: true, value: true });

function authScope(
  organizationId: string,
  generation: SessionGeneration = createSessionGeneration(),
): SessionScope {
  return sessionScopeFromSession({ user: {
      id: 'user-1', email: 'admin@test', name: 'Admin', account_status: 'active',
      normalized_email: 'admin@test', email_verified_at: null, last_login_at: null,
      platform_admin: false, created_at: '2026-08-31T00:00:00Z',
      updated_at: '2026-08-31T00:00:00Z',
    }, roles: ['admin'], memberships: [], transport: 'web',
    organization: {
      id: organizationId, name: organizationId, slug: organizationId,
      type: 'factory', status: 'active', license: { plan: 'none', status: 'none' },
    }, session_scope: {
      user_id: 'user-1', membership_id: `membership-${organizationId}`,
      organization_id: organizationId, mode: 'auth', support_session_id: null,
      recovery_session_id: null, membership_credential_version: 1,
      organization_credential_version: 1,
      absolute_expires_at: '2026-09-01T00:00:00Z',
    } }, generation);
}

describe('useWorkspaceLoad', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('has one owner across initial auth, A to B, and same-scope refreshes', () => {
    const container = document.createElement('div');
    root = createRoot(container);
    const loadWorkspace = vi.fn(async () => undefined);
    const resetWorkspace = vi.fn();
    const generationA = createSessionGeneration();
    const scopeA = authScope('org-a', generationA);

    function Harness({ scope }: { readonly scope: SessionScope }) {
      useWorkspaceLoad({ session: 'auth', sessionScope: scope, loadWorkspace, resetWorkspace });
      return null;
    }

    act(() => root?.render(createElement(Harness, { scope: scopeA })));
    expect(loadWorkspace).toHaveBeenCalledTimes(1);

    act(() => root?.render(createElement(Harness, {
      scope: authScope('org-a', generationA),
    })));
    expect(loadWorkspace).toHaveBeenCalledTimes(1);

    act(() => root?.render(createElement(Harness, { scope: authScope('org-b') })));
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
    expect(resetWorkspace).toHaveBeenCalledTimes(2);
  });

  it('waits for auth hydration while preserving guest and pending behavior', () => {
    const container = document.createElement('div');
    root = createRoot(container);
    const loadWorkspace = vi.fn(async () => undefined);
    const resetWorkspace = vi.fn();

    function Harness({ session, scope }: {
      readonly session: 'auth' | 'guest' | null;
      readonly scope: SessionScope | null;
    }) {
      useWorkspaceLoad({ session, sessionScope: scope, loadWorkspace, resetWorkspace });
      return null;
    }

    act(() => root?.render(createElement(Harness, { session: null, scope: null })));
    act(() => root?.render(createElement(Harness, { session: 'auth', scope: null })));
    expect(loadWorkspace).not.toHaveBeenCalled();

    act(() => root?.render(createElement(Harness, { session: 'auth', scope: authScope('org-a') })));
    expect(loadWorkspace).toHaveBeenCalledTimes(1);

    act(() => root?.render(createElement(Harness, { session: 'guest', scope: null })));
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
  });
});
