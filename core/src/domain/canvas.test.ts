import { describe, expect, it } from 'vitest';
import {
  canvasPathForFramework,
  emptyCanvasDoc,
  emptyScratchDoc,
  ghostLayouts,
  isScratchCanvasPath,
  parseCanvasJson,
  reconcileCanvas,
  scratchPathForId,
  serializeCanvasDoc,
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
});
