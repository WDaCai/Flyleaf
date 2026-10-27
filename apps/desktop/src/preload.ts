import { contextBridge, ipcRenderer } from 'electron';

const IPC_INVOKE = 'flyleaf:invoke';
const IPC_EVENT = 'flyleaf:event';

contextBridge.exposeInMainWorld('flyleaf', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload),
  on: (channel: string, cb: (payload: unknown) => void): (() => void) => {
    const handler = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.off(channel, handler);
    };
  },
  invokeChannel: IPC_INVOKE,
  eventChannel: IPC_EVENT,
});
