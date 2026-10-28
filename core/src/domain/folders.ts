/** 文件夹配置：路径校验与归一（纯函数，不碰文件系统） */

export interface FolderEntry {
  path: string;
  title: string;
}

export interface FoldersConfig {
  version: 1;
  /** 随记归档目录（相对 vault） */
  inbox: string;
  folders: FolderEntry[];
}

export const FOLDERS_FILE = '.yan/folders.json';

/** 每次打开 vault 都确保存在的系统目录（不含用户分类） */
export const SYSTEM_ENSURE_DIRS = [
  '.yan',
  '.yan/templates',
  '.yan/scratch',
  '.yan/ui',
  '.yan/trash',
  'assets',
] as const;

/** 用户不可删的系统路径 */
export const PROTECTED_FOLDER_PATHS = new Set(['.yan', 'assets']);

/** 默认分类种子：仅在无 folders.json 时写入一次 */
export const DEFAULT_FOLDER_SEED: readonly FolderEntry[] = [
  { path: '00-inbox', title: '收件箱' },
  { path: '10-pitfalls', title: '踩坑' },
  { path: '20-experiments', title: '实验' },
  { path: '30-knowledge', title: '知识' },
  { path: '40-weekly', title: '周报' },
  { path: '50-frameworks', title: '框架' },
];

const ILLEGAL_SEG = /[<>:"\\|?*\u0000-\u001f]/;
const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 真实目录可以多层；界面至少要能挂父子两级，再深一点也不另起模型。 */
export const MAX_FOLDER_DEPTH = 8;

/** 规范化相对路径：posix、去 ..、去空段；非法则返回 null */
export function normalizeFolderPath(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!trimmed || trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) return null;
  const parts: string[] = [];
  for (const seg of trimmed.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    if (seg.startsWith('.')) return null;
    if (ILLEGAL_SEG.test(seg)) return null;
    if (RESERVED_WIN.test(seg)) return null;
    if (seg.endsWith('.') || seg.endsWith(' ')) return null;
    parts.push(seg);
  }
  if (parts.length < 1 || parts.length > MAX_FOLDER_DEPTH) return null;
  return parts.join('/');
}

/** 校验 path，合法返回 null，否则返回中文错误说明 */
export function validateFolderPath(raw: string): string | null {
  const n = normalizeFolderPath(raw);
  if (!n) {
    return `目录名不合法：需相对路径（最多 ${MAX_FOLDER_DEPTH} 层），禁止 ..、绝对路径、隐藏目录与非法字符`;
  }
  if (PROTECTED_FOLDER_PATHS.has(n.split('/')[0]!)) {
    return `不可使用系统目录：${n.split('/')[0]}`;
  }
  return null;
}

export function isProtectedFolderPath(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const top = n.split('/')[0] ?? '';
  return PROTECTED_FOLDER_PATHS.has(top) || PROTECTED_FOLDER_PATHS.has(n);
}

/** 从显示名生成可用目录名（保留中文；过滤非法字符） */
export function slugFolderName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 64)
    .trim();
  return cleaned || 'folder';
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

/** 宽容合并 folders.json：缺字段补默认，非法 path 丢掉 */
export function normalizeFoldersConfig(input: unknown): FoldersConfig {
  const seed = DEFAULT_FOLDER_SEED.map((f) => ({ ...f }));
  if (!input || typeof input !== 'object') {
    return { version: 1, inbox: '00-inbox', folders: seed };
  }
  const o = input as Record<string, unknown>;
  const rawList = Array.isArray(o.folders) ? o.folders : seed;
  const folders: FolderEntry[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (validateFolderPath(String(rec.path ?? ''))) continue;
    const p = normalizeFolderPath(String(rec.path))!;
    if (seen.has(p)) continue;
    seen.add(p);
    const title = str(rec.title, p.split('/').pop() ?? p);
    folders.push({ path: p, title });
  }
  if (folders.length === 0) folders.push(...seed);

  let inbox = str(o.inbox, folders[0]?.path ?? '00-inbox');
  const inboxNorm = normalizeFolderPath(inbox);
  if (!inboxNorm || !folders.some((f) => f.path === inboxNorm)) {
    inbox = folders[0]?.path ?? '00-inbox';
  } else {
    inbox = inboxNorm;
  }

  return { version: 1, inbox, folders };
}

/** 扫描到的顶层目录合并进种子（已有目录保留，缺的种子补上） */
export function seedFromExisting(topDirs: string[]): FoldersConfig {
  const folders: FolderEntry[] = [];
  const seen = new Set<string>();
  const titleOf = (p: string): string => {
    const hit = DEFAULT_FOLDER_SEED.find((f) => f.path === p);
    return hit?.title ?? (p.split('/').pop() ?? p);
  };
  for (const d of topDirs) {
    const n = normalizeFolderPath(d);
    if (!n || n.includes('/') || seen.has(n)) continue;
    if (PROTECTED_FOLDER_PATHS.has(n)) continue;
    seen.add(n);
    folders.push({ path: n, title: titleOf(n) });
  }
  for (const f of DEFAULT_FOLDER_SEED) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    folders.push({ ...f });
  }
  if (folders.length === 0) folders.push(...DEFAULT_FOLDER_SEED.map((f) => ({ ...f })));
  const inbox = folders.find((f) => f.path === '00-inbox')?.path ?? folders[0]!.path;
  return { version: 1, inbox, folders };
}



/** path 自己，或落在 ancestor 下面 */
export function folderIsUnder(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** 重命名时改写自己和子路径前缀；无关路径原样返回 */
export function retargetFolderPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (from && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

/**
 * 把清单里的 from 及其子文件夹改到 to。
 * 不能把文件夹移进自己里面。改完的路径不能撞车。
 */
export function planFolderRename(
  folders: FolderEntry[],
  from: string,
  to: string,
  title?: string,
): { ok: true; folders: FolderEntry[] } | { ok: false; reason: string } {
  if (from !== to && folderIsUnder(to, from)) {
    return { ok: false, reason: '不能把文件夹移到自己里面' };
  }
  const next = folders.map((f) => {
    if (f.path === from) {
      const nextTitle = title?.trim() || f.title || to.split('/').pop() || to;
      return { path: to, title: nextTitle };
    }
    return { ...f, path: retargetFolderPath(f.path, from, to) };
  });
  const seen = new Set<string>();
  for (const f of next) {
    if (seen.has(f.path)) return { ok: false, reason: `目标文件夹已存在：${f.path}` };
    seen.add(f.path);
  }
  return { ok: true, folders: next };
}

/** 删除文件夹时，清单里的子文件夹一并去掉，避免下次启动又建出来 */
export function foldersAfterDelete(folders: FolderEntry[], path: string): FolderEntry[] {
  return folders.filter((f) => !folderIsUnder(f.path, path));
}

/** 删除当前 inbox（或其父文件夹）时，挑选下一个收件箱；没有其他分类则 null */
export function pickNextInbox(cfg: FoldersConfig, deletingPath: string): string | null {
  const others = cfg.folders.filter((f) => !folderIsUnder(f.path, deletingPath));
  return others[0]?.path ?? null;
}

/** 删除策略：默认非空拒绝；系统路径永远拒绝 */
export function canDeleteFolder(opts: {
  path: string;
  isInbox: boolean;
  isEmpty: boolean;
  mode: 'refuse-if-not-empty' | 'delete-recursive';
}): { ok: true } | { ok: false; reason: string } {
  if (isProtectedFolderPath(opts.path)) {
    return { ok: false, reason: `不可删除系统目录：${opts.path}` };
  }
  if (opts.isInbox) {
    return { ok: false, reason: '正在用作随记收件箱，无法直接删除。请先在「管理文件夹」把另一个分类「设为收件箱」，再删除本文件夹。' };
  }
  if (!opts.isEmpty && opts.mode === 'refuse-if-not-empty') {
    return { ok: false, reason: `目录非空，已拒绝删除：${opts.path}` };
  }
  return { ok: true };
}
