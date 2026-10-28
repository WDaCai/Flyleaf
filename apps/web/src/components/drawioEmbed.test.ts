import { describe, expect, it } from 'vitest';
import {
  DRAWIO_LOCAL_INDEX,
  DRAWIO_REMOTE_INDEX,
  buildDrawioEmbedUrl,
  drawioOriginAllowed,
  probeDrawioIndex,
  readDrawioMessage,
  resolveDrawioIndex,
} from './drawioEmbed';

describe('drawio embed', () => {
  it('URL 带 embed 协议，深色开关写进 dark', () => {
    const dark = buildDrawioEmbedUrl(DRAWIO_REMOTE_INDEX, true);
    expect(dark.startsWith('https://embed.diagrams.net/?')).toBe(true);
    expect(dark).toContain('embed=1');
    expect(dark).toContain('proto=json');
    expect(dark).toContain('ui=atlas');
    expect(dark).toContain('saveAndExit=0');
    expect(dark).toContain('noExitBtn=1');
    expect(dark).toContain('configure=1');
    expect(dark).toContain('dark=1');
    expect(buildDrawioEmbedUrl('/drawio/index.html', false)).toContain('dark=0');
  });

  it('只收 diagrams.net 和当前页源', () => {
    expect(drawioOriginAllowed('https://embed.diagrams.net', DRAWIO_REMOTE_INDEX)).toBe(true);
    expect(drawioOriginAllowed('https://app.diagrams.net', DRAWIO_REMOTE_INDEX)).toBe(true);
    expect(drawioOriginAllowed('https://evil.example', DRAWIO_REMOTE_INDEX)).toBe(false);
    expect(drawioOriginAllowed('http://127.0.0.1:5174', DRAWIO_LOCAL_INDEX, 'http://127.0.0.1:5174')).toBe(true);
  });

  it('postMessage 兼容字符串和对象', () => {
    expect(readDrawioMessage('{"event":"init"}')?.event).toBe('init');
    expect(readDrawioMessage({ event: 'save', xml: '<mxfile/>' })?.xml).toBe('<mxfile/>');
    expect(readDrawioMessage('nope')).toBeNull();
  });

  it('自托管探测：draw.io 页面可用，本应用 index 不用', async () => {
    const drawio = await probeDrawioIndex(async () => new Response('<html><script src="js/app.min.js"></script>', { status: 200 }));
    expect(drawio).toBe(DRAWIO_LOCAL_INDEX);
    const spa = await probeDrawioIndex(
      async () => new Response('<html><div id="root"></div><script src="/src/main.tsx"></script>', { status: 200 }),
    );
    expect(spa).toBeNull();
    const missing = await resolveDrawioIndex(async () => new Response('no', { status: 404 }));
    expect(missing).toBe(DRAWIO_REMOTE_INDEX);
  });
});
