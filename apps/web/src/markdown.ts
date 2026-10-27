import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

const STATE_GLYPH: Record<string, string> = {
  ' ': '○',
  '~': '◐',
  x: '●',
  X: '●',
  '*': '★',
};

/** 把砚的扩展语法翻译成标准 markdown */
export function transform(src: string): string {
  const withState = src.replace(/^(\s*[-*+]\s+)\[([ xX~*])\]/gm, (_m, prefix: string, ch: string) => {
    return `${prefix}${STATE_GLYPH[ch] ?? '○'}`;
  });

  return withState.replace(/\[\[([^[\]\n]+?)\]\]/g, (_m, inner: string) => {
    const bar = inner.indexOf('|');
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const label = (bar === -1 ? inner : inner.slice(bar + 1)).trim() || target;
    return `[${label}](#wiki:${encodeURIComponent(target)})`;
  });
}

export function renderMarkdown(src: string): string {
  return md.render(transform(src));
}

export const WIKI_PREFIX = '#wiki:';
