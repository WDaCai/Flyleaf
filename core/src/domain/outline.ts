import type { Mastery } from '../contracts';
import { parseStateToken } from './state';
import { splitLines } from './text';
import { parseWikiLinks } from './wikilink';

export interface OutlineNode {
  /** 1-based 行号（在完整文件中的行号） */
  line: number;
  depth: number;
  text: string;
  state: Mastery;
  /** 该行第一个 wikilink 的目标；没有则为 null */
  linkRaw: string | null;
  raw: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * 解析大纲：标题 + 缩进列表 → 扁平节点序列（按文档顺序）。
 * 容错优先：缩进混乱、跳级、tab/空格混用都不报错，只做合理归位。
 */
export function parseOutline(body: string, bodyStartLine: number): OutlineNode[] {
  const lines = splitLines(body);
  const out: OutlineNode[] = [];

  let unit = 0;
  for (const line of lines) {
    const m = LIST_ITEM.exec(line);
    if (!m) continue;
    const indent = (m[1] ?? '').replace(/\t/g, '    ').length;
    if (indent > 0 && (unit === 0 || indent < unit)) unit = indent;
  }
  if (!unit) unit = 2;

  let inFence = false;
  let headingDepth = 0;
  let prevDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h = HEADING.exec(raw);
    if (h) {
      const level = (h[1] ?? '#').length;
      const text = (h[2] ?? '').trim();
      headingDepth = level;
      const depth = Math.max(0, level - 1);
      if (text) {
        out.push({ line: bodyStartLine + i, depth, text, state: 'todo', linkRaw: null, raw });
        prevDepth = depth;
      }
      continue;
    }

    const m = LIST_ITEM.exec(raw);
    if (!m) continue;

    const indent = (m[1] ?? '').replace(/\t/g, '    ').length;
    const indentLevel = Math.round(indent / unit);
    let depth = headingDepth + indentLevel;
    if (depth > prevDepth + 1) depth = prevDepth + 1;
    if (depth < 0) depth = 0;

    const content = (m[3] ?? '').trim();
    const parsed = parseStateToken(content) ?? { state: 'todo' as Mastery, rest: content };
    const link = parseWikiLinks(parsed.rest)[0] ?? null;
    const stripped = parsed.rest.replace(/\[\[[^[\]\n]*\]\]/g, '').replace(/\s{2,}/g, ' ').trim();
    const text = stripped || parsed.rest.trim();

    out.push({
      line: bodyStartLine + i,
      depth,
      text,
      state: parsed.state,
      linkRaw: link?.target ?? null,
      raw,
    });
    prevDepth = depth;
  }

  return out;
}
