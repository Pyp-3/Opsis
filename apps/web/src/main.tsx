import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { canvasLook } from './workspace/canvas-theme';

// Apply the viewer's canvas colours before the first paint.
canvasLook();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
