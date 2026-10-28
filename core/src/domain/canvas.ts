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
  /** scratch 节点标题；bound 可省略（文案来自 md 树） */
  text?: string;
}

export interface CanvasEdge {
  id: string;
  kind: 'link';
  from: string;
  to: string;
  arrow?: boolean;
}

/** 从 v1 节点画布迁入时留下的布局，避免被 draw.io XML 覆盖后无法回看 */
export interface CanvasLegacy {
  nodes: CanvasNodeLayout[];
  edges: CanvasEdge[];
}

export interface FrameworkCanvasDoc {
  /** 1=旧节点布局；2=draw.io mxfile */
  version: 1 | 2;
  /** bound=旁路框架 md；scratch=独立纯梳理 */
  mode: CanvasMode;
  /** bound：框架 md 路径；scratch：可空 */
  frameworkPath: string;
  /** scratch 显示名；bound 可省略 */
  title?: string;
  viewport: CanvasViewport;
  nodes: CanvasNodeLayout[];
  edges: CanvasEdge[];
  /** version 2 的图。diagrams.net mxfile / mxGraphModel */
  xml?: string;
  legacy?: CanvasLegacy;
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

/** 画布缩放夹取。过窄会让滚轮一滑就顶死，拖拽也容易贴边。 */
export const CANVAS_ZOOM_MIN = 0.2;
export const CANVAS_ZOOM_MAX = 4;

export function clampCanvasZoom(k: number): number {
  if (!Number.isFinite(k) || k <= 0) return 1;
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, k));
}

/**
 * 以 SVG 视口坐标 (px, py) 为锚缩放，锚点下的世界坐标保持不动。
 * transform 约定：translate(tx, ty) scale(k)，tx/ty 是视口像素。
 */
export function zoomCanvasView(view: CanvasViewport, px: number, py: number, factor: number): CanvasViewport {
  const prev = view.k > 0 && Number.isFinite(view.k) ? view.k : 1;
  const nextK = clampCanvasZoom(prev * (Number.isFinite(factor) && factor > 0 ? factor : 1));
  const ratio = nextK / prev;
  return {
    k: nextK,
    tx: px - (px - view.tx) * ratio,
    ty: py - (py - view.ty) * ratio,
  };
}

/**
 * 滚轮增量 → 乘性缩放。deltaMode：0 像素、1 行、2 页。
 * 按像素幅度平滑缩放，避免触控板每一小格都跳 12%。deltaY 为 0 时不缩放。
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * 0.00115);
}

/** foo.md → foo.canvas.json */
export function canvasPathForFramework(frameworkRel: string): string {
  const p = frameworkRel.replace(/\\/g, '/');
  if (p.toLowerCase().endsWith('.md')) return `${p.slice(0, -3)}.canvas.json`;
  return `${p}.canvas.json`;
}


/** 纯梳理画布目录（PLAN 钉死） */
export const SCRATCH_DIR = '.yan/scratch';

/** id → .yan/scratch/<id>.flycanvas.json */
export function scratchPathForId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'scratch';
  return `${SCRATCH_DIR}/${safe}.flycanvas.json`;
}

export function isScratchCanvasPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  return p.startsWith(`${SCRATCH_DIR}/`) && p.endsWith('.flycanvas.json');
}

export function emptyScratchDoc(title: string, frameworkPath = ''): FrameworkCanvasDoc {
  return {
    version: 1,
    mode: 'scratch',
    frameworkPath: frameworkPath.replace(/\\/g, '/'),
    title: title.trim() || '梳理画布',
    viewport: { k: 1, tx: 48, ty: 48 },
    nodes: [],
    edges: [],
  };
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

/** 单份图 XML 上限。JSON 转义后仍低于 API bodyLimit（32MB）。 */
export const DRAWIO_XML_MAX = 6_000_000;

export const DRAWIO_MIGRATED_NOTICE =
  '已从旧版画布迁入节点和连线。大纲仍以 Markdown 为准，这张图单独保存。首次保存时，原文会复制为同名 .bak。';

export interface DrawioLabel {
  id: string;
  text: string;
  parentId?: string | null;
}

export type DrawioBootKind = 'ready' | 'empty' | 'migrated' | 'degraded';

export interface DrawioBoot {
  xml: string;
  notice: string;
  kind: DrawioBootKind;
  legacy?: CanvasLegacy;
}

export function isDrawioXml(xml: string): boolean {
  const s = xml.trim();
  if (!s.startsWith('<')) return false;
  return s.includes('<mxfile') || s.includes('<mxGraphModel');
}

export function emptyDrawioXml(pageName = '画布'): string {
  return wrapMxfile(pageName, '');
}

export function emptyDrawioDoc(mode: CanvasMode, frameworkPath = '', title?: string): FrameworkCanvasDoc {
  const name = (title || (mode === 'scratch' ? '梳理画布' : '画布')).trim() || '画布';
  return {
    version: 2,
    mode,
    frameworkPath: mode === 'scratch' ? '' : frameworkPath.replace(/\\/g, '/'),
    ...(mode === 'scratch' || title ? { title: name } : {}),
    viewport: { k: 1, tx: 0, ty: 0 },
    nodes: [],
    edges: [],
    xml: emptyDrawioXml(name),
  };
}

export function canvasDegradedNotice(reason: string | undefined): string {
  if (!reason || reason === 'missing') return '';
  const why =
    reason === 'json-parse'
      ? '不是合法 JSON'
      : reason === 'not-object'
        ? '内容不是 JSON 对象'
        : reason === 'bad-version'
          ? '版本无法识别'
          : reason === 'bad-xml'
            ? '没有可用的 draw.io 图'
            : reason === 'read-error'
              ? '文件读取失败'
              : '内容无法识别';
  return `旧画布读不成图（${why}）。现在打开的是空白图。原文件还在；你改图并保存之后，原文会复制成同名 .bak。`;
}

/** 打开画布时决定喂给 draw.io 的 XML。不在这里写盘。 */
export function bootDrawioFromCanvas(
  loaded: CanvasLoadResult,
  opts?: { labels?: DrawioLabel[]; pageName?: string },
): DrawioBoot {
  const pageName = (opts?.pageName || '画布').trim() || '画布';
  if (loaded.degraded || !loaded.doc) {
    const notice = canvasDegradedNotice(loaded.reason);
    return { xml: emptyDrawioXml(pageName), notice, kind: notice ? 'degraded' : 'empty' };
  }
  const doc = loaded.doc;
  if (doc.version === 2 && typeof doc.xml === 'string' && isDrawioXml(doc.xml)) {
    return {
      xml: doc.xml,
      notice: '',
      kind: 'ready',
      ...(doc.legacy ? { legacy: doc.legacy } : {}),
    };
  }
  if (doc.nodes.length === 0 && doc.edges.length === 0) {
    return { xml: emptyDrawioXml(pageName), notice: '', kind: 'empty' };
  }
  return {
    xml: migrateCanvasToDrawioXml(doc, opts?.labels ?? [], pageName),
    notice: DRAWIO_MIGRATED_NOTICE,
    kind: 'migrated',
    legacy: {
      nodes: doc.nodes.map((n) => ({ ...n })),
      edges: doc.edges.map((e) => ({ ...e })),
    },
  };
}

/**
 * 把 v1 节点/自由边收成 mxfile。
 * labels 只用于文案、失效样式，以及「两端都在文件里」的父子结构边。
 * 不把大纲里有、文件里没有的节点补进来。
 */
export function migrateCanvasToDrawioXml(
  doc: FrameworkCanvasDoc,
  labels: DrawioLabel[] = [],
  pageName = '画布',
): string {
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const hasLabels = labels.length > 0;
  const ids = new Set<string>();
  const used = new Set<string>(['0', '1']);
  const idMap = new Map<string, string>();
  const mapId = (id: string): string => {
    const prev = idMap.get(id);
    if (prev) return prev;
    let salt = idMap.size + 1;
    let next = id;
    if (used.has(next) || /[\s<>&"']/.test(next)) {
      next = `n${salt}`;
      salt += 1;
    }
    while (used.has(next)) {
      next = `n${salt}`;
      salt += 1;
    }
    used.add(next);
    idMap.set(id, next);
    return next;
  };

  const cells: string[] = [];
  for (const n of doc.nodes) {
    if (!n.id || ids.has(n.id)) continue;
    ids.add(n.id);
    const label = labelById.get(n.id);
    const text = (label?.text ?? n.text ?? n.id).trim() || n.id;
    const ghost = hasLabels && !label;
    const shown = ghost ? `（失效）${text}` : text;
    const style = shapeStyle(n.shape, ghost);
    cells.push(
      `<mxCell id="${xmlEscape(mapId(n.id))}" value="${cellValue(shown)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${numAttr(n.x)}" y="${numAttr(n.y)}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry"/></mxCell>`,
    );
  }

  const pair = new Set<string>();
  let ei = 0;
  const pushEdge = (from: string, to: string, arrow: boolean): void => {
    if (!ids.has(from) || !ids.has(to) || from === to) return;
    const key = `${from}->${to}`;
    if (pair.has(key)) return;
    pair.add(key);
    ei += 1;
    cells.push(edgeXml(`e${ei}`, mapId(from), mapId(to), arrow));
  };
  for (const e of doc.edges) pushEdge(e.from, e.to, e.arrow === true);
  if (hasLabels) {
    for (const l of labels) {
      if (l.parentId) pushEdge(l.parentId, l.id, false);
    }
  }
  return wrapMxfile(pageName, cells.join('\n        '));
}

/** 保存前收成稳定形状。非法 draw.io XML 仍返回 version 2 和空 xml，由服务拒绝写入。 */
export function canvasDocForSave(
  doc: FrameworkCanvasDoc,
  opts: { mode: CanvasMode; frameworkPath: string; title?: string },
): FrameworkCanvasDoc {
  const mode = opts.mode === 'scratch' ? 'scratch' : 'bound';
  const frameworkPath = mode === 'scratch' ? '' : (opts.frameworkPath || doc.frameworkPath || '').replace(/\\/g, '/');
  const titleRaw = opts.title ?? doc.title;
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  const wantsDrawio = doc.version === 2 || (typeof doc.xml === 'string' && doc.xml.includes('<'));
  if (wantsDrawio) {
    const xml = typeof doc.xml === 'string' ? doc.xml : '';
    const legacy = cleanLegacy(doc.legacy);
    return {
      version: 2,
      mode,
      frameworkPath,
      ...(mode === 'scratch' || title ? { title: title || '梳理画布' } : {}),
      viewport: { k: 1, tx: 0, ty: 0 },
      nodes: [],
      edges: [],
      xml,
      ...(legacy ? { legacy } : {}),
    };
  }
  return {
    version: 1,
    mode,
    frameworkPath,
    ...(mode === 'scratch' || title ? { title: title || '梳理画布' } : {}),
    viewport: doc.viewport ?? { k: 1, tx: 48, ty: 48 },
    nodes: Array.isArray(doc.nodes) ? doc.nodes : [],
    edges: Array.isArray(doc.edges) ? doc.edges : [],
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cellValue(text: string): string {
  return text.split(/\r?\n/).map(xmlEscape).join('&lt;br&gt;');
}

function numAttr(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10) / 10);
}

function shapeStyle(shape: CanvasShape, ghost: boolean): string {
  const base =
    shape === 'ellipse'
      ? 'ellipse;whiteSpace=wrap;html=1;'
      : shape === 'rect'
        ? 'rounded=0;whiteSpace=wrap;html=1;'
        : 'rounded=1;whiteSpace=wrap;html=1;arcSize=20;';
  return ghost ? `${base}dashed=1;opacity=60;` : base;
}

function edgeXml(id: string, from: string, to: string, arrow: boolean): string {
  const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=${arrow ? 'classic' : 'none'};`;
  return `<mxCell id="${xmlEscape(id)}" style="${style}" edge="1" parent="1" source="${xmlEscape(from)}" target="${xmlEscape(to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function wrapMxfile(pageName: string, body: string): string {
  const inner = body.trim();
  return `<mxfile host="Flyleaf" agent="Flyleaf" version="22.1.0">\n  <diagram id="flyleaf" name="${xmlEscape(pageName)}">\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n        ${inner}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`;
}

function cleanLegacy(legacy: CanvasLegacy | undefined): CanvasLegacy | undefined {
  if (!legacy) return undefined;
  const parsed = parseCanvasJson(JSON.stringify({ version: 1, nodes: legacy.nodes, edges: legacy.edges }), '');
  if (!parsed.doc || (parsed.doc.nodes.length === 0 && parsed.doc.edges.length === 0)) return undefined;
  return { nodes: parsed.doc.nodes, edges: parsed.doc.edges };
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
  const ver = o.version;
  const drawio = ver === 2 || ver === '2' || (o.format === 'drawio' && typeof o.xml === 'string' && ver !== 1 && ver !== '1');
  if (drawio) return parseDrawioRecord(o, frameworkPath);
  if (ver !== 1 && ver !== '1') {
    return { degraded: true, doc: null, reason: 'bad-version' };
  }
  const vpIn = o.viewport && typeof o.viewport === 'object' ? (o.viewport as Record<string, unknown>) : {};
  const viewport: CanvasViewport = {
    k: clampCanvasZoom(num(vpIn.k, 1)),
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
      const text = typeof n.text === 'string' ? n.text : undefined;
      nodes.push({
        id,
        x: num(n.x, 0),
        y: num(n.y, 0),
        w: Math.max(40, num(n.w, DEFAULT_W)),
        h: Math.max(24, num(n.h, DEFAULT_H)),
        shape: asShape(n.shape),
        ...(text !== undefined ? { text } : {}),
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

  const title = typeof o.title === 'string' ? o.title : undefined;
  return {
    degraded: false,
    doc: {
      version: 1,
      mode: o.mode === 'scratch' ? 'scratch' : 'bound',
      frameworkPath: fp,
      ...(title !== undefined ? { title } : {}),
      viewport,
      nodes,
      edges,
    },
  };
}

function parseDrawioRecord(o: Record<string, unknown>, frameworkPath: string): CanvasLoadResult {
  const xml = typeof o.xml === 'string' ? o.xml : '';
  if (!isDrawioXml(xml)) return { degraded: true, doc: null, reason: 'bad-xml' };
  const fp =
    typeof o.frameworkPath === 'string' && o.frameworkPath.trim()
      ? o.frameworkPath.replace(/\\/g, '/')
      : frameworkPath.replace(/\\/g, '/');
  const title = typeof o.title === 'string' ? o.title : undefined;
  const legacy = cleanLegacy(
    o.legacy && typeof o.legacy === 'object' ? (o.legacy as CanvasLegacy) : undefined,
  );
  return {
    degraded: false,
    doc: {
      version: 2,
      mode: o.mode === 'scratch' ? 'scratch' : 'bound',
      frameworkPath: fp,
      ...(title !== undefined ? { title } : {}),
      viewport: { k: 1, tx: 0, ty: 0 },
      nodes: [],
      edges: [],
      xml,
      ...(legacy ? { legacy } : {}),
    },
  };
}

function serializeDrawioDoc(doc: FrameworkCanvasDoc): string {
  const mode = doc.mode === 'scratch' ? 'scratch' : 'bound';
  const xml = doc.xml ?? '';
  if (!isDrawioXml(xml)) throw new Error('drawio xml missing');
  const legacy = cleanLegacy(doc.legacy);
  const title = typeof doc.title === 'string' ? doc.title.trim() : '';
  const clean = {
    version: 2 as const,
    format: 'drawio' as const,
    mode,
    frameworkPath: (doc.frameworkPath || '').replace(/\\/g, '/'),
    ...(mode === 'scratch' || title ? { title: title || '梳理画布' } : {}),
    xml,
    ...(legacy ? { legacy } : {}),
  };
  return `${JSON.stringify(clean, null, 2)}\n`;
}

export function serializeCanvasDoc(doc: FrameworkCanvasDoc): string {
  if (doc.version === 2 || (typeof doc.xml === 'string' && isDrawioXml(doc.xml))) {
    return serializeDrawioDoc(doc);
  }
  const mode = doc.mode === 'scratch' ? 'scratch' : 'bound';
  const clean: FrameworkCanvasDoc = {
    version: 1,
    mode,
    frameworkPath: (doc.frameworkPath || '').replace(/\\/g, '/'),
    ...(mode === 'scratch' || (typeof doc.title === 'string' && doc.title)
      ? { title: (doc.title || '梳理画布').trim() || '梳理画布' }
      : {}),
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
      ...(typeof n.text === 'string' ? { text: n.text } : {}),
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
