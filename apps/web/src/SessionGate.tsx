/**
 * SessionGate — login/register gate around the app content (F057 shape,
 * F120 extracted from App.tsx). Renders `children` (the shell content) only
 * when a session is active; LoginScreen / RegisterScreen otherwise.
 */

import type { ReactNode } from 'react';
import { LoginScreen, RegisterScreen } from '@muebles/ui';

import { useWorkspaceStore } from './stores/workspaceStore';

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
  const sessionEndReason = useWorkspaceStore((s) => s.sessionEndReason);

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
        onRegister={() => {
          clearAuthErrors();
          setAuthGate('register');
        }}
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
