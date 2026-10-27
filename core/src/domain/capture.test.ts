import { describe, expect, it } from 'vitest';
import { appendCapture, formatCaptureLine, formatDate, inboxHeader } from './capture';

const AT = new Date(2026, 9, 27, 9, 5, 0);

describe('capture', () => {
  it('单行随记格式', () => {
    expect(formatCaptureLine('测试一条', AT)).toBe('- 09:05 测试一条');
  });

  it('多行随记保持同一条归属', () => {
    expect(formatCaptureLine('第一行\n第二行', AT)).toBe('- 09:05 第一行\n  第二行');
  });

  it('空内容不产生行', () => {
    expect(formatCaptureLine('   \n  ', AT)).toBe('');
  });

  it('新建当日 inbox', () => {
    expect(appendCapture('', '内容', AT)).toBe('# 2026-10-27\n\n- 09:05 内容\n');
  });

  it('追加不覆盖已有内容', () => {
    const existing = '# 2026-10-27\n\n- 09:05 甲\n';
    const next = appendCapture(existing, '乙', AT);
    expect(next).toBe('# 2026-10-27\n\n- 09:05 甲\n- 09:05 乙\n');
  });

  it('日期与标题使用本地时区', () => {
    expect(formatDate(AT)).toBe('2026-10-27');
    expect(inboxHeader(AT)).toBe('# 2026-10-27');
  });
});
