import path from 'node:path';
import { CoreHost } from '../host';
import { createServer } from '../api/server';

const root = process.argv[2] ?? process.env.YAN_VAULT ?? path.resolve('.local-vault');
const port = Number(process.env.YAN_PORT ?? 5174);

const host = new CoreHost();
await host.open(root);

const app = createServer(host);
await app.listen({ port, host: '127.0.0.1' });

console.log(`[yan] api  http://127.0.0.1:${port}`);
console.log(`[yan] vault ${root}`);
console.log('[yan] 按 Ctrl+C 停止');
