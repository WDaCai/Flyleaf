import { describe, expect, it } from 'vitest';
import { parseOutline } from './outline';
import { buildTree, findNodeByLine, flattenTree } from './tree';

const BODY = [
  '## 光栅化',
  '- [x] 三角形光栅化',
  '- [x] 深度测试与 Z-Fighting [[深度测试]]',
  '  - [ ] 半透明与深度写入',
  '## PBR',
  '- [ ] 微表面模型',
].join('\n');

function makeTree(resolve: (t: string) => string | null = () => null) {
  return buildTree({
    path: '50-frameworks/渲染.md',
    title: '实时渲染',
    nodes: parseOutline(BODY, 1),
    resolveLink: resolve,
    linkedCount: (text) => (text === '深度测试与 Z-Fighting' ? 3 : 0),
  });
}

describe('tree', () => {
  it('按 depth 组装成树', () => {
    const tree = makeTree();
    expect(tree.root.children).toHaveLength(2);
    const [raster, pbr] = tree.root.children;
    expect(raster?.text).toBe('光栅化');
    expect(raster?.children).toHaveLength(2);
    expect(raster?.children[1]?.children).toHaveLength(1);
    expect(pbr?.children).toHaveLength(1);
  });

  it('统计四档状态', () => {
    const tree = makeTree();
    expect(tree.stats).toMatchObject({ todo: 4, learning: 0, known: 2, used: 0, total: 6 });
  });

  it('有链接且能解析时指向文件', () => {
    const tree = makeTree(() => '30-knowledge/深度测试.md');
    const node = flattenTree(tree.root).find((n) => n.text === '深度测试与 Z-Fighting');
    expect(node?.target).toEqual({ kind: 'file', path: '30-knowledge/深度测试.md' });
  });

  it('无链接时定位到框架文件该行', () => {
    const tree = makeTree();
    const node = flattenTree(tree.root).find((n) => n.text === '三角形光栅化');
    expect(node?.target).toEqual({ kind: 'line', path: '50-frameworks/渲染.md', line: 2 });
  });

  it('反查计数只挂在对应节点上', () => {
    const tree = makeTree();
    const node = flattenTree(tree.root).find((n) => n.text === '深度测试与 Z-Fighting');
    expect(node?.linkedNotes).toBe(3);
  });

  it('id 稳定且可按行号查找', () => {
    const a = makeTree();
    const b = makeTree();
    const idsA = flattenTree(a.root).map((n) => n.id);
    const idsB = flattenTree(b.root).map((n) => n.id);
    expect(idsA).toEqual(idsB);
    expect(findNodeByLine(a.root, 3)?.text).toBe('深度测试与 Z-Fighting');
  });
});
