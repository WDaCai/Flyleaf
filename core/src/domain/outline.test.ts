import { describe, expect, it } from 'vitest';
import { parseOutline } from './outline';

const BODY = [
  '## 光栅化',
  '- [x] 三角形光栅化',
  '- [x] 深度测试与 Z-Fighting [[深度测试]]',
  '  - [ ] 半透明与深度写入',
  '## PBR',
  '- [ ] 微表面模型',
].join('\n');

describe('outline', () => {
  it('标题与缩进列表共同决定层级', () => {
    const nodes = parseOutline(BODY, 1);
    expect(nodes.map((n) => n.depth)).toEqual([1, 2, 2, 3, 1, 2]);
    expect(nodes).toHaveLength(6);
  });

  it('解析状态与 wikilink', () => {
    const nodes = parseOutline(BODY, 1);
    expect(nodes[1]?.state).toBe('known');
    expect(nodes[2]?.linkRaw).toBe('深度测试');
    expect(nodes[2]?.text).toBe('深度测试与 Z-Fighting');
    expect(nodes[3]?.state).toBe('todo');
    expect(nodes[3]?.linkRaw).toBeNull();
  });

  it('行号以 bodyStartLine 为基准', () => {
    const nodes = parseOutline(BODY, 4);
    expect(nodes[0]?.line).toBe(4);
    expect(nodes[1]?.line).toBe(5);
  });

  it('代码块里的列表不被解析', () => {
    const body = ['```text', '- [x] 假的节点', '```', '- [ ] 真节点'].join('\n');
    const nodes = parseOutline(body, 1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.text).toBe('真节点');
  });

  it('缩进跳级会被收敛到父级下一层', () => {
    const body = ['- a', '  - b', '        - c'].join('\n');
    const nodes = parseOutline(body, 1);
    expect(nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it('tab 缩进与空列表项容错', () => {
    const body = ['- a', '\t- b', '- [x]'].join('\n');
    const nodes = parseOutline(body, 1);
    expect(nodes).toHaveLength(3);
    expect(nodes[1]?.depth).toBe(1);
    expect(nodes[2]?.state).toBe('known');
  });
});
