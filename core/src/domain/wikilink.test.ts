import { describe, expect, it } from 'vitest';
import { parseWikiLinks, resolveTargetName, stripWikiLinks } from './wikilink';

describe('wikilink', () => {
  it('解析目标与别名', () => {
    const links = parseWikiLinks('[[材质的序列化|序列化]] 和 [[渲染/深度测试#原理]]');
    expect(links).toHaveLength(2);
    expect(links[0]?.target).toBe('材质的序列化');
    expect(links[0]?.alias).toBe('序列化');
    expect(links[1]?.target).toBe('渲染/深度测试#原理');
    expect(links[1]?.alias).toBeNull();
  });

  it('取文件名时剥离目录与锚点', () => {
    expect(resolveTargetName('渲染/深度测试#原理')).toBe('深度测试');
    expect(resolveTargetName('深度测试')).toBe('深度测试');
    expect(resolveTargetName('a/b/c^block')).toBe('c');
  });

  it('剥离链接后不留双空格', () => {
    expect(stripWikiLinks('深度测试与 Z-Fighting [[深度测试]]')).toBe('深度测试与 Z-Fighting');
  });

  it('空目标不产生链接', () => {
    expect(parseWikiLinks('[[]]')).toHaveLength(0);
    expect(parseWikiLinks('没有链接')).toHaveLength(0);
  });
});
