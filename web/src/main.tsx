import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

// The site shows the boot screen once per browser session (?skipboot skips it). Tests render <App />
// without it.
createRoot(root).render(
  <StrictMode>
    <App boot />
  </StrictMode>,
);