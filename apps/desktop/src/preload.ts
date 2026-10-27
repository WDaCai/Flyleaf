import { contextBridge, ipcRenderer } from 'electron';

const IPC_INVOKE = 'yan:invoke';
const IPC_EVENT = 'yan:event';

contextBridge.exposeInMainWorld('yan', {
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
