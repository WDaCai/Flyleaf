import type { Eol } from './text';
import { serializeFrontmatter } from './frontmatter';

/** 把 frontmatter + 正文组装回文件原文，复用原有 BOM 与换行符 */
export function composeDocument(
  bom: boolean,
  eol: Eol,
  fm: Record<string, unknown> | null,
  body: string,
): string {
  const hasFm = !!fm && Object.keys(fm).length > 0;
  const fmBlock = hasFm ? `---\n${serializeFrontmatter(fm ?? {})}\n---\n` : '';
  const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const normalizedFm = fmBlock.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  return `${bom ? '\uFEFF' : ''}${normalizedFm}${normalizedBody}`;
}
