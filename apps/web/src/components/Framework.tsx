import type { FrameworkTree, Mastery, NavTarget, TreeNode } from '@yan/core/contracts';
import { MASTERY_LABEL, MASTERY_ORDER } from '@yan/core/contracts';
import { STATE_GLYPH } from '@yan/ui';
import { MindMap } from './MindMap';

export interface FrameworkProps {
  framework: FrameworkTree;
  mode: 'outline' | 'mindmap';
  onModeChange: (m: 'outline' | 'mindmap') => void;
  onSetState: (line: number, state: Mastery) => void;
  onExpand: (line: number) => void;
  onNavigate: (target: NavTarget | null) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  highlightLine: number | null;
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
  collapsed,
  onToggle,
  highlightLine,
}: FrameworkProps): React.ReactElement {
  const done = framework.stats.known + framework.stats.used;
  const pct = framework.stats.total ? Math.round((done / framework.stats.total) * 100) : 0;

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
        <div className="fw-legend">
          {MASTERY_ORDER.map((s) => (
            <span key={s} className={`fw-legend-item state-${s}`} title={MASTERY_LABEL[s]}>
              {STATE_GLYPH[s]} {framework.stats[s]}
            </span>
          ))}
        </div>
        <div className="seg">
          <button className={mode === 'outline' ? 'seg-on' : ''} onClick={() => onModeChange('outline')}>
            大纲
          </button>
          <button className={mode === 'mindmap' ? 'seg-on' : ''} onClick={() => onModeChange('mindmap')}>
            导图
          </button>
        </div>
      </div>

      {mode === 'outline' ? (
        <div className="fw-outline">
          <OutlineRow
            node={framework.root}
            depth={-1}
            isRoot
            highlightLine={highlightLine}
            onSetState={onSetState}
            onExpand={onExpand}
            onNavigate={onNavigate}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        </div>
      ) : (
        <MindMap framework={framework} collapsed={collapsed} onToggle={onToggle} onNavigate={onNavigate} />
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
  onSetState: (line: number, state: Mastery) => void;
  onExpand: (line: number) => void;
  onNavigate: (target: NavTarget | null) => void;
}

function OutlineRow({
  node,
  depth,
  isRoot,
  highlightLine,
  collapsed,
  onToggle,
  onSetState,
  onExpand,
  onNavigate,
}: RowProps): React.ReactElement {
  const isCollapsed = collapsed.has(node.id);
  const hasFile = node.target?.kind === 'file';

  const onRowClick = (): void => {
    if (isRoot) return;
    if (hasFile && node.target) onNavigate(node.target);
    else if (node.line) onNavigate(node.target);
  };

  return (
    <div className="fw-node">
      <div
        className={`fw-row ${highlightLine === node.line ? 'is-hit' : ''} ${isRoot ? 'is-root' : ''}`}
        style={{ paddingLeft: `${Math.max(0, depth + 1) * 16 + 8}px` }}
        onClick={onRowClick}
      >
        {isRoot ? (
          <span className="fw-glyph">◆</span>
        ) : (
          <button
            className={`fw-glyph state-${node.state}`}
            title={`${MASTERY_LABEL[node.state]}（点击切换）`}
            onClick={(e) => {
              e.stopPropagation();
              onSetState(node.line, nextState(node.state));
            }}
          >
            {STATE_GLYPH[node.state]}
          </button>
        )}

        {node.children.length > 0 && !isRoot && (
          <button
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

        {!hasFile && !isRoot && (
          <button
            className="fw-expand"
            title="展开为独立文件并建立链接"
            onClick={(e) => {
              e.stopPropagation();
              onExpand(node.line);
            }}
          >
            ＋
          </button>
        )}
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
            onSetState={onSetState}
            onExpand={onExpand}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}
