import { promises as fs } from 'node:fs';
import path from 'node:path';
import { joinRel, splitRel } from '../domain/paths';
import type { AssetStore } from '../ports';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm']);

export class FsAssetStore implements AssetStore {
  constructor(private readonly root: string) {}

  absolute(rel: string): string {
    return path.resolve(this.root, ...splitRel(rel));
  }

  async save(data: Buffer, ext: string, at: Date): Promise<string> {
    const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ALLOWED.has(clean) ? clean : 'png';
    const rel = joinRel(
      'assets',
      String(at.getFullYear()),
      pad(at.getMonth() + 1),
      `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`,
    );
    const abs = this.absolute(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    return rel;
  }
}
