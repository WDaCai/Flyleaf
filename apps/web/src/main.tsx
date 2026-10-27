import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@yan/ui/tokens.css';
import './styles.css';
import { App } from './App';
import { createHttpClient } from '@yan/core/client';

const client = createHttpClient();

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');

createRoot(root).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
