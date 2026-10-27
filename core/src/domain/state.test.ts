import { describe, expect, it } from 'vitest';
import { parseStateToken, replaceStateMarker } from './state';

describe('state', () => {
  it('解析四档标记', () => {
    expect(parseStateToken('[ ] 未学')?.state).toBe('todo');
    expect(parseStateToken('[~] 在学')?.state).toBe('learning');
    expect(parseStateToken('[x] 已懂')?.state).toBe('known');
    expect(parseStateToken('[X] 已懂大写')?.state).toBe('known');
    expect(parseStateToken('[*] 用过')?.state).toBe('used');
    expect(parseStateToken('[~] 在学')?.rest).toBe('在学');
  });

  it('无标记返回 null', () => {
    expect(parseStateToken('普通文字')).toBeNull();
    expect(parseStateToken('[?] 未知标记')).toBeNull();
  });

  it('替换只动标记，其余字节不变', () => {
    expect(replaceStateMarker('- [~] Early-Z 为什么失效', 'known')).toBe('- [x] Early-Z 为什么失效');
    expect(replaceStateMarker('  - [ ] 子节点', 'used')).toBe('  - [*] 子节点');
    expect(replaceStateMarker('  1. 有序列表项', 'learning')).toBe('  1. [~] 有序列表项');
  });

  it('无标记的列表项会插入标记', () => {
    expect(replaceStateMarker('- 无标记', 'learning')).toBe('- [~] 无标记');
  });

  it('非列表行原样返回', () => {
    expect(replaceStateMarker('普通段落', 'learning')).toBe('普通段落');
    expect(replaceStateMarker('## 标题', 'learning')).toBe('## 标题');
  });
});
