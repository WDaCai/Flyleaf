import type { FrameworkStats, FrameworkTree, NavTarget, TreeNode } from '../contracts';
import type { OutlineNode } from './outline';
import { fnv1a } from './hash';

export interface BuildTreeOptions {
  path: string;
  title: string;
  nodes: OutlineNode[];
  /** 把 wikilink 目标解析成相对路径；无解时返回 null */
  resolveLink: (target: string, fromNodeLine: number) => string | null;
  /** 该节点通过 frontmatter.nodes 反查到的条目数 */
  linkedCount: (nodeText: string) => number;
}

export function buildTree(opts: BuildTreeOptions): FrameworkTree {
  const { path, title, nodes } = opts;

  const root: TreeNode = {
    id: fnv1a(`${path}|root`),
    text: title,
    depth: -1,
    state: 'todo',
    line: 0,
    target: { kind: 'file', path },
    linkedNotes: 0,
    children: [],
  };

  const stats: FrameworkStats = { todo: 0, learning: 0, known: 0, used: 0, total: 0 };
  // stack[d] = 最近一个 depth 为 d 的节点；root 占据 depth -1 的槽位
  const stack: TreeNode[] = [root];

  for (const n of nodes) {
    const depth = Math.max(0, n.depth);
    while (stack.length <= depth) {
      const last = stack[stack.length - 1] ?? root;
      stack.push(last);
    }
    const parent = stack[depth] ?? root;

    const resolved = n.linkRaw ? opts.resolveLink(n.linkRaw, n.line) : null;
    const target: NavTarget | null = resolved
      ? { kind: 'file', path: resolved }
      : { kind: 'line', path, line: n.line };

    const node: TreeNode = {
      id: fnv1a(`${path}|${n.line}|${n.text}`),
      text: n.text,
      depth,
      state: n.state,
      line: n.line,
      target,
      linkedNotes: opts.linkedCount(n.text),
      children: [],
    };

    parent.children.push(node);
    stack.length = depth + 1;
    stack.push(node);

    stats[n.state] += 1;
    stats.total += 1;
  }

  return { path, title, root, stats };
}

/** 深度优先展平（含根），供布局与检索使用 */
export function flattenTree(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** 找到某一行对应的节点 */
export function findNodeByLine(root: TreeNode, line: number): TreeNode | null {
  if (root.line === line) return root;
  for (const c of root.children) {
    const hit = findNodeByLine(c, line);
    if (hit) return hit;
  }
  return null;
}
