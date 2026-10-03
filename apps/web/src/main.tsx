import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyLook, fallbackLook } from './workspace/canvas-theme';

// Paint the canvas tokens before the first paint; the open canvas then applies its own.
applyLook(fallbackLook());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
