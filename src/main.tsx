import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/stage.css';
import './styles/book.css';
import './styles/toolbar.css';
import './styles/thumbnails.css';
import './styles/dropzone.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);