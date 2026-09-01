/**
 * SessionGate — invitation-first authentication gate around the app content.
 * Renders `children` only when a session is active and otherwise exposes
 * login or the token-bound invitation acceptance flow.
 *
 * #460 SEC-4B: distingue `booting` (cookie bootstrap en curso — ni login ni
 * shell) de anonymous/guest/authenticated/support, y comunica motivos de fin
 * de sesión (expired/revoked/security) y boot fallido (unavailable/config)
 * sin loops login→refresh→login.
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { LoginScreen, AcceptInvitationScreen } from '@granete/ui';

import { useWorkspaceStore } from './stores/workspaceStore';
import { OrgPicker } from './OrgPicker';
import { DEFAULT_API_BASE, credentialedWebFetch } from './session';

const SESSION_END_NOTICES: Record<string, string> = {
  expired: 'Tu sesión expiró. Volvé a iniciar sesión para continuar donde estabas.',
  revoked: 'Tu sesión fue revocada. Iniciá sesión de nuevo para continuar.',
  security: 'Cerramos tu sesión por seguridad. Iniciá sesión de nuevo.',
  connection: 'Perdimos la conexión y no pudimos mantener tu sesión. Iniciá sesión de nuevo.',
};

export function SessionGate({ children }: { readonly children: ReactNode }): ReactNode {
  const session = useWorkspaceStore((s) => s.session);
  const authBootstrapping = useWorkspaceStore((s) => s.authBootstrapping);
  const sessionBootError = useWorkspaceStore((s) => s.sessionBootError);
  const loginLoading = useWorkspaceStore((s) => s.loginLoading);
  const loginError = useWorkspaceStore((s) => s.loginError);
  const enterAsGuest = useWorkspaceStore((s) => s.enterAsGuest);
  const login = useWorkspaceStore((s) => s.login);
  const loginWithAuthPayload = useWorkspaceStore((s) => s.loginWithAuthPayload);
  const sessionEndReason = useWorkspaceStore((s) => s.sessionEndReason);
  const logoutServerPending = useWorkspaceStore((s) => s.logoutServerPending);
  const retryLogout = useWorkspaceStore((s) => s.logout);
  const pendingOrgSelection = useWorkspaceStore((s) => s.pendingOrgSelection);
  const orgSelectionLoading = useWorkspaceStore((s) => s.orgSelectionLoading);
  const orgSelectionError = useWorkspaceStore((s) => s.orgSelectionError);
  const selectOrg = useWorkspaceStore((s) => s.selectOrg);
  const logout = useWorkspaceStore((s) => s.logout);

  // Cookie bootstrap del arranque (SEC-4B §7): sin bearer en memoria, la
  // sesión compartida se descubre con POST /auth/refresh + /auth/me.
  useEffect(() => {
    void useWorkspaceStore.getState().beginAuthBootstrap();
  }, []);

  const isAcceptInvitation =
    typeof window !== 'undefined' && window.location.pathname === '/accept-invitation';
  const invitationToken =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token') || ''
      : '';

  if (session === null && authBootstrapping) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          gap: 12,
        }}
        aria-busy="true"
      >
        <p style={{ margin: 0, fontSize: 15 }}>Restaurando tu sesión…</p>
      </main>
    );
  }

  if (session === null && isAcceptInvitation && invitationToken) {
    return (
      <AcceptInvitationScreen
        token={invitationToken}
        baseUrl={DEFAULT_API_BASE}
        fetchImpl={credentialedWebFetch()}
        onAccepted={(authData) => {
          loginWithAuthPayload(authData);
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/');
          }
        }}
        onBackToLogin={() => {
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', '/');
            window.location.reload();
          }
        }}
      />
    );
  }

  if (session === null && pendingOrgSelection && pendingOrgSelection.length > 0) {
    return (
      <OrgPicker
        memberships={pendingOrgSelection}
        onPick={(orgId) => void selectOrg(orgId)}
        loading={orgSelectionLoading}
        error={orgSelectionError}
        onLogout={logout}
      />
    );
  }

  if (session === null) {
    return (
      <>
        {logoutServerPending && (
          <div
            role="alert"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 16px',
              borderBottom: '1px solid #d79b9b',
              background: '#fdf0f0',
              fontSize: 14,
            }}
          >
            <span>
              No pudimos cerrar tu sesión en el servidor. Tus datos ya no están
              visibles; reintentá el cierre o volvé a iniciar sesión.
            </span>
            <button type="button" className="btn btn--ghost btn--small" onClick={retryLogout}>
              Reintentar cierre de sesión
            </button>
          </div>
        )}
        <LoginScreen
          onLogin={login}
          onGuestAccess={enterAsGuest}
          loading={loginLoading}
          error={loginError}
          notice={
            sessionEndReason
              ? SESSION_END_NOTICES[sessionEndReason] ?? null
              : sessionBootError === 'config'
                ? 'No pudimos verificar tu sesión por una configuración del servidor. Recargá la página o contactá soporte.'
                : sessionBootError === 'unavailable'
                  ? 'No pudimos verificar tu sesión. Revisá tu conexión y volvé a iniciar sesión.'
                  : null
          }
        />
      </>
    );
  }

  return children;
}
