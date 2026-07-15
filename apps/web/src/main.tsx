import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@muebles/ui/design-system/tokens.css';
import '@muebles/ui/design-system/reset.css';
import { App } from './App';
import './app.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
