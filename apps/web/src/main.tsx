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
import './app.css';

// #366 — claves legacy muebles_* → granete_* antes de que nada lea storage.
migrateLegacyStorageKeys();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
