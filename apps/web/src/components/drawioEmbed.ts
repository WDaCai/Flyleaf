/** diagrams.net embed URL 与 postMessage。纯函数，方便单测。 */

export const DRAWIO_REMOTE_INDEX = 'https://embed.diagrams.net/';
export const DRAWIO_LOCAL_INDEX = '/drawio/index.html';

const DRAWIO_HOSTS = new Set([
  'embed.diagrams.net',
  'app.diagrams.net',
  'viewer.diagrams.net',
  'draw.io',
  'www.draw.io',
]);

export function buildDrawioEmbedUrl(indexUrl: string, dark: boolean): string {
  const q = new URLSearchParams({
    embed: '1',
    proto: 'json',
    spin: '1',
    ui: 'atlas',
    saveAndExit: '0',
    noExitBtn: '1',
    lang: 'zh',
    stealth: '1',
    offline: '1',
    gapi: '0',
    db: '0',
    od: '0',
    gh: '0',
    gl: '0',
    tr: '0',
    dark: dark ? '1' : '0',
    configure: '1',
  });
  const base = indexUrl.split('#')[0] || indexUrl;
  return `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`;
}

export function drawioEmbedOrigin(indexUrl: string, pageOrigin = ''): string {
  if (indexUrl.startsWith('http://') || indexUrl.startsWith('https://')) {
    return new URL(indexUrl).origin;
  }
  return pageOrigin;
}

export function drawioOriginAllowed(origin: string, indexUrl: string, pageOrigin = ''): boolean {
  if (origin && origin === drawioEmbedOrigin(indexUrl, pageOrigin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return DRAWIO_HOSTS.has(host) || host.endsWith('.diagrams.net');
  } catch {
    return false;
  }
}

export function readDrawioMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      const v = JSON.parse(data) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

/** 安装目录里有自托管页面就用它。Vite 把未知路径回落到本应用 index 时要认出来。 */
export async function probeDrawioIndex(fetchFn: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchFn(DRAWIO_LOCAL_INDEX);
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, 12000);
    if (/\/src\/main\.tsx/.test(text) && /id=["']root["']/.test(text)) return null;
    if (/mxgraph|app\.min\.js|diagrams\.net|GraphEditor/i.test(text)) return DRAWIO_LOCAL_INDEX;
    return null;
  } catch {
    return null;
  }
}

export async function resolveDrawioIndex(fetchFn: typeof fetch = fetch): Promise<string> {
  return (await probeDrawioIndex(fetchFn)) ?? DRAWIO_REMOTE_INDEX;
}
