import type { FrameworkTree, Mastery, NavTarget, NoteDoc } from '../contracts';
import { composeDocument } from '../domain/compose';
import { parseFrontmatter, asString } from '../domain/frontmatter';
import { basename, joinRel, slugify, stripExt } from '../domain/paths';
import { replaceStateMarker } from '../domain/state';
import { splitDocument } from '../domain/text';
import { parseOutline } from '../domain/outline';
import { buildTree } from '../domain/tree';
import { resolveTargetName } from '../domain/wikilink';
import { BadRequestError, NotFoundError } from '../errors';
import type { IndexProvider, NoteRepo } from '../ports';
import type { EventBus } from './event-bus';
import type { NoteService } from './note-service';

const NODE_DIR = '50-frameworks/nodes';

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
  const walk = (node: typeof tree.root): { text: string; target: NavTarget | null } | null => {
    if (node.line === line) return { text: node.text, target: node.target };
    for (const c of node.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree.root);
}
