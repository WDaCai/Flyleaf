/** 文本形态工具：BOM、换行符、frontmatter 切分。全部纯函数。 */

export type Eol = '\n' | '\r\n';

export function stripBom(src: string): { bom: boolean; text: string } {
  if (src.charCodeAt(0) === 0xfeff) return { bom: true, text: src.slice(1) };
  return { bom: false, text: src };
}

export function detectEol(src: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) {
      if (i > 0 && src.charCodeAt(i - 1) === 13) crlf++;
      else lf++;
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

export interface SplitDoc {
  bom: boolean;
  eol: Eol;
  /** 不含首尾分隔线的 frontmatter 原文；无 frontmatter 时为 null */
  frontmatterRaw: string | null;
  body: string;
  /** 正文第一行在文件中的 1-based 行号 */
  bodyStartLine: number;
}

const NO_FM = (bom: boolean, eol: Eol, body: string): SplitDoc => ({
  bom,
  eol,
  frontmatterRaw: null,
  body,
  bodyStartLine: 1,
});

export function splitDocument(src: string): SplitDoc {
  const { bom, text } = stripBom(src);
  const eol = detectEol(text);
  if (!text.startsWith('---')) return NO_FM(bom, eol, text);

  const firstNl = text.indexOf('\n');
  if (firstNl === -1) return NO_FM(bom, eol, text);
  const firstLine = text.slice(0, firstNl).replace(/\r$/, '');
  if (firstLine.trimEnd() !== '---') return NO_FM(bom, eol, text);

  let pos = firstNl + 1;
  let fmLines = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end).replace(/\r$/, '');
    if (line.trimEnd() === '---') {
      const frontmatterRaw = text.slice(firstNl + 1, pos).replace(/\r?\n$/, '');
      const body = nl === -1 ? '' : text.slice(nl + 1);
      return {
        bom,
        eol,
        frontmatterRaw: frontmatterRaw.length ? frontmatterRaw : null,
        body,
        bodyStartLine: fmLines + 3,
      };
    }
    fmLines++;
    if (nl === -1) break;
    pos = nl + 1;
  }
  // 只有起始 --- 没有结束 ---：当作普通正文，不吞内容
  return NO_FM(bom, eol, text);
}

/** 按行拆分，兼容 CRLF，不保留行尾 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** 把任意文本规整成指定换行符 */
export function withEol(text: string, eol: Eol): string {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}
