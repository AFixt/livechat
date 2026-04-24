import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { initI18n } from './i18n/index.js';

initI18n();

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('Root element not found');
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
