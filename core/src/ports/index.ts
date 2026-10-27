import type { AppConfig } from '../contracts';

export interface RawNote {
  rel: string;
  raw: string;
  mtimeMs: number;
}

export interface WriteResult {
  mtimeMs: number;
  /** false 表示内容与磁盘一致，未真正落盘 */
  changed: boolean;
}

/** 笔记的字节级存取。只认相对路径，不暴露绝对路径给上层业务。 */
export interface NoteRepo {
  exists(rel: string): Promise<boolean>;
  read(rel: string): Promise<RawNote>;
  write(rel: string, raw: string, expectMtimeMs?: number): Promise<WriteResult>;
  remove(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** 所有 markdown 文件（posix 相对路径） */
  listMarkdown(): Promise<string[]>;
  /** 列出某相对目录下全部 markdown（含 .yan/trash，不跳过该前缀） */
  listMarkdownUnder(rel: string): Promise<Array<{ path: string; mtimeMs: number }>>;
  /** 列出某相对目录下匹配后缀的文件（含 .yan/*，不跳过隐藏前缀） */
  listFilesUnder(rel: string, endsWith: string): Promise<Array<{ path: string; mtimeMs: number }>>;
  /** 所有目录（posix 相对路径），用于文件树 */
  listDirs(): Promise<string[]>;
  /** 仅顶层非隐藏目录名 */
  listTopDirs(): Promise<string[]>;
  dirExists(rel: string): Promise<boolean>;
  isDirEmpty(rel: string): Promise<boolean>;
  mkdir(rel: string): Promise<void>;
  rmdir(rel: string, opts?: { recursive?: boolean }): Promise<void>;
  renameDir(from: string, to: string): Promise<void>;
  stat(rel: string): Promise<number | null>;
}

export interface IndexEntry {
  path: string;
  title: string;
  type: string;
  tags: string[];
  project: string;
  nodes: string[];
  body: string;
  mtimeMs: number;
}

export interface IndexProvider {
  rebuild(entries: IndexEntry[]): void;
  upsert(entry: IndexEntry): void;
  remove(path: string): void;
  all(): IndexEntry[];
  get(path: string): IndexEntry | undefined;
  size(): number;
}

export interface AssetStore {
  /** 保存二进制资源，返回相对路径 */
  save(data: Buffer, ext: string, at: Date): Promise<string>;
  absolute(rel: string): string;
}

export interface WatchAdapter {
  start(onChange: (paths: string[]) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface CaptureSink {
  append(text: string, at: Date): Promise<{ file: string; line: number }>;
}

export interface ConfigRepo {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface FileEntry {
  path: string;
  kind: 'dir' | 'file';
}
