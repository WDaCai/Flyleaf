/** 路径与文件名工具（纯函数，不碰文件系统） */

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function normalizeRel(p: string): string {
  const posix = toPosix(p).replace(/^\.\//, '');
  const parts: string[] = [];
  for (const seg of posix.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export function joinRel(...parts: string[]): string {
  return normalizeRel(parts.filter(Boolean).join('/'));
}

export function dirname(p: string): string {
  const n = normalizeRel(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? '' : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalizeRel(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? n : n.slice(i + 1);
}

export function stripExt(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? p : p.slice(0, p.length - (b.length - i));
}

/** 是否位于 root 之内（防目录穿越） */
export function isInside(root: string, candidate: string): boolean {
  const r = normalizeRel(root);
  const c = normalizeRel(candidate);
  return c === r || c.startsWith(r + '/');
}

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

/** 由标题生成安全文件名（不含扩展名） */
export function slugify(title: string): string {
  const cleaned = title
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  return cleaned || 'untitled';
}

/** 相对路径 → 文件系统绝对路径片段（仅该用 '/' 或 '\\' 的地方调用） */
export function splitRel(p: string): string[] {
  return normalizeRel(p).split('/').filter(Boolean);
}
