import { describe, expect, it } from 'vitest';
import { matchesFilters, parseQueryString, scoreNote, tokenize } from './search';

const NOTE = {
  path: '10-pitfalls/材质打包.md',
  title: '材质实例在打包后丢失参数',
  type: 'pitfall',
  tags: ['材质', '打包'],
  project: '项目A',
  body: '打包后材质丢失参数，需要重新保存所有实例。',
};

describe('search', () => {
  it('中文多词按 AND 命中', () => {
    const tokens = tokenize('材质 打包');
    const hit = scoreNote(tokens, NOTE);
    expect(hit).not.toBeNull();
    expect(hit?.score).toBeGreaterThan(0);
  });

  it('连写的中文长串按 bigram 容忍语序差异', () => {
    const tokens = tokenize('材质打包');
    expect(tokens[0]?.bigrams.length).toBe(3);
    expect(scoreNote(tokens, NOTE)).not.toBeNull();
  });

  it('完全无关的词不命中', () => {
    expect(scoreNote(tokenize('骨骼动画'), NOTE)).toBeNull();
  });

  it('拉丁词整词命中', () => {
    expect(scoreNote(tokenize('UE'), NOTE)).toBeNull();
    const note = { ...NOTE, body: 'UE 5.4 打包后材质丢失' };
    expect(scoreNote(tokenize('ue'), note)).not.toBeNull();
  });

  it('片段包含命中位置', () => {
    const hit = scoreNote(tokenize('实例'), NOTE);
    expect(hit?.snippet).toContain('实例');
  });

  it('过滤器按 type / tag / project 生效', () => {
    expect(matchesFilters(NOTE, { type: 'pitfall' })).toBe(true);
    expect(matchesFilters(NOTE, { type: 'weekly' })).toBe(false);
    expect(matchesFilters(NOTE, { tag: '材质' })).toBe(true);
    expect(matchesFilters(NOTE, { project: '项目B' })).toBe(false);
  });

  it('查询串解析出过滤器', () => {
    const { text, filters } = parseQueryString('type:pitfall tag:材质 深度测试');
    expect(filters).toEqual({ type: 'pitfall', tag: '材质' });
    expect(text).toBe('深度测试');
  });
});
