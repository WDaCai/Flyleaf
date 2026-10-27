import { useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import type { FrameworkTree, NavTarget, TreeNode } from '@yan/core/contracts';
import { STATE_GLYPH } from '@yan/ui';

const NODE_W = 196;
const NODE_H = 26;
const GAP_Y = 14;
const GAP_X = 212;
const PAD = 40;

interface Lite {
  id: string;
  text: string;
  state: string;
  target: NavTarget | null;
  linkedNotes: number;
  line: number;
  childCount: number;
  children: Lite[];
}

interface Placement {
  id: string;
  text: string;
  state: string;
  target: NavTarget | null;
  linkedNotes: number;
  childCount: number;
  line: number;
  x: number;
  y: number;
  collapsed: boolean;
}

function toLite(n: TreeNode, collapsed: Set<string>): Lite {
  const isCollapsed = collapsed.has(n.id);
  return {
    id: n.id,
    text: n.text,
    state: n.state,
    target: n.target,
    linkedNotes: n.linkedNotes,
    line: n.line,
    childCount: n.children.length,
    children: isCollapsed ? [] : n.children.map((c) => toLite(c, collapsed)),
  };
}

export interface MindMapProps {
  framework: FrameworkTree;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (target: NavTarget | null) => void;
}

export function MindMap({ framework, collapsed, onToggle, onNavigate }: MindMapProps): React.ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [view, setView] = useState({ k: 1, tx: PAD, ty: PAD });

  const layout = useMemo(() => {
    const root = hierarchy<Lite>(toLite(framework.root, collapsed));
    d3tree<Lite>().nodeSize([NODE_H + GAP_Y, GAP_X])(root);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const nodes: Placement[] = [];
    for (const d of root.descendants()) {
      const x = d.y ?? 0;
      const y = (d.x ?? 0) - NODE_H / 2;
      nodes.push({
        id: d.data.id,
        text: d.data.text,
        state: d.data.state,
        target: d.data.target,
        linkedNotes: d.data.linkedNotes,
        childCount: d.data.childCount,
        line: d.data.line,
        x,
        y,
        collapsed: collapsed.has(d.data.id),
      });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + NODE_W);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + NODE_H);
    }

    const links = root.links().map((l) => ({
      id: `${l.source.data.id}->${l.target.data.id}`,
      from: { x: (l.source.y ?? 0) + NODE_W, y: l.source.x ?? 0 },
      to: { x: l.target.y ?? 0, y: l.target.x ?? 0 },
    }));

    return { nodes, links, minX, maxX, minY, maxY };
  }, [framework, collapsed]);

  // 切换框架文件时自动回到「适应窗口」视图
  useEffect(() => {
    const el = svgRef.current;
    const w = el?.clientWidth ?? 900;
    const h = el?.clientHeight ?? 600;
    const cw = Math.max(1, layout.maxX - layout.minX);
    const ch = Math.max(1, layout.maxY - layout.minY);
    const k = Math.min(1, Math.min((w - PAD * 2) / cw, (h - PAD * 2) / ch));
    setView({
      k,
      tx: (w - cw * k) / 2 - layout.minX * k,
      ty: (h - ch * k) / 2 - layout.minY * k,
    });
    // 只在框架文件或折叠状态变化时重排视图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework.path]);

  // 原生 wheel 监听：React 的 onWheel 在部分环境是 passive 的
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
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if ((e.target as HTMLElement).closest('[data-node]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const zoomBy = (factor: number): void => {
    setView((v) => ({ ...v, k: Math.min(2, Math.max(0.35, v.k * factor)) }));
  };

  return (
    <div className="mm-wrap">
      <div className="mm-toolbar">
        <button className="icon-btn" title="放大" onClick={() => zoomBy(1.2)}>
          ＋
        </button>
        <button className="icon-btn" title="缩小" onClick={() => zoomBy(0.83)}>
          －
        </button>
        <button className="icon-btn" title="适应窗口" onClick={() => setView((v) => ({ ...v, k: 1, tx: PAD, ty: PAD }))}>
          ⊙
        </button>
        <span className="mm-hint">双击折叠 · 滚轮缩放 · 拖拽平移</span>
      </div>
      <svg
        ref={svgRef}
        className="mm-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          {layout.links.map((l) => {
            const mid = (l.from.x + l.to.x) / 2;
            return (
              <path
                key={l.id}
                d={`M ${l.from.x} ${l.from.y} C ${mid} ${l.from.y}, ${mid} ${l.to.y}, ${l.to.x} ${l.to.y}`}
                fill="none"
                stroke="#2b323c"
                strokeWidth={1.4}
              />
            );
          })}

          {layout.nodes.map((n) => (
            <g
              key={n.id}
              data-node={n.id}
              transform={`translate(${n.x},${n.y})`}
              className={`mm-node state-${n.state}`}
              onClick={() => onNavigate(n.target)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (n.childCount > 0) onToggle(n.id);
              }}
            >
              <title>{`${n.text}\n第 ${n.line} 行 · ${n.linkedNotes} 条关联`}</title>
              <rect width={NODE_W} height={NODE_H} rx={6} />
              <text x={10} y={NODE_H / 2 + 4} className="mm-glyph">
                {STATE_GLYPH[n.state] ?? '○'}
              </text>
              <text x={26} y={NODE_H / 2 + 4} className="mm-label">
                {n.text.length > 14 ? `${n.text.slice(0, 14)}…` : n.text}
              </text>
              {n.childCount > 0 && (
                <text x={NODE_W - 12} y={NODE_H / 2 + 4} className="mm-count" textAnchor="end">
                  {n.collapsed ? `+${n.childCount}` : ''}
                </text>
              )}
              {n.linkedNotes > 0 && (
                <circle cx={NODE_W - 8} cy={8} r={3} fill="var(--used)" opacity={0.9} />
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
