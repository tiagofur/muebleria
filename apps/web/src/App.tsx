/**
 * Thin web shell — composition root (F121): session gate + toast viewport +
 * AppContent. Cost formulas only via the domain engine; the render lives in
 * ShellView, orchestration in AppContent.
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { SessionGate } from './SessionGate';
import { ToastViewport } from './components/ToastViewport';
import { AppContent } from './AppContent';
import {
  useWorkspaceStore,
  resetCatalogStore,
  resetProjectStore,
  resetPurchasingStore,
} from './stores';

export function App(): ReactNode {
  // F118 S2: feature stores are module singletons that outlive SessionGate —
  // clear them when the session ends so the previous user's catalog/projects
  // never sit in memory behind the login screen.
  const appSession = useWorkspaceStore((s) => s.session);
  const logout = useWorkspaceStore((s) => s.logout);

  useEffect(() => {
    if (appSession === null) {
      resetCatalogStore();
      resetProjectStore();
      resetPurchasingStore();
    }
  }, [appSession]);

  return (
    <>
      {appSession != null ? (
        <SessionGate>
          <AppContent session={appSession} onLogout={logout} />
        </SessionGate>
      ) : (
        <SessionGate>
          <span />
        </SessionGate>
      )}
      <ToastViewport />
    </>
  );
}
