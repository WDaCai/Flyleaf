import type { CaptureArchiveResult, CaptureDraft } from '../contracts';
import type { CaptureSink, NoteRepo } from '../ports';
import type { EventBus } from './event-bus';

// `.yan`：历史目录名，兼容保留
const SCRATCH_REL = '.yan/scratch/card.json';

export class CaptureService {
  constructor(
    private readonly sink: CaptureSink,
    private readonly repo: NoteRepo,
    private readonly events: EventBus,
    private readonly now: () => Date,
  ) {}

  async getDraft(): Promise<CaptureDraft> {
    try {
      const raw = await this.repo.read(SCRATCH_REL);
      const parsed = JSON.parse(raw.raw) as Partial<CaptureDraft>;
      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
        archivedCount: typeof parsed.archivedCount === 'number' ? parsed.archivedCount : 0,
      };
    } catch {
      return { text: '', updatedAt: '', archivedCount: 0 };
    }
  }

  async saveDraft(text: string): Promise<void> {
    const current = await this.getDraft();
    const next: CaptureDraft = {
      text,
      updatedAt: this.now().toISOString(),
      archivedCount: current.archivedCount,
    };
    try {
      await this.repo.write(SCRATCH_REL, `${JSON.stringify(next)}\n`);
    } catch {
      // 草稿写失败不应打断输入
    }
  }

  async archive(text: string): Promise<CaptureArchiveResult> {
    const at = this.now();
    const result = await this.sink.append(text, at);
    const current = await this.getDraft();
    await this.saveDraft('');
    await this.repo.write(
      SCRATCH_REL,
      `${JSON.stringify({ text: '', updatedAt: at.toISOString(), archivedCount: current.archivedCount + 1 })}\n`,
    );
    this.events.emit({ type: 'capture:saved', at: at.toISOString(), file: result.file, line: result.line });
    return result;
  }
}
