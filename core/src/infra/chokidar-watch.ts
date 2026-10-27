import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { toPosix } from '../domain/paths';
import type { WatchAdapter } from '../ports';

const IGNORED = /(^|[\\/])(\.git|\.yan|\.obsidian|node_modules|dist|dist-electron)([\\/]|$)/;

export class ChokidarWatch implements WatchAdapter {
  private watcher: FSWatcher | null = null;

  constructor(private readonly root: string) {}

  async start(onChange: (paths: string[]) => void): Promise<void> {
    if (this.watcher) return;
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | null = null;

    this.watcher = watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => IGNORED.test(p),
      awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 60 },
    });

    this.watcher.on('all', (_event, changed) => {
      const rel = toPosix(path.relative(this.root, changed));
      if (!rel) return;
      if (!rel.endsWith('.md') && !rel.startsWith('assets/')) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = [...pending];
        pending.clear();
        onChange(batch);
      }, 120);
    });

    await new Promise<void>((resolve) => {
      this.watcher?.once('ready', () => resolve());
      setTimeout(resolve, 1500);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
