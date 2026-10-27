import type { AssetRef } from '../contracts';
import { BadRequestError } from '../errors';
import type { AssetStore } from '../ports';

const MAX_BYTES = 20 * 1024 * 1024;
const DATA_URL = /^data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/;

export class AssetService {
  constructor(
    private readonly store: AssetStore,
    private readonly now: () => Date,
  ) {}

  async saveImage(dataUrl: string): Promise<AssetRef> {
    const m = DATA_URL.exec(dataUrl.trim());
    if (!m) throw new BadRequestError('不是有效的图片 data URL');
    const ext = (m[1] ?? 'png').toLowerCase();
    const buf = Buffer.from(m[2] ?? '', 'base64');
    if (buf.length === 0) throw new BadRequestError('图片内容为空');
    if (buf.length > MAX_BYTES) throw new BadRequestError('图片超过 20MB');
    const relPath = await this.store.save(buf, ext === 'jpeg' ? 'jpg' : ext, this.now());
    return { relPath };
  }
}
