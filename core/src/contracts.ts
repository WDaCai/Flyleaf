/**
 * 契约层：所有跨层共享的类型。
 * 约束：本文件不得 import 任何 IO / Node / React 模块，可被浏览器直接引用。
 */

export type NoteType =
  | 'pitfall'
  | 'experiment'
  | 'knowledge'
  | 'weekly'
  | 'framework'
  | 'note';

export const NOTE_TYPES: readonly NoteType[] = [
  'pitfall',
  'experiment',
  'knowledge',
  'weekly',
  'framework',
  'note',
];

/** 知识节点的四档掌握度 */
export type Mastery = 'todo' | 'learning' | 'known' | 'used';
export const MASTERY_ORDER: readonly Mastery[] = ['todo', 'learning', 'known', 'used'];
export const MASTERY_LABEL: Record<Mastery, string> = {
  todo: '未学',
  learning: '在学',
  known: '已懂',
  used: '用过',
};

export type NavTarget =
  | { kind: 'file'; path: string }
  | { kind: 'line'; path: string; line: number };

export interface TreeNode {
  /** 稳定 id：由 path + 行号 + 原文哈希得到，供 UI 折叠状态持久化 */
  id: string;
  text: string;
  depth: number;
  state: Mastery;
  /** 1-based，在框架文件中的行号 */
  line: number;
  target: NavTarget | null;
  /** 通过 frontmatter.nodes 反查到的条目数 */
  linkedNotes: number;
  children: TreeNode[];
}

export interface FrameworkStats {
  todo: number;
  learning: number;
  known: number;
  used: number;
  total: number;
}

export interface FrameworkTree {
  path: string;
  title: string;
  /** 虚拟根，text = title，target 指向框架文件自身 */
  root: TreeNode;
  stats: FrameworkStats;
}

export interface NoteDoc {
  /** 相对 vault 根的 posix 路径 */
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  eol: '\n' | '\r\n';
  bom: boolean;
  mtimeMs: number;
}

export interface NoteSummary {
  path: string;
  title: string;
  type: string;
  tags: string[];
  project?: string;
  mtimeMs: number;
}

export interface CreateNoteInput {
  type: NoteType;
  title: string;
  /** 目标目录（相对 vault），缺省按类型默认 */
  dir?: string;
  project?: string;
  engine?: string;
  platform?: string;
  nodes?: string[];
  tags?: string[];
  body?: string;
}

export type DeleteNoteMode = 'trash' | 'hard';

export interface DeleteNoteInput {
  path: string;
  /** 默认 trash（移入 .yan/trash）；hard 为永久删除 */
  mode?: DeleteNoteMode;
}

export interface DeleteNoteResult {
  path: string;
  mode: DeleteNoteMode;
  /** trash 模式下的回收站相对路径 */
  trashedTo?: string;
}

export interface SearchQuery {
  text?: string;
  type?: string;
  tag?: string;
  project?: string;
  nodes?: string;
  limit?: number;
}

export interface SearchHit {
  path: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
}

export interface CaptureDraft {
  text: string;
  updatedAt: string;
  archivedCount: number;
}

export interface CaptureArchiveResult {
  file: string;
  line: number;
}

export interface FileNode {
  /** 相对 vault 根的 posix 路径 */
  path: string;
  name: string;
  kind: 'dir' | 'file';
  children?: FileNode[];
}

export interface VaultInfo {
  root: string;
  name: string;
  noteCount: number;
}

export interface Backlink {
  path: string;
  title: string;
  type: string;
  line: number;
}

export interface AssetRef {
  relPath: string;
}

export interface CardBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}


export interface FolderEntry {
  path: string;
  title: string;
}

export interface FoldersConfig {
  version: 1;
  inbox: string;
  folders: FolderEntry[];
}

export type DeleteFolderMode = 'refuse-if-not-empty' | 'delete-recursive';

export interface CreateFolderInput {
  path: string;
  title?: string;
}

export interface RenameFolderInput {
  from: string;
  to: string;
  title?: string;
}

export interface DeleteFolderInput {
  path: string;
  mode?: DeleteFolderMode;
}

export interface AppConfig {
  vaultPath: string | null;
  defaults: {
    project: string;
    engine: string;
    platform: string;
  };
  card: {
    bounds: CardBounds;
    opacity: number;
    hotkey: string;
    pinned: boolean;
  };
  tabs: {
    max: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  vaultPath: null,
  defaults: { project: '', engine: '', platform: '' },
  card: {
    bounds: { x: 120, y: 120, w: 340, h: 200 },
    opacity: 0.95,
    hotkey: 'CommandOrControl+Alt+Space',
    pinned: true,
  },
  tabs: { max: 8 },
};

export type YanEvent =
  | { type: 'note:changed'; path: string }
  | { type: 'vault:changed'; paths: string[] }
  | { type: 'index:ready'; count: number }
  | { type: 'capture:saved'; at: string; file: string; line: number };

export type Unsubscribe = () => void;

export interface YanClient {
  vault: {
    open(root: string): Promise<VaultInfo>;
    info(): Promise<VaultInfo>;
    tree(): Promise<FileNode[]>;
    recent(limit?: number): Promise<NoteSummary[]>;
    listFolders(): Promise<FoldersConfig>;
    createFolder(input: CreateFolderInput): Promise<FoldersConfig>;
    renameFolder(input: RenameFolderInput): Promise<FoldersConfig>;
    deleteFolder(input: DeleteFolderInput): Promise<FoldersConfig>;
    setInbox(path: string): Promise<FoldersConfig>;
  };
  notes: {
    read(path: string): Promise<NoteDoc>;
    write(path: string, body: string, frontmatter?: Record<string, unknown>, expectMtimeMs?: number): Promise<NoteDoc>;
    create(input: CreateNoteInput): Promise<NoteDoc>;
    rename(from: string, to: string): Promise<void>;
    delete(input: DeleteNoteInput | string): Promise<DeleteNoteResult>;
    backlinks(path: string): Promise<Backlink[]>;
  };
  search: {
    query(q: SearchQuery): Promise<SearchHit[]>;
  };
  framework: {
    tree(path: string): Promise<FrameworkTree>;
    setState(path: string, line: number, state: Mastery): Promise<FrameworkTree>;
    expandNode(path: string, line: number): Promise<{ doc: NoteDoc; tree: FrameworkTree }>;
  };
  capture: {
    getDraft(): Promise<CaptureDraft>;
    saveDraft(text: string): Promise<void>;
    archive(text: string): Promise<CaptureArchiveResult>;
  };
  assets: {
    saveImage(dataUrl: string, name?: string): Promise<AssetRef>;
  };
  events: {
    subscribe(fn: (e: YanEvent) => void): Unsubscribe;
  };
}

/** 对外优先用此名；YanClient 为历史别名，逐步替换。 */
export type FlyleafClient = YanClient;
export type FlyleafEvent = YanEvent;

export interface ApiError {
  code: string;
  message: string;
  detail?: unknown;
}
