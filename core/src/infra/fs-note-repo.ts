import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConflictError, NotFoundError } from '../errors';
import { isInside, normalizeRel, splitRel, toPosix } from '../domain/paths';
import type { NoteRepo, RawNote, WriteResult } from '../ports';

const SKIP_DIRS = new Set(['.git', '.yan', 'node_modules', '.obsidian', '.trash']);

export class FsNoteRepo implements NoteRepo {
  private readonly rootAbs: string;

  constructor(root: string) {
    this.rootAbs = path.resolve(root);
  }

  get root(): string {
    return this.rootAbs;
  }

  private abs(rel: string): string {
    const norm = normalizeRel(rel);
    if (!norm) throw new NotFoundError(rel);
    const full = path.resolve(this.rootAbs, ...splitRel(norm));
    if (!isInside(this.rootAbs, full)) throw new NotFoundError(rel);
    return full;
  }

  async exists(rel: string): Promise<boolean> {
    try {
      const st = await fs.stat(this.abs(rel));
      return st.isFile();
    } catch {
      return false;
    }
  }

  async stat(rel: string): Promise<number | null> {
    try {
      const st = await fs.stat(this.abs(rel));
      return st.isFile() ? st.mtimeMs : null;
    } catch {
      return null;
    }
  }

  async read(rel: string): Promise<RawNote> {
    const abs = this.abs(rel);
    try {
      const [raw, st] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      return { rel: normalizeRel(rel), raw, mtimeMs: st.mtimeMs };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(rel);
      throw e;
    }
  }

  async write(rel: string, raw: string, expectMtimeMs?: number): Promise<WriteResult> {
    const abs = this.abs(rel);
    let current: number | null = null;
    try {
      current = (await fs.stat(abs)).mtimeMs;
    } catch {
      current = null;
    }

    if (current !== null && expectMtimeMs !== undefined && Math.abs(current - expectMtimeMs) > 1) {
      throw new ConflictError(rel, current);
    }

    if (current !== null) {
      const existing = await fs.readFile(abs, 'utf8');
      if (existing === raw) return { mtimeMs: current, changed: false };
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, raw, 'utf8');
    const st = await fs.stat(abs);
    return { mtimeMs: st.mtimeMs, changed: true };
  }

  async remove(rel: string): Promise<void> {
    try {
      await fs.unlink(this.abs(rel));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const src = this.abs(from);
    const dst = this.abs(to);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
  }

  async listMarkdown(): Promise<string[]> {
    return this.walk((name) => name.endsWith('.md'));
  }

  async listDirs(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(path.join(this.rootAbs, ...splitRel(rel)), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const child = rel ? `${rel}/${e.name}` : e.name;
        out.push(child);
        await walk(child);
      }
    };
    await walk('');
    return out.sort();
  }

  private async walk(match: (name: string) => boolean): Promise<string[]> {
    const out: string[] = [];
    const visit = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(path.join(this.rootAbs, ...splitRel(rel)), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          await visit(rel ? `${rel}/${e.name}` : e.name);
        } else if (e.isFile() && match(e.name)) {
          out.push(toPosix(rel ? `${rel}/${e.name}` : e.name));
        }
      }
    };
    await visit('');
    return out.sort();
  }
}
