/**
 * SessionGate — login/register gate around the app content (F057 shape,
 * F120 extracted from App.tsx). Renders `children` (the shell content) only
 * when a session is active; LoginScreen / RegisterScreen otherwise.
 */

import type { ReactNode } from 'react';
import { LoginScreen, RegisterScreen, AcceptInvitationScreen } from '@granete/ui';

import { useWorkspaceStore } from './stores/workspaceStore';
import { OrgPicker } from './OrgPicker';
import { DEFAULT_API_BASE } from './session';

export function SessionGate({ children }: { readonly children: ReactNode }): ReactNode {
  const session = useWorkspaceStore((s) => s.session);
  const authGate = useWorkspaceStore((s) => s.authGate);
  const loginLoading = useWorkspaceStore((s) => s.loginLoading);
  const loginError = useWorkspaceStore((s) => s.loginError);
  const registerLoading = useWorkspaceStore((s) => s.registerLoading);
  const registerError = useWorkspaceStore((s) => s.registerError);
  const setAuthGate = useWorkspaceStore((s) => s.setAuthGate);
  const clearAuthErrors = useWorkspaceStore((s) => s.clearAuthErrors);
  const enterAsGuest = useWorkspaceStore((s) => s.enterAsGuest);
  const login = useWorkspaceStore((s) => s.login);
  const register = useWorkspaceStore((s) => s.register);
  const loginWithAuthPayload = useWorkspaceStore((s) => s.loginWithAuthPayload);
  const sessionEndReason = useWorkspaceStore((s) => s.sessionEndReason);
  const pendingOrgSelection = useWorkspaceStore((s) => s.pendingOrgSelection);
  const orgSelectionLoading = useWorkspaceStore((s) => s.orgSelectionLoading);
  const orgSelectionError = useWorkspaceStore((s) => s.orgSelectionError);
  const selectOrg = useWorkspaceStore((s) => s.selectOrg);
  const logout = useWorkspaceStore((s) => s.logout);

  const isAcceptInvitation =
    typeof window !== 'undefined' && window.location.pathname === '/accept-invitation';
  const invitationToken =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token') || ''
      : '';

  if (session === null && isAcceptInvitation && invitationToken) {
    return (
      <AcceptInvitationScreen
        token={invitationToken}
        baseUrl={DEFAULT_API_BASE}
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
    if (authGate === 'register') {
      return (
        <RegisterScreen
          onRegister={register}
          onBack={() => {
            setAuthGate('login');
            clearAuthErrors();
          }}
          loading={registerLoading}
          error={registerError}
        />
      );
    }
    return (
      <LoginScreen
        onLogin={login}
        onGuestAccess={enterAsGuest}
        loading={loginLoading}
        error={loginError}
        notice={
          sessionEndReason === 'expired'
            ? 'Tu sesión expiró. Volvé a iniciar sesión para continuar donde estabas.'
            : null
        }
      />
    );
  }

  return children;
}
