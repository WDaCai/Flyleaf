import type { FileNode, NoteSummary, VaultInfo } from '../contracts';
import { basename, dirname } from '../domain/paths';
import type { IndexProvider, NoteRepo } from '../ports';

export class VaultService {
  constructor(
    private readonly root: string,
    private readonly repo: NoteRepo,
    private readonly index: IndexProvider,
  ) {}

  async info(): Promise<VaultInfo> {
    return {
      root: this.root,
      name: basename(this.root) || this.root,
      noteCount: this.index.size(),
    };
  }

  async tree(): Promise<FileNode[]> {    const [dirs, files] = await Promise.all([this.repo.listDirs(), this.repo.listMarkdown()]);
    const rootNodes: FileNode[] = [];
    const dirMap = new Map<string, FileNode>();

    const ensure = (rel: string): FileNode => {
      const existing = dirMap.get(rel);
      if (existing) return existing;
      const node: FileNode = { path: rel, name: basename(rel), kind: 'dir', children: [] };
      dirMap.set(rel, node);
      const parentRel = dirname(rel);
      if (parentRel) {
        ensure(parentRel).children?.push(node);
      } else {
        rootNodes.push(node);
      }
      return node;
    };

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
}
