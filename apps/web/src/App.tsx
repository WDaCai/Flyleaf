import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Backlink,
  FileNode,
  FoldersConfig,
  FrameworkTree,
  Mastery,
  NavTarget,
  NoteDoc,
  NoteType,
  VaultInfo,
  FlyleafClient,
  TrashItem,
} from '@flyleaf/core/contracts';
import { Editor } from './components/Editor';
import { ExperimentChart } from './components/ExperimentChart';
import { MetaPanel } from './components/MetaPanel';
import { Framework } from './components/Framework';
import { Palette, type PaletteItem } from './components/Palette';
import { renderMarkdown, WIKI_PREFIX } from './markdown';
import markdownGuideBody from './help/markdown-guide.md?raw';
import { toPng } from 'html-to-image';


type UiTheme = 'dark' | 'light';
type EditorWidth = 'narrow' | 'mid' | 'wide';
const THEME_KEY = 'flyleaf-theme';
const WIDTH_KEY = 'flyleaf-editor-width';
const FOCUS_KEY = 'flyleaf-focus';

function readStoredWidth(): EditorWidth {
  try {
    const v = localStorage.getItem(WIDTH_KEY);
    if (v === 'narrow' || v === 'mid' || v === 'wide') return v;
  } catch {
    /* ignore */
  }
  return 'mid';
}

function applyEditorWidth(w: EditorWidth): void {
  document.documentElement.setAttribute('data-editor-width', w);
  try {
    localStorage.setItem(WIDTH_KEY, w);
  } catch {
    /* ignore */
  }
}

function readStoredFocus(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredTheme(): UiTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyTheme(theme: UiTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

interface Tab {
  path: string;
  title: string;
}

const NEW_TYPES: Array<{ type: NoteType; label: string }> = [
  { type: 'pitfall', label: '踩坑' },
  { type: 'experiment', label: '实验' },
  { type: 'knowledge', label: '知识' },
  { type: 'weekly', label: '周报' },
  { type: 'framework', label: '框架' },
  { type: 'note', label: '随手记' },
];

const MARKDOWN_GUIDE_PATH = '30-knowledge/Markdown写法说明.md';
const MARKDOWN_GUIDE_TITLE = 'Markdown写法说明';

const PITFALL_TEMPLATE = ['## 症状', '', '## 环境', '', '## 原因', '', '## 解法', '', '## 验证', ''].join('\n');

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayInboxPath(inbox = '00-inbox'): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${inbox}/${y}-${m}-${day}.md`;
}

/** 过滤 Windows 非法路径字符，保留中文 */
function sanitizeFolderPathInput(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/^[/]+|[/]+$/g, '')
    .replace(/[/]+/g, '/')
    .slice(0, 80);
}

function baseName(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function withoutExt(p: string): string {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? b : b.slice(0, i);
}

function firstNoteLeaf(nodes: FileNode[]): FileNode | null {
  for (const n of nodes) {
    if (n.kind === 'file') return n;
    if (n.children) {
      const hit = firstNoteLeaf(n.children);
      if (hit) return hit;
    }
  }
  return null;
}


function collapseStorageKey(path: string): string {
  return `flyleaf.fw.collapsed:${path}`;
}

function resolveFrameworkDir(folders: FoldersConfig | null): string {
  const list = folders?.folders ?? [];
  const byPath = list.find((f) => /framework/i.test(f.path));
  if (byPath) return byPath.path;
  const byTitle = list.find((f) => /框架/.test(f.title));
  if (byTitle) return byTitle.path;
  return '50-frameworks';
}

function countFrameworkFiles(nodes: FileNode[]): number {
  let n = 0;
  const walk = (list: FileNode[]): void => {
    for (const x of list) {
      if (x.kind === 'file' && /framework/i.test(x.path)) {
        /* path heuristic weak; rely on search when possible */
      }
      if (x.kind === 'dir' && x.children) walk(x.children);
      if (x.kind === 'file' && x.path.includes('50-frameworks') && x.path.endsWith('.md') && !x.path.includes('/nodes/')) {
        n += 1;
      }
    }
  };
  walk(nodes);
  return n;
}

function titleOf(doc: NoteDoc): string {
  const t = doc.frontmatter.title;
  return typeof t === 'string' && t.trim() ? t.trim() : withoutExt(doc.path);
}

export function App({ client }: { client: FlyleafClient }): React.ReactElement {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [needVault, setNeedVault] = useState(false);
  const [vaultInput, setVaultInput] = useState('');

  const [tree, setTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [doc, setDoc] = useState<NoteDoc | null>(null);

  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [framework, setFramework] = useState<FrameworkTree | null>(null);
  const [fwMode, setFwMode] = useState<'outline' | 'mindmap'>('outline');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hasFrameworkNotes, setHasFrameworkNotes] = useState(true);
  const fwCollapsePath = useRef<string | null>(null);
  const largeTreeWarned = useRef<string | null>(null);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [status, setStatus] = useState('就绪');
  const [palette, setPalette] = useState<'command' | 'search' | null>(null);
  const [present, setPresent] = useState(false);
  const [captureFlash, setCaptureFlash] = useState<{ file: string; line: number } | null>(null);
  const [folders, setFolders] = useState<FoldersConfig | null>(null);
  const [folderDialog, setFolderDialog] = useState<
    null | { mode: 'create' } | { mode: 'rename'; path: string; title: string } | { mode: 'manage' }
  >(null);
  const [dirMenu, setDirMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [theme, setTheme] = useState<UiTheme>(() => {
    const initial = readStoredTheme();
    applyTheme(initial);
    return initial;
  });
  const [focusMode, setFocusMode] = useState<boolean>(() => readStoredFocus());
  const [editorWidth, setEditorWidth] = useState<EditorWidth>(() => {
    const w = readStoredWidth();
    applyEditorWidth(w);
    return w;
  });
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [lastTrashed, setLastTrashed] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const statusTimer = useRef<number | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyEditorWidth(editorWidth);
  }, [editorWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(FOCUS_KEY, focusMode ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [focusMode]);

  const flashStatus = useCallback((msg: string, autoClearMs = 3200): void => {
    setStatus(msg);
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), autoClearMs);
    statusTimer.current = window.setTimeout(() => {
      setStatus((cur) => (cur === msg ? '就绪' : cur));
    }, autoClearMs + 400);
  }, []);

  const toggleTheme = useCallback((): void => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const docRef = useRef<NoteDoc | null>(null);
  const bodyRef = useRef('');
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      const next = await client.vault.tree();
      setTree(next);
      try {
        const hits = await client.search.query({ type: 'framework', limit: 1 });
        setHasFrameworkNotes(hits.length > 0 || countFrameworkFiles(next) > 0);
      } catch {
        setHasFrameworkNotes(countFrameworkFiles(next) > 0);
      }
    } catch {
      setTree([]);
      setHasFrameworkNotes(false);
    }
  }, [client]);

  const refreshFolders = useCallback(async () => {
    try {
      setFolders(await client.vault.listFolders());
    } catch {
      setFolders(null);
    }
  }, [client]);

  const refreshTrash = useCallback(async () => {
    try {
      setTrashItems(await client.notes.listTrash(30));
    } catch {
      setTrashItems([]);
    }
  }, [client]);

  const doSave = useCallback(async (): Promise<void> => {
    const pending = pendingRef.current;
    const d = docRef.current;
    if (pending === null || !d) return;
    pendingRef.current = null;
    try {
      const next = await client.notes.write(d.path, pending, undefined, d.mtimeMs);
      const fresh = { ...d, mtimeMs: next.mtimeMs };
      docRef.current = fresh;
      setDoc(fresh);
      setStatus(`已保存 ${nowTime()}`);
      if (String(d.frontmatter.type) === 'framework') {
        setFramework(await client.framework.tree(d.path));
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'CONFLICT') {
        setStatus('文件已被外部修改，已重新载入');
        const again = await client.notes.read(d.path);
        docRef.current = again;
        bodyRef.current = again.body;
        pendingRef.current = null;
        setDoc(again);
        setBody(again.body);
      } else {
        setStatus(`保存失败：${err.message ?? '未知错误'}`);
      }
    }
  }, [client]);

  const openPath = useCallback(
    async (path: string): Promise<void> => {
      await doSave();
      const d = await client.notes.read(path);
      docRef.current = d;
      bodyRef.current = d.body;
      pendingRef.current = null;
      setDoc(d);
      setBody(d.body);
      setActive(path);
      setHighlightLine(null);
      setTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev;
        return [...prev, { path, title: titleOf(d) }].slice(-8);
      });
      if (String(d.frontmatter.type) === 'framework') {
        setFramework(await client.framework.tree(path));
      } else {
        setFramework(null);
      }
      setBacklinks(await client.notes.backlinks(path));
      setStatus(path);
    },
    [client, doSave],
  );

  const onBodyChange = useCallback(
    (next: string): void => {
      bodyRef.current = next;
      pendingRef.current = next;
      if (mode === 'preview') setBody(next);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void doSave();
      }, 800);
    },
    [doSave, mode],
  );

  const navigate = useCallback(
    async (target: NavTarget | null): Promise<void> => {
      if (!target) return;
      if (target.kind === 'line' && docRef.current?.path === target.path) {
        setHighlightLine(target.line);
        return;
      }
      await openPath(target.path);
      if (target.kind === 'line') setHighlightLine(target.line);
    },
    [openPath],
  );


  const openMarkdownGuide = useCallback(async (): Promise<void> => {
    try {
      await client.notes.read(MARKDOWN_GUIDE_PATH);
      await openPath(MARKDOWN_GUIDE_PATH);
      setMode('preview');
      setBody(bodyRef.current);
      setStatus(MARKDOWN_GUIDE_PATH);
      return;
    } catch {
      /* 不存在则写入，不覆盖已有 */
    }
    try {
      const created = await client.notes.create({
        type: 'knowledge',
        title: MARKDOWN_GUIDE_TITLE,
        body: markdownGuideBody.replace(/^\uFEFF/, ''),
      });
      await refreshTree();
      await openPath(created.path);
      setMode('preview');
      setBody(bodyRef.current);
      setStatus(`已写入 ${created.path}`);
    } catch (e) {
      const err = e as { message?: string };
      setStatus(`打开 Markdown 说明失败：${err.message ?? '未知错误'}`);
    }
  }, [client, openPath, refreshTree]);

  const createNote = useCallback(
    async (type: NoteType, dir?: string): Promise<void> => {
      const label = NEW_TYPES.find((t) => t.type === type)?.label ?? '笔记';
      const where = dir ? `到 ${dir}` : '';
      const title = window.prompt(`新建${label}${where} · 标题`, `${label} ${new Date().toLocaleDateString('zh-CN')}`);
      if (!title) return;
      const created = await client.notes.create({ type, title, dir });
      await refreshTree();
      await openPath(created.path);
      setStatus(`已新建 ${created.path}`);
    },
    [client, openPath, refreshTree],
  );

  const createFolder = useCallback(
    async (title: string, pathInput: string): Promise<void> => {
      const path = sanitizeFolderPathInput(pathInput || title);
      if (!path) {
        setStatus('请填写目录名');
        return;
      }
      try {
        const next = await client.vault.createFolder({ path, title: title.trim() || path });
        setFolders(next);
        await refreshTree();
        setFolderDialog(null);
        setStatus(`已建文件夹 ${path}`);
      } catch (e) {
        const err = e as { message?: string };
        setStatus(`新建文件夹失败：${err.message ?? '未知错误'}`);
      }
    },
    [client, refreshTree],
  );

  const renameFolder = useCallback(
    async (from: string, toRaw: string, title: string): Promise<void> => {
      const to = sanitizeFolderPathInput(toRaw);
      if (!to) {
        setStatus('目录名不能为空');
        return;
      }
      try {
        const next = await client.vault.renameFolder({ from, to, title: title.trim() || undefined });
        setFolders(next);
        await refreshTree();
        setFolderDialog(null);
        setStatus(`已重命名 ${from} → ${to}`);
      } catch (e) {
        const err = e as { message?: string };
        setStatus(`重命名失败：${err.message ?? '未知错误'}`);
      }
    },
    [client, refreshTree],
  );

  const deleteFolder = useCallback(
    async (path: string): Promise<void> => {
      const ok = window.confirm(`删除文件夹「${path}」？
空目录可删；有内容则拒绝（不会清笔记）。
若正用作收件箱且还有其他分类，会自动把收件箱迁过去。`);
      if (!ok) return;
      try {
        const next = await client.vault.deleteFolder({ path, mode: 'refuse-if-not-empty' });
        setFolders(next);
        await refreshTree();
        setStatus(`已删除文件夹 ${path}`);
      } catch (e) {
        const err = e as { message?: string };
        const msg = err.message ?? '未知错误';
        if (msg.includes('非空')) {
          const force = window.confirm(`${msg}

确定要连同里面的笔记一起删除吗？此操作不可恢复。`);
          if (!force) {
            setStatus('已取消删除');
            return;
          }
          try {
            const next = await client.vault.deleteFolder({ path, mode: 'delete-recursive' });
            setFolders(next);
            await refreshTree();
            setStatus(`已递归删除 ${path}`);
          } catch (e2) {
            const err2 = e2 as { message?: string };
            setStatus(`删除失败：${err2.message ?? '未知错误'}`);
          }
        } else {
          setStatus(`删除失败：${msg}`);
        }
      }
    },
    [client, refreshTree],
  );

  const setInboxFolder = useCallback(
    async (path: string): Promise<void> => {
      try {
        const next = await client.vault.setInbox(path);
        setFolders(next);
        flashStatus(`已设收件箱 → ${path}`);
      } catch (e) {
        const err = e as { message?: string };
        setStatus(`设置收件箱失败：${err.message ?? '未知错误'}`);
      }
    },
    [client, flashStatus],
  );

  const clearOpenNote = useCallback(
    (path: string): void => {
      setTabs((prev) => prev.filter((x) => x.path !== path));
      if (active === path || docRef.current?.path === path) {
        setActive(null);
        setDoc(null);
        docRef.current = null;
        bodyRef.current = '';
        pendingRef.current = null;
        setBody('');
        setFramework(null);
        setBacklinks([]);
      }
    },
    [active],
  );

  const deleteNote = useCallback(
    async (path: string, mode: 'trash' | 'hard' = 'trash'): Promise<void> => {
      const label = withoutExt(path);
      if (mode === 'hard') {
        const ok = window.confirm(`永久删除「${label}」？
此操作不可恢复，不会进入回收站。`);
        if (!ok) return;
      } else {
        const ok = window.confirm(`将「${label}」移入回收站？`);
        if (!ok) return;
      }
      try {
        await doSave();
        const result = await client.notes.delete({ path, mode });
        clearOpenNote(path);
        await refreshTree();
        if (result.mode === 'trash') {
          setLastTrashed(result.trashedTo ?? null);
          flashStatus('已移入回收站');
          if (trashOpen) void refreshTrash();
        } else {
          flashStatus(`已永久删除 ${path}`);
        }
      } catch (e) {
        const err = e as { message?: string };
        setStatus(`删除失败：${err.message ?? '未知错误'}`);
      }
    },
    [client, clearOpenNote, doSave, flashStatus, refreshTree, refreshTrash, trashOpen],
  );

  const restoreNote = useCallback(
    async (trashedPath: string): Promise<void> => {
      try {
        const result = await client.notes.restore({
          path: trashedPath,
          inbox: folders?.inbox ?? '00-inbox',
        });
        await refreshTree();
        await refreshTrash();
        await openPath(result.to);
        flashStatus(result.usedInboxFallback ? `已还原到收件箱：${result.to}` : `已还原：${result.to}`);
        if (lastTrashed === trashedPath) setLastTrashed(null);
      } catch (e) {
        const err = e as { message?: string };
        setStatus(`还原失败：${err.message ?? '未知错误'}`);
      }
    },
    [client, folders?.inbox, flashStatus, lastTrashed, openPath, refreshTrash, refreshTree],
  );

  const restoreLatest = useCallback(async (): Promise<void> => {
    let path = lastTrashed;
    if (!path) {
      const list = await client.notes.listTrash(1);
      path = list[0]?.path ?? null;
    }
    if (!path) {
      flashStatus('回收站为空');
      return;
    }
    await restoreNote(path);
  }, [client, flashStatus, lastTrashed, restoreNote]);

  const clearTrash = useCallback(async (): Promise<void> => {
    const ok = window.confirm(
      '清空回收站？\n将永久删除回收站内全部笔记，此操作不可恢复。',
    );
    if (!ok) return;
    try {
      const result = await client.notes.clearTrash();
      setLastTrashed(null);
      await refreshTrash();
      flashStatus(result.removed ? `已清空回收站（${result.removed}）` : '回收站已为空');
    } catch (e) {
      const err = e as { message?: string };
      setStatus(`清空失败：${err.message ?? '未知错误'}`);
    }
  }, [client, flashStatus, refreshTrash]);

    const setEditorWidthPref = useCallback(
    (w: EditorWidth): void => {
      setEditorWidth(w);
      flashStatus(w === 'narrow' ? '读宽：窄' : w === 'wide' ? '读宽：宽' : '读宽：中');
    },
    [flashStatus],
  );

  const toggleFocus = useCallback((): void => {
    setFocusMode((v) => {
      const next = !v;
      flashStatus(next ? '已进入 Focus' : '已退出 Focus');
      return next;
    });
  }, [flashStatus]);


  const moveNote = useCallback(
    async (from: string, folder: string): Promise<void> => {
      const name = baseName(from);
      const to = folder ? `${folder}/${name}` : name;
      if (to === from) {
        setStatus('已在该文件夹');
        return;
      }
      try {
        await doSave();
        await client.notes.rename(from, to);
        clearOpenNote(from);
        await refreshTree();
        await openPath(to);
        setStatus(`已移动 → ${to}`);
      } catch (e) {
        const err = e as { message?: string };
        setStatus(`移动失败：${err.message ?? '未知错误'}`);
      }
    },
    [client, clearOpenNote, doSave, openPath, refreshTree],
  );

  const insertPitfallTemplate = useCallback((): void => {
    const current = bodyRef.current;
    if (current.includes('## 症状')) {
      setStatus('正文已有五段模板');
      return;
    }
    const next = current.trim() ? `${current.trimEnd()}\n\n${PITFALL_TEMPLATE}` : PITFALL_TEMPLATE;
    bodyRef.current = next;
    pendingRef.current = next;
    setBody(next);
    setMode('edit');
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void doSave();
    }, 200);
    setStatus('已插入踩坑五段模板');
  }, [doSave]);

  const setNodeState = useCallback(
    async (line: number, state: Mastery): Promise<void> => {
      const d = docRef.current;
      if (!d) return;
      await doSave();
      setFramework(await client.framework.setState(d.path, line, state));
      setStatus(`第 ${line} 行 → ${state}`);
    },
    [client, doSave],
  );

  const expandNode = useCallback(
    async (line: number): Promise<void> => {
      const d = docRef.current;
      if (!d) return;
      await doSave();
      const res = await client.framework.expandNode(d.path, line);
      setFramework(res.tree);
      const fresh = await client.notes.read(d.path);
      docRef.current = fresh;
      bodyRef.current = fresh.body;
      setDoc(fresh);
      setBody(fresh.body);
      await refreshTree();
      setStatus(`已展开为 ${res.doc.path}`);
    },
    [client, doSave, refreshTree],
  );

  const toggleCollapse = useCallback((id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 折叠状态按框架 path 记住
  useEffect(() => {
    if (!framework) {
      fwCollapsePath.current = null;
      return;
    }
    if (fwCollapsePath.current === framework.path) return;
    fwCollapsePath.current = framework.path;
    try {
      const raw = localStorage.getItem(collapseStorageKey(framework.path));
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) setCollapsed(new Set(arr.filter((x): x is string => typeof x === 'string')));
        else setCollapsed(new Set());
      } else {
        setCollapsed(new Set());
      }
    } catch {
      setCollapsed(new Set());
    }
  }, [framework]);

  useEffect(() => {
    if (!framework) return;
    try {
      localStorage.setItem(collapseStorageKey(framework.path), JSON.stringify([...collapsed]));
    } catch {
      /* ignore */
    }
  }, [collapsed, framework]);

  useEffect(() => {
    if (!framework) return;
    if (framework.stats.total <= 200) return;
    if (largeTreeWarned.current === framework.path) return;
    largeTreeWarned.current = framework.path;
    flashStatus('节点超过 200，建议拆成多棵框架');
  }, [framework, flashStatus]);

  const refreshFrameworkDoc = useCallback(async (): Promise<void> => {
    const d = docRef.current;
    if (!d) return;
    const fresh = await client.notes.read(d.path);
    docRef.current = fresh;
    bodyRef.current = fresh.body;
    setDoc(fresh);
    setBody(fresh.body);
  }, [client]);

  const addFwNode = useCallback(
    async (afterLine: number | null, asChild: boolean): Promise<void> => {
      const d = docRef.current;
      if (!d) return;
      const text = window.prompt(asChild ? '子节点标题' : '节点标题', '新节点');
      if (!text || !text.trim()) return;
      await doSave();
      setFramework(
        await client.framework.addNode(d.path, { afterLine, text: text.trim(), asChild }),
      );
      await refreshFrameworkDoc();
      setStatus('已添加节点');
    },
    [client, doSave, refreshFrameworkDoc],
  );

  const renameFwNode = useCallback(
    async (line: number): Promise<void> => {
      const d = docRef.current;
      if (!d || !framework) return;
      const walk = (n: typeof framework.root): string | null => {
        if (n.line === line) return n.text;
        for (const c of n.children) {
          const hit = walk(c);
          if (hit != null) return hit;
        }
        return null;
      };
      const cur = walk(framework.root) ?? '';
      const text = window.prompt('重命名节点', cur);
      if (!text || !text.trim() || text.trim() === cur) return;
      await doSave();
      setFramework(await client.framework.renameNode(d.path, line, text.trim()));
      await refreshFrameworkDoc();
      setHighlightLine(line);
      setStatus(`已重命名第 ${line} 行`);
    },
    [client, doSave, framework, refreshFrameworkDoc],
  );

  const removeFwNode = useCallback(
    async (line: number): Promise<void> => {
      const d = docRef.current;
      if (!d || !framework) return;
      const walk = (
        n: typeof framework.root,
      ): { text: string; hasFile: boolean; kids: number } | null => {
        if (n.line === line) {
          const count = (x: typeof n): number => 1 + x.children.reduce((a, c) => a + count(c), 0);
          return {
            text: n.text,
            hasFile: n.target?.kind === 'file',
            kids: count(n) - 1,
          };
        }
        for (const c of n.children) {
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      const info = walk(framework.root);
      if (!info) return;
      const extra = info.kids > 0 ? `（含 ${info.kids} 个子节点）` : '';
      const fileTip = info.hasFile
        ? '\n关联的独立笔记会移入回收站（可还原），不会静默硬删。'
        : '';
      const ok = window.confirm(`删除节点「${info.text}」${extra}？${fileTip}`);
      if (!ok) return;
      await doSave();
      const res = await client.framework.removeNode(d.path, line, { trashLinked: true });
      setFramework(res.tree);
      await refreshFrameworkDoc();
      setHighlightLine(null);
      if (res.trashed.length) {
        flashStatus(`已删除节点，${res.trashed.length} 个关联笔记已入回收站`);
        await refreshTrash();
      } else {
        setStatus('已删除节点');
      }
    },
    [client, doSave, flashStatus, framework, refreshFrameworkDoc, refreshTrash],
  );

  const shiftFwNode = useCallback(
    async (line: number, delta: -1 | 1): Promise<void> => {
      const d = docRef.current;
      if (!d) return;
      await doSave();
      setFramework(await client.framework.shiftNode(d.path, line, delta));
      await refreshFrameworkDoc();
      setHighlightLine(line);
      setStatus(delta > 0 ? '已降级' : '已升级');
    },
    [client, doSave, refreshFrameworkDoc],
  );

  const createFrameworkNote = useCallback(async (): Promise<void> => {
    const dir = resolveFrameworkDir(folders);
    await createNote('framework', dir);
  }, [createNote, folders]);

  /** 属性面板保存：连同当前正文一起提交，避免丢字 */
  const saveMeta = useCallback(
    async (patch: Record<string, unknown>): Promise<void> => {
      const d = docRef.current;
      if (!d) return;
      try {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          clean[k] = v === undefined ? null : v;
        }
        const next = await client.notes.write(d.path, bodyRef.current, clean, d.mtimeMs);
        docRef.current = next;
        setDoc(next);
        pendingRef.current = null;
        setStatus('属性已保存');
      } catch (e) {
        setStatus(`属性保存失败：${String(e)}`);
      }
    },
    [client],
  );

  const exportPng = useCallback(async (): Promise<void> => {
    const el = document.querySelector('.present-paper') as HTMLElement | null;
    if (!el) return;
    try {
      const dataUrl = await toPng(el, { backgroundColor: '#fafaf8', pixelRatio: 2, cacheBust: true });
      const blob = await (await fetch(dataUrl)).blob();
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setStatus('已复制图片到剪贴板');
      } catch {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${(doc?.path ?? 'note').split('/').pop()?.replace(/\.md$/, '') ?? 'note'}.png`;
        a.click();
        setStatus('浏览器不允许直接写剪贴板，已下载 PNG');
      }
    } catch (e) {
      setStatus(`导出失败：${String(e)}`);
    }
  }, [doc]);

  const openTodayInbox = useCallback(async (): Promise<void> => {
    const path = captureFlash?.file ?? todayInboxPath(folders?.inbox ?? '00-inbox');
    try {
      await openPath(path);
      if (captureFlash?.line) setHighlightLine(captureFlash.line);
      setCaptureFlash(null);
    } catch {
      setStatus(`今日 inbox 还不存在：${path}（先用 Ctrl+Alt+Space 归档一条）`);
    }
  }, [captureFlash, folders?.inbox, openPath]);

  useEffect(() => {
    if (trashOpen) void refreshTrash();
  }, [trashOpen, refreshTrash]);

  // 初始化
  useEffect(() => {
    void (async () => {
      try {
        const info = await client.vault.info();
        setVault(info);
        await refreshTree();
        await refreshFolders();
      } catch {
        setNeedVault(true);
      }
    })();
  }, [client, refreshFolders, refreshTree]);

  // 事件订阅
  useEffect(
    () =>
      client.events.subscribe((e) => {
        if (e.type === 'vault:changed') void refreshTree();
        if (e.type === 'capture:saved') {
          const file = 'file' in e && typeof e.file === 'string' ? e.file : todayInboxPath(folders?.inbox ?? '00-inbox');
          const line = 'line' in e && typeof e.line === 'number' ? e.line : 0;
          setCaptureFlash({ file, line });
          setStatus(`随记已归档 → ${file}`);
          void refreshTree();
        }
      }),
    [client, folders?.inbox, refreshTree],
  );

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && present) {
        setPresent(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable ||
          !!t.closest('.cm-editor'));
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && active) {
        e.preventDefault();
        void deleteNote(active, e.shiftKey ? 'hard' : 'trash');
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'p' && e.shiftKey) {
        e.preventDefault();
        setPresent((p) => !p);
        setMode('preview');
        setBody(bodyRef.current);
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPalette('command');
      } else if (e.key.toLowerCase() === 'f' && e.shiftKey) {
        e.preventDefault();
        setPalette('search');
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setMode((m) => (m === 'edit' ? 'preview' : 'edit'));
        setBody(bodyRef.current);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setFwMode((m) => (m === 'outline' ? 'mindmap' : 'outline'));
      } else if (e.key === '\\' || e.code === 'Backslash') {
        e.preventDefault();
        toggleFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [present, active, deleteNote, toggleFocus]);

  const openVault = async (): Promise<void> => {
    if (!vaultInput.trim()) return;
    const info = await client.vault.open(vaultInput.trim());
    setVault(info);
    setNeedVault(false);
    await refreshTree();
  };

  const commandItems = useMemo<PaletteItem[]>(() => {
    const folderActions: PaletteItem[] = [
      {
        id: 'folder-create',
        label: '新建文件夹',
        hint: '文件夹',
        run: () => setFolderDialog({ mode: 'create' }),
      },
      {
        id: 'folder-manage',
        label: '管理文件夹',
        hint: '文件夹',
        run: () => setFolderDialog({ mode: 'manage' }),
      },
      ...(folders?.folders ?? []).map((f) => ({
        id: `new-in-${f.path}`,
        label: `在「${f.title}」中新建笔记`,
        hint: f.path,
        run: () => void createNote('note', f.path),
      })),
    ];
    const actions: PaletteItem[] = [
      {
        id: 'new-framework',
        label: '新建框架笔记',
        hint: '框架',
        run: () => void createFrameworkNote(),
      },
      {
        id: 'markdown-guide',
        label: '打开 Markdown 写法说明',
        hint: '帮助',
        run: () => void openMarkdownGuide(),
      },
      {
        id: 'focus-toggle',
        label: focusMode ? '退出 Focus 模式' : '进入 Focus 模式',
        hint: 'Ctrl+\\',
        run: () => toggleFocus(),
      },
      {
        id: 'width-narrow',
        label: '读宽：窄',
        hint: '约 680px',
        run: () => setEditorWidthPref('narrow'),
      },
      {
        id: 'width-mid',
        label: '读宽：中',
        hint: '约 820px',
        run: () => setEditorWidthPref('mid'),
      },
      {
        id: 'width-wide',
        label: '读宽：宽',
        hint: '约 960px',
        run: () => setEditorWidthPref('wide'),
      },
      {
        id: 'trash-restore-latest',
        label: '还原最近删除',
        hint: '回收站',
        run: () => void restoreLatest(),
      },
      {
        id: 'trash-open',
        label: trashOpen ? '关闭回收站面板' : '打开回收站',
        hint: '回收站',
        run: () => setTrashOpen((v) => !v),
      },
      {
        id: 'trash-clear',
        label: '清空回收站',
        hint: '危险',
        run: () => void clearTrash(),
      },
      ...(active
        ? [
            {
              id: 'set-inbox-active-folder',
              label: '将当前笔记所在目录设为收件箱',
              hint: '文件夹',
              run: () => {
                const dir = active.includes('/') ? active.slice(0, active.lastIndexOf('/')) : '';
                if (dir) void setInboxFolder(dir);
                else flashStatus('当前笔记在库根，无法设收件箱');
              },
            } satisfies PaletteItem,
          ]
        : []),
      ...NEW_TYPES.map((t) => ({
        id: `new-${t.type}`,
        label: `新建${t.label}`,
        hint: '命令',
        run: () => void createNote(t.type),
      })),
      ...folderActions,
    ];
    const files: PaletteItem[] = [];
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.kind === 'file') files.push({ id: n.path, label: withoutExt(n.name), hint: n.path, run: () => void openPath(n.path) });
        else if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return [...actions, ...files];
  }, [active, clearTrash, createNote, createFrameworkNote, flashStatus, focusMode, folders, openMarkdownGuide, openPath, restoreLatest, setEditorWidthPref, setInboxFolder, toggleFocus, trashOpen, tree]);

  const searchFn = useCallback(
    async (q: string): Promise<PaletteItem[]> => {
      const hits = await client.search.query({ text: q, limit: 30 });
      return hits.map((h) => ({
        id: h.path,
        label: h.title,
        hint: `${h.path} · ${h.snippet.slice(0, 40)}`,
        run: () => void openPath(h.path),
      }));
    },
    [client, openPath],
  );

  const openFirstNote = useCallback((): void => {
    const leaf = firstNoteLeaf(tree);
    if (leaf) void openPath(leaf.path);
  }, [openPath, tree]);

  const openByName = useCallback(
    async (name: string): Promise<void> => {
      const flat: FileNode[] = [];
      const walk = (nodes: FileNode[]): void => {
        for (const n of nodes) {
          if (n.kind === 'file') flat.push(n);
          else if (n.children) walk(n.children);
        }
      };
      walk(tree);
      const hit = flat.find((f) => withoutExt(f.name).toLowerCase() === name.toLowerCase());
      if (hit) await openPath(hit.path);
      else setStatus(`找不到「${name}」，可在框架节点上点 ＋ 展开为文件`);
    },
    [openPath, tree],
  );

  if (needVault) {
    return (
      <div className="vault-open">
        <div className="vault-card">
          <h1>Flyleaf</h1>
          <p>输入一个文件夹路径作为 vault（不存在会自动创建）</p>
          <input className="input" value={vaultInput} onChange={(e) => setVaultInput(e.target.value)} placeholder="C:\\Users\\你\\Documents\\flyleaf-vault" />
          <button className="btn primary" onClick={() => void openVault()}>
            打开
          </button>
        </div>
      </div>
    );
  }

  const isFramework = framework !== null && doc !== null && String(doc.frontmatter.type) === 'framework';
  const isExperiment = doc !== null && String(doc.frontmatter.type) === 'experiment';
  const isPitfall = doc !== null && String(doc.frontmatter.type) === 'pitfall';
  const showPitfallInsert = isPitfall && !bodyRef.current.includes('## 症状') && !body.includes('## 症状');

  return (
    <div className={`app ${present ? 'present' : ''} ${focusMode ? 'focus-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">Flyleaf</span>
          <span className="vault-name">{vault?.name ?? '—'}</span>
          <button
            className="icon-btn theme-toggle"
            title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
          <button className="icon-btn" title="刷新文件树" onClick={() => void refreshTree()}>
            刷新
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="btn ghost" onClick={() => setPalette('command')}>
            <span>+ 新建</span>
            <kbd>Ctrl+P</kbd>
          </button>
          <button className="btn ghost" onClick={() => setPalette('search')}>
            <span>搜索</span>
            <kbd>Ctrl+Shift+F</kbd>
          </button>
          <button className="btn ghost" onClick={() => setFolderDialog({ mode: 'create' })} title="新建或管理文件夹">
            <span>文件夹</span>
          </button>
          <button
            className={`btn ghost ${trashOpen ? 'on' : ''}`}
            onClick={() => setTrashOpen((v) => !v)}
            title="回收站"
          >
            <span>回收站</span>
          </button>
        </div>

        <div
          className="tree"
          onClick={() => {
            setDirMenu(null);
            setFileMenu(null);
          }}
        >
          <TreeView
            nodes={tree}
            activePath={active}
            inboxPath={folders?.inbox ?? null}
            onOpen={(p) => void openPath(p)}
            onCreateIn={(dir) => void createNote('note', dir)}
            onDirMenu={(path, x, y) => {
              setFileMenu(null);
              setDirMenu({ path, x, y });
            }}
            onFileMenu={(path, x, y) => {
              setDirMenu(null);
              setFileMenu({ path, x, y });
            }}
          />
        </div>


        {trashOpen && (
          <div className="trash-panel">
            <div className="trash-panel-head">
              <strong>回收站</strong>
              <span className="trash-panel-count">{trashItems.length}</span>
              <div className="trash-panel-spacer" />
              <button
                type="button"
                className="btn ghost danger"
                disabled={trashItems.length === 0}
                onClick={() => void clearTrash()}
                title="永久清空"
              >
                清空
              </button>
              <button type="button" className="icon-btn" onClick={() => setTrashOpen(false)} title="关闭">
                ×
              </button>
            </div>
            <div className="trash-panel-body">
              {trashItems.length === 0 ? (
                <div className="empty-plain trash-empty">
                  <div className="empty-plain-title">回收站是空的</div>
                  <div className="empty-plain-copy">删除的笔记会出现在这里，可随时还原。</div>
                  <button type="button" className="btn primary" onClick={() => setTrashOpen(false)}>
                    返回笔记
                  </button>
                </div>
              ) : (
                trashItems.map((item) => (
                  <div key={item.path} className="trash-row">
                    <div className="trash-row-main" title={item.originalPath}>
                      <div className="trash-row-title">{item.title}</div>
                      <div className="trash-row-path">{item.originalPath}</div>
                    </div>
                    <button type="button" className="btn ghost" onClick={() => void restoreNote(item.path)}>
                      还原
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="sidebar-foot">
          <span>{vault?.noteCount ?? 0} 篇</span>
          <span className="dot" />
          {captureFlash ? (
            <button className="status-link" title="打开今日 inbox" onClick={() => void openTodayInbox()}>
              随记已归档 · 打开今日 inbox
            </button>
          ) : (
            <span className="status-text" title={status}>
              {status}
            </span>
          )}
        </div>
        <div className="sidebar-tip">关窗口进托盘，不退出；随记 Ctrl+Alt+Space</div>
      </aside>

      <main className="main">
        <div className="tabbar">
          {tabs.map((t) => (
            <div
              key={t.path}
              className={`tab ${active === t.path ? 'on' : ''}`}
              onClick={() => void openPath(t.path)}
              title={t.path}
            >
              <span className="tab-title">{t.title}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setTabs((prev) => prev.filter((x) => x.path !== t.path));
                  if (active === t.path) {
                    const rest = tabs.filter((x) => x.path !== t.path);
                    const last = rest[rest.length - 1];
                    if (last) void openPath(last.path);
                    else {
                      setActive(null);
                      setDoc(null);
                      docRef.current = null;
                      setFramework(null);
                    }
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="tabbar-fill" />
          {!doc && (
            <div className="tabbar-actions">
              <button
                className={`btn ghost ${focusMode ? 'focus-exit' : ''}`}
                onClick={toggleFocus}
                title="Focus 模式 Ctrl+\u005c"
              >
                {focusMode ? '退出 Focus' : 'Focus'}
              </button>
            </div>
          )}
          {doc && (
            <div className="tabbar-actions">
              <div className="seg">
                <button
                  className={mode === 'edit' ? 'seg-on' : ''}
                  onClick={() => {
                    setMode('edit');
                    setBody(bodyRef.current);
                  }}
                  title="编辑 Ctrl+E"
                >
                  编辑
                </button>
                <button
                  className={mode === 'preview' ? 'seg-on' : ''}
                  onClick={() => {
                    setMode('preview');
                    setBody(bodyRef.current);
                  }}
                  title="预览 Ctrl+E"
                >
                  预览
                </button>
              </div>
              {showPitfallInsert && (
                <button className="btn ghost" onClick={insertPitfallTemplate} title="插入症状/环境/原因/解法/验证">
                  插入模板
                </button>
              )}
              <button
                className="btn ghost"
                onClick={() => {
                  setPresent(true);
                  setMode('preview');
                  setBody(bodyRef.current);
                }}
                title="呈现模式 Ctrl+Shift+P"
              >
                呈现 <kbd>Ctrl+Shift+P</kbd>
              </button>
              <button
                className={`btn ghost ${focusMode ? 'focus-exit' : ''}`}
                onClick={toggleFocus}
                title="Focus 模式 Ctrl+\u005c"
              >
                {focusMode ? '退出 Focus' : 'Focus'}
              </button>
            </div>
          )}
        </div>

        <div className="content">
          <div key={active ?? 'empty'} className="content-pane">
          {!doc && (
            <div className="empty-plain">
              {firstNoteLeaf(tree) ? (
                <>
                  <div className="empty-plain-title">还没有打开笔记</div>
                  <div className="empty-plain-copy">从左侧选一篇，或打开第一篇开始。</div>
                  <button type="button" className="btn primary" onClick={openFirstNote}>
                    打开第一篇笔记
                  </button>
                </>
              ) : (
                <>
                  <div className="empty-plain-title">还没有笔记</div>
                  <div className="empty-plain-copy">新建一篇，或用随记热键 Ctrl+Alt+Space 快速记下。</div>
                  <button type="button" className="btn primary" onClick={() => setPalette('command')}>
                    新建笔记
                  </button>
                </>
              )}
              {!hasFrameworkNotes && (
                <>
                  <div className="empty-plain-title" style={{ marginTop: 28 }}>
                    还没有知识框架
                  </div>
                  <div className="empty-plain-copy">一棵缩进树，大纲与导图读同一份 Markdown。不超过两步就能建出根和子节点。</div>
                  <button type="button" className="btn primary" onClick={() => void createFrameworkNote()}>
                    新建框架笔记
                  </button>
                </>
              )}
            </div>
          )}

          {doc && isFramework && framework && (
            <Framework
              framework={framework}
              mode={fwMode}
              onModeChange={setFwMode}
              onSetState={(line, state) => void setNodeState(line, state)}
              onExpand={(line) => void expandNode(line)}
              onNavigate={(t) => void navigate(t)}
              onAddNode={(after, asChild) => void addFwNode(after, asChild)}
              onRenameNode={(line) => void renameFwNode(line)}
              onRemoveNode={(line) => void removeFwNode(line)}
              onShiftNode={(line, delta) => void shiftFwNode(line, delta)}
              collapsed={collapsed}
              onToggle={toggleCollapse}
              highlightLine={highlightLine}
              onSelectLine={setHighlightLine}
              loadCanvas={(path) => client.framework.getCanvas(path)}
              saveCanvas={(path, doc) => client.framework.saveCanvas(path, doc)}
            />
          )}

          {doc && !isFramework && mode === 'edit' && (
            <div className="doc-wrap">
              {isExperiment && <ExperimentChart body={bodyRef.current} />}
              <div className="doc-main">
                <Editor docKey={doc.path} value={bodyRef.current} onChange={onBodyChange} uiTheme={theme} />
              </div>
            </div>
          )}

          {doc && !isFramework && mode === 'preview' && (
            <div className="doc-wrap">
              {isExperiment && <ExperimentChart body={body} />}
              <div className="doc-main">
                <div
                  className="preview"
                  onClick={(e) => {
                    const a = (e.target as HTMLElement).closest('a');
                    if (!a) return;
                    const href = a.getAttribute('href') ?? '';
                    if (href.startsWith(WIKI_PREFIX)) {
                      e.preventDefault();
                      const name = decodeURIComponent(href.slice(WIKI_PREFIX.length));
                      void openByName(name);
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                />
              </div>
            </div>
          )}
          </div>
        </div>
      </main>

      {doc && !isFramework && (
        <aside key={doc.path} className="right anim-in">
          <div className="right-section">
            <div className="right-head">属性</div>
            <MetaPanel doc={doc} onSave={(patch) => void saveMeta(patch)} />
          </div>
          <div className="right-section right-section-grow">
            <div className="right-head">反向链接</div>
            <div className="right-body">
              {backlinks.length === 0 && <div className="right-empty">没有笔记链接到这里</div>}
              {backlinks.map((b) => (
                <div key={b.path} className="backlink" onClick={() => void openPath(b.path)} title={`${b.path}:${b.line}`}>
                  <div className="backlink-title">{b.title}</div>
                  <div className="backlink-path">{b.path}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="right-section">
            <div className="right-head">路径</div>
            <div className="right-foot">
              {doc.path}
              <br />
              {String(doc.frontmatter.type ?? 'note')}
            </div>
          </div>
        </aside>
      )}

      {present && (
        <div className="present-shell">
          <div className="present-bar">
            <span className="present-label">呈现模式</span>
            <button className="btn ghost" onClick={() => void exportPng()}>
              复制为图片
            </button>
            <button className="btn ghost" onClick={() => window.print()}>
              打印 / PDF
            </button>
            <button className="btn ghost" onClick={() => setPresent(false)}>
              退出 Esc
            </button>
          </div>
          <div className="present-paper">
            <div className="present-title">{doc ? titleOf(doc) : ''}</div>
            {isExperiment && <ExperimentChart body={body} />}
            <div className="present-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
          </div>
        </div>
      )}


      {toast && (
        <div className={`status-toast ${lastTrashed && toast.includes('回收站') ? 'has-action' : ''}`}>
          <span>{toast}</span>
          {lastTrashed && toast.includes('回收站') && (
            <button
              type="button"
              className="status-toast-action"
              onClick={() => void restoreLatest()}
            >
              撤销
            </button>
          )}
        </div>
      )}

      {palette === 'command' && (
        <Palette placeholder="搜索文件或执行命令…" items={commandItems} onClose={() => setPalette(null)} />
      )}
      {palette === 'search' && (
        <Palette placeholder="全文搜索（中文可直接搜）…" search={searchFn} onClose={() => setPalette(null)} />
      )}

      {folderDialog && (
        <FolderDialog
          key={folderDialog.mode === 'rename' ? `rename:${folderDialog.path}` : folderDialog.mode}
          state={folderDialog}
          folders={folders}
          inbox={folders?.inbox ?? '00-inbox'}
          onClose={() => setFolderDialog(null)}
          onCreate={(title, path) => void createFolder(title, path)}
          onRename={(from, to, title) => void renameFolder(from, to, title)}
          onDelete={(path) => void deleteFolder(path)}
          onSetInbox={(path) => void setInboxFolder(path)}
          onOpenCreate={() => setFolderDialog({ mode: 'create' })}
          onOpenRename={(path, title) => setFolderDialog({ mode: 'rename', path, title })}
        />
      )}

      {dirMenu && (
        <div className="dir-menu-backdrop" onClick={() => setDirMenu(null)}>
          <div
            className="dir-menu"
            style={{ left: dirMenu.x, top: dirMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const f = folders?.folders.find((x) => x.path === dirMenu.path);
                setFolderDialog({ mode: 'rename', path: dirMenu.path, title: f?.title ?? dirMenu.path });
                setDirMenu(null);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              onClick={() => {
                void createNote('note', dirMenu.path);
                setDirMenu(null);
              }}
            >
              在此新建笔记
            </button>
            <button
              type="button"
              onClick={() => {
                void setInboxFolder(dirMenu.path);
                setDirMenu(null);
              }}
            >
              设为随记收件箱
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const p = dirMenu.path;
                setDirMenu(null);
                void deleteFolder(p);
              }}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {fileMenu && (
        <div className="dir-menu-backdrop" onClick={() => setFileMenu(null)}>
          <div
            className="dir-menu"
            style={{ left: fileMenu.x, top: fileMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="danger"
              onClick={() => {
                const p = fileMenu.path;
                setFileMenu(null);
                void deleteNote(p, 'trash');
              }}
            >
              删除（进回收站）
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const p = fileMenu.path;
                setFileMenu(null);
                void deleteNote(p, 'hard');
              }}
            >
              永久删除
            </button>
            <div className="dir-menu-sep" />
            <div className="dir-menu-label">移动到</div>
            {(folders?.folders ?? []).map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => {
                  const p = fileMenu.path;
                  setFileMenu(null);
                  void moveNote(p, f.path);
                }}
              >
                {f.title}
                {folders?.inbox === f.path ? ' · 收件箱' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function TreeView({
  nodes,
  activePath,
  inboxPath,
  onOpen,
  onCreateIn,
  onDirMenu,
  onFileMenu,
}: {
  nodes: FileNode[];
  activePath: string | null;
  inboxPath?: string | null;
  onOpen: (path: string) => void;
  onCreateIn?: (dir: string) => void;
  onDirMenu?: (path: string, x: number, y: number) => void;
  onFileMenu?: (path: string, x: number, y: number) => void;
}): React.ReactElement {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const userTouched = useRef<Set<string>>(new Set());

  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const n of nodes) {
        if (n.kind !== 'dir') continue;
        // 顶层目录默认展开，但用户点过收起后不再强行打开
        if (!userTouched.current.has(n.path) && !next.has(n.path)) {
          next.add(n.path);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [nodes]);

  const toggle = (p: string): void => {
    userTouched.current.add(p);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const render = (list: FileNode[], depth: number): React.ReactNode =>
    list.map((n) => {
      if (n.kind === 'dir') {
        const expanded = open.has(n.path);
        const isInbox = inboxPath === n.path;
        const kids = n.children ?? [];
        const empty = kids.length === 0;
        return (
          <div key={n.path}>
            <div
              className={`tree-row dir ${isInbox ? 'inbox' : ''}`}
              style={{ paddingLeft: depth * 14 + 6 }}
              onClick={() => toggle(n.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                onDirMenu?.(n.path, e.clientX, e.clientY);
              }}
              title={`${n.path}${isInbox ? ' · 收件箱' : ''}（右键管理）`}
            >
              <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
              <span className="tree-name">{n.name}</span>
              {isInbox && <span className="tree-inbox-badge">收件箱</span>}
            </div>
            {expanded && empty && (
              <div className="tree-empty" style={{ paddingLeft: (depth + 1) * 14 + 20 }}>
                <span className="tree-empty-copy">此文件夹是空的</span>
                <button
                  type="button"
                  className="btn ghost tree-empty-cta"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateIn?.(n.path);
                  }}
                >
                  在此新建
                </button>
              </div>
            )}
            {expanded && !empty && render(kids, depth + 1)}
          </div>
        );
      }
      return (
        <div
          key={n.path}
          className={`tree-row file ${activePath === n.path ? 'on' : ''}`}
          style={{ paddingLeft: depth * 14 + 20 }}
          onClick={() => onOpen(n.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            onFileMenu?.(n.path, e.clientX, e.clientY);
          }}
          title={`${n.path}（右键删除/移动）`}
        >
          <span className="tree-name">{withoutExt(n.name)}</span>
        </div>
      );
    });

  if (nodes.length === 0) {
    return (
      <div className="tree-empty tree-empty-root">
        <span className="tree-empty-copy">还没有文件夹</span>
      </div>
    );
  }

  return <>{render(nodes, 0)}</>;
}

function FolderDialog({
  state,
  folders,
  inbox,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onSetInbox,
  onOpenCreate,
  onOpenRename,
}: {
  state: { mode: 'create' } | { mode: 'rename'; path: string; title: string } | { mode: 'manage' };
  folders: FoldersConfig | null;
  inbox: string;
  onClose: () => void;
  onCreate: (title: string, path: string) => void;
  onRename: (from: string, to: string, title: string) => void;
  onDelete: (path: string) => void;
  onSetInbox: (path: string) => void;
  onOpenCreate: () => void;
  onOpenRename: (path: string, title: string) => void;
}): React.ReactElement {
  const [title, setTitle] = useState(state.mode === 'rename' ? state.title : '');
  const [path, setPath] = useState(state.mode === 'rename' ? state.path : '');
  const [pathTouched, setPathTouched] = useState(state.mode === 'rename');

  const syncPathFromTitle = (t: string): void => {
    setTitle(t);
    if (!pathTouched && state.mode === 'create') {
      setPath(sanitizeFolderPathInput(t));
    }
  };

  return (
    <div className="folder-modal-backdrop" onClick={onClose}>
      <div className="folder-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {state.mode === 'manage' ? (
          <>
            <div className="folder-modal-head">
              <strong>管理文件夹</strong>
              <button type="button" className="icon-btn" onClick={onClose}>
                关闭
              </button>
            </div>
            <p className="folder-modal-hint">
              随记收件箱：<code>{inbox}</code>。也可在侧栏文件夹上右键操作。
            </p>
            <ul className="folder-list">
              {(folders?.folders ?? []).map((f) => (
                <li key={f.path}>
                  <div className="folder-list-main">
                    <span className="folder-list-title">{f.title}</span>
                    <code>{f.path}</code>
                    {f.path === inbox && <span className="folder-badge">inbox</span>}
                  </div>
                  <div className="folder-list-actions">
                    <button type="button" onClick={() => onSetInbox(f.path)}>
                      设为收件箱
                    </button>
                    <button type="button" onClick={() => onOpenRename(f.path, f.title)}>
                      重命名
                    </button>
                    <button type="button" className="danger" onClick={() => onDelete(f.path)}>
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="folder-modal-foot">
              <button type="button" className="btn ghost" onClick={onOpenCreate}>
                新建文件夹
              </button>
              <button type="button" className="btn" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="folder-modal-head">
              <strong>{state.mode === 'create' ? '新建文件夹' : '重命名文件夹'}</strong>
              <button type="button" className="icon-btn" onClick={onClose}>
                关闭
              </button>
            </div>
            <label className="folder-field">
              <span>显示名</span>
              <input
                value={title}
                onChange={(e) => syncPathFromTitle(e.target.value)}
                placeholder="例如：材质研究"
                autoFocus
              />
            </label>
            <label className="folder-field">
              <span>目录名（相对库，一层或两层）</span>
              <input
                value={path}
                onChange={(e) => {
                  setPathTouched(true);
                  setPath(sanitizeFolderPathInput(e.target.value));
                }}
                placeholder="例如：研究/材质 或 材质研究"
              />
            </label>
            <p className="folder-modal-hint">Windows 可用中文路径；不要用 .. 或绝对路径。</p>
            <div className="folder-modal-foot">
              <button type="button" className="btn ghost" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (state.mode === 'create') onCreate(title, path);
                  else onRename(state.path, path, title);
                }}
              >
                {state.mode === 'create' ? '创建' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
