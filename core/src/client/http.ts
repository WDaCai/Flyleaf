import type { YanClient, YanEvent } from '../contracts';

export interface HttpClientOptions {
  baseUrl?: string;
}

interface ApiFailure {
  code?: string;
  message?: string;
}

export class YanApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'YanApiError';
  }
}

async function request<T>(baseUrl: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let failure: ApiFailure = {};
    try {
      failure = (await res.json()) as ApiFailure;
    } catch {
      failure = { message: `HTTP ${res.status}` };
    }
    throw new YanApiError(failure.message ?? `HTTP ${res.status}`, failure.code ?? 'HTTP');
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createHttpClient(opts: HttpClientOptions = {}): YanClient {
  const base = opts.baseUrl ?? '';

  return {
    vault: {
      open: (root) => request(base, 'POST', '/api/v1/vault/open', { root }),
      info: () => request(base, 'GET', '/api/v1/vault'),
      tree: () => request(base, 'GET', '/api/v1/vault/tree'),
      recent: (limit) => request(base, 'GET', `/api/v1/vault/recent${qs({ limit })}`),
      listFolders: () => request(base, 'GET', '/api/v1/vault/folders'),
      createFolder: (input) => request(base, 'POST', '/api/v1/vault/folders', input),
      renameFolder: (input) => request(base, 'POST', '/api/v1/vault/folders/rename', input),
      deleteFolder: (input) => request(base, 'POST', '/api/v1/vault/folders/delete', input),
      setInbox: (path) => request(base, 'POST', '/api/v1/vault/folders/inbox', { path }),
    },
    notes: {
      read: (path) => request(base, 'GET', `/api/v1/note${qs({ path })}`),
      write: (path, body, frontmatter, expectMtimeMs) =>
        request(base, 'PUT', '/api/v1/note', { path, body, frontmatter, mtimeMs: expectMtimeMs }),
      create: (input) => request(base, 'POST', '/api/v1/note', input),
      rename: async (from, to) => {
        await request(base, 'POST', '/api/v1/note/rename', { from, to });
      },
      delete: (input) =>
        request(base, 'POST', '/api/v1/note/delete', typeof input === 'string' ? { path: input } : input),
      listTrash: (limit) => request(base, 'GET', `/api/v1/note/trash${qs({ limit })}`),
      clearTrash: () => request(base, 'POST', '/api/v1/note/trash/clear', {}),
      restore: (input) =>
        request(base, 'POST', '/api/v1/note/restore', typeof input === 'string' ? { path: input } : input),
      backlinks: (path) => request(base, 'GET', `/api/v1/backlinks${qs({ path })}`),
    },
    search: {
      query: (q) =>
        request(
          base,
          'GET',
          `/api/v1/search${qs({ q: q.text, type: q.type, tag: q.tag, project: q.project, nodes: q.nodes, limit: q.limit })}`,
        ),
    },
    framework: {
      tree: (path) => request(base, 'GET', `/api/v1/framework${qs({ path })}`),
      setState: (path, line, state) => request(base, 'POST', '/api/v1/framework/state', { path, line, state }),
      expandNode: (path, line) => request(base, 'POST', '/api/v1/framework/expand', { path, line }),
      addNode: (path, opts) => request(base, 'POST', '/api/v1/framework/add', { path, ...opts }),
      renameNode: (path, line, text) => request(base, 'POST', '/api/v1/framework/rename', { path, line, text }),
      removeNode: (path, line, opts) =>
        request(base, 'POST', '/api/v1/framework/remove', { path, line, trashLinked: opts?.trashLinked }),
      shiftNode: (path, line, delta) => request(base, 'POST', '/api/v1/framework/shift', { path, line, delta }),
    },
    capture: {
      getDraft: () => request(base, 'GET', '/api/v1/capture/draft'),
      saveDraft: async (text) => {
        await request(base, 'PUT', '/api/v1/capture/draft', { text });
      },
      archive: (text) => request(base, 'POST', '/api/v1/capture/archive', { text }),
    },
    assets: {
      saveImage: (dataUrl) => request(base, 'POST', '/api/v1/assets/image', { dataUrl }),
    },
    events: {
      subscribe: (fn) => {
        const source = new EventSource(`${base}/api/v1/events`);
        source.onmessage = (ev: MessageEvent<string>) => {
          try {
            fn(JSON.parse(ev.data) as YanEvent);
          } catch {
            // 忽略坏消息
          }
        };
        return () => source.close();
      },
    },
  };
}
