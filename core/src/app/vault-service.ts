import type {
  CreateFolderInput,
  DeleteFolderInput,
  FileNode,
  FoldersConfig,
  NoteSummary,
  RenameFolderInput,
  VaultInfo,
} from '../contracts';
import { BadRequestError } from '../errors';
import {
  FOLDERS_FILE,
  SYSTEM_ENSURE_DIRS,
  normalizeFolderPath,
  normalizeFoldersConfig,
  seedFromExisting,
  canDeleteFolder,
  folderIsUnder,
  foldersAfterDelete,
  pickNextInbox,
  planFolderRename,
  retargetFolderPath,
  validateFolderPath,
} from '../domain/folders';
import { basename, dirname } from '../domain/paths';
import type { EventBus } from './event-bus';
import type { IndexProvider, NoteRepo } from '../ports';

export class VaultService {
  private folders: FoldersConfig | null = null;

  constructor(
    private readonly root: string,
    private readonly repo: NoteRepo,
    private readonly index: IndexProvider,
    private readonly events?: EventBus,
  ) {}

  async info(): Promise<VaultInfo> {
    return {
      root: this.root,
      name: basename(this.root) || this.root,
      noteCount: this.index.size(),
    };
  }

  async tree(): Promise<FileNode[]> {
    const [dirs, files] = await Promise.all([this.repo.listDirs(), this.repo.listMarkdown()]);
    const rootNodes: FileNode[] = [];
    const dirMap = new Map<string, FileNode>();
    const titles = new Map((this.folders?.folders ?? []).map((f) => [f.path, f.title]));

    const ensure = (rel: string): FileNode => {
      const existing = dirMap.get(rel);
      if (existing) return existing;
      const display = titles.get(rel) ?? basename(rel);
      const node: FileNode = { path: rel, name: display, kind: 'dir', children: [] };
      dirMap.set(rel, node);
      const parentRel = dirname(rel);
      if (parentRel) {
        ensure(parentRel).children?.push(node);
      } else {
        rootNodes.push(node);
      }
      return node;
    };

    await this.adoptDirs(dirs);
    for (const d of dirs) ensure(d);

    for (const f of files) {
      const parentRel = dirname(f);
      const node: FileNode = { path: f, name: basename(f), kind: 'file' };
      if (parentRel) ensure(parentRel).children?.push(node);
      else rootNodes.push(node);
    }

    const sort = (nodes: FileNode[]): void => {
      nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });
      for (const n of nodes) if (n.children) sort(n.children);
    };
    sort(rootNodes);
    return rootNodes;
  }

  async recent(limit = 12): Promise<NoteSummary[]> {
    return this.index
      .all()
      .slice()
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map((e) => ({
        path: e.path,
        title: e.title,
        type: e.type,
        tags: e.tags,
        project: e.project,
        mtimeMs: e.mtimeMs,
      }));
  }

  getInbox(): string {
    return this.folders?.inbox ?? '00-inbox';
  }

  /** 打开 vault 时调用：系统目录 + folders.json 种子/ensure */
  async ensureLayout(mkdirp: (dir: string) => Promise<void>, joinRoot: (...parts: string[]) => string): Promise<FoldersConfig> {
    for (const d of SYSTEM_ENSURE_DIRS) {
      await mkdirp(joinRoot(...d.split('/')));
    }

    const existing = await this.tryLoadFoldersFile();
    if (!existing) {
      const top = await this.repo.listTopDirs();
      this.folders = seedFromExisting(top);
      // 首次：缺的默认目录建一次
      for (const f of this.folders.folders) {
        await this.repo.mkdir(f.path);
      }
      // frameworks 下 nodes 兼容旧结构
      await this.repo.mkdir('50-frameworks/nodes').catch(() => undefined);
      await this.saveFoldersFile(this.folders);
    } else {
      this.folders = existing;
      for (const f of this.folders.folders) {
        await this.repo.mkdir(f.path);
      }
    }
    return this.snapshot();
  }

  async listFolders(): Promise<FoldersConfig> {
    if (!this.folders) {
      this.folders = (await this.tryLoadFoldersFile()) ?? normalizeFoldersConfig(null);
    }
    return this.snapshot();
  }

  async createFolder(input: CreateFolderInput): Promise<FoldersConfig> {
    const cfg = await this.listFolders();
    const err = validateFolderPath(input.path);
    if (err) throw new BadRequestError(err);
    const p = normalizeFolderPath(input.path)!;
    if (cfg.folders.some((f) => f.path === p)) throw new BadRequestError(`文件夹已存在：${p}`);
    const title = (input.title?.trim() || p.split('/').pop() || p).trim();
    await this.repo.mkdir(p);
    cfg.folders.push({ path: p, title });
    this.folders = cfg;
    await this.saveFoldersFile(cfg);
    this.emitChanged([p]);
    return this.snapshot();
  }

  async renameFolder(input: RenameFolderInput): Promise<FoldersConfig> {
    const cfg = await this.listFolders();
    const fromErr = validateFolderPath(input.from);
    if (fromErr) throw new BadRequestError(fromErr);
    const toErr = validateFolderPath(input.to);
    if (toErr) throw new BadRequestError(toErr);
    const from = normalizeFolderPath(input.from)!;
    const to = normalizeFolderPath(input.to)!;
    if (!cfg.folders.some((f) => f.path === from)) throw new BadRequestError(`文件夹不在清单中：${from}`);
    const planned = planFolderRename(cfg.folders, from, to, input.title);
    if (!planned.ok) throw new BadRequestError(planned.reason);
    if (from !== to) {
      if (await this.repo.dirExists(to)) throw new BadRequestError(`磁盘上已有目录：${to}`);
      if (await this.repo.dirExists(from)) {
        // 整棵目录一起搬走，磁盘上的子文件夹跟着走
        await this.repo.renameDir(from, to);
      }
      for (const f of planned.folders) {
        if (folderIsUnder(f.path, to)) await this.repo.mkdir(f.path);
      }
    }
    cfg.folders = planned.folders;
    cfg.inbox = retargetFolderPath(cfg.inbox, from, to);
    this.folders = cfg;
    await this.saveFoldersFile(cfg);
    this.emitChanged([from, to]);
    return this.snapshot();
  }

  async deleteFolder(input: DeleteFolderInput): Promise<FoldersConfig> {
    const cfg = await this.listFolders();
    const err = validateFolderPath(input.path);
    if (err) throw new BadRequestError(err);
    const p = normalizeFolderPath(input.path)!;
    if (!cfg.folders.some((f) => f.path === p)) throw new BadRequestError(`文件夹不在清单中：${p}`);
    const mode = input.mode ?? 'refuse-if-not-empty';
    const exists = await this.repo.dirExists(p);
    const empty = exists ? await this.repo.isDirEmpty(p) : true;

    // 删当前 inbox，或删掉包着 inbox 的父文件夹：有其他分类则自动迁收件箱
    let migratedInbox: string | null = null;
    if (folderIsUnder(cfg.inbox, p)) {
      const next = pickNextInbox(cfg, p);
      if (!next) {
        throw new BadRequestError(
          '这是当前唯一的分类文件夹，不能删除收件箱。请先新建另一个文件夹，在「管理文件夹」里点「设为收件箱」，再回来删除本文件夹。',
        );
      }
      cfg.inbox = next;
      migratedInbox = next;
    }

    const gate = canDeleteFolder({
      path: p,
      isInbox: false,
      isEmpty: empty,
      mode,
    });
    if (!gate.ok) throw new BadRequestError(gate.reason);
    if (exists) {
      await this.repo.rmdir(p, { recursive: mode === 'delete-recursive' || empty });
    }
    cfg.folders = foldersAfterDelete(cfg.folders, p);
    this.folders = cfg;
    await this.saveFoldersFile(cfg);
    this.emitChanged(migratedInbox ? [p, migratedInbox] : [p]);
    return this.snapshot();
  }

  async setInbox(path: string): Promise<FoldersConfig> {
    const cfg = await this.listFolders();
    const err = validateFolderPath(path);
    if (err) throw new BadRequestError(err);
    const p = normalizeFolderPath(path)!;
    if (!cfg.folders.some((f) => f.path === p)) {
      throw new BadRequestError(`inbox 必须是已有文件夹：${p}`);
    }
    cfg.inbox = p;
    this.folders = cfg;
    await this.saveFoldersFile(cfg);
    this.emitChanged([p]);
    return this.snapshot();
  }

  /** 磁盘上已有、清单里还没有的目录补进清单，这样子文件夹能被重命名、删除和移动。 */
  private async adoptDirs(dirs: string[]): Promise<void> {
    const cfg = await this.listFolders();
    let changed = false;
    for (const d of dirs) {
      if (validateFolderPath(d)) continue;
      if (cfg.folders.some((f) => f.path === d)) continue;
      cfg.folders.push({ path: d, title: basename(d) });
      changed = true;
    }
    if (!changed) return;
    this.folders = cfg;
    await this.saveFoldersFile(cfg);
  }

  private snapshot(): FoldersConfig {
    const f = this.folders ?? normalizeFoldersConfig(null);
    return {
      version: 1,
      inbox: f.inbox,
      folders: f.folders.map((x) => ({ ...x })),
    };
  }

  private async tryLoadFoldersFile(): Promise<FoldersConfig | null> {
    try {
      const raw = await this.repo.read(FOLDERS_FILE);
      return normalizeFoldersConfig(JSON.parse(raw.raw) as unknown);
    } catch {
      return null;
    }
  }

  private async saveFoldersFile(cfg: FoldersConfig): Promise<void> {
    const body = `${JSON.stringify({ version: 1, inbox: cfg.inbox, folders: cfg.folders }, null, 2)}\n`;
    await this.repo.write(FOLDERS_FILE, body);
  }

  private emitChanged(paths: string[]): void {
    this.events?.emit({ type: 'vault:changed', paths });
  }
}
