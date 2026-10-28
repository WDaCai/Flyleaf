import { describe, expect, it } from 'vitest';
import {
  isProtectedFolderPath,
  normalizeFolderPath,
  normalizeFoldersConfig,
  seedFromExisting,
  slugFolderName,
  validateFolderPath,
  canDeleteFolder,
  pickNextInbox,
  planFolderRename,
  foldersAfterDelete,
  folderIsUnder,
} from './folders';

describe('folders path', () => {
  it('接受多层相对路径', () => {
    expect(normalizeFolderPath('00-inbox')).toBe('00-inbox');
    expect(normalizeFolderPath('研究/材质')).toBe('研究/材质');
    expect(normalizeFolderPath('研究/材质/金属')).toBe('研究/材质/金属');
    expect(normalizeFolderPath('./foo')).toBe('foo');
  });

  it('拒绝 ..、绝对路径、隐藏段与非法字符', () => {
    expect(normalizeFolderPath('../x')).toBeNull();
    expect(normalizeFolderPath('/abs')).toBeNull();
    expect(normalizeFolderPath('C:/abs')).toBeNull();
    expect(normalizeFolderPath('.yan')).toBeNull();
    expect(normalizeFolderPath('a/b/c/d/e/f/g/h/i')).toBeNull();
    expect(normalizeFolderPath('a<b')).toBeNull();
    expect(validateFolderPath('..')).toMatch(/不合法/);
    expect(validateFolderPath('assets')).toMatch(/系统目录/);
    expect(validateFolderPath('.yan')).toMatch(/不合法|系统/);
  });

  it('保护系统路径', () => {
    expect(isProtectedFolderPath('.yan')).toBe(true);
    expect(isProtectedFolderPath('assets')).toBe(true);
    expect(isProtectedFolderPath('.yan/templates')).toBe(true);
    expect(isProtectedFolderPath('00-inbox')).toBe(false);
  });

  it('slug 保留中文并过滤非法字符', () => {
    expect(slugFolderName('材质研究')).toBe('材质研究');
    expect(slugFolderName('a/b:c')).toBe('a b c');
  });
});

describe('folders config', () => {
  it('空输入回落默认种子', () => {
    const cfg = normalizeFoldersConfig(null);
    expect(cfg.version).toBe(1);
    expect(cfg.inbox).toBe('00-inbox');
    expect(cfg.folders.some((f) => f.path === '10-pitfalls')).toBe(true);
  });

  it('丢掉非法 path，inbox 不在列表时回落到第一项', () => {
    const cfg = normalizeFoldersConfig({
      version: 1,
      inbox: '../evil',
      folders: [
        { path: '研究', title: '研究' },
        { path: '../x', title: '坏' },
        { path: 'assets', title: '资源' },
      ],
    });
    expect(cfg.folders.map((f) => f.path)).toEqual(['研究']);
    expect(cfg.inbox).toBe('研究');
  });

  it('扫描已有顶层目录并补种子', () => {
    const cfg = seedFromExisting(['30-knowledge', '我的夹', 'assets', '.yan']);
    expect(cfg.folders.find((f) => f.path === '30-knowledge')?.title).toBe('知识');
    expect(cfg.folders.find((f) => f.path === '我的夹')?.title).toBe('我的夹');
    expect(cfg.folders.some((f) => f.path === '00-inbox')).toBe(true);
    expect(cfg.folders.some((f) => f.path === 'assets')).toBe(false);
  });
});

describe('folders delete policy', () => {
  it('非空且 refuse 时拒绝', () => {
    const r = canDeleteFolder({
      path: '10-pitfalls',
      isInbox: false,
      isEmpty: false,
      mode: 'refuse-if-not-empty',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/非空/);
  });

  it('非空但 recursive 允许（业务层再二次确认）', () => {
    expect(
      canDeleteFolder({
        path: '10-pitfalls',
        isInbox: false,
        isEmpty: false,
        mode: 'delete-recursive',
      }).ok,
    ).toBe(true);
  });

  it('inbox 与系统目录拒绝', () => {
    const inbox = canDeleteFolder({
      path: '00-inbox',
      isInbox: true,
      isEmpty: true,
      mode: 'refuse-if-not-empty',
    });
    expect(inbox.ok).toBe(false);
    if (!inbox.ok) expect(inbox.reason).toMatch(/设为收件箱/);
    expect(
      canDeleteFolder({ path: 'assets', isInbox: false, isEmpty: true, mode: 'delete-recursive' }).ok,
    ).toBe(false);
  });
});

describe('nested folders', () => {
  const list = [
    { path: '研究', title: '研究' },
    { path: '研究/材质', title: '材质' },
    { path: '笔记', title: '笔记' },
  ];

  it('重命名父文件夹时子路径跟着改', () => {
    const planned = planFolderRename(list, '研究', '调研', '调研');
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.folders.map((f) => f.path)).toEqual(['调研', '调研/材质', '笔记']);
    expect(planned.folders[0]?.title).toBe('调研');
    expect(planned.folders[1]?.title).toBe('材质');
  });

  it('不能把文件夹移进自己里面', () => {
    const planned = planFolderRename(list, '研究', '研究/内部');
    expect(planned.ok).toBe(false);
  });

  it('删除父文件夹时清单去掉子文件夹', () => {
    expect(foldersAfterDelete(list, '研究').map((f) => f.path)).toEqual(['笔记']);
  });
});

describe('pickNextInbox', () => {
  it('排除正在删除的路径，回落到下一个分类', () => {
    const cfg = normalizeFoldersConfig({
      version: 1,
      inbox: '00-inbox',
      folders: [
        { path: '00-inbox', title: '收件箱' },
        { path: '研究', title: '研究' },
      ],
    });
    expect(pickNextInbox(cfg, '00-inbox')).toBe('研究');
  });

  it('不把正在删除的子文件夹选成下一个收件箱', () => {
    const cfg = normalizeFoldersConfig({
      version: 1,
      inbox: '研究',
      folders: [
        { path: '研究', title: '研究' },
        { path: '研究/材质', title: '材质' },
        { path: '笔记', title: '笔记' },
      ],
    });
    expect(pickNextInbox(cfg, '研究')).toBe('笔记');
    expect(folderIsUnder('研究/材质', '研究')).toBe(true);
  });

  it('没有其他分类时返回 null', () => {
    const cfg = normalizeFoldersConfig({
      version: 1,
      inbox: '00-inbox',
      folders: [{ path: '00-inbox', title: '收件箱' }],
    });
    expect(pickNextInbox(cfg, '00-inbox')).toBeNull();
  });
});
