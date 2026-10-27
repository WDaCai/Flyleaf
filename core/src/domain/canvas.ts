/** 框架画布旁路：parse / reconcile / 路径（纯函数） */

export type CanvasShape = 'round' | 'rect' | 'ellipse';

export type CanvasMode = 'bound' | 'scratch';

export interface CanvasViewport {
  k: number;
  tx: number;
  ty: number;
}

export interface CanvasNodeLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: CanvasShape;
}

export interface CanvasEdge {
  id: string;
  kind: 'link';
  from: string;
  to: string;
  arrow?: boolean;
}

export interface FrameworkCanvasDoc {
  version: 1;
  /** bound=旁路框架 md；scratch=独立纯梳理（下一刀） */
  mode: CanvasMode;
  frameworkPath: string;
  viewport: CanvasViewport;
  nodes: CanvasNodeLayout[];
  edges: CanvasEdge[];
}

export interface CanvasLoadResult {
  /** true：无文件或解析失败，应树布局兜底 */
  degraded: boolean;
  doc: FrameworkCanvasDoc | null;
  reason?: string;
}

export interface LiveTreeNode {
  id: string;
}

export interface ReconcileResult {
  nodes: CanvasNodeLayout[];
  edges: CanvasEdge[];
  /** json 有、md 无 */
  orphanNodeIds: string[];
  /** 端点失效的自由边 */
  orphanEdgeIds: string[];
}

const DEFAULT_W = 208;
const DEFAULT_H = 34;
const SHAPES = new Set<CanvasShape>(['round', 'rect', 'ellipse']);

/** foo.md → foo.canvas.json */
export function canvasPathForFramework(frameworkRel: string): string {
  const p = frameworkRel.replace(/\\/g, '/');
  if (p.toLowerCase().endsWith('.md')) return `${p.slice(0, -3)}.canvas.json`;
  return `${p}.canvas.json`;
}

export function emptyCanvasDoc(frameworkPath: string): FrameworkCanvasDoc {
  return {
    version: 1,
    mode: 'bound',
    frameworkPath: frameworkPath.replace(/\\/g, '/'),
    viewport: { k: 1, tx: 48, ty: 48 },
    nodes: [],
    edges: [],
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asShape(v: unknown): CanvasShape {
  return typeof v === 'string' && SHAPES.has(v as CanvasShape) ? (v as CanvasShape) : 'round';
}

/** 宽容解析；失败返回 degraded */
export function parseCanvasJson(raw: string, frameworkPath: string): CanvasLoadResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { degraded: true, doc: null, reason: 'json-parse' };
  }
  if (!data || typeof data !== 'object') {
    return { degraded: true, doc: null, reason: 'not-object' };
  }
  const o = data as Record<string, unknown>;
  if (o.version !== 1 && o.version !== '1') {
    return { degraded: true, doc: null, reason: 'bad-version' };
  }
  const vpIn = o.viewport && typeof o.viewport === 'object' ? (o.viewport as Record<string, unknown>) : {};
  const viewport: CanvasViewport = {
    k: Math.min(2, Math.max(0.35, num(vpIn.k, 1))),
    tx: num(vpIn.tx, 48),
    ty: num(vpIn.ty, 48),
  };

  const nodes: CanvasNodeLayout[] = [];
  const seenN = new Set<string>();
  if (Array.isArray(o.nodes)) {
    for (const item of o.nodes) {
      if (!item || typeof item !== 'object') continue;
      const n = item as Record<string, unknown>;
      const id = typeof n.id === 'string' ? n.id.trim() : '';
      if (!id || seenN.has(id)) continue;
      seenN.add(id);
      nodes.push({
        id,
        x: num(n.x, 0),
        y: num(n.y, 0),
        w: Math.max(40, num(n.w, DEFAULT_W)),
        h: Math.max(24, num(n.h, DEFAULT_H)),
        shape: asShape(n.shape),
      });
    }
  }

  const edges: CanvasEdge[] = [];
  const seenE = new Set<string>();
  if (Array.isArray(o.edges)) {
    for (const item of o.edges) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      if (e.kind !== 'link') continue;
      const from = typeof e.from === 'string' ? e.from : '';
      const to = typeof e.to === 'string' ? e.to : '';
      if (!from || !to || from === to) continue;
      const id =
        typeof e.id === 'string' && e.id.trim()
          ? e.id.trim()
          : `e_${from.slice(0, 8)}_${to.slice(0, 8)}`;
      if (seenE.has(id)) continue;
      seenE.add(id);
      edges.push({ id, kind: 'link', from, to, arrow: e.arrow === true });
    }
  }

  const fp =
    typeof o.frameworkPath === 'string' && o.frameworkPath.trim()
      ? o.frameworkPath.replace(/\\/g, '/')
      : frameworkPath.replace(/\\/g, '/');

  return {
    degraded: false,
    doc: {
      version: 1,
      mode: o.mode === 'scratch' ? 'scratch' : 'bound',
      frameworkPath: fp,
      viewport,
      nodes,
      edges,
    },
  };
}

export function serializeCanvasDoc(doc: FrameworkCanvasDoc): string {
  const clean: FrameworkCanvasDoc = {
    version: 1,
    mode: doc.mode === 'scratch' ? 'scratch' : 'bound',
    frameworkPath: doc.frameworkPath.replace(/\\/g, '/'),
    viewport: {
      k: Math.min(2, Math.max(0.35, doc.viewport.k)),
      tx: doc.viewport.tx,
      ty: doc.viewport.ty,
    },
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      x: Math.round(n.x * 10) / 10,
      y: Math.round(n.y * 10) / 10,
      w: Math.round(n.w),
      h: Math.round(n.h),
      shape: SHAPES.has(n.shape) ? n.shape : 'round',
    })),
    edges: doc.edges
      .filter((e) => e.kind === 'link' && e.from && e.to && e.from !== e.to)
      .map((e) => ({
        id: e.id,
        kind: 'link' as const,
        from: e.from,
        to: e.to,
        ...(e.arrow ? { arrow: true } : {}),
      })),
  };
  return `${JSON.stringify(clean, null, 2)}\n`;
}

/**
 * 合并 md 树节点与 json 布局。
 * defaults: id → 树布局默认位（仅对 json 缺失的 id 使用）
 */
export function reconcileCanvas(
  live: LiveTreeNode[],
  stored: FrameworkCanvasDoc | null,
  defaults: Map<string, { x: number; y: number; w?: number; h?: number }>,
): ReconcileResult {
  const liveIds = new Set(live.map((n) => n.id));
  const byId = new Map<string, CanvasNodeLayout>();
  if (stored) {
    for (const n of stored.nodes) byId.set(n.id, { ...n });
  }

  const nodes: CanvasNodeLayout[] = [];
  for (const n of live) {
    const prev = byId.get(n.id);
    const def = defaults.get(n.id);
    if (prev) {
      nodes.push({ ...prev, id: n.id });
      byId.delete(n.id);
    } else {
      nodes.push({
        id: n.id,
        x: def?.x ?? 0,
        y: def?.y ?? 0,
        w: def?.w ?? DEFAULT_W,
        h: def?.h ?? DEFAULT_H,
        shape: 'round',
      });
    }
  }

  const orphanNodeIds = [...byId.keys()];

  const orphanEdgeIds: string[] = [];
  const edges: CanvasEdge[] = [];
  for (const e of stored?.edges ?? []) {
    if (!liveIds.has(e.from) || !liveIds.has(e.to)) {
      orphanEdgeIds.push(e.id);
      continue;
    }
    edges.push(e);
  }

  return { nodes, edges, orphanNodeIds, orphanEdgeIds };
}

export function ghostLayouts(
  stored: FrameworkCanvasDoc | null,
  orphanNodeIds: string[],
): CanvasNodeLayout[] {
  if (!stored || orphanNodeIds.length === 0) return [];
  const want = new Set(orphanNodeIds);
  return stored.nodes.filter((n) => want.has(n.id));
}

export const CANVAS_DEFAULT_SIZE = { w: DEFAULT_W, h: DEFAULT_H } as const;
