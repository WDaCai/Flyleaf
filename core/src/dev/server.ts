import path from 'node:path';
import { CoreHost } from '../host';
import { createServer } from '../api/server';

function flag(name: string): string | undefined {
  const eq = `${name}=`;
  const inline = process.argv.find((a) => a.startsWith(eq));
  if (inline) return inline.slice(eq.length);
  const i = process.argv.indexOf(name);
  const next = i >= 0 ? process.argv[i + 1] : undefined;
  if (next && !next.startsWith('--')) return next;
  return undefined;
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const root = flag('--vault') ?? positional[0] ?? process.env.FLYLEAF_VAULT ?? process.env.YAN_VAULT ?? path.resolve('.local-vault');
const port = Number(flag('--port') ?? process.env.FLYLEAF_PORT ?? process.env.YAN_PORT ?? 5174);
const staticDir = flag('--static') ?? process.env.FLYLEAF_STATIC ?? process.env.YAN_STATIC;

async function main(): Promise<void> {
  const host = new CoreHost();
  await host.open(root);

  const app = createServer(host, staticDir ? { staticDir } : {});
  try {
    await app.listen({ port, host: '127.0.0.1' });
  } catch (err) {
    console.error(`[flyleaf] 监听失败 ${port}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`FLYLEAF_READY ${port}`);
  console.log(`[flyleaf] api  http://127.0.0.1:${port}`);
  console.log(`[flyleaf] vault ${root}`);
  if (staticDir) console.log(`[flyleaf] static ${path.resolve(staticDir)}`);
  console.log('[flyleaf] 按 Ctrl+C 停止');
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
