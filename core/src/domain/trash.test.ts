import { describe, expect, it } from 'vitest';
import { originalPathFromTrash, restoreTargetPath } from './trash';

describe('trash path recovery', () => {
  it('strips .yan/trash prefix', () => {
    expect(originalPathFromTrash('.yan/trash/00-inbox/a.md')).toBe('00-inbox/a.md');
    expect(originalPathFromTrash('.yan/trash/root.md')).toBe('root.md');
  });

  it('strips conflict stamp', () => {
    expect(originalPathFromTrash('.yan/trash/30-knowledge/foo__2026-10-28T01-02-03-000Z.md')).toBe(
      '30-knowledge/foo.md',
    );
  });

  it('rejects non-trash', () => {
    expect(originalPathFromTrash('00-inbox/a.md')).toBeNull();
  });

  it('falls back to inbox when parent missing', () => {
    const r = restoreTargetPath('.yan/trash/gone/x.md', {
      inbox: '00-inbox',
      dirExists: () => false,
    });
    expect(r).toEqual({ target: '00-inbox/x.md', usedInboxFallback: true });
  });

  it('keeps original when parent exists', () => {
    const r = restoreTargetPath('.yan/trash/30-knowledge/x.md', {
      inbox: '00-inbox',
      dirExists: (p) => p === '30-knowledge',
    });
    expect(r).toEqual({ target: '30-knowledge/x.md', usedInboxFallback: false });
  });
});
