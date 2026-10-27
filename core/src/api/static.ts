import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function inside(root: string, abs: string): boolean {
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return abs === root || abs.startsWith(rootWithSep);
}

function resolveUnder(root: string, urlPath: string): string | null {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^[/\\]+/, '');
  if (!rel || rel.includes('\0')) return null;
  const abs = path.resolve(root, rel);
  return inside(root, abs) ? abs : null;
}

async function isFile(abs: string): Promise<boolean> {
  try {
    const st = await stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

/** 非 /api 的 GET/HEAD 落到静态目录；无扩展名的路径回落到 index.html */
export function registerStatic(app: FastifyInstance, dir: string): void {
  const root = path.resolve(dir);

  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'not found' });
    }

    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/')) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'not found' });
    }

    const requested = pathname === '/' ? '/index.html' : pathname;
    const abs = resolveUnder(root, requested);
    const file = abs && (await isFile(abs)) ? abs : null;
    const fallback =
      file === null && !path.extname(requested) ? path.join(root, 'index.html') : null;
    const target = file ?? (fallback && (await isFile(fallback)) ? fallback : null);
    if (!target) return reply.code(404).send('not found');

    const ext = path.extname(target).toLowerCase();
    reply.type(TYPES[ext] ?? 'application/octet-stream');
    return reply.send(createReadStream(target));
  });
}
