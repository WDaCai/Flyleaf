/** 随记卡片的文本格式：纯渲染，不碰 IO */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 本地时间 HH:MM（刻意用本地时区，不用 UTC） */
export function formatTime(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 本地日期 YYYY-MM-DD */
export function formatDate(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 一条随记 → 列表项文本；多行缩进两格，保持归属同一条 */
export function formatCaptureLine(text: string, at: Date): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const [first = '', ...rest] = normalized.split('\n');
  const head = `- ${formatTime(at)} ${first.trim()}`.trimEnd();
  const tail = rest.map((l) => `  ${l.trimEnd()}`);
  return [head, ...tail].join('\n');
}

export function inboxHeader(at: Date): string {
  return `# ${formatDate(at)}`;
}

/** 追加到当日 inbox；已有内容时只追加不覆盖 */
export function appendCapture(existing: string, text: string, at: Date): string {
  const line = formatCaptureLine(text, at);
  if (!line) return existing;
  if (!existing.trim()) return `${inboxHeader(at)}\n\n${line}\n`;
  return `${existing.replace(/\s*$/, '')}\n${line}\n`;
}

/** 卡片状态行：已保存 20:51 */
export function savedHint(at: Date): string {
  return `已保存 ${formatTime(at)}`;
}
