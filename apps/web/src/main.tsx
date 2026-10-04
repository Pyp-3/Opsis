import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyLook, fallbackLook } from './workspace/canvas-theme';
import { applyAppTheme, readAppTheme } from './workspace/app-theme';

// Apply the viewer's chosen colour scheme and fonts before the first paint, to avoid a flash.
applyAppTheme(readAppTheme());
// Paint the canvas tokens before the first paint; the open canvas then applies its own.
applyLook(fallbackLook());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
