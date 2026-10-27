import type { YanClient, YanEvent } from '../contracts';

/** preload 通过 contextBridge 暴露的最小桥 */
export interface IpcBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}

export const IPC_INVOKE = 'yan:invoke';
export const IPC_EVENT = 'yan:event';

export function createIpcClient(bridge: IpcBridge): YanClient {
  const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
    bridge.invoke(IPC_INVOKE, { method, args }) as Promise<T>;

  return {
    vault: {
      open: (root) => call('vault.open', root),
      info: () => call('vault.info'),
      tree: () => call('vault.tree'),
      recent: (limit) => call('vault.recent', limit),
    },
    notes: {
      read: (path) => call('notes.read', path),
      write: (path, body, frontmatter, expectMtimeMs) =>
        call('notes.write', path, body, frontmatter, expectMtimeMs),
      create: (input) => call('notes.create', input),
      rename: async (from, to) => {
        await call('notes.rename', from, to);
      },
      backlinks: (path) => call('notes.backlinks', path),
    },
    search: {
      query: (q) => call('search.query', q),
    },
    framework: {
      tree: (path) => call('framework.tree', path),
      setState: (path, line, state) => call('framework.setState', path, line, state),
      expandNode: (path, line) => call('framework.expandNode', path, line),
    },
    capture: {
      getDraft: () => call('capture.getDraft'),
      saveDraft: (text) => call('capture.saveDraft', text),
      archive: (text) => call('capture.archive', text),
    },
    assets: {
      saveImage: (dataUrl) => call('assets.saveImage', dataUrl),
    },
    events: {
      subscribe: (fn) => bridge.on(IPC_EVENT, (payload) => fn(payload as YanEvent)),
    },
  };
}
