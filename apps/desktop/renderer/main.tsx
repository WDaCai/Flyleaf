import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@yan/ui/tokens.css';
import '../../web/src/styles.css';
import { App } from '../../web/src/App';
import { createIpcClient, type IpcBridge } from '@yan/core/client';

interface YanBridge extends IpcBridge {
  invokeChannel: string;
  eventChannel: string;
}

const bridge = (window as unknown as { yan: YanBridge }).yan;
const client = createIpcClient(bridge);

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');

createRoot(root).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
