import { describe, expect, it } from 'vitest';
import { detectEol, splitDocument, stripBom, withEol } from './text';

describe('text', () => {
  it('解析带 frontmatter 的文档', () => {
    const src = '---\ntype: framework\ntitle: 实时渲染\n---\n\n## 光栅化\n';
    const d = splitDocument(src);
    expect(d.frontmatterRaw).toBe('type: framework\ntitle: 实时渲染');
    expect(d.body).toBe('\n## 光栅化\n');
    expect(d.bodyStartLine).toBe(5);
    expect(d.eol).toBe('\n');
    expect(d.bom).toBe(false);
  });

  it('无 frontmatter 时整篇都是正文', () => {
    const d = splitDocument('# 标题\n正文');
    expect(d.frontmatterRaw).toBeNull();
    expect(d.body).toBe('# 标题\n正文');
    expect(d.bodyStartLine).toBe(1);
  });

  it('未闭合的 frontmatter 不吞内容', () => {
    const src = '---\ntype: note\n没有结束线\n';
    const d = splitDocument(src);
    expect(d.frontmatterRaw).toBeNull();
    expect(d.body).toBe(src);
  });

  it('CRLF 与 BOM 原样识别', () => {
    const src = '\uFEFF---\r\ntype: a\r\n---\r\nbody\r\n';
    const d = splitDocument(src);
    expect(d.bom).toBe(true);
    expect(d.eol).toBe('\r\n');
    expect(d.bodyStartLine).toBe(4);
    expect(d.body).toBe('body\r\n');
  });

  it('空 frontmatter 仍算合法', () => {
    const d = splitDocument('---\n---\n正文');
    expect(d.frontmatterRaw).toBeNull();
    expect(d.body).toBe('正文');
    expect(d.bodyStartLine).toBe(3);
  });

  it('detectEol / stripBom / withEol', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n');
    expect(detectEol('a\nb\n')).toBe('\n');
    expect(stripBom('\uFEFFx').text).toBe('x');
    expect(withEol('a\nb', '\r\n')).toBe('a\r\nb');
    // 已经 CRLF 的文本不应被二次扩写
    expect(withEol('a\r\nb', '\r\n')).toBe('a\r\nb');
  });
});
