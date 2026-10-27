import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendCapture, formatDate } from '../domain/capture';
import type { CaptureSink, NoteRepo } from '../ports';

export type InboxDirProvider = () => string | Promise<string>;

export class DailyInboxSink implements CaptureSink {
  constructor(
    private readonly repo: NoteRepo,
    private readonly getInbox: InboxDirProvider = () => '00-inbox',
  ) {}

  async append(text: string, at: Date): Promise<{ file: string; line: number }> {
    const dir = await this.getInbox();
    const file = `${dir}/${formatDate(at)}.md`;
    let existing = '';
    try {
      existing = (await this.repo.read(file)).raw;
    } catch {
      existing = '';
    }
    const next = appendCapture(existing, text, at);
    await this.repo.write(file, next);

    const marker = appendCapture('', text, at).trim();
    const idx = marker ? next.indexOf(marker) : -1;
    const line = idx === -1 ? next.split(/\r?\n/).length : next.slice(0, idx).split(/\r?\n/).length;
    return { file, line };
  }
}

/** 仅给单测与工具使用：确保目录存在 */
export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(path.resolve(p), { recursive: true });
}
