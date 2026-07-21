import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from '@muebles/ui';
import '@muebles/ui/design-system/tokens.css';
import '@muebles/ui/design-system/reset.css';
import '@muebles/ui/common/buttons.css';
import '@muebles/ui/common/workspaceChrome.css';
import '@muebles/ui/common/catalogImage.css';
import '@muebles/ui/common/surfaceCard.css';
import '@muebles/ui/common/dataTable.css';
import '@muebles/ui/common/pageHeader.css';
import '@muebles/ui/common/entityCard.css';
import { App } from './App';
import './app.css';

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
