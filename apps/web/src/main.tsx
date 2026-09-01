import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from '@granete/ui';
import { migrateLegacyStorageKeys } from '@granete/storage';
import '@granete/ui/design-system/tokens.css';
import '@granete/ui/design-system/reset.css';
import '@granete/ui/common/buttons.css';
import '@granete/ui/common/workspaceChrome.css';
import '@granete/ui/common/catalogImage.css';
import '@granete/ui/common/surfaceCard.css';
import '@granete/ui/common/dataTable.css';
import '@granete/ui/common/pageHeader.css';
import '@granete/ui/common/tabs.css';
import '@granete/ui/common/entityCard.css';
import '@granete/ui/common/engineeringDetail.css';
import { App } from './App';
import { ServerStateProvider } from './app/providers/ServerStateProvider';
import { installAuth401Interceptor } from './auth401';
import { installCrossTabRefresh } from './crossTabSync';
import { tenantTransition } from './shared/query/tenantTransition';
import { useWorkspaceStore } from './stores/workspaceStore';
import { clearCredential, getAccessToken } from './webAuthRuntime';
import { coordinatedWebRefresh } from './webAuthClient';
import { subscribeToWebSessionEvents } from './webSessionChannel';
import './app.css';

// #366 + #460 SEC-4B: primero destruye bearers legacy (`granete_token`,
// `muebles_token` → DELETE, NEVER SEND) y migra las claves guest.
migrateLegacyStorageKeys();

// P0-1 (pre-demo audit): 401 en endpoints de negocio fuera del boundary
// autenticado ⇒ UN refresh coordinado; si es terminal, cierre de sesión con
// motivo. Nunca lee storage de credenciales (SEC-4B).
installAuth401Interceptor(
  () => useWorkspaceStore.getState().markSessionEnded('expired'),
  {
    readToken: () => getAccessToken(),
    refresh: () => coordinatedWebRefresh(),
  },
);

// #460 SEC-4B cross-tab: las demás pestañas resuelven su estado desde la
// cookie compartida (bootstrap), nunca copiando tokens por BroadcastChannel.
// session-replaced / session-ended / scope-changed ⇒ purge + reload con boot
// autoritativo; refresh-completed no recarga nada (rotación normal).
subscribeToWebSessionEvents((event) => {
  if (event.type === 'refresh-completed' || event.type === 'lock-released') return;
  clearCredential();
  tenantTransition.commit();
  window.location.reload();
});

// P0-3 (mitigación): otra pestaña mutó el catálogo ⇒ esta pestaña refresca
// del server al volver a ella, en vez de pisar cambios con su copia vieja.
installCrossTabRefresh(async () => {
  const ws = useWorkspaceStore.getState();
  if (ws.session !== 'auth') return;
  await ws.loadWorkspace();
  const after = useWorkspaceStore.getState();
  if (after.session === 'auth' && after.workspaceLoadError) {
    throw new Error(after.workspaceLoadError);
  }
});

// Hook SOLO para el browser gate (#460 SEC-4B proof §58): expone el refresh
// coordinado (lock cross-tab + singleflight) para poder ejercitar la
// serialización real desde dos pestañas. Nunca existe en el bundle de
// producción: import.meta.env.DEV es constante false en el build.
if (import.meta.env.DEV) {
  (window as unknown as { __graneteWebAuthTestRefresh?: () => Promise<{ status: string }> })
    .__graneteWebAuthTestRefresh = () => coordinatedWebRefresh();
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <ServerStateProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </ServerStateProvider>
  </StrictMode>,
);
