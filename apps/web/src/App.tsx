/**
 * Thin web shell — composition root (F121): session gate + toast viewport +
 * AppContent. Cost formulas only via the domain engine; the render lives in
 * ShellView, orchestration in AppContent.
 */

import type { ReactNode } from 'react';
import { clearRegisteredDraftSessions, registerDraftSessionScope } from '@granete/ui';

import { SessionGate } from './SessionGate';
import { ToastViewport } from './components/ToastViewport';
import { AppContent } from './AppContent';
import {
  useWorkspaceStore,
  resetCatalogStore,
  resetProjectStore,
  resetPurchasingStore,
} from './stores';
import {
  registerTenantCommitCleanup,
  registerTenantMemoryReset,
} from './shared/query/tenantTransition';

registerTenantMemoryReset(() => {
  resetCatalogStore();
  resetProjectStore();
  resetPurchasingStore();
});
registerTenantCommitCleanup(clearRegisteredDraftSessions);
registerDraftSessionScope(() => {
  const state = useWorkspaceStore.getState();
  return state.sessionScope
    ? `${state.sessionScope.sessionGeneration}:${state.sessionScope.organizationId ?? 'platform'}`
    : state.session ?? 'anonymous';
});

export function App(): ReactNode {
  const appSession = useWorkspaceStore((s) => s.session);
  const logout = useWorkspaceStore((s) => s.logout);

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
