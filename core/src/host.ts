import type { YanClient } from './contracts';
import { createCore, type Core } from './core';
import { EventBus } from './app/event-bus';

/**
 * 持有"当前 vault"的核心实例，并把它包装成 YanClient。
 * 两个壳（HTTP / IPC）都直接调这里，保证行为一致。
 */
export class CoreHost {
  private core: Core | null = null;
  private readonly bus = new EventBus();
  readonly client: YanClient;

  constructor(private readonly opts: { configFile?: string } = {}) {
    this.client = this.buildClient();
  }

  get isOpen(): boolean {
    return this.core !== null;
  }

  get current(): Core {
    if (!this.core) throw new Error('尚未打开 vault');
    return this.core;
  }

  async open(root: string): Promise<Awaited<ReturnType<Core['vault']['info']>>> {
    await this.close();
    const core = await createCore({ root, configFile: this.opts.configFile });
    core.events.subscribe((e) => this.bus.emit(e));
    this.core = core;
    return core.vault.info();
  }

  async close(): Promise<void> {
    if (!this.core) return;
    await this.core.close();
    this.core = null;
  }

  private buildClient(): YanClient {
    const c = (): Core => this.current;
    return {
      vault: {
        open: (root) => this.open(root),
        info: () => c().vault.info(),
        tree: () => c().vault.tree(),
        recent: (limit) => c().vault.recent(limit),
        listFolders: () => c().vault.listFolders(),
        createFolder: (input) => c().vault.createFolder(input),
        renameFolder: (input) => c().vault.renameFolder(input),
        deleteFolder: (input) => c().vault.deleteFolder(input),
        setInbox: (path) => c().vault.setInbox(path),
      },
      notes: {
        read: (p) => c().notes.read(p),
        write: (p, body, fm, mtime) => c().notes.write(p, body, fm, mtime),
        create: (input) => c().notes.create(input),
        rename: (from, to) => c().notes.rename(from, to),
        delete: (input) => c().notes.delete(input),
        listTrash: (limit) => c().notes.listTrash(limit),
        clearTrash: () => c().notes.clearTrash(),
        restore: (input) => c().notes.restore(input),
        backlinks: (p) => c().notes.backlinks(p),
      },
      search: {
        query: (q) => c().search.query(q),
      },
      framework: {
        tree: (p) => c().framework.tree(p),
        setState: (p, line, state) => c().framework.setState(p, line, state),
        expandNode: (p, line) => c().framework.expandNode(p, line),
      },
      capture: {
        getDraft: () => c().capture.getDraft(),
        saveDraft: (text) => c().capture.saveDraft(text),
        archive: (text) => c().capture.archive(text),
      },
      assets: {
        saveImage: (dataUrl) => c().assets.saveImage(dataUrl),
      },
      events: {
        subscribe: (fn) => this.bus.subscribe(fn),
      },
    };
  }
}
