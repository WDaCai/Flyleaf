import type { FrameworkTree, Mastery, NavTarget, NoteDoc } from '../contracts';
import { composeDocument } from '../domain/compose';
import { parseFrontmatter, asString } from '../domain/frontmatter';
import { basename, joinRel, slugify, stripExt } from '../domain/paths';
import { replaceStateMarker } from '../domain/state';
import { splitDocument } from '../domain/text';
import { parseOutline } from '../domain/outline';
import { buildTree, flattenTree, findNodeByLine } from '../domain/tree';
import {
  canvasDocForSave,
  canvasPathForFramework,
  DRAWIO_XML_MAX,
  emptyDrawioDoc,
  isDrawioXml,
  isScratchCanvasPath,
  parseCanvasJson,
  scratchPathForId,
  serializeCanvasDoc,
  SCRATCH_DIR,
  type FrameworkCanvasDoc,
  type CanvasLoadResult,
} from '../domain/canvas';
import type { ScratchCanvasSummary } from '../contracts';
import { resolveTargetName } from '../domain/wikilink';
import { BadRequestError, NotFoundError } from '../errors';
import type { IndexProvider, NoteRepo } from '../ports';
import type { EventBus } from './event-bus';
import type { NoteService } from './note-service';

const NODE_DIR = '50-frameworks/nodes';
const LIST_PREFIX = /^(\s*)([-*+]|\d+[.)])\s+/;
const HEADING_LINE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export class FrameworkService {
  constructor(
    private readonly repo: NoteRepo,
    private readonly index: IndexProvider,
    private readonly notes: NoteService,
    private readonly events: EventBus,
    private readonly now: () => Date,
  ) {}

  async tree(rel: string): Promise<FrameworkTree> {
    const raw = await this.repo.read(rel);
    const split = splitDocument(raw.raw);
    const fm = parseFrontmatter(split.frontmatterRaw);
    const title = asString(fm.title).trim() || stripExt(basename(rel));
    const nodes = parseOutline(split.body, split.bodyStartLine);
    return buildTree({
      path: rel,
      title,
      nodes,
      resolveLink: (target) => this.resolveLink(target, rel),
      linkedCount: (text) => this.linkedCount(text),
    });
  }

  async setState(rel: string, line: number, state: Mastery): Promise<FrameworkTree> {
    const raw = await this.repo.read(rel);
    const lines = raw.raw.split(/\r?\n/);
    const idx = line - 1;
    if (idx < 0 || idx >= lines.length) throw new BadRequestError(`行号越界：${line}`);
    const current = lines[idx] ?? '';
    const next = replaceStateMarker(current, state);
    if (next === current) return this.tree(rel);
    lines[idx] = next;
    const eol = splitDocument(raw.raw).eol;
    await this.repo.write(rel, lines.join(eol));
    this.events.emit({ type: 'note:changed', path: rel });
    return this.tree(rel);
  }

  async expandNode(rel: string, line: number): Promise<{ doc: NoteDoc; tree: FrameworkTree }> {
    const tree = await this.tree(rel);
    const node = findInTree(tree, line);
    if (!node) throw new NotFoundError(`${rel}:${line}`);
    if (node.target?.kind === 'file') {
      return { doc: await this.notes.read(node.target.path), tree };
    }

    const raw = await this.repo.read(rel);
    const lines = raw.raw.split(/\r?\n/);
    const idx = line - 1;
    if (idx < 0 || idx >= lines.length) throw new BadRequestError(`行号越界：${line}`);

    const name = slugify(node.text);
    let nodeRel = joinRel(NODE_DIR, `${name}.md`);
    let n = 2;
    while (await this.repo.exists(nodeRel)) {
      nodeRel = joinRel(NODE_DIR, `${name}-${n}.md`);
      n += 1;
    }

    const iso = this.now().toISOString();
    const fm: Record<string, unknown> = {
      type: 'knowledge',
      title: node.text,
      framework: rel,
      created: iso,
      updated: iso,
    };
    await this.repo.write(nodeRel, composeDocument(false, '\n', fm, `# ${node.text}\n\n`));
    // 立刻进索引，否则紧随其后的 tree() 解析不到这个新文件
    await this.notes.reindexOne(nodeRel);

    lines[idx] = `${(lines[idx] ?? '').trimEnd()} [[${stripExt(basename(nodeRel))}]]`;
    const eol = splitDocument(raw.raw).eol;
    await this.repo.write(rel, lines.join(eol));

    const [doc, nextTree] = await Promise.all([this.notes.read(nodeRel), this.tree(rel)]);
    this.events.emit({ type: 'note:changed', path: rel });
    return { doc, tree: nextTree };
  }

  /** 在锚点后新增列表节点；asChild=true 时作为子节点，否则作为同级（插在子树之后） */
  async addNode(
    rel: string,
    opts: { afterLine?: number | null; text: string; asChild?: boolean },
  ): Promise<FrameworkTree> {
    const text = (opts.text ?? '').trim() || '新节点';
    const raw = await this.repo.read(rel);
    const eol = splitDocument(raw.raw).eol;
    const lines = raw.raw.split(/\r?\n/);
    const asChild = opts.asChild !== false;

    if (!opts.afterLine) {
      lines.push(`- [ ] ${text}`);
      await this.repo.write(rel, lines.join(eol));
      this.events.emit({ type: 'note:changed', path: rel });
      return this.tree(rel);
    }

    const tree = await this.tree(rel);
    const flat = flattenTree(tree.root).filter((n) => n.line > 0);
    const startFlat = flat.findIndex((n) => n.line === opts.afterLine);
    if (startFlat < 0) throw new NotFoundError(`${rel}:${opts.afterLine}`);
    const anchor = flat[startFlat]!;
    const anchorIdx = opts.afterLine - 1;
    const anchorLine = lines[anchorIdx] ?? '';
    const listMatch = LIST_PREFIX.exec(anchorLine);
    const heading = HEADING_LINE.exec(anchorLine);

    let indent = '';
    if (listMatch) {
      const base = listMatch[1] ?? '';
      indent = asChild ? `${base}  ` : base;
    } else if (heading) {
      indent = asChild ? '' : '';
    }

    let lastLine = anchor.line;
    const depthLimit = asChild ? anchor.depth : anchor.depth;
    for (let i = startFlat + 1; i < flat.length; i++) {
      const n = flat[i]!;
      if (n.depth <= depthLimit) break;
      lastLine = n.line;
    }
    // 同级：插在整棵子树后；子级：同样插在子树末（成为最后一个孩子）
    const insertAt = lastLine; // 1-based → splice index

    let newLine: string;
    if (heading && !asChild) {
      newLine = `${heading[1]} ${text}`;
    } else {
      newLine = `${indent}- [ ] ${text}`;
    }
    lines.splice(insertAt, 0, newLine);
    await this.repo.write(rel, lines.join(eol));
    this.events.emit({ type: 'note:changed', path: rel });
    return this.tree(rel);
  }

  /** 重命名节点文本；保留状态标记与行尾 wikilink */
  async renameNode(rel: string, line: number, text: string): Promise<FrameworkTree> {
    const nextText = text.trim();
    if (!nextText) throw new BadRequestError('标题不能为空');
    const raw = await this.repo.read(rel);
    const eol = splitDocument(raw.raw).eol;
    const lines = raw.raw.split(/\r?\n/);
    const idx = line - 1;
    if (idx < 0 || idx >= lines.length) throw new BadRequestError(`行号越界：${line}`);
    const cur = lines[idx] ?? '';
    const heading = HEADING_LINE.exec(cur);
    if (heading) {
      lines[idx] = `${heading[1]} ${nextText}`;
    } else {
      const listMatch = LIST_PREFIX.exec(cur);
      if (!listMatch) throw new BadRequestError('该行不是框架节点');
      const prefix = listMatch[0];
      const rest = cur.slice(prefix.length);
      const state = rest.match(/^(\[[ xX~*]\])\s*/);
      const afterState = state ? rest.slice(state[0].length) : rest;
      const wiki = afterState.match(/\[\[[^[\]\n]*\]\]/g);
      const wikiSuffix = wiki && wiki.length ? ` ${wiki.join(' ')}` : '';
      const marker = state ? `${state[1]} ` : '';
      lines[idx] = `${prefix}${marker}${nextText}${wikiSuffix}`;
    }
    await this.repo.write(rel, lines.join(eol));
    this.events.emit({ type: 'note:changed', path: rel });
    return this.tree(rel);
  }

  /**
   * 删除节点及其子树。
   * 若子树内节点挂了独立笔记文件，按 trashLinked 移入回收站（默认 true）。
   */
  async removeNode(
    rel: string,
    line: number,
    opts?: { trashLinked?: boolean },
  ): Promise<{ tree: FrameworkTree; trashed: string[] }> {
    const trashLinked = opts?.trashLinked !== false;
    const tree = await this.tree(rel);
    const flat = flattenTree(tree.root).filter((n) => n.line > 0);
    const startFlat = flat.findIndex((n) => n.line === line);
    if (startFlat < 0) throw new NotFoundError(`${rel}:${line}`);
    const anchor = flat[startFlat]!;
    const toRemove = new Set<number>([anchor.line]);
    for (let i = startFlat + 1; i < flat.length; i++) {
      const n = flat[i]!;
      if (n.depth <= anchor.depth) break;
      toRemove.add(n.line);
    }

    const trashed: string[] = [];
    if (trashLinked) {
      for (const n of flat) {
        if (!toRemove.has(n.line)) continue;
        if (n.target?.kind === 'file' && n.target.path !== rel) {
          try {
            await this.notes.delete({ path: n.target.path, mode: 'trash' });
            trashed.push(n.target.path);
          } catch {
            /* 文件可能已不存在，仍继续删行 */
          }
        }
      }
    }

    const raw = await this.repo.read(rel);
    const eol = splitDocument(raw.raw).eol;
    const lines = raw.raw.split(/\r?\n/);
    const nextLines = lines.filter((_, i) => !toRemove.has(i + 1));
    await this.repo.write(rel, nextLines.join(eol));
    this.events.emit({ type: 'note:changed', path: rel });
    return { tree: await this.tree(rel), trashed };
  }

  /** 缩进/反缩进节点及其子树；delta=+1 加深，-1 变浅 */
  async shiftNode(rel: string, line: number, delta: -1 | 1): Promise<FrameworkTree> {
    const tree = await this.tree(rel);
    const flat = flattenTree(tree.root).filter((n) => n.line > 0);
    const startFlat = flat.findIndex((n) => n.line === line);
    if (startFlat < 0) throw new NotFoundError(`${rel}:${line}`);
    const anchor = flat[startFlat]!;
    if (anchor.depth + delta < 0) return tree;

    const linesToShift = new Set<number>([anchor.line]);
    for (let i = startFlat + 1; i < flat.length; i++) {
      const n = flat[i]!;
      if (n.depth <= anchor.depth) break;
      linesToShift.add(n.line);
    }

    const raw = await this.repo.read(rel);
    const eol = splitDocument(raw.raw).eol;
    const lines = raw.raw.split(/\r?\n/);
    const step = '  ';

    for (const ln of linesToShift) {
      const idx = ln - 1;
      const cur = lines[idx] ?? '';
      const heading = HEADING_LINE.exec(cur);
      if (heading) {
        const level = (heading[1] ?? '#').length;
        const nextLevel = Math.min(6, Math.max(1, level + delta));
        lines[idx] = `${'#'.repeat(nextLevel)} ${(heading[2] ?? '').trim()}`;
        continue;
      }
      const listMatch = LIST_PREFIX.exec(cur);
      if (!listMatch) continue;
      const indent = listMatch[1] ?? '';
      if (delta > 0) {
        lines[idx] = `${step}${cur}`;
      } else {
        if (indent.length < 2) continue;
        lines[idx] = cur.replace(/^ {1,2}/, '') ;
      }
    }

    await this.repo.write(rel, lines.join(eol));
    this.events.emit({ type: 'note:changed', path: rel });
    return this.tree(rel);
  }



  async listScratch(): Promise<ScratchCanvasSummary[]> {
    await this.repo.mkdir(SCRATCH_DIR);
    const files = await this.repo.listFilesUnder(SCRATCH_DIR, '.flycanvas.json');
    const out: ScratchCanvasSummary[] = [];
    for (const f of files) {
      if (!isScratchCanvasPath(f.path)) continue;
      const id = f.path.slice(SCRATCH_DIR.length + 1, -'.flycanvas.json'.length);
      let title = id;
      try {
        const raw = await this.repo.read(f.path);
        const parsed = parseCanvasJson(raw.raw, '');
        if (parsed.doc?.title) title = parsed.doc.title;
        else if (parsed.doc?.mode === 'scratch') title = title || '梳理画布';
      } catch {
        /* keep id */
      }
      out.push({ id, path: f.path, title, mtimeMs: f.mtimeMs });
    }
    return out;
  }

  async createScratch(opts?: { title?: string }): Promise<{ path: string; doc: FrameworkCanvasDoc }> {
    await this.repo.mkdir(SCRATCH_DIR);
    const now = this.now();
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const id = `s_${stamp}_${Math.random().toString(36).slice(2, 6)}`;
    const path = scratchPathForId(id);
    const title =
      (opts?.title && opts.title.trim()) ||
      `梳理 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const doc = emptyDrawioDoc('scratch', '', title);
    await this.repo.write(path, serializeCanvasDoc(doc));
    this.events.emit({ type: 'scratch:changed' });
    this.events.emit({ type: 'scratch:open', path, title: doc.title || title });
    return { path, doc };
  }

  async getScratch(rel: string): Promise<CanvasLoadResult> {
    const path = rel.replace(/\\/g, '/');
    if (!isScratchCanvasPath(path)) throw new BadRequestError('不是 scratch 画布路径');
    if (!(await this.repo.exists(path))) {
      return { degraded: true, doc: null, reason: 'missing' };
    }
    try {
      const raw = await this.repo.read(path);
      const parsed = parseCanvasJson(raw.raw, '');
      if (parsed.doc && parsed.doc.mode !== 'scratch') {
        parsed.doc = { ...parsed.doc, mode: 'scratch' };
      }
      return parsed;
    } catch {
      return { degraded: true, doc: null, reason: 'read-error' };
    }
  }

  async saveScratch(rel: string, doc: FrameworkCanvasDoc): Promise<FrameworkCanvasDoc> {
    const path = rel.replace(/\\/g, '/');
    if (!isScratchCanvasPath(path)) throw new BadRequestError('不是 scratch 画布路径');
    const normalized = this.normalizeCanvas(doc, { mode: 'scratch', frameworkPath: '', title: doc?.title });
    if (normalized.version === 2) await this.backupReplacedCanvas(path);
    await this.repo.write(path, serializeCanvasDoc(normalized));
    this.events.emit({ type: 'scratch:changed' });
    return normalized;
  }

  /** 只删画布文件，不走笔记 trash，不碰 inbox md。迁移留下的 .bak 一并去掉。 */
  async deleteScratch(rel: string): Promise<void> {
    const path = rel.replace(/\\/g, '/');
    if (!isScratchCanvasPath(path)) throw new BadRequestError('不是 scratch 画布路径');
    await this.repo.remove(path);
    await this.repo.remove(`${path}.bak`);
    this.events.emit({ type: 'scratch:changed' });
  }

  async getCanvas(rel: string): Promise<CanvasLoadResult> {
    const side = canvasPathForFramework(rel);
    if (!(await this.repo.exists(side))) {
      return { degraded: true, doc: null, reason: 'missing' };
    }
    try {
      const raw = await this.repo.read(side);
      return parseCanvasJson(raw.raw, rel);
    } catch {
      return { degraded: true, doc: null, reason: 'read-error' };
    }
  }

  async saveCanvas(rel: string, doc: FrameworkCanvasDoc): Promise<FrameworkCanvasDoc> {
    const side = canvasPathForFramework(rel);
    const normalized = this.normalizeCanvas(doc, {
      mode: 'bound',
      frameworkPath: rel,
      title: doc?.title,
    });
    if (normalized.version === 2) await this.backupReplacedCanvas(side);
    await this.repo.write(side, serializeCanvasDoc(normalized));
    this.events.emit({ type: 'note:changed', path: side });
    return normalized;
  }

  private normalizeCanvas(
    doc: FrameworkCanvasDoc,
    opts: { mode: 'bound' | 'scratch'; frameworkPath: string; title?: string },
  ): FrameworkCanvasDoc {
    if (!doc || (doc.version !== 1 && doc.version !== 2)) {
      throw new BadRequestError('画布 version 必须为 1 或 2');
    }
    const normalized = canvasDocForSave(doc, opts);
    if (normalized.version === 2) {
      if (!normalized.xml || !isDrawioXml(normalized.xml)) throw new BadRequestError('画布 xml 不是 draw.io 图');
      if (normalized.xml.length > DRAWIO_XML_MAX) throw new BadRequestError('画布太大，没保存');
    }
    return normalized;
  }

  /** 用 draw.io 覆盖旧节点文件或坏文件之前，把原文复制成同名 .bak，只做一次。 */
  private async backupReplacedCanvas(rel: string): Promise<void> {
    if (!(await this.repo.exists(rel))) return;
    const bak = `${rel}.bak`;
    if (await this.repo.exists(bak)) return;
    const prev = await this.repo.read(rel);
    const parsed = parseCanvasJson(prev.raw, '');
    if (parsed.doc?.version === 2 && parsed.doc.xml && isDrawioXml(parsed.doc.xml)) return;
    await this.repo.write(bak, prev.raw);
  }

  /** 把 wikilink 目标解析成相对路径：同目录优先 → 全库唯一 → 否则不可解 */
  private resolveLink(target: string, fromRel: string): string | null {
    const name = resolveTargetName(target).toLowerCase();
    if (!name) return null;
    const entries = this.index.all();
    const matches = entries.filter((e) => stripExt(basename(e.path)).toLowerCase() === name);
    if (matches.length === 0) return null;

    const sameDir = matches.filter((e) => dirOf(e.path) === dirOf(fromRel));
    if (sameDir.length === 1) return sameDir[0]!.path;
    if (matches.length === 1) return matches[0]!.path;
    return null;
  }

  private linkedCount(text: string): number {
    const key = text.toLowerCase();
    let count = 0;
    for (const e of this.index.all()) {
      if (e.nodes.some((n) => n.toLowerCase() === key)) count += 1;
    }
    return count;
  }
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function findInTree(tree: FrameworkTree, line: number): { text: string; target: NavTarget | null } | null {
  const node = findNodeByLine(tree.root, line);
  return node ? { text: node.text, target: node.target } : null;
}
