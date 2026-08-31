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
import { installSessionSync } from './sessionSync';
import { tenantTransition } from './shared/query/tenantTransition';
import { useWorkspaceStore } from './stores/workspaceStore';
import './app.css';

// #366 — claves legacy muebles_* → granete_* antes de que nada lea storage.
migrateLegacyStorageKeys();

// P0-1 (pre-demo audit): 401 en endpoints de negocio ⇒ logout con el mensaje
// de sesión expirada, nunca el toast engañoso "Error de conexión".
installAuth401Interceptor(() => useWorkspaceStore.getState().markSessionExpired());

installSessionSync(() => {
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
