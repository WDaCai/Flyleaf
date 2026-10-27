import type { YanClient, YanEvent } from '../contracts';

/** preload 通过 contextBridge 暴露的最小桥 */
export interface IpcBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}

export const IPC_INVOKE = 'flyleaf:invoke';
export const IPC_EVENT = 'flyleaf:event';

export function createIpcClient(bridge: IpcBridge): YanClient {
  const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
    bridge.invoke(IPC_INVOKE, { method, args }) as Promise<T>;

  return {
    vault: {
      open: (root) => call('vault.open', root),
      info: () => call('vault.info'),
      tree: () => call('vault.tree'),
      recent: (limit) => call('vault.recent', limit),
      listFolders: () => call('vault.listFolders'),
      createFolder: (input) => call('vault.createFolder', input),
      renameFolder: (input) => call('vault.renameFolder', input),
      deleteFolder: (input) => call('vault.deleteFolder', input),
      setInbox: (path) => call('vault.setInbox', path),
    },
    notes: {
      read: (path) => call('notes.read', path),
      write: (path, body, frontmatter, expectMtimeMs) =>
        call('notes.write', path, body, frontmatter, expectMtimeMs),
      create: (input) => call('notes.create', input),
      rename: async (from, to) => {
        await call('notes.rename', from, to);
      },
      delete: (input) => call('notes.delete', typeof input === 'string' ? { path: input } : input),
      listTrash: (limit) => call('notes.listTrash', limit),
      clearTrash: () => call('notes.clearTrash'),
      restore: (input) => call('notes.restore', typeof input === 'string' ? { path: input } : input),
      backlinks: (path) => call('notes.backlinks', path),
    },
    search: {
      query: (q) => call('search.query', q),
    },
    framework: {
      tree: (path) => call('framework.tree', path),
      setState: (path, line, state) => call('framework.setState', path, line, state),
      expandNode: (path, line) => call('framework.expandNode', path, line),
      addNode: (path, opts) => call('framework.addNode', path, opts),
      renameNode: (path, line, text) => call('framework.renameNode', path, line, text),
      removeNode: (path, line, opts) => call('framework.removeNode', path, line, opts),
      shiftNode: (path, line, delta) => call('framework.shiftNode', path, line, delta),
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
