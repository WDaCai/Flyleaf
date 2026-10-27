import type { IndexEntry, IndexProvider } from '../ports';

/** 内存索引：几千条笔记足够用，启动重建，随时可丢 */
export class MemoryIndex implements IndexProvider {
  private map = new Map<string, IndexEntry>();

  rebuild(entries: IndexEntry[]): void {
    this.map = new Map(entries.map((e) => [e.path, e]));
  }

  upsert(entry: IndexEntry): void {
    this.map.set(entry.path, entry);
  }

  remove(path: string): void {
    this.map.delete(path);
  }

  all(): IndexEntry[] {
    return [...this.map.values()];
  }

  get(path: string): IndexEntry | undefined {
    return this.map.get(path);
  }

  size(): number {
    return this.map.size;
  }
}
