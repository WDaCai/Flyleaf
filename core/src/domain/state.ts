import type { Mastery } from '../contracts';

/** 行首状态标记：未学 [ ] / 在学 [~] / 已懂 [x] / 用过 [*] */
const TOKEN_TO_STATE: Record<string, Mastery> = {
  ' ': 'todo',
  '~': 'learning',
  x: 'known',
  X: 'known',
  '*': 'used',
};

const STATE_TO_TOKEN: Record<Mastery, string> = {
  todo: ' ',
  learning: '~',
  known: 'x',
  used: '*',
};

const LEADING_TOKEN = /^\[([ xX~*])\](?=\s|$)/;

export interface StateParse {
  state: Mastery;
  rest: string;
}

/** 从条目内容开头解析状态标记；没有标记时返回 null */
export function parseStateToken(content: string): StateParse | null {
  const m = LEADING_TOKEN.exec(content.trimStart());
  if (!m) return null;
  const ch = m[1];
  if (ch === undefined) return null;
  const state = TOKEN_TO_STATE[ch];
  if (!state) return null;
  return { state, rest: content.trimStart().slice(m[0].length).trimStart() };
}

const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)(\[[ xX~*]\])?(\s*)/;

/**
 * 只替换状态标记所在的那几个字符，其余字节原样保留。
 * 若该行没有标记，则在列表前缀后插入；不是列表项时返回原行。
 */
export function replaceStateMarker(rawLine: string, next: Mastery): string {
  const token = STATE_TO_TOKEN[next];
  const m = LIST_PREFIX.exec(rawLine);
  if (!m) return rawLine;
  const prefix = m[1] ?? '';
  const rest = rawLine.slice(m[0].length);
  return `${prefix}[${token}] ${rest}`;
}

export function markerOf(state: Mastery): string {
  return `[${STATE_TO_TOKEN[state]}]`;
}
