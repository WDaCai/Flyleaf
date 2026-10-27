export interface WikiLink {
  raw: string;
  /** 完整目标（可能含 #标题 或 ^块） */
  target: string;
  alias: string | null;
}

const WIKI = /\[\[([^[\]\n]+?)\]\]/g;

export function parseWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  WIKI.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI.exec(text)) !== null) {
    const inner = m[1] ?? '';
    const bar = inner.indexOf('|');
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const alias = bar === -1 ? null : inner.slice(bar + 1).trim();
    if (target) out.push({ raw: m[0], target, alias });
  }
  return out;
}

/** 去掉 #标题 / ^块 与目录，只留文件名词 */
export function resolveTargetName(target: string): string {
  let t = target;
  const hash = t.search(/[#^]/);
  if (hash !== -1) t = t.slice(0, hash);
  t = t.trim();
  const slash = t.lastIndexOf('/');
  return (slash === -1 ? t : t.slice(slash + 1)).trim();
}

/** 取目标里的目录部分（用于同目录优先解析） */
export function resolveTargetDir(target: string): string {
  let t = target;
  const hash = t.search(/[#^]/);
  if (hash !== -1) t = t.slice(0, hash);
  const slash = t.lastIndexOf('/');
  return slash === -1 ? '' : t.slice(0, slash);
}

export function stripWikiLinks(text: string): string {
  return text.replace(WIKI, '').replace(/\s{2,}/g, ' ').trim();
}
