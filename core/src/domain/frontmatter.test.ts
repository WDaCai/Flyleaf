import { describe, expect, it } from 'vitest';
import { asStringArray, parseFrontmatter, serializeFrontmatter } from './frontmatter';

describe('frontmatter', () => {
  it('保持字段顺序并保留未知字段', () => {
    const raw = 'type: pitfall\ntitle: 测试\nproject: 项目A\ncustom_field: 保留我\n';
    const fm = parseFrontmatter(raw);
    expect(Object.keys(fm)).toEqual(['type', 'title', 'project', 'custom_field']);

    const out = serializeFrontmatter(fm);
    expect(out).toContain('custom_field');
    expect(out).toContain('保留我');
    expect(out.indexOf('type:')).toBeLessThan(out.indexOf('custom_field'));
  });

  it('空值与非对象输入都不抛错', () => {
    expect(parseFrontmatter(null)).toEqual({});
    expect(parseFrontmatter('')).toEqual({});
    expect(parseFrontmatter('just a string')).toEqual({});
    expect(serializeFrontmatter({})).toBe('');
  });

  it('数组字段与逗号串都能归一', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(asStringArray('a, b')).toEqual(['a', 'b']);
    expect(asStringArray(undefined)).toEqual([]);
  });

  it('中文与冒号内容可回环', () => {
    const fm = parseFrontmatter('title: 材质实例在打包后丢失参数\nnodes:\n  - 深度测试\n  - Z-Fighting\n');
    const out = serializeFrontmatter(fm);
    const again = parseFrontmatter(out);
    expect(again.title).toBe('材质实例在打包后丢失参数');
    expect(again.nodes).toEqual(['深度测试', 'Z-Fighting']);
  });
});
