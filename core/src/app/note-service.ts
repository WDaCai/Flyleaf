import type { Backlink, CreateNoteInput, DeleteNoteInput, DeleteNoteResult, NoteDoc, NoteSummary, RestoreNoteInput, RestoreNoteResult, TrashItem } from '../contracts';
import { composeDocument } from '../domain/compose';
import { asIsoString, asString, asStringArray, parseFrontmatter } from '../domain/frontmatter';
import { basename, dirname, joinRel, normalizeRel, slugify, stripExt } from '../domain/paths';
import { TRASH_ROOT, originalPathFromTrash } from '../domain/trash';
import { splitDocument } from '../domain/text';
import { parseWikiLinks, resolveTargetName } from '../domain/wikilink';
import { BadRequestError, NotFoundError } from '../errors';
import type { IndexEntry, IndexProvider, NoteRepo, RawNote } from '../ports';
import type { EventBus } from './event-bus';
import { DEFAULT_DIRS, DEFAULT_TEMPLATES } from './templates';

export interface NoteServiceDeps {
  repo: NoteRepo;
  index: IndexProvider;
  events: EventBus;
  now: () => Date;
  defaults: () => { project: string; engine: string; platform: string };
}

export class NoteService {
  private readonly repo: NoteRepo;
  private readonly index: IndexProvider;
  private readonly events: EventBus;
  private readonly now: () => Date;
  private readonly defaults: NoteServiceDeps['defaults'];

  constructor(deps: NoteServiceDeps) {
    this.repo = deps.repo;
    this.index = deps.index;
    this.events = deps.events;
    this.now = deps.now;
    this.defaults = deps.defaults;
  }

  async listAll(): Promise<NoteSummary[]> {
    return this.index.all().map((e) => ({
      path: e.path,
      title: e.title,
      type: e.type,
      tags: e.tags,
      project: e.project,
      mtimeMs: e.mtimeMs,
    }));
  }

  async read(rel: string): Promise<NoteDoc> {
    const raw = await this.repo.read(rel);
    return this.accept(raw);
  }

  async write(
    rel: string,
    body: string,
    fmPatch?: Record<string, unknown>,
    expectMtimeMs?: number,
  ): Promise<NoteDoc> {
    const current = await this.repo.read(rel);
    const split = splitDocument(current.raw);
    const fmChanged = !!fmPatch && Object.keys(fmPatch).length > 0;
    // 内容与元数据都没变时不落盘：避免 mtime 抖动与文件监听回环
    if (body === split.body && !fmChanged) {
      return this.read(rel);
    }
    const fm = { ...parseFrontmatter(split.frontmatterRaw) };
    // 空值视为「删除该字段」，避免写出 project: null 这种噪音
    for (const [k, v] of Object.entries(fmPatch ?? {})) {
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || v === '') {
        delete fm[k];
      } else {
        fm[k] = v;
      }
    }
    fm.updated = this.now().toISOString();
    const composed = composeDocument(split.bom, split.eol, fm, body);
    await this.repo.write(rel, composed, expectMtimeMs);
    const doc = await this.read(rel);
    this.events.emit({ type: 'note:changed', path: rel });
    return doc;
  }

  async create(input: CreateNoteInput): Promise<NoteDoc> {
    const dir = input.dir ?? DEFAULT_DIRS[input.type];
    const slug = slugify(input.title);
    let rel = joinRel(dir, `${slug}.md`);
    let n = 2;
    while (await this.repo.exists(rel)) {
      rel = joinRel(dir, `${slug}-${n}.md`);
      n += 1;
    }

    const d = this.defaults();
    const iso = this.now().toISOString();
    const fm: Record<string, unknown> = {
      type: input.type,
      title: input.title,
      created: iso,
      updated: iso,
    };
    const project = input.project ?? d.project;
    const engine = input.engine ?? d.engine;
    const platform = input.platform ?? d.platform;
    if (project) fm.project = project;
    if (engine) fm.engine = engine;
    if (platform) fm.platform = platform;
    if (input.tags?.length) fm.tags = input.tags;
    if (input.nodes?.length) fm.nodes = input.nodes;

    const body = input.body ?? DEFAULT_TEMPLATES[input.type];
    const composed = composeDocument(false, '\n', fm, body);
    await this.repo.write(rel, composed);
    const doc = await this.read(rel);
    this.events.emit({ type: 'note:changed', path: rel });
    return doc;
  }

  async rename(from: string, to: string): Promise<void> {
    await this.repo.rename(from, to);
    this.index.remove(from);
    try {
      await this.read(to);
    } catch {
      // 索引会在文件监听里补上
    }
  }


  async delete(input: DeleteNoteInput | string): Promise<DeleteNoteResult> {
    const raw = typeof input === 'string' ? { path: input } : input;
    const rel = normalizeRel(raw.path);
    if (!rel) throw new BadRequestError('缺少笔记路径');
    if (!rel.endsWith('.md')) throw new BadRequestError('只能删除 markdown 笔记');
    const mode = raw.mode ?? 'trash';
    if ((rel.startsWith('.yan/') || rel === '.yan') && !(mode === 'hard' && rel.startsWith(`${TRASH_ROOT}/`))) {
      throw new BadRequestError('不可删除系统目录下的文件');
    }
    if (!(await this.repo.exists(rel))) throw new NotFoundError(rel);

    if (mode === 'hard') {
      await this.repo.remove(rel);
      this.index.remove(rel);
      this.events.emit({ type: 'note:changed', path: rel });
      this.events.emit({ type: 'vault:changed', paths: [rel] });
      return { path: rel, mode: 'hard' };
    }

    // 默认进 .yan/trash，保留相对路径，便于恢复
    let dest = joinRel(TRASH_ROOT, rel);
    if (await this.repo.exists(dest)) {
      const stamp = this.now().toISOString().replace(/[:.]/g, '-');
      const dir = dirname(rel);
      const name = `${stripExt(basename(rel))}__${stamp}.md`;
      dest = joinRel(TRASH_ROOT, dir, name);
    }
    await this.repo.rename(rel, dest);
    this.index.remove(rel);
    this.events.emit({ type: 'note:changed', path: rel });
    this.events.emit({ type: 'vault:changed', paths: [rel, dest] });
    return { path: rel, mode: 'trash', trashedTo: dest };
  }

  async clearTrash(): Promise<{ removed: number }> {
    let files: Array<{ path: string; mtimeMs: number }> = [];
    try {
      files = await this.repo.listMarkdownUnder(TRASH_ROOT);
    } catch {
      return { removed: 0 };
    }
    for (const f of files) {
      await this.repo.remove(f.path);
      this.index.remove(f.path);
    }
    if (files.length) {
      this.events.emit({ type: 'vault:changed', paths: files.map((f) => f.path) });
    }
    return { removed: files.length };
  }

  async listTrash(limit = 40): Promise<TrashItem[]> {
    const lim = Math.max(1, Math.min(200, limit));
    let files: Array<{ path: string; mtimeMs: number }> = [];
    try {
      files = await this.repo.listMarkdownUnder(TRASH_ROOT);
    } catch {
      return [];
    }
    const out: TrashItem[] = [];
    for (const f of files.slice(0, lim)) {
      const original = originalPathFromTrash(f.path) ?? basename(f.path);
      out.push({
        path: f.path,
        originalPath: original,
        title: stripExt(basename(original)),
        mtimeMs: f.mtimeMs,
      });
    }
    return out;
  }

  async restore(input: RestoreNoteInput | string): Promise<RestoreNoteResult> {
    const raw = typeof input === 'string' ? { path: input } : input;
    const from = normalizeRel(raw.path);
    if (!from.startsWith(`${TRASH_ROOT}/`)) throw new BadRequestError('只能从回收站还原');
    if (!from.endsWith('.md')) throw new BadRequestError('只能还原 markdown 笔记');
    if (!(await this.repo.exists(from))) throw new NotFoundError(from);

    const inbox = normalizeRel(raw.inbox ?? '00-inbox') || '00-inbox';
    let target: string;
    let usedInboxFallback: boolean;
    const original = originalPathFromTrash(from);
    if (original) {
      const parent = dirname(original);
      if (!parent || (await this.repo.dirExists(parent))) {
        target = original;
        usedInboxFallback = false;
      } else {
        target = joinRel(inbox, basename(original));
        usedInboxFallback = true;
      }
    } else {
      target = joinRel(inbox, basename(from));
      usedInboxFallback = true;
    }

    if (await this.repo.exists(target)) {
      const stamp = this.now().toISOString().replace(/[:.]/g, '-');
      const dir = dirname(target);
      const name = `${stripExt(basename(target))}__restored_${stamp}.md`;
      target = dir ? joinRel(dir, name) : name;
    }

    await this.repo.rename(from, target);
    try {
      await this.read(target);
    } catch {
      // 索引稍后由监听补上
    }
    this.events.emit({ type: 'note:changed', path: target });
    this.events.emit({ type: 'vault:changed', paths: [from, target] });
    return { from, to: target, usedInboxFallback };
  }

  /** 反链：哪些笔记的 wikilink 指向当前文件 */
  async backlinks(rel: string): Promise<Backlink[]> {
    const name = stripExt(basename(rel)).toLowerCase();
    const out: Backlink[] = [];
    for (const entry of this.index.all()) {
      if (entry.path === rel) continue;
      const links = parseWikiLinks(entry.body);
      for (const link of links) {
        if (resolveTargetName(link.target).toLowerCase() !== name) continue;
        const line = this.lineOf(entry.body, link.raw);
        out.push({ path: entry.path, title: entry.title, type: entry.type, line });
        break;
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  }

  /** 全量重建索引 */
  async reindex(): Promise<number> {
    const files = await this.repo.listMarkdown();
    const entries: IndexEntry[] = [];
    for (const rel of files) {
      try {
        const raw = await this.repo.read(rel);
        entries.push(this.toIndex(this.toDoc(raw)));
      } catch {
        // 单个文件坏掉不影响整体索引
      }
    }
    this.index.rebuild(entries);
    return entries.length;
  }

  /** 单文件增量更新索引 */
  async reindexOne(rel: string): Promise<void> {
    try {
      const raw = await this.repo.read(rel);
      this.index.upsert(this.toIndex(this.toDoc(raw)));
    } catch {
      this.index.remove(rel);
    }
  }

  removeFromIndex(rel: string): void {
    this.index.remove(rel);
  }

  private accept(raw: RawNote): NoteDoc {
    const doc = this.toDoc(raw);
    this.index.upsert(this.toIndex(doc));
    return doc;
  }

  private toDoc(raw: RawNote): NoteDoc {
    const split = splitDocument(raw.raw);
    return {
      path: raw.rel,
      frontmatter: parseFrontmatter(split.frontmatterRaw),
      body: split.body,
      eol: split.eol,
      bom: split.bom,
      mtimeMs: raw.mtimeMs,
    };
  }

  private toIndex(doc: NoteDoc): IndexEntry {
    return {
      path: doc.path,
      title: this.titleOf(doc),
      type: asString(doc.frontmatter.type, 'note') || 'note',
      tags: asStringArray(doc.frontmatter.tags),
      project: asString(doc.frontmatter.project),
      nodes: asStringArray(doc.frontmatter.nodes),
      body: doc.body,
      mtimeMs: doc.mtimeMs,
    };
  }

  private titleOf(doc: NoteDoc): string {
    const fmTitle = asString(doc.frontmatter.title).trim();
    if (fmTitle) return fmTitle;
    const heading = /^#\s+(.+)$/m.exec(doc.body);
    if (heading?.[1]) return heading[1].trim();
    return stripExt(basename(doc.path));
  }

  private lineOf(body: string, needle: string): number {
    const i = body.indexOf(needle);
    if (i === -1) return 1;
    return body.slice(0, i).split(/\r?\n/).length;
  }
}

export function noteExists(repo: NoteRepo, rel: string): Promise<boolean> {
  return repo.exists(rel).catch(() => false);
}

export function assertNoteDir(rel: string): string {
  return dirname(rel);
}

export function isoOrEmpty(v: unknown): string {
  return asIsoString(v);
}

export { NotFoundError };
