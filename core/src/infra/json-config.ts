import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../contracts';
import { normalizeConfig } from '../domain/config';
import type { ConfigRepo } from '../ports';

export class JsonConfigRepo implements ConfigRepo {
  constructor(private readonly file: string) {}

  async load(): Promise<AppConfig> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      return normalizeConfig(JSON.parse(raw) as unknown);
    } catch {
      return normalizeConfig(null);
    }
  }

  async save(config: AppConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}
