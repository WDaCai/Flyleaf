import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { CoreHost } from '../host';
import { BadRequestError, toApiError } from '../errors';
import type { CreateNoteInput, DeleteNoteInput, Mastery, SearchQuery, CreateFolderInput, DeleteFolderInput, RenameFolderInput, RestoreNoteInput } from '../contracts';
import { registerStatic } from './static';

type Body = Record<string, unknown>;

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`缺少参数：${field}`);
  return v;
}

export interface ServerOptions {
  /** 有值时，非 /api 请求从该目录提供静态文件（轻量壳用） */
  staticDir?: string;
}

export function createServer(host: CoreHost, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });

  void app.register(cors, { origin: true });

  app.get('/api/v1/health', async () => ({ ok: true }));

  app.setErrorHandler((err, _req, reply) => {
    const api = toApiError(err);
    const code = api.code === 'NOT_FOUND' ? 404 : api.code === 'BAD_REQUEST' ? 400 : api.code === 'CONFLICT' ? 409 : 500;
    void reply.status(code).send(api);
  });

  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!host.isOpen) throw new BadRequestError('尚未打开 vault');
    return fn();
  };

  app.post('/api/v1/vault/open', async (req) => {
    const body = (req.body ?? {}) as Body;
    return host.open(str(body.root, 'root'));
  });

  app.get('/api/v1/vault', async () => guard(() => host.client.vault.info()));
  app.get('/api/v1/vault/tree', async () => guard(() => host.client.vault.tree()));
  app.get('/api/v1/vault/recent', async (req) => {
    const q = (req.query ?? {}) as Body;
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    return guard(() => host.client.vault.recent(limit));
  });

  app.get('/api/v1/vault/folders', async () => guard(() => host.client.vault.listFolders()));

  app.post('/api/v1/vault/folders', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.vault.createFolder(body as unknown as CreateFolderInput));
  });

  app.post('/api/v1/vault/folders/rename', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.vault.renameFolder(body as unknown as RenameFolderInput));
  });

  app.post('/api/v1/vault/folders/delete', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.vault.deleteFolder(body as unknown as DeleteFolderInput));
  });

  app.post('/api/v1/vault/folders/inbox', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.vault.setInbox(str(body.path, 'path')));
  });

  app.get('/api/v1/note', async (req) => {
    const q = (req.query ?? {}) as Body;
    return guard(() => host.client.notes.read(str(q.path, 'path')));
  });

  app.put('/api/v1/note', async (req) => {
    const body = (req.body ?? {}) as Body;
    const path = str(body.path, 'path');
    const text = typeof body.body === 'string' ? body.body : '';
    const fm = body.frontmatter && typeof body.frontmatter === 'object' ? (body.frontmatter as Record<string, unknown>) : undefined;
    const mtime = typeof body.mtimeMs === 'number' ? body.mtimeMs : undefined;
    return guard(() => host.client.notes.write(path, text, fm, mtime));
  });

  app.post('/api/v1/note', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.notes.create(body as unknown as CreateNoteInput));
  });

  app.post('/api/v1/note/rename', async (req) => {
    const body = (req.body ?? {}) as Body;
    await guard(() => host.client.notes.rename(str(body.from, 'from'), str(body.to, 'to')));
    return { ok: true };
  });

  app.post('/api/v1/note/delete', async (req) => {
    const body = (req.body ?? {}) as Body;
    const input: DeleteNoteInput = {
      path: str(body.path, 'path'),
      mode: body.mode === 'hard' ? 'hard' : body.mode === 'trash' ? 'trash' : undefined,
    };
    return guard(() => host.client.notes.delete(input));
  });

  app.post('/api/v1/note/trash/clear', async () => {
    return guard(() => host.client.notes.clearTrash());
  });

  app.get('/api/v1/note/trash', async (req) => {
    const q = (req.query ?? {}) as Body;
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    return guard(() => host.client.notes.listTrash(limit));
  });

  app.post('/api/v1/note/restore', async (req) => {
    const body = (req.body ?? {}) as Body;
    const input: RestoreNoteInput = {
      path: str(body.path, 'path'),
      inbox: typeof body.inbox === 'string' ? body.inbox : undefined,
    };
    return guard(() => host.client.notes.restore(input));
  });

  app.get('/api/v1/backlinks', async (req) => {
    const q = (req.query ?? {}) as Body;
    return guard(() => host.client.notes.backlinks(str(q.path, 'path')));
  });

  app.get('/api/v1/search', async (req) => {
    const q = (req.query ?? {}) as Body;
    const query: SearchQuery = {
      text: typeof q.q === 'string' ? q.q : '',
      type: typeof q.type === 'string' ? q.type : undefined,
      tag: typeof q.tag === 'string' ? q.tag : undefined,
      project: typeof q.project === 'string' ? q.project : undefined,
      nodes: typeof q.nodes === 'string' ? q.nodes : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
    };
    return guard(() => host.client.search.query(query));
  });

  app.get('/api/v1/framework', async (req) => {
    const q = (req.query ?? {}) as Body;
    return guard(() => host.client.framework.tree(str(q.path, 'path')));
  });

  app.post('/api/v1/framework/state', async (req) => {
    const body = (req.body ?? {}) as Body;
    const state = str(body.state, 'state') as Mastery;
    return guard(() => host.client.framework.setState(str(body.path, 'path'), Number(body.line), state));
  });

  app.post('/api/v1/framework/expand', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.framework.expandNode(str(body.path, 'path'), Number(body.line)));
  });

  app.post('/api/v1/framework/add', async (req) => {
    const body = (req.body ?? {}) as Body;
    const afterLine = body.afterLine == null || body.afterLine === '' ? null : Number(body.afterLine);
    return guard(() =>
      host.client.framework.addNode(str(body.path, 'path'), {
        afterLine,
        text: typeof body.text === 'string' ? body.text : '新节点',
        asChild: body.asChild !== false,
      }),
    );
  });

  app.post('/api/v1/framework/rename', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() =>
      host.client.framework.renameNode(str(body.path, 'path'), Number(body.line), str(body.text, 'text')),
    );
  });

  app.post('/api/v1/framework/remove', async (req) => {
    const body = (req.body ?? {}) as Body;
    const trashLinked = body.trashLinked !== false && body.trashLinked !== 'false';
    return guard(() =>
      host.client.framework.removeNode(str(body.path, 'path'), Number(body.line), { trashLinked }),
    );
  });

  app.post('/api/v1/framework/shift', async (req) => {
    const body = (req.body ?? {}) as Body;
    const delta = Number(body.delta) < 0 ? -1 : 1;
    return guard(() => host.client.framework.shiftNode(str(body.path, 'path'), Number(body.line), delta));
  });


  app.get('/api/v1/framework/canvas', async (req) => {
    const q = (req.query ?? {}) as Body;
    return guard(() => host.client.framework.getCanvas(str(q.path, 'path')));
  });

  app.put('/api/v1/framework/canvas', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() =>
      host.client.framework.saveCanvas(str(body.path, 'path'), body.doc as Parameters<typeof host.client.framework.saveCanvas>[1]),
    );
  });


  app.get('/api/v1/framework/scratch', async () => guard(() => host.client.framework.listScratch()));

  app.post('/api/v1/framework/scratch', async (req) => {
    const body = (req.body ?? {}) as Body;
    const title = typeof body.title === 'string' ? body.title : undefined;
    return guard(() => host.client.framework.createScratch({ title }));
  });

  app.get('/api/v1/framework/scratch/one', async (req) => {
    const q = (req.query ?? {}) as Body;
    return guard(() => host.client.framework.getScratch(str(q.path, 'path')));
  });

  app.put('/api/v1/framework/scratch/one', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() =>
      host.client.framework.saveScratch(
        str(body.path, 'path'),
        body.doc as Parameters<typeof host.client.framework.saveScratch>[1],
      ),
    );
  });

  app.post('/api/v1/framework/scratch/delete', async (req) => {
    const body = (req.body ?? {}) as Body;
    await guard(() => host.client.framework.deleteScratch(str(body.path, 'path')));
    return { ok: true };
  });

  app.get('/api/v1/capture/draft', async () => guard(() => host.client.capture.getDraft()));

  app.put('/api/v1/capture/draft', async (req) => {
    const body = (req.body ?? {}) as Body;
    await guard(() => host.client.capture.saveDraft(typeof body.text === 'string' ? body.text : ''));
    return { ok: true };
  });

  app.post('/api/v1/capture/archive', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.capture.archive(typeof body.text === 'string' ? body.text : ''));
  });

  app.post('/api/v1/assets/image', async (req) => {
    const body = (req.body ?? {}) as Body;
    return guard(() => host.client.assets.saveImage(str(body.dataUrl, 'dataUrl')));
  });

  app.get('/api/v1/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write(': connected\n\n');
    const unsub = host.client.events.subscribe((e) => {
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  if (opts.staticDir) registerStatic(app, opts.staticDir);

  return app;
}
