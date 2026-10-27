import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import type {
  FrameworkCanvasDoc,
  FrameworkCanvasLoadResult,
  FrameworkTree,
  NavTarget,
  TreeNode,
} from '@flyleaf/core/contracts';

type CanvasShape = 'round' | 'rect' | 'ellipse';
type Tool = 'select' | 'round' | 'rect' | 'ellipse' | 'link' | 'delete';

const NODE_W = 208;
const NODE_H = 34;
const GAP_Y = 18;
const GAP_X = 228;
const PAD = 48;
const LABEL_MAX = 16;
const GRID = 20;
const HANDLE = 7;

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

function shapeRx(shape: CanvasShape, w: number, h: number): { rx: number; ry: number } {
  if (shape === 'rect') return { rx: 0, ry: 0 };
  if (shape === 'ellipse') return { rx: w / 2, ry: h / 2 };
  return { rx: 8, ry: 8 };
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
  highlightLine = null,
  onSelectLine,
  loadCanvas,
  saveCanvas,
}: FrameworkCanvasProps): React.ReactElement {
  const isScratch = mode === 'scratch';
  const docPath = isScratch
    ? (canvasPath || '').replace(/\\/g, '/')
    : (framework?.path || '').replace(/\\/g, '/');
  const [title, setTitle] = useState(scratchTitle);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState({ k: 1, tx: PAD, ty: PAD });
  const [nodes, setNodes] = useState<LayoutNode[]>([]);
  const [edges, setEdges] = useState<LinkEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [draftLine, setDraftLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);

  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragNodeRef = useRef<{
    id: string;
    ox: number;
    oy: number;
    nx: number;
    ny: number;
  } | null>(null);
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const titleRef = useRef(title);
  titleRef.current = title;

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
          setView({
            k: Math.min(2, Math.max(0.35, stored.viewport.k || 1)),
            tx: stored.viewport.tx ?? PAD,
            ty: stored.viewport.ty ?? PAD,
          });
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
        setView({
          k: Math.min(2, Math.max(0.35, stored.viewport.k || 1)),
          tx: stored.viewport.tx ?? PAD,
          ty: stored.viewport.ty ?? PAD,
        });
      }
    },
    [isScratch, framework, collapsed, live],
  );

  // load sidecar
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setLinkFrom(null);
    setDirty(false);
    (async () => {
      try {
        if (!docPath) {
          applyStored(null);
          if (!cancelled) setReady(true);
          return;
        }
        const res = await loadCanvas(docPath);
        if (cancelled) return;
        applyStored(res.doc);
      } catch {
        if (cancelled) return;
        applyStored(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docPath, loadCanvas, applyStored]);

  // when tree changes (collapse/rename) after ready, re-merge without wiping positions
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

  const scheduleSave = useCallback((): void => {
    if (!docPath) return;
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const doc = buildDoc();
      void saveCanvas(docPath, doc)
        .then(() => setDirty(false))
        .catch(() => {
          /* keep dirty */
        });
    }, 280);
  }, [buildDoc, saveCanvas, docPath]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

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

  const fitView = useCallback((): void => {
    const el = svgRef.current;
    const w = el?.clientWidth ?? 900;
    const h = el?.clientHeight ?? 600;
    const cw = Math.max(1, bounds.maxX - bounds.minX);
    const ch = Math.max(1, bounds.maxY - bounds.minY);
    const k = Math.min(1.15, Math.max(0.35, Math.min((w - PAD * 2) / cw, (h - PAD * 2) / ch)));
    setView({
      k,
      tx: (w - cw * k) / 2 - bounds.minX * k,
      ty: (h - ch * k) / 2 - bounds.minY * k,
    });
    scheduleSave();
  }, [bounds, scheduleSave]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const nextK = Math.min(2, Math.max(0.35, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
        const ratio = nextK / v.k;
        return { k: nextK, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio };
      });
      scheduleSave();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [scheduleSave]);

  const clientToWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.tx) / v.k, y: (clientY - rect.top - v.ty) / v.k };
  };

  const selectNode = (n: LayoutNode): void => {
    setSelectedId(n.id);
    setSelectedEdgeId(null);
    if (!isScratch && n.line > 0) onSelectLine?.(n.line);
  };

  const editScratchText = (n: LayoutNode): void => {
    if (!isScratch) return;
    const next = window.prompt('节点文案', n.text);
    if (next == null) return;
    const text = next.trim() || '新节点';
    setNodes((prev) => prev.map((x) => (x.id === n.id ? { ...x, text } : x)));
    scheduleSave();
  };

  const applyShapeTool = (n: LayoutNode): void => {
    if (tool === 'round' || tool === 'rect' || tool === 'ellipse') {
      setNodes((prev) => prev.map((x) => (x.id === n.id ? { ...x, shape: tool } : x)));
      scheduleSave();
    }
  };

  const onNodePointerDown = (e: React.PointerEvent, n: LayoutNode): void => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

    if (tool === 'link') {
      if (!linkFrom) {
        setLinkFrom(n.id);
        const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
        setDraftLine({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
      } else if (linkFrom !== n.id) {
        const id = `e_${linkFrom.slice(0, 8)}_${n.id.slice(0, 8)}_${Date.now().toString(36).slice(-4)}`;
        setEdges((prev) => [...prev, { id, from: linkFrom, to: n.id }]);
        setLinkFrom(null);
        setDraftLine(null);
        scheduleSave();
      }
      selectNode(n);
      return;
    }

    if (tool === 'delete') {
      if (isScratch) {
        setNodes((prev) => prev.filter((x) => x.id !== n.id));
        setEdges((prev) => prev.filter((e) => e.from !== n.id && e.to !== n.id));
        setSelectedId(null);
        scheduleSave();
        return;
      }
      // bound：删除只清自由边/幽灵；不删 md 节点
      if (n.ghost) {
        setNodes((prev) => prev.filter((x) => x.id !== n.id));
        scheduleSave();
      }
      selectNode(n);
      return;
    }

    selectNode(n);
    applyShapeTool(n);

    if (tool === 'select' || tool === 'round' || tool === 'rect' || tool === 'ellipse') {
      const w = clientToWorld(e.clientX, e.clientY);
      dragNodeRef.current = { id: n.id, ox: w.x, oy: w.y, nx: n.x, ny: n.y };
    }
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if ((e.target as HTMLElement).closest('[data-node],[data-edge],[data-handle]')) return;
    setSelectedId(null);
    setSelectedEdgeId(null);
    if (tool === 'link') {
      setLinkFrom(null);
      setDraftLine(null);
    }
    if (isScratch && (tool === 'round' || tool === 'rect' || tool === 'ellipse')) {
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
      scheduleSave();
      return;
    }
    panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const w = clientToWorld(e.clientX, e.clientY);
    if (draftLine && linkFrom) {
      setDraftLine((d) => (d ? { ...d, x2: w.x, y2: w.y } : d));
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
    if (dn) {
      const dx = w.x - dn.ox;
      const dy = w.y - dn.oy;
      setNodes((prev) => prev.map((n) => (n.id === dn.id ? { ...n, x: dn.nx + dx, y: dn.ny + dy } : n)));
      return;
    }
    const p = panRef.current;
    if (p) {
      setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (dragNodeRef.current || resizeRef.current) scheduleSave();
    dragNodeRef.current = null;
    resizeRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
      scheduleSave();
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const startResize = (e: React.PointerEvent, n: LayoutNode, corner: string): void => {
    e.stopPropagation();
    const w = clientToWorld(e.clientX, e.clientY);
    resizeRef.current = {
      id: n.id,
      corner,
      ox: w.x,
      oy: w.y,
      nx: n.x,
      ny: n.y,
      nw: n.w,
      nh: n.h,
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const deleteSelection = (): void => {
    if (selectedEdgeId) {
      setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      scheduleSave();
      return;
    }
    if (selectedId) {
      const n = nodeMap.get(selectedId);
      if (n?.ghost) {
        setNodes((prev) => prev.filter((x) => x.id !== selectedId));
        setSelectedId(null);
        scheduleSave();
      }
      // live md nodes: 不在画布删；提示由工具栏文案说明
    }
  };

  const zoomBy = (factor: number): void => {
    const el = svgRef.current;
    const w = el?.clientWidth ?? 900;
    const h = el?.clientHeight ?? 600;
    const cx = w / 2;
    const cy = h / 2;
    setView((v) => {
      const nextK = Math.min(2, Math.max(0.35, v.k * factor));
      const ratio = nextK / v.k;
      return { k: nextK, tx: cx - (cx - v.tx) * ratio, ty: cy - (cy - v.ty) * ratio };
    });
    scheduleSave();
  };

  const selected = selectedId ? nodeMap.get(selectedId) : null;
  const zoomPct = Math.round(view.k * 100);
  const gridPad = GRID * 40;
  const gridX = (Number.isFinite(bounds.minX) ? bounds.minX : 0) - gridPad;
  const gridY = (Number.isFinite(bounds.minY) ? bounds.minY : 0) - gridPad;
  const gridW = Math.max(GRID * 80, (bounds.maxX - bounds.minX || 0) + gridPad * 2);
  const gridH = Math.max(GRID * 80, (bounds.maxY - bounds.minY || 0) + gridPad * 2);

  const tools: { id: Tool; label: string; title: string }[] = [
    { id: 'select', label: '选', title: '选择 / 拖动' },
    { id: 'rect', label: '□', title: '矩形' },
    { id: 'round', label: '▢', title: '圆角矩形' },
    { id: 'ellipse', label: '○', title: '椭圆' },
    { id: 'link', label: '⟷', title: '自由连线' },
    { id: 'delete', label: '删', title: '删除自由边 / 幽灵节点（不删大纲）' },
  ];

  return (
    <div className="mm-wrap fc-wrap">
      <svg
        ref={svgRef}
        className={`mm-svg${panning ? ' is-panning' : ''}`}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id="fc-grid-pat" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path className="mm-grid-line" d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" strokeWidth={1} />
          </pattern>
          <marker id="fc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 8 5 L 0 9" fill="none" stroke="var(--mm-link, #888)" strokeWidth="1.2" opacity="0.55" />
          </marker>
        </defs>
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          <rect className="mm-grid-fill" x={gridX} y={gridY} width={gridW} height={gridH} fill="url(#fc-grid-pat)" pointerEvents="none" />

          {treeLinks.map((l) => {
            const a = nodeMap.get(l.from);
            const b = nodeMap.get(l.to);
            if (!a || !b) return null;
            return (
              <path
                key={l.id}
                className="mm-link fc-tree-link"
                d={orthogonalPath({ x: a.x + a.w, y: a.y + a.h / 2 }, { x: b.x, y: b.y + b.h / 2 })}
                fill="none"
                pointerEvents="none"
              />
            );
          })}

          {edges.map((e) => {
            const a = nodeMap.get(e.from);
            const b = nodeMap.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + a.w / 2;
            const y1 = a.y + a.h / 2;
            const x2 = b.x + b.w / 2;
            const y2 = b.y + b.h / 2;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const on = selectedEdgeId === e.id;
            return (
              <g key={e.id} data-edge={e.id} className={on ? 'fc-edge is-selected' : 'fc-edge'}>
                <path
                  className="mm-link fc-free-link"
                  d={`M ${x1} ${y1} L ${x2} ${y2}`}
                  fill="none"
                  markerEnd={e.arrow ? 'url(#fc-arrow)' : undefined}
                  strokeWidth={on ? 2 : 1}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdgeId(e.id);
                    setSelectedId(null);
                    if (tool === 'delete') {
                      setEdges((prev) => prev.filter((x) => x.id !== e.id));
                      setSelectedEdgeId(null);
                      scheduleSave();
                    }
                  }}
                />
                <circle
                  className="fc-edge-handle"
                  cx={mx}
                  cy={my}
                  r={4}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdgeId(e.id);
                    setSelectedId(null);
                  }}
                />
              </g>
            );
          })}

          {draftLine && (
            <line className="fc-draft-link" x1={draftLine.x1} y1={draftLine.y1} x2={draftLine.x2} y2={draftLine.y2} />
          )}

          {nodes.map((n) => {
            const selected = selectedId === n.id || (n.line > 0 && (highlightLine != null && highlightLine === n.line));
            const label = n.text.length > LABEL_MAX ? `${n.text.slice(0, LABEL_MAX)}…` : n.text;
            const { rx, ry } = shapeRx(n.shape, n.w, n.h);
            return (
              <g
                key={n.id}
                data-node={n.id}
                transform={`translate(${n.x},${n.y})`}
                className={`mm-node state-${n.state}${selected ? ' is-selected' : ''}${n.ghost ? ' is-ghost' : ''}`}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (isScratch) {
                    editScratchText(n);
                    return;
                  }
                  if (!n.ghost && n.childCount > 0) onToggle?.(n.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // 单击只选中/导航，绝不新建文件；scratch 不导航
                  if (isScratch) return;
                  if (!n.ghost) onNavigate?.(n.target);
                }}
              >
                <title>{isScratch ? `${n.text}（双击改文案）` : n.ghost ? '幽灵节点（md 已无）' : `${n.text}\n第 ${n.line} 行 · ${n.linkedNotes} 条关联`}</title>
                <rect className="mm-node-body" width={n.w} height={n.h} rx={rx} ry={ry} />
                {!n.ghost && <rect className="mm-state-bar" x={0} y={0} width={4} height={n.h} rx={2} />}
                <text x={14} y={n.h / 2 + 4} className="mm-label">
                  {label}
                </text>
                {n.linkedNotes > 0 && <circle cx={n.w - 10} cy={9} r={3} className="mm-linked" />}
                {selected && !n.ghost && (
                  <g className="fc-selection" pointerEvents="all">
                    <rect className="fc-sel-box" x={-1} y={-1} width={n.w + 2} height={n.h + 2} fill="none" />
                    {(['nw', 'ne', 'sw', 'se'] as const).map((c) => {
                      const cx = c.includes('w') ? -HANDLE / 2 : n.w - HANDLE / 2;
                      const cy = c.includes('n') ? -HANDLE / 2 : n.h - HANDLE / 2;
                      return (
                        <rect
                          key={c}
                          data-handle={c}
                          className="fc-handle"
                          x={cx}
                          y={cy}
                          width={HANDLE}
                          height={HANDLE}
                          onPointerDown={(ev) => startResize(ev, n, c)}
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
            title="梳理画布标题"
            onChange={(e) => {
              const v = e.target.value;
              setTitle(v);
              onScratchTitleChange?.(v);
            }}
            onBlur={() => scheduleSave()}
          />
        )}
        {isScratch && <span className="mm-toolbar-hint">形状工具点空白处新建 · 双击改文案</span>}
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
              if (t.id === 'delete') deleteSelection();
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="mm-toolbar-sep" aria-hidden="true" />
        <button type="button" className="icon-btn" title="缩小" onClick={() => zoomBy(0.83)}>
          −
        </button>
        <span className="mm-zoom" title="当前缩放">
          {zoomPct}%
        </span>
        <button type="button" className="icon-btn" title="放大" onClick={() => zoomBy(1.2)}>
          +
        </button>
        <span className="mm-toolbar-sep" aria-hidden="true" />
        <button type="button" className="icon-btn mm-fit-btn" title="适应窗口" onClick={fitView}>
          适应
        </button>
        <span className="mm-hint">
          {dirty ? '保存中…' : 'bound 画布 · 不新建笔记'}
          {selected ? ` · ${selected.shape}` : ''}
        </span>
      </div>
    </div>
  );
}
