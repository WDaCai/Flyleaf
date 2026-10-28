import { describe, expect, it } from 'vitest';
import {
  bootDrawioFromCanvas,
  canvasDegradedNotice,
  canvasPathForFramework,
  clampCanvasZoom,
  emptyCanvasDoc,
  emptyDrawioDoc,
  emptyDrawioXml,
  emptyScratchDoc,
  ghostLayouts,
  isDrawioXml,
  isScratchCanvasPath,
  migrateCanvasToDrawioXml,
  parseCanvasJson,
  reconcileCanvas,
  scratchPathForId,
  serializeCanvasDoc,
  wheelZoomFactor,
  zoomCanvasView,
} from './canvas';

describe('canvas', () => {
  it('旁路路径：md → .canvas.json', () => {
    expect(canvasPathForFramework('50-frameworks/foo.md')).toBe('50-frameworks/foo.canvas.json');
    expect(canvasPathForFramework('a/b/c.MD')).toBe('a/b/c.canvas.json');
  });

  it('坏 json 降级', () => {
    const r = parseCanvasJson('{nope', '50-frameworks/foo.md');
    expect(r.degraded).toBe(true);
    expect(r.doc).toBeNull();
  });

  it('宽容解析 version=1', () => {
    const raw = JSON.stringify({
      version: 1,
      nodes: [{ id: 'a', x: 1, y: 2, shape: 'ellipse' }, { id: 'a', x: 9, y: 9 }],
      edges: [
        { id: 'e1', kind: 'link', from: 'a', to: 'b' },
        { id: 'e2', kind: 'tree', from: 'a', to: 'b' },
        { kind: 'link', from: 'a', to: 'a' },
      ],
    });
    const r = parseCanvasJson(raw, '50-frameworks/foo.md');
    expect(r.degraded).toBe(false);
    expect(r.doc?.nodes).toHaveLength(1);
    expect(r.doc?.nodes[0]?.shape).toBe('ellipse');
    expect(r.doc?.edges).toHaveLength(1);
    expect(r.doc?.frameworkPath).toBe('50-frameworks/foo.md');
    expect(r.doc?.mode).toBe('bound');
  });

  it('reconcile：补位 + 幽灵 + 失效边', () => {
    const stored = emptyCanvasDoc('50-frameworks/foo.md');
    stored.nodes = [
      { id: 'live', x: 10, y: 20, w: 208, h: 34, shape: 'rect' },
      { id: 'ghost', x: 1, y: 2, w: 100, h: 30, shape: 'round' },
    ];
    stored.edges = [
      { id: 'ok', kind: 'link', from: 'live', to: 'root' },
      { id: 'bad', kind: 'link', from: 'live', to: 'ghost' },
    ];
    const defaults = new Map([['root', { x: 0, y: 0 }], ['live', { x: 99, y: 99 }]]);
    const rec = reconcileCanvas([{ id: 'root' }, { id: 'live' }], stored, defaults);
    expect(rec.nodes.map((n) => n.id).sort()).toEqual(['live', 'root']);
    expect(rec.nodes.find((n) => n.id === 'live')?.x).toBe(10);
    expect(rec.nodes.find((n) => n.id === 'root')?.x).toBe(0);
    expect(rec.orphanNodeIds).toEqual(['ghost']);
    expect(rec.orphanEdgeIds).toEqual(['bad']);
    expect(rec.edges.map((e) => e.id)).toEqual(['ok']);
    expect(ghostLayouts(stored, rec.orphanNodeIds)).toHaveLength(1);
  });

  it('serialize 稳定输出', () => {
    const doc = emptyCanvasDoc('50-frameworks/foo.md');
    doc.nodes.push({ id: 'n1', x: 1.234, y: 5.678, w: 208, h: 34, shape: 'round' });
    const s = serializeCanvasDoc(doc);
    expect(s).toContain('"version": 1');
    expect(s).toContain('"mode": "bound"');
    expect(parseCanvasJson(s, doc.frameworkPath).degraded).toBe(false);
  });

  it('scratch 路径与序列化', () => {
    expect(scratchPathForId('s_abc')).toBe('.yan/scratch/s_abc.flycanvas.json');
    expect(isScratchCanvasPath('.yan/scratch/s_abc.flycanvas.json')).toBe(true);
    expect(isScratchCanvasPath('50-frameworks/foo.canvas.json')).toBe(false);
    const doc = emptyScratchDoc('我的框架');
    doc.nodes.push({ id: 'n1', x: 10, y: 20, w: 208, h: 34, shape: 'round', text: '概念' });
    const s = serializeCanvasDoc(doc);
    expect(s).toContain('"mode": "scratch"');
    expect(s).toContain('"title": "我的框架"');
    expect(s).toContain('"text": "概念"');
    const r = parseCanvasJson(s, '');
    expect(r.degraded).toBe(false);
    expect(r.doc?.mode).toBe('scratch');
    expect(r.doc?.nodes[0]?.text).toBe('概念');
  });

  it('缩放锚点下的世界坐标不变', () => {
    const view = { k: 1, tx: 48, ty: 40 };
    const px = 400;
    const py = 300;
    const worldX = (px - view.tx) / view.k;
    const worldY = (py - view.ty) / view.k;
    const next = zoomCanvasView(view, px, py, wheelZoomFactor(-120, 0));
    expect(next.k).toBeGreaterThan(1);
    expect(next.k).toBeLessThanOrEqual(4);
    expect((px - next.tx) / next.k).toBeCloseTo(worldX, 5);
    expect((py - next.ty) / next.k).toBeCloseTo(worldY, 5);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(clampCanvasZoom(99)).toBe(4);
    expect(clampCanvasZoom(0.01)).toBe(0.2);
    const parsed = parseCanvasJson(JSON.stringify({ version: 1, viewport: { k: 9, tx: 1, ty: 2 } }), 'a.md');
    expect(parsed.doc?.viewport.k).toBe(4);
  });

  it('v2 draw.io 往返，并保留 legacy', () => {
    const xml = emptyDrawioXml('页');
    expect(isDrawioXml(xml)).toBe(true);
    const doc = emptyDrawioDoc('scratch', '', '梳理');
    doc.legacy = {
      nodes: [{ id: 'a', x: 1, y: 2, w: 80, h: 30, shape: 'ellipse', text: '旧' }],
      edges: [{ id: 'e1', kind: 'link', from: 'a', to: 'b' }],
    };
    const raw = serializeCanvasDoc(doc);
    expect(raw).toContain('"version": 2');
    expect(raw).toContain('"format": "drawio"');
    expect(raw).toContain('<mxfile');
    const parsed = parseCanvasJson(raw, '');
    expect(parsed.degraded).toBe(false);
    expect(parsed.doc?.version).toBe(2);
    expect(parsed.doc?.mode).toBe('scratch');
    expect(parsed.doc?.title).toBe('梳理');
    expect(parsed.doc?.legacy?.nodes[0]?.text).toBe('旧');
    expect(parsed.doc?.legacy?.edges).toHaveLength(1);
  });

  it('坏版本与坏 xml 降级', () => {
    expect(parseCanvasJson(JSON.stringify({ version: 3 }), 'a.md').reason).toBe('bad-version');
    expect(parseCanvasJson(JSON.stringify({ version: 2, xml: 'hello' }), 'a.md').reason).toBe('bad-xml');
    expect(canvasDegradedNotice('missing')).toBe('');
    expect(canvasDegradedNotice('json-parse')).toContain('.bak');
  });

  it('v1 节点迁成 mxfile：文案、父子边、失效节点', () => {
    const doc = emptyCanvasDoc('50-frameworks/foo.md');
    doc.nodes = [
      { id: 'root', x: 10, y: 20, w: 100, h: 34, shape: 'round' },
      { id: 'note:a&b', x: 30, y: 40, w: 120, h: 36, shape: 'ellipse', text: '应被大纲盖住' },
      { id: 'ghost', x: 1, y: 2, w: 90, h: 30, shape: 'rect', text: '游离' },
    ];
    doc.edges = [{ id: 'free', kind: 'link', from: 'root', to: 'ghost', arrow: true }];
    const xml = migrateCanvasToDrawioXml(
      doc,
      [
        { id: 'root', text: '根', parentId: null },
        { id: 'note:a&b', text: 'A & B', parentId: 'root' },
      ],
      '框架',
    );
    expect(xml).toContain('value="根"');
    expect(xml).toContain('value="A &amp; B"');
    expect(xml).toContain('ellipse;');
    expect(xml).toContain('（失效）游离');
    expect(xml).toContain('dashed=1');
    expect(xml).toContain('endArrow=classic');
    expect(xml).toContain('source="root"');
    expect(xml).not.toContain('id="note:a&amp;b"');
    const boot = bootDrawioFromCanvas(
      { degraded: false, doc },
      { labels: [{ id: 'root', text: '根', parentId: null }], pageName: '框架' },
    );
    expect(boot.kind).toBe('migrated');
    expect(boot.notice).toContain('迁入');
    expect(boot.legacy?.nodes).toHaveLength(3);
    const emptyBoot = bootDrawioFromCanvas({ degraded: true, doc: null, reason: 'missing' });
    expect(emptyBoot.kind).toBe('empty');
    expect(emptyBoot.notice).toBe('');
    const badBoot = bootDrawioFromCanvas({ degraded: true, doc: null, reason: 'json-parse' });
    expect(badBoot.kind).toBe('degraded');
  });
});
