import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import type {
  FrameworkCanvasDoc,
  FrameworkCanvasLoadResult,
  FrameworkTree,
  NavTarget,
  TreeNode,
} from '@flyleaf/core/contracts';
import { clampCanvasZoom, wheelZoomFactor, zoomCanvasView } from '@flyleaf/core/contracts';

type CanvasShape = 'round' | 'rect' | 'ellipse';
type Tool = 'select' | 'round' | 'rect' | 'ellipse' | 'link' | 'delete';
type Side = 'n' | 'e' | 's' | 'w';

const NODE_W = 208;
const NODE_H = 34;
const GAP_Y = 18;
const GAP_X = 228;
const PAD = 48;
const LABEL_MAX = 16;
const GRID = 20;
const HANDLE = 7;
const DRAG_PX = 4;
const SIDES: Side[] = ['n', 'e', 's', 'w'];

interface FlatNode {
  id: string;
  text: string;
  state: string;
  target: NavTarget | null;
  linkedNotes: number;
  line: number;
  childCount: number;
  parentId: string | null;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: CanvasShape;
  text: string;
  state: string;
  target: NavTarget | null;
  linkedNotes: number;
  line: number;
  childCount: number;
  ghost?: boolean;
}

interface LinkEdge {
  id: string;
  from: string;
  to: string;
  arrow?: boolean;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

function flattenLive(root: TreeNode, collapsed: Set<string>): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: TreeNode, parentId: string | null, hideKids: boolean): void => {
    out.push({
      id: n.id,
      text: n.text,
      state: n.state,
      target: n.target,
      linkedNotes: n.linkedNotes,
      line: n.line,
      childCount: n.children.length,
      parentId,
    });
    if (hideKids) return;
    const nextHide = collapsed.has(n.id);
    for (const c of n.children) walk(c, n.id, nextHide);
  };
  walk(root, null, false);
  return out;
}

function treeDefaults(root: TreeNode, collapsed: Set<string>): Map<string, { x: number; y: number; w: number; h: number }> {
  type Lite = { id: string; children: Lite[] };
  const toLite = (n: TreeNode): Lite => ({
    id: n.id,
    children: collapsed.has(n.id) ? [] : n.children.map(toLite),
  });
  const h = hierarchy<Lite>(toLite(root));
  d3tree<Lite>().nodeSize([NODE_H + GAP_Y, GAP_X])(h);
  const map = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const d of h.descendants()) {
    map.set(d.data.id, {
      x: d.y ?? 0,
      y: (d.x ?? 0) - NODE_H / 2,
      w: NODE_W,
      h: NODE_H,
    });
  }
  return map;
}

function orthogonalPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = Math.round((from.x + to.x) / 2);
  if (Math.abs(from.y - to.y) < 0.5) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

function anchorOf(n: LayoutNode, side: Side): { x: number; y: number } {
  if (side === 'n') return { x: n.x + n.w / 2, y: n.y };
  if (side === 's') return { x: n.x + n.w / 2, y: n.y + n.h };
  if (side === 'w') return { x: n.x, y: n.y + n.h / 2 };
  return { x: n.x + n.w, y: n.y + n.h / 2 };
}

function routeSides(a: LayoutNode, b: LayoutNode): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['e', 'w'] : ['w', 'e'];
  return dy >= 0 ? ['s', 'n'] : ['n', 's'];
}

function edgePath(a: LayoutNode, b: LayoutNode): string {
  const [sa, sb] = routeSides(a, b);
  return orthogonalPath(anchorOf(a, sa), anchorOf(b, sb));
}

function shapeRx(shape: CanvasShape, w: number, h: number): { rx: number; ry: number } {
  if (shape === 'rect') return { rx: 0, ry: 0 };
  if (shape === 'ellipse') return { rx: w / 2, ry: h / 2 };
  return { rx: 8, ry: 8 };
}

function hitNode(list: LayoutNode[], x: number, y: number, ignore?: string): LayoutNode | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const n = list[i];
    if (!n || n.id === ignore) continue;
    if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
  }
  return null;
}

function emptyBoundDoc(path: string): FrameworkCanvasDoc {
  return {
    version: 1,
    mode: 'bound',
    frameworkPath: path.replace(/\\/g, '/'),
    viewport: { k: 1, tx: PAD, ty: PAD },
    nodes: [],
    edges: [],
  };
}

function emptyScratchLocal(title: string): FrameworkCanvasDoc {
  return {
    version: 1,
    mode: 'scratch',
    frameworkPath: '',
    title: title.trim() || '梳理画布',
    viewport: { k: 1, tx: PAD, ty: PAD },
    nodes: [],
    edges: [],
  };
}

function newScratchNodeId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function newEdgeId(from: string, to: string): string {
  return `e_${from.slice(0, 6)}_${to.slice(0, 6)}_${Date.now().toString(36).slice(-4)}`;
}

function typingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.isContentEditable ||
    !!t.closest('.cm-editor') ||
    !!t.closest('.palette')
  );
}

export interface FrameworkCanvasProps {
  /** 默认 bound；scratch=纯梳理，不绑 md */
  mode?: 'bound' | 'scratch';
  /** bound 必填；scratch 可省略 */
  framework?: FrameworkTree;
  /** scratch 存盘路径；bound 时用 framework.path */
  canvasPath?: string;
  /** scratch 标题 */
  scratchTitle?: string;
  onScratchTitleChange?: (title: string) => void;
  collapsed?: Set<string>;
  onToggle?: (id: string) => void;
  onNavigate?: (target: NavTarget | null) => void;
  /** bound：F2 改大纲标题（不在画布里建文件） */
  onRenameLine?: (line: number) => void;
  highlightLine?: number | null;
  onSelectLine?: (line: number | null) => void;
  loadCanvas: (path: string) => Promise<FrameworkCanvasLoadResult>;
  saveCanvas: (path: string, doc: FrameworkCanvasDoc) => Promise<FrameworkCanvasDoc>;
}

export function FrameworkCanvas({
  mode = 'bound',
  framework,
  canvasPath,
  scratchTitle = '梳理画布',
  onScratchTitleChange,
  collapsed = new Set(),
  onToggle,
  onNavigate,
  onRenameLine,
  highlightLine = null,
  onSelectLine,
  loadCanvas,
  saveCanvas,
}: FrameworkCanvasProps): React.ReactElement {
  const isScratch = mode === 'scratch';
  const docPath = isScratch
    ? (canvasPath || '').replace(/\\/g, '/')
    : (framework?.path || '').replace(/\\/g, '/');
  const gridId = `fc-grid-${useId().replace(/:/g, '')}`;
  const [title, setTitle] = useState(scratchTitle);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<View>({ k: 1, tx: PAD, ty: PAD });
  const [nodes, setNodes] = useState<LayoutNode[]>([]);
  const [edges, setEdges] = useState<LinkEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [draftLine, setDraftLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragNodeRef = useRef<{ id: string; ox: number; oy: number; nx: number; ny: number } | null>(null);
  const resizeRef = useRef<{
    id: string;
    corner: string;
    ox: number;
    oy: number;
    nx: number;
    ny: number;
    nw: number;
    nh: number;
  } | null>(null);
  const linkDragRef = useRef<{ fromId: string } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const spaceRef = useRef(false);
  const clickTimer = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGen = useRef(0);
  const dirtyRef = useRef(false);
  const pendingFit = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const titleRef = useRef(title);
  titleRef.current = title;
  const docPathRef = useRef(docPath);
  docPathRef.current = docPath;
  const loadRef = useRef(loadCanvas);
  loadRef.current = loadCanvas;
  const saveRef = useRef(saveCanvas);
  saveRef.current = saveCanvas;

  useEffect(() => {
    setTitle(scratchTitle);
  }, [scratchTitle, docPath]);

  const live = useMemo(() => {
    if (isScratch || !framework) return [] as FlatNode[];
    return flattenLive(framework.root, collapsed);
  }, [isScratch, framework, collapsed]);
  const liveById = useMemo(() => new Map(live.map((n) => [n.id, n])), [live]);

  const treeLinks = useMemo(() => {
    if (isScratch) return [] as { id: string; from: string; to: string }[];
    const out: { id: string; from: string; to: string }[] = [];
    for (const n of live) {
      if (n.parentId) out.push({ id: `tree:${n.parentId}->${n.id}`, from: n.parentId, to: n.id });
    }
    return out;
  }, [live, isScratch]);

  const applyStored = useCallback(
    (stored: FrameworkCanvasDoc | null): void => {
      const applyView = (next: View, fit: boolean): void => {
        viewRef.current = next;
        setView(next);
        pendingFit.current = fit;
      };
      if (isScratch) {
        const next: LayoutNode[] = [];
        for (const n of stored?.nodes ?? []) {
          next.push({
            id: n.id,
            x: n.x,
            y: n.y,
            w: n.w,
            h: n.h,
            shape: (n.shape as CanvasShape) || 'round',
            text: typeof n.text === 'string' && n.text ? n.text : '新节点',
            state: 'todo',
            target: null,
            linkedNotes: 0,
            line: 0,
            childCount: 0,
          });
        }
        const idSet = new Set(next.map((n) => n.id));
        const nextEdges: LinkEdge[] = [];
        for (const e of stored?.edges ?? []) {
          if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
          nextEdges.push({ id: e.id, from: e.from, to: e.to, arrow: e.arrow });
        }
        setNodes(next);
        setEdges(nextEdges);
        if (stored?.title) setTitle(stored.title);
        if (stored?.viewport) {
          applyView(
            {
              k: clampCanvasZoom(stored.viewport.k || 1),
              tx: stored.viewport.tx ?? PAD,
              ty: stored.viewport.ty ?? PAD,
            },
            false,
          );
        } else {
          applyView({ k: 1, tx: PAD, ty: PAD }, true);
        }
        return;
      }
      if (!framework) return;
      const defaults = treeDefaults(framework.root, collapsed);
      const byId = new Map<string, LayoutNode>();
      if (stored) {
        for (const n of stored.nodes) {
          byId.set(n.id, {
            id: n.id,
            x: n.x,
            y: n.y,
            w: n.w,
            h: n.h,
            shape: (n.shape as CanvasShape) || 'round',
            text: '',
            state: 'todo',
            target: null,
            linkedNotes: 0,
            line: 0,
            childCount: 0,
          });
        }
      }
      const next: LayoutNode[] = [];
      for (const n of live) {
        const prev = byId.get(n.id);
        const def = defaults.get(n.id);
        byId.delete(n.id);
        next.push({
          id: n.id,
          x: prev?.x ?? def?.x ?? 0,
          y: prev?.y ?? def?.y ?? 0,
          w: prev?.w ?? def?.w ?? NODE_W,
          h: prev?.h ?? def?.h ?? NODE_H,
          shape: prev?.shape ?? 'round',
          text: n.text,
          state: n.state,
          target: n.target,
          linkedNotes: n.linkedNotes,
          line: n.line,
          childCount: n.childCount,
        });
      }
      for (const [, ghost] of byId) {
        next.push({ ...ghost, text: '(已失效)', state: 'todo', ghost: true, childCount: 0 });
      }
      const liveSet = new Set(live.map((n) => n.id));
      const nextEdges: LinkEdge[] = [];
      for (const e of stored?.edges ?? []) {
        if (!liveSet.has(e.from) || !liveSet.has(e.to)) continue;
        nextEdges.push({ id: e.id, from: e.from, to: e.to, arrow: e.arrow });
      }
      setNodes(next);
      setEdges(nextEdges);
      if (stored?.viewport) {
        applyView(
          {
            k: clampCanvasZoom(stored.viewport.k || 1),
            tx: stored.viewport.tx ?? PAD,
            ty: stored.viewport.ty ?? PAD,
          },
          false,
        );
      } else {
        applyView({ k: 1, tx: PAD, ty: PAD }, true);
      }
    },
    [isScratch, framework, collapsed, live],
  );

  const applyStoredRef = useRef(applyStored);
  applyStoredRef.current = applyStored;

  // 只在换文件时读盘。父组件重绘若把 loadCanvas 换成新函数，不能把缩放和拖拽打回去。
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setLinkFrom(null);
    setDraftLine(null);
    setEditingId(null);
    setDirty(false);
    dirtyRef.current = false;
    void (async () => {
      try {
        if (!docPath) {
          applyStoredRef.current(null);
          return;
        }
        const res = await loadRef.current(docPath);
        if (cancelled) return;
        applyStoredRef.current(res.doc);
      } catch {
        if (!cancelled) applyStoredRef.current(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docPath]);

  useEffect(() => {
    if (!ready || isScratch || !framework) return;
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const defaults = treeDefaults(framework.root, collapsed);
      const next: LayoutNode[] = [];
      for (const n of live) {
        const p = prevMap.get(n.id);
        const def = defaults.get(n.id);
        next.push({
          id: n.id,
          x: p?.x ?? def?.x ?? 0,
          y: p?.y ?? def?.y ?? 0,
          w: p?.w ?? def?.w ?? NODE_W,
          h: p?.h ?? def?.h ?? NODE_H,
          shape: p?.shape ?? 'round',
          text: n.text,
          state: n.state,
          target: n.target,
          linkedNotes: n.linkedNotes,
          line: n.line,
          childCount: n.childCount,
        });
      }
      for (const p of prev) {
        if (p.ghost && !liveById.has(p.id)) next.push(p);
      }
      return next;
    });
  }, [live, ready, framework, collapsed, liveById, isScratch]);

  const buildDoc = useCallback((): FrameworkCanvasDoc => {
    if (isScratch) {
      const base = emptyScratchLocal(titleRef.current);
      return {
        ...base,
        viewport: { ...viewRef.current },
        nodes: nodes.map((n) => ({
          id: n.id,
          x: Math.round(n.x * 10) / 10,
          y: Math.round(n.y * 10) / 10,
          w: Math.round(n.w),
          h: Math.round(n.h),
          shape: n.shape,
          text: n.text,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          kind: 'link' as const,
          from: e.from,
          to: e.to,
          ...(e.arrow ? { arrow: true } : {}),
        })),
      };
    }
    const base = emptyBoundDoc(docPath);
    return {
      ...base,
      viewport: { ...viewRef.current },
      nodes: nodes
        .filter((n) => !n.ghost)
        .map((n) => ({
          id: n.id,
          x: Math.round(n.x * 10) / 10,
          y: Math.round(n.y * 10) / 10,
          w: Math.round(n.w),
          h: Math.round(n.h),
          shape: n.shape,
        })),
      edges: edges.map((e) => ({
        id: e.id,
        kind: 'link' as const,
        from: e.from,
        to: e.to,
        ...(e.arrow ? { arrow: true } : {}),
      })),
    };
  }, [isScratch, docPath, nodes, edges]);

  const buildDocRef = useRef(buildDoc);
  buildDocRef.current = buildDoc;

  const scheduleSave = useCallback((): void => {
    const path = docPathRef.current;
    if (!path) return;
    const gen = ++saveGen.current;
    dirtyRef.current = true;
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (docPathRef.current !== path) return;
      const doc = buildDocRef.current();
      void saveRef
        .current(path, doc)
        .then(() => {
          if (saveGen.current === gen && docPathRef.current === path) {
            dirtyRef.current = false;
            setDirty(false);
          }
        })
        .catch(() => {
          /* 保留未保存标记 */
        });
    }, 400);
  }, []);

  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;

  useEffect(
    () => () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (!dirtyRef.current) return;
      const path = docPathRef.current;
      if (!path) return;
      dirtyRef.current = false;
      void saveRef.current(path, buildDocRef.current()).catch(() => {
        /* 卸载时写盘失败不打断关闭 */
      });
    },
    [],
  );

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const bounds = useMemo(() => {
    let minX = 0;
    let maxX = 400;
    let minY = 0;
    let maxY = 300;
    if (nodes.length) {
      minX = Infinity;
      maxX = -Infinity;
      minY = Infinity;
      maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x + n.w);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y + n.h);
      }
    }
    return { minX, maxX, minY, maxY };
  }, [nodes]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const fitNow = useCallback((persist: boolean): void => {
    const el = svgRef.current;
    const b = boundsRef.current;
    const w = el?.clientWidth ?? 900;
    const h = el?.clientHeight ?? 600;
    const cw = Math.max(1, b.maxX - b.minX);
    const ch = Math.max(1, b.maxY - b.minY);
    const k = clampCanvasZoom(Math.min(1.15, Math.min((w - PAD * 2) / cw, (h - PAD * 2) / ch)));
    const next = {
      k,
      tx: (w - cw * k) / 2 - b.minX * k,
      ty: (h - ch * k) / 2 - b.minY * k,
    };
    viewRef.current = next;
    setView(next);
    if (persist) scheduleSaveRef.current();
  }, []);

  useEffect(() => {
    if (!ready || !pendingFit.current) return;
    let frames = 0;
    let raf = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled || !pendingFit.current) return;
      const el = svgRef.current;
      frames += 1;
      if (!el || el.clientWidth < 8) {
        if (frames < 40) raf = requestAnimationFrame(tick);
        return;
      }
      pendingFit.current = false;
      fitNow(false);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [ready, bounds, fitNow]);

  const clientToView = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (svg) {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
      }
      const rect = svg.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }
    return { x: 0, y: 0 };
  };

  const clientToWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    const g = worldRef.current;
    if (svg && g) {
      const ctm = g.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
      }
    }
    const local = clientToView(clientX, clientY);
    const v = viewRef.current;
    const k = v.k || 1;
    return { x: (local.x - v.tx) / k, y: (local.y - v.ty) / k };
  };

  const zoomAt = (clientX: number, clientY: number, factor: number): void => {
    const anchor = clientToView(clientX, clientY);
    setView((v) => {
      const next = zoomCanvasView(v, anchor.x, anchor.y, factor);
      viewRef.current = next;
      return next;
    });
    scheduleSaveRef.current();
  };

  const zoomBy = (factor: number): void => {
    const el = svgRef.current;
    const rect = el?.getBoundingClientRect();
    zoomAt((rect?.left ?? 0) + (el?.clientWidth ?? 900) / 2, (rect?.top ?? 0) + (el?.clientHeight ?? 600) / 2, factor);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
      if (factor === 1) return;
      zoomAt(e.clientX, e.clientY, factor);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [docPath]);

  const selectNode = (n: LayoutNode): void => {
    setSelectedId(n.id);
    setSelectedEdgeId(null);
    if (!isScratch && n.line > 0) onSelectLine?.(n.line);
  };

  const beginEdit = (n: LayoutNode): void => {
    if (!isScratch) {
      if (n.line > 0) onRenameLine?.(n.line);
      return;
    }
    setEditingId(n.id);
    setEditingText(n.text);
    setSelectedId(n.id);
  };

  const commitEdit = (): void => {
    if (!editingId) return;
    const text = editingText.trim() || '新节点';
    const id = editingId;
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)));
    setEditingId(null);
    scheduleSave();
  };

  const addEdge = (from: string, to: string): void => {
    if (!from || !to || from === to) return;
    setEdges((prev) => {
      if (prev.some((e) => e.from === from && e.to === to)) return prev;
      return [...prev, { id: newEdgeId(from, to), from, to }];
    });
    setLinkFrom(null);
    setDraftLine(null);
    setDropId(null);
    linkDragRef.current = null;
    scheduleSave();
  };

  const removeNode = (id: string): void => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    scheduleSave();
  };

  const deleteSelection = (): void => {
    if (selectedEdgeId) {
      const id = selectedEdgeId;
      setEdges((prev) => prev.filter((e) => e.id !== id));
      setSelectedEdgeId(null);
      scheduleSave();
      return;
    }
    if (!selectedId) return;
    const n = nodeMap.get(selectedId);
    if (!n) return;
    if (isScratch || n.ghost) removeNode(n.id);
  };

  const captureSvg = (e: React.PointerEvent): void => {
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 画布未挂上时忽略 */
    }
  };

  const beginPan = (e: React.PointerEvent): void => {
    const v = viewRef.current;
    panRef.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty };
    dragNodeRef.current = null;
    resizeRef.current = null;
    setPanning(true);
    captureSvg(e);
  };

  const movedPast = (e: React.PointerEvent): boolean => {
    const s = pointerStartRef.current;
    if (!s) return false;
    return Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_PX;
  };

  const onNodePointerDown = (e: React.PointerEvent, n: LayoutNode): void => {
    if (editingId === n.id) return;
    e.stopPropagation();
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    suppressClickRef.current = false;
    if (e.button === 1 || spaceRef.current) {
      e.preventDefault();
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    captureSvg(e);

    if (tool === 'link' || linkFrom) {
      if (!linkFrom) {
        setLinkFrom(n.id);
        linkDragRef.current = { fromId: n.id };
        const c = anchorOf(n, 'e');
        setDraftLine({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
      } else if (linkFrom !== n.id) {
        addEdge(linkFrom, n.id);
      }
      selectNode(n);
      return;
    }

    if (tool === 'delete') {
      if (isScratch || n.ghost) removeNode(n.id);
      else selectNode(n);
      return;
    }

    selectNode(n);
    if (tool === 'round' || tool === 'rect' || tool === 'ellipse') {
      setNodes((prev) => prev.map((x) => (x.id === n.id ? { ...x, shape: tool } : x)));
      scheduleSave();
    }
    const w = clientToWorld(e.clientX, e.clientY);
    dragNodeRef.current = { id: n.id, ox: w.x, oy: w.y, nx: n.x, ny: n.y };
  };

  const onPortPointerDown = (e: React.PointerEvent, n: LayoutNode, side: Side): void => {
    e.stopPropagation();
    e.preventDefault();
    if (n.ghost) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    suppressClickRef.current = true;
    const c = anchorOf(n, side);
    setLinkFrom(n.id);
    linkDragRef.current = { fromId: n.id };
    setDraftLine({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
    setSelectedId(n.id);
    setSelectedEdgeId(null);
    captureSvg(e);
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    const target = e.target as Element | null;
    if (target?.closest('[data-node],[data-edge],[data-handle],[data-port]')) return;
    if (editingId) commitEdit();
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    setSelectedId(null);
    setSelectedEdgeId(null);
    if (!isScratch) onSelectLine?.(null);
    if (tool === 'link' || linkFrom) {
      setLinkFrom(null);
      setDraftLine(null);
      linkDragRef.current = null;
      setDropId(null);
    }
    const creating =
      isScratch && e.button === 0 && !spaceRef.current && (tool === 'round' || tool === 'rect' || tool === 'ellipse');
    if (!creating && (e.button === 0 || e.button === 1)) beginPan(e);
    if (e.button !== 0 || spaceRef.current) return;
    if (creating) {
      const w = clientToWorld(e.clientX, e.clientY);
      const id = newScratchNodeId();
      const node: LayoutNode = {
        id,
        x: w.x - NODE_W / 2,
        y: w.y - NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
        shape: tool,
        text: '新节点',
        state: 'todo',
        target: null,
        linkedNotes: 0,
        line: 0,
        childCount: 0,
      };
      setNodes((prev) => [...prev, node]);
      setSelectedId(id);
      panRef.current = null;
      setPanning(false);
      scheduleSave();
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (movedPast(e)) suppressClickRef.current = true;
    const w = clientToWorld(e.clientX, e.clientY);
    if (draftLine && (linkFrom || linkDragRef.current)) {
      setDraftLine((d) => (d ? { ...d, x2: w.x, y2: w.y } : d));
      const from = linkDragRef.current?.fromId ?? linkFrom ?? undefined;
      const hit = hitNode(nodesRef.current, w.x, w.y, from);
      setDropId(hit?.id ?? null);
    }
    const rz = resizeRef.current;
    if (rz) {
      const dx = w.x - rz.ox;
      const dy = w.y - rz.oy;
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== rz.id) return n;
          let x = rz.nx;
          let y = rz.ny;
          let ww = rz.nw;
          let hh = rz.nh;
          if (rz.corner.includes('e')) ww = Math.max(80, rz.nw + dx);
          if (rz.corner.includes('s')) hh = Math.max(28, rz.nh + dy);
          if (rz.corner.includes('w')) {
            ww = Math.max(80, rz.nw - dx);
            x = rz.nx + (rz.nw - ww);
          }
          if (rz.corner.includes('n')) {
            hh = Math.max(28, rz.nh - dy);
            y = rz.ny + (rz.nh - hh);
          }
          return { ...n, x, y, w: ww, h: hh };
        }),
      );
      return;
    }
    const dn = dragNodeRef.current;
    if (dn && suppressClickRef.current) {
      const dx = w.x - dn.ox;
      const dy = w.y - dn.oy;
      setNodes((prev) => prev.map((n) => (n.id === dn.id ? { ...n, x: dn.nx + dx, y: dn.ny + dy } : n)));
      return;
    }
    const p = panRef.current;
    if (p) {
      const next = { ...viewRef.current, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) };
      viewRef.current = next;
      setView(next);
    }
  };

  const finishLink = (e: React.PointerEvent<SVGSVGElement>): void => {
    const from = linkDragRef.current?.fromId;
    if (!from) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const hit = hitNode(nodesRef.current, w.x, w.y, from);
    linkDragRef.current = null;
    setDropId(null);
    if (hit) {
      addEdge(from, hit.id);
      return;
    }
    const start = pointerStartRef.current;
    const dist = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 0;
    if (dist > 12) {
      setLinkFrom(null);
      setDraftLine(null);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    const dragged = suppressClickRef.current && (!!dragNodeRef.current || !!resizeRef.current);
    finishLink(e);
    if (dragged) scheduleSave();
    dragNodeRef.current = null;
    resizeRef.current = null;
    if (panRef.current) {
      const moved = suppressClickRef.current;
      panRef.current = null;
      setPanning(false);
      if (moved) scheduleSave();
    }
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const startResize = (e: React.PointerEvent, n: LayoutNode, corner: string): void => {
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = true;
    const w = clientToWorld(e.clientX, e.clientY);
    resizeRef.current = { id: n.id, corner, ox: w.x, oy: w.y, nx: n.x, ny: n.y, nw: n.w, nh: n.h };
    dragNodeRef.current = null;
    captureSvg(e);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === ' ' && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (typingTarget(e.target) || tag === 'BUTTON' || tag === 'A') return;
        spaceRef.current = true;
        e.preventDefault();
        return;
      }
      if (typingTarget(e.target)) return;
      if (e.key === 'Escape') {
        setLinkFrom(null);
        setDraftLine(null);
        linkDragRef.current = null;
        setDropId(null);
        setEditingId(null);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        deleteSelection();
        return;
      }
      if (e.key === 'F2') {
        const id = selectedId;
        const n = id ? nodeMap.get(id) : undefined;
        if (n && !n.ghost) {
          e.preventDefault();
          beginEdit(n);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.key === '0') {
          e.preventDefault();
          fitNow(true);
        }
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(1.12);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(1 / 1.12);
      } else if (e.key === '0') {
        e.preventDefault();
        fitNow(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  });

  const selected = selectedId ? nodeMap.get(selectedId) : null;
  const zoomPct = Math.round(view.k * 100);
  const handlePx = HANDLE / Math.max(view.k, 0.2);
  const portR = 5 / Math.max(view.k, 0.2);

  const tools: { id: Tool; label: string; title: string }[] = [
    { id: 'select', label: '选择', title: '选择、拖动节点。空白处拖动画布，中键或按住空格也可平移' },
    { id: 'rect', label: '矩形', title: isScratch ? '矩形：点空白处新建，或点已有节点改形状' : '把选中节点改成矩形' },
    { id: 'round', label: '圆角', title: isScratch ? '圆角矩形：点空白处新建' : '把选中节点改成圆角矩形' },
    { id: 'ellipse', label: '椭圆', title: isScratch ? '椭圆：点空白处新建' : '把选中节点改成椭圆' },
    { id: 'link', label: '连线', title: '从一个节点拖到另一个节点。树状连线只读，这条是自由连线' },
    {
      id: 'delete',
      label: '删除',
      title: isScratch ? '删除选中的节点或自由连线' : '删除自由连线或已失效节点。不删大纲，也不删笔记',
    },
  ];

  return (
    <div className="mm-wrap fc-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`mm-svg${panning ? ' is-panning' : ''}${tool === 'link' ? ' is-link' : ''}`}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onAuxClick={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id={gridId}
            width={GRID}
            height={GRID}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}
          >
            <path className="mm-grid-line" d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <rect className="fc-back" width="100%" height="100%" fill={`url(#${gridId})`} />
        <g ref={worldRef} transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          {treeLinks.map((l) => {
            const a = nodeMap.get(l.from);
            const b = nodeMap.get(l.to);
            if (!a || !b) return null;
            return (
              <path
                key={l.id}
                className="mm-link fc-tree-link"
                d={orthogonalPath(anchorOf(a, 'e'), anchorOf(b, 'w'))}
                fill="none"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {edges.map((edge) => {
            const a = nodeMap.get(edge.from);
            const b = nodeMap.get(edge.to);
            if (!a || !b) return null;
            const on = selectedEdgeId === edge.id;
            const d = edgePath(a, b);
            return (
              <g key={edge.id} data-edge={edge.id} className={on ? 'fc-edge is-selected' : 'fc-edge'}>
                <path
                  className="fc-edge-hit"
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16 / Math.max(view.k, 0.2)}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    setSelectedId(null);
                    if (tool === 'delete') {
                      setEdges((prev) => prev.filter((x) => x.id !== edge.id));
                      setSelectedEdgeId(null);
                      scheduleSave();
                    }
                  }}
                />
                <path
                  className="mm-link fc-free-link"
                  d={d}
                  fill="none"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {draftLine && (
            <path
              className="fc-draft-link"
              d={orthogonalPath({ x: draftLine.x1, y: draftLine.y1 }, { x: draftLine.x2, y: draftLine.y2 })}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {nodes.map((n) => {
            const isOn =
              selectedId === n.id || (!isScratch && n.line > 0 && highlightLine != null && highlightLine === n.line);
            const label = n.text.length > LABEL_MAX ? `${n.text.slice(0, LABEL_MAX)}…` : n.text;
            const { rx, ry } = shapeRx(n.shape, n.w, n.h);
            const showPorts = !n.ghost && (hoverId === n.id || selectedId === n.id || linkFrom === n.id);
            return (
              <g
                key={n.id}
                data-node={n.id}
                transform={`translate(${n.x},${n.y})`}
                className={`mm-node state-${n.state}${isOn ? ' is-selected' : ''}${n.ghost ? ' is-ghost' : ''}${dropId === n.id ? ' is-drop' : ''}`}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId((cur) => (cur === n.id ? null : cur))}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  suppressClickRef.current = true;
                  if (clickTimer.current) {
                    window.clearTimeout(clickTimer.current);
                    clickTimer.current = null;
                  }
                  if (n.ghost) return;
                  if (isScratch) {
                    beginEdit(n);
                    return;
                  }
                  if (n.childCount > 0) onToggle?.(n.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  if (isScratch || tool !== 'select' || n.ghost || linkFrom) return;
                  if (clickTimer.current) window.clearTimeout(clickTimer.current);
                  const target = n.target;
                  clickTimer.current = window.setTimeout(() => {
                    clickTimer.current = null;
                    onNavigate?.(target);
                  }, 220);
                }}
              >
                <title>
                  {isScratch
                    ? `${n.text}（双击改字）`
                    : n.ghost
                      ? '大纲里已经没有这项，可以删除这个失效块'
                      : `${n.text}\n第 ${n.line} 行 · ${n.linkedNotes} 条关联`}
                </title>
                <rect className="mm-node-body" width={n.w} height={n.h} rx={rx} ry={ry} />
                {!n.ghost && <rect className="mm-state-bar" x={0} y={0} width={4} height={n.h} rx={2} />}
                {editingId !== n.id && (
                  <text x={14} y={n.h / 2 + 4} className="mm-label">
                    {label}
                  </text>
                )}
                {editingId === n.id && (
                  <foreignObject x={8} y={4} width={Math.max(40, n.w - 16)} height={Math.max(20, n.h - 8)}>
                    <input
                      className="fc-inline-input"
                      value={editingText}
                      autoFocus
                      aria-label="节点文案"
                      onChange={(ev) => setEditingText(ev.target.value)}
                      onBlur={commitEdit}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => {
                        ev.stopPropagation();
                        if (ev.key === 'Enter') {
                          ev.preventDefault();
                          commitEdit();
                        } else if (ev.key === 'Escape') {
                          ev.preventDefault();
                          setEditingId(null);
                        }
                      }}
                    />
                  </foreignObject>
                )}
                {n.linkedNotes > 0 && <circle cx={n.w - 10} cy={9} r={3} className="mm-linked" />}
                {showPorts &&
                  SIDES.map((side) => {
                    const p = anchorOf(n, side);
                    return (
                      <circle
                        key={side}
                        data-port={side}
                        className="fc-port"
                        cx={p.x - n.x}
                        cy={p.y - n.y}
                        r={portR}
                        onPointerDown={(ev) => onPortPointerDown(ev, n, side)}
                      />
                    );
                  })}
                {isOn && !n.ghost && (
                  <g className="fc-selection">
                    <rect
                      className="fc-sel-box"
                      x={-1}
                      y={-1}
                      width={n.w + 2}
                      height={n.h + 2}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    {(['nw', 'ne', 'sw', 'se'] as const).map((c) => {
                      const cx = c.includes('w') ? -handlePx / 2 : n.w - handlePx / 2;
                      const cy = c.includes('n') ? -handlePx / 2 : n.h - handlePx / 2;
                      return (
                        <rect
                          key={c}
                          data-handle={c}
                          className="fc-handle"
                          x={cx}
                          y={cy}
                          width={handlePx}
                          height={handlePx}
                          onPointerDown={(ev) => startResize(ev, n, c)}
                          onClick={(ev) => ev.stopPropagation()}
                        />
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mm-toolbar fc-toolbar" role="toolbar" aria-label={isScratch ? '梳理画布' : '自由画布'}>
        {isScratch && (
          <input
            className="fc-scratch-title"
            value={title}
            aria-label="梳理画布标题"
            title="梳理画布标题"
            onChange={(e) => {
              const v = e.target.value;
              setTitle(v);
              onScratchTitleChange?.(v);
            }}
            onBlur={() => scheduleSave()}
          />
        )}
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`icon-btn${tool === t.id ? ' is-on' : ''}`}
            title={t.title}
            onClick={() => {
              setTool(t.id);
              setLinkFrom(null);
              setDraftLine(null);
              linkDragRef.current = null;
              if (t.id === 'delete') deleteSelection();
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="mm-toolbar-sep" aria-hidden="true" />
        <button type="button" className="icon-btn" title="缩小（-）" onClick={() => zoomBy(1 / 1.12)}>
          −
        </button>
        <span className="mm-zoom" title="当前缩放">
          {zoomPct}%
        </span>
        <button type="button" className="icon-btn" title="放大（+）" onClick={() => zoomBy(1.12)}>
          +
        </button>
        <span className="mm-toolbar-sep" aria-hidden="true" />
        <button type="button" className="icon-btn mm-fit-btn" title="适应窗口（0）" onClick={() => fitNow(true)}>
          适应
        </button>
        <span className="mm-hint">{dirty ? '保存中…' : isScratch ? '不写笔记' : '不新建笔记'}</span>
      </div>
    </div>
  );
}
