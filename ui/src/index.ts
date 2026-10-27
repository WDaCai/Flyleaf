/** 共享 UI 基础：设计 token 走 CSS 变量，组件保持最小集 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export const STATE_CLASS: Record<string, string> = {
  todo: 'state-todo',
  learning: 'state-learning',
  known: 'state-known',
  used: 'state-used',
};

export const STATE_GLYPH: Record<string, string> = {
  todo: '○',
  learning: '◐',
  known: '●',
  used: '★',
};
