import { useEffect, useRef } from 'react';
import type { FrameworkTree, Mastery, NavTarget, TreeNode } from '@flyleaf/core/contracts';
import { MASTERY_LABEL, MASTERY_ORDER } from '@flyleaf/core/contracts';
import { STATE_GLYPH } from '@flyleaf/ui';
import { FrameworkCanvas } from './FrameworkCanvas';
import type { FrameworkCanvasDoc, FrameworkCanvasLoadResult } from '@flyleaf/core/contracts';

export interface FrameworkProps {
  framework: FrameworkTree;
  mode: 'outline' | 'mindmap';
  onModeChange: (m: 'outline' | 'mindmap') => void;
  onSetState: (line: number, state: Mastery) => void;
  onExpand: (line: number) => void;
  onNavigate: (target: NavTarget | null) => void;
  onAddNode: (afterLine: number | null, asChild: boolean) => void;
  onRenameNode: (line: number) => void;
  onRemoveNode: (line: number) => void;
  onShiftNode: (line: number, delta: -1 | 1) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  highlightLine: number | null;
  onSelectLine: (line: number | null) => void;
  loadCanvas: (path: string) => Promise<FrameworkCanvasLoadResult>;
  saveCanvas: (path: string, doc: FrameworkCanvasDoc) => Promise<FrameworkCanvasDoc>;
}

function nextState(state: Mastery): Mastery {
  const i = MASTERY_ORDER.indexOf(state);
  return MASTERY_ORDER[(i + 1) % MASTERY_ORDER.length] ?? 'todo';
}

export function Framework({
  framework,
  mode,
  onModeChange,
  onSetState,
  onExpand,
  onNavigate,
  onAddNode,
  onRenameNode,
  onRemoveNode,
  onShiftNode,
  collapsed,
  onToggle,
  highlightLine,
  onSelectLine,
  loadCanvas,
  saveCanvas,
}: FrameworkProps): React.ReactElement {
  const done = framework.stats.known + framework.stats.used;
  const pct = framework.stats.total ? Math.round((done / framework.stats.total) * 100) : 0;
  const emptyTree = framework.root.children.length === 0;
  const outlineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode !== 'outline' || highlightLine == null) return;
    const root = outlineRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-fw-line="${highlightLine}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mode, highlightLine, framework.path]);

  return (
    <div className="fw">
      <div className="fw-bar">
        <div className="fw-title">{framework.title}</div>
        <div className="fw-progress" title={`已懂 ${framework.stats.known} · 用过 ${framework.stats.used} · 共 ${framework.stats.total}`}>
          <div className="fw-progress-track">
            <div className="fw-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="fw-progress-text">
            {done}/{framework.stats.total} · {pct}%
          </span>
        </div>
        <div className="fw-legend" title="状态图例：未学 / 在学 / 已懂 / 用过">
          {MASTERY_ORDER.map((s) => (
            <span key={s} className={`fw-legend-item state-${s}`} title={MASTERY_LABEL[s]}>
              {STATE_GLYPH[s]} {MASTERY_LABEL[s]}
              <span className="fw-legend-count">{framework.stats[s]}</span>
            </span>
          ))}
        </div>
        <div className="seg">
          <button type="button" className={mode === 'outline' ? 'seg-on' : ''} onClick={() => onModeChange('outline')}>
            大纲
          </button>
          <button type="button" className={mode === 'mindmap' ? 'seg-on' : ''} title="自由画布：拖节点、连线、滚轮缩放" onClick={() => onModeChange('mindmap')}>
            画布
          </button>
        </div>
      </div>

      {mode === 'outline' ? (
        <div className="fw-outline" ref={outlineRef}>
          {emptyTree && (
            <div className="fw-empty-tip">
              <div className="fw-empty-title">还没有子节点</div>
              <div className="fw-empty-copy">
                用缩进列表写子项，例如 <code>- [ ] 主题</code>；或点下方按钮添加。掌握度：
                <code>[ ]</code> 未学 · <code>[~]</code> 在学 · <code>[x]</code> 已懂 · <code>[*]</code> 用过。
              </div>
              <button type="button" className="btn primary" onClick={() => onAddNode(null, true)}>
                添加第一个节点
              </button>
            </div>
          )}
          <OutlineRow
            node={framework.root}
            depth={-1}
            isRoot
            highlightLine={highlightLine}
            onSelectLine={onSelectLine}
            onSetState={onSetState}
            onExpand={onExpand}
            onNavigate={onNavigate}
            onAddNode={onAddNode}
            onRenameNode={onRenameNode}
            onRemoveNode={onRemoveNode}
            onShiftNode={onShiftNode}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        </div>
      ) : (
        <FrameworkCanvas
          key={framework.path}
          framework={framework}
          collapsed={collapsed}
          onToggle={onToggle}
          onNavigate={onNavigate}
          onRenameLine={onRenameNode}
          highlightLine={highlightLine}
          onSelectLine={onSelectLine}
          loadCanvas={loadCanvas}
          saveCanvas={saveCanvas}
        />
      )}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  isRoot?: boolean;
  highlightLine: number | null;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelectLine: (line: number | null) => void;
  onSetState: (line: number, state: Mastery) => void;
  onExpand: (line: number) => void;
  onNavigate: (target: NavTarget | null) => void;
  onAddNode: (afterLine: number | null, asChild: boolean) => void;
  onRenameNode: (line: number) => void;
  onRemoveNode: (line: number) => void;
  onShiftNode: (line: number, delta: -1 | 1) => void;
}

function OutlineRow({
  node,
  depth,
  isRoot,
  highlightLine,
  collapsed,
  onToggle,
  onSelectLine,
  onSetState,
  onExpand,
  onNavigate,
  onAddNode,
  onRenameNode,
  onRemoveNode,
  onShiftNode,
}: RowProps): React.ReactElement {
  const isCollapsed = collapsed.has(node.id);
  const hasFile = node.target?.kind === 'file';
  const isHit = !isRoot && highlightLine === node.line;

  const onRowClick = (): void => {
    if (isRoot) return;
    onSelectLine(node.line);
    if (hasFile && node.target) onNavigate(node.target);
    else if (node.target) onNavigate(node.target);
  };

  const onRowKeyDown = (e: React.KeyboardEvent): void => {
    if (isRoot) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      onShiftNode(node.line, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onAddNode(node.line, true);
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      onRenameNode(node.line);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault();
      onRemoveNode(node.line);
    }
  };

  return (
    <div className="fw-node">
      <div
        className={`fw-row ${isHit ? 'is-hit' : ''} ${isRoot ? 'is-root' : ''}`}
        style={{ paddingLeft: `${Math.max(0, depth + 1) * 16 + 8}px` }}
        data-fw-line={isRoot ? undefined : node.line}
        tabIndex={isRoot ? undefined : 0}
        onClick={onRowClick}
        onKeyDown={onRowKeyDown}
      >
        {isRoot ? (
          <span className="fw-glyph">◆</span>
        ) : (
          <button
            type="button"
            className={`fw-glyph state-${node.state}`}
            title={`${MASTERY_LABEL[node.state]}（点击切换）`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectLine(node.line);
              onSetState(node.line, nextState(node.state));
            }}
          >
            {STATE_GLYPH[node.state]}
          </button>
        )}

        {node.children.length > 0 && (
          <button
            type="button"
            className="fw-caret"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            title={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        )}

        <span className={`fw-text ${hasFile ? 'has-file' : ''}`}>{node.text}</span>

        {node.linkedNotes > 0 && <span className="fw-badge">{node.linkedNotes} 条关联</span>}

        <span className="fw-ops" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="fw-op"
            title={isRoot ? '添加子节点' : '添加子节点（Ctrl+Enter）'}
            onClick={() => onAddNode(isRoot ? null : node.line, true)}
          >
            ＋
          </button>
          {!isRoot && (
            <>
              <button type="button" className="fw-op" title="重命名（F2）" onClick={() => onRenameNode(node.line)}>
                改
              </button>
              <button type="button" className="fw-op" title="升级（Shift+Tab）" onClick={() => onShiftNode(node.line, -1)}>
                ←
              </button>
              <button type="button" className="fw-op" title="降级（Tab）" onClick={() => onShiftNode(node.line, 1)}>
                →
              </button>
              <button type="button" className="fw-op danger" title="删除节点/子树" onClick={() => onRemoveNode(node.line)}>
                删
              </button>
            </>
          )}
          {!hasFile && !isRoot && (
            <button
              type="button"
              className="fw-expand"
              title="展开为独立文件并建立链接"
              onClick={() => onExpand(node.line)}
            >
              成文
            </button>
          )}
        </span>
      </div>

      {!isCollapsed &&
        node.children.map((child) => (
          <OutlineRow
            key={child.id}
            node={child}
            depth={depth + 1}
            highlightLine={highlightLine}
            collapsed={collapsed}
            onToggle={onToggle}
            onSelectLine={onSelectLine}
            onSetState={onSetState}
            onExpand={onExpand}
            onNavigate={onNavigate}
            onAddNode={onAddNode}
            onRenameNode={onRenameNode}
            onRemoveNode={onRemoveNode}
            onShiftNode={onShiftNode}
          />
        ))}
    </div>
  );
}