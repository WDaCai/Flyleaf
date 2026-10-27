import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppConfig } from './contracts';
import { AssetService } from './app/asset-service';
import { CaptureService } from './app/capture-service';
import { EventBus } from './app/event-bus';
import { FrameworkService } from './app/framework-service';
import { NoteService } from './app/note-service';
import { SearchService } from './app/search-service';
import { VAULT_VERSION } from './app/templates';
import { VaultService } from './app/vault-service';
import { ChokidarWatch } from './infra/chokidar-watch';
import { DailyInboxSink } from './infra/daily-inbox-sink';
import { FsAssetStore } from './infra/fs-asset-store';
import { FsNoteRepo } from './infra/fs-note-repo';
import { JsonConfigRepo } from './infra/json-config';
import { MemoryIndex } from './infra/memory-index';
import type { ConfigRepo, IndexProvider } from './ports';

export interface CoreOptions {
  root: string;
  configFile?: string;
}

export interface Core {
  root: string;
  config: AppConfig;
  configRepo: ConfigRepo;
  repo: FsNoteRepo;
  index: IndexProvider;
  events: EventBus;
  vault: VaultService;
  notes: NoteService;
  search: SearchService;
  framework: FrameworkService;
  capture: CaptureService;
  assets: AssetService;
  close(): Promise<void>;
}

/** Windows 上新建目录常被杀毒软件短暂占用，第一次 mkdir 会返回 EPERM */
async function mkdirp(dir: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      await fs.mkdir(dir, { recursive: true });
      return;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw err;
      last = err;
      await delay(50 * (i + 1));
    }
  }
  throw last;
}

export async function createCore(opts: CoreOptions): Promise<Core> {
  const root = path.resolve(opts.root);
  await mkdirp(root);

  // `.yan`：历史目录名，兼容保留（不改为 .flyleaf）
  const configFile = opts.configFile ?? path.join(root, '.yan', 'config.json');
  const configRepo = new JsonConfigRepo(configFile);
  const index = new MemoryIndex();
  const repo = new FsNoteRepo(root);
  const events = new EventBus();
  const vault = new VaultService(root, repo, index, events);

  // 系统目录 + folders.json（不再每次把用户删掉的分类 mkdir 回来）
  await vault.ensureLayout(mkdirp, (...parts: string[]) => path.join(root, ...parts));

  const versionFile = path.join(root, '.yan', 'version');
  try {
    await fs.access(versionFile);
  } catch {
    await fs.writeFile(versionFile, `${VAULT_VERSION}\n`, 'utf8');
  }

  const config = await configRepo.load();
  if (config.vaultPath !== root) {
    config.vaultPath = root;
    await configRepo.save(config);
  }

  const notes = new NoteService({
    repo,
    index,
    events,
    now: () => new Date(),
    defaults: () => config.defaults,
  });

  await notes.reindex();

  const framework = new FrameworkService(repo, index, notes, events, () => new Date());
  const search = new SearchService(index);
  const capture = new CaptureService(new DailyInboxSink(repo, () => vault.getInbox()), repo, events, () => new Date());
  const assets = new AssetService(new FsAssetStore(root), () => new Date());

  const watcher = new ChokidarWatch(root);
  let disposed = false;
  await watcher.start((paths) => {
    if (disposed) return;
    void (async () => {
      for (const p of paths) {
        if (p.endsWith('.md')) await notes.reindexOne(p);
      }
      events.emit({ type: 'vault:changed', paths });
    })();
  });

  events.emit({ type: 'index:ready', count: index.size() });

  return {
    root,
    config,
    configRepo,
    repo,
    index,
    events,
    vault,
    notes,
    search,
    framework,
    capture,
    assets,
    async close(): Promise<void> {
      disposed = true;
      await watcher.stop();
    },
  };
}
