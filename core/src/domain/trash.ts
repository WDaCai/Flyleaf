import { basename, dirname, normalizeRel, stripExt } from './paths';

export const TRASH_ROOT = '.yan/trash';

/** 删除冲突时追加的时间戳后缀：name__2026-10-28T01-02-03-000Z.md */
const STAMP_RE = /__\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

/** 从回收站相对路径还原出原笔记路径；无效则 null */
export function originalPathFromTrash(trashedRel: string): string | null {
  const norm = normalizeRel(trashedRel);
  if (!norm.startsWith(`${TRASH_ROOT}/`)) return null;
  const rest = norm.slice(TRASH_ROOT.length + 1);
  if (!rest || !rest.endsWith('.md') || rest.includes('..')) return null;
  const dir = dirname(rest);
  const base = stripExt(basename(rest)).replace(STAMP_RE, '');
  if (!base) return null;
  return dir ? `${dir}/${base}.md` : `${base}.md`;
}

/** 路径信息不可靠时落到 inbox */
export function restoreTargetPath(
  trashedRel: string,
  opts: { inbox: string; dirExists: (rel: string) => boolean },
): { target: string; usedInboxFallback: boolean } {
  const inbox = normalizeRel(opts.inbox) || '00-inbox';
  const original = originalPathFromTrash(trashedRel);
  if (!original) {
    const name = basename(normalizeRel(trashedRel));
    return { target: `${inbox}/${name}`, usedInboxFallback: true };
  }
  const parent = dirname(original);
  if (parent && !opts.dirExists(parent)) {
    return { target: `${inbox}/${basename(original)}`, usedInboxFallback: true };
  }
  return { target: original, usedInboxFallback: false };
}
