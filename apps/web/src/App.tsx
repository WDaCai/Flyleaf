import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Backlink,
  FileNode,
  FrameworkTree,
  Mastery,
  NavTarget,
  NoteDoc,
  NoteType,
  VaultInfo,
  YanClient,
} from '@yan/core/contracts';
import { Editor } from './components/Editor';
import { Framework } from './components/Framework';
import { Palette, type PaletteItem } from './components/Palette';
import { renderMarkdown, WIKI_PREFIX } from './markdown';

interface Tab {
  path: string;
  title: string;
}

const NEW_TYPES: Array<{ type: NoteType; label: string }> = [
  { type: 'pitfall', label: '踩坑' },
  { type: 'experiment', label: '实验' },
  { type: 'knowledge', label: '知识' },
  { type: 'weekly', label: '周报' },
  { type: 'framework', label: '知识框架' },
  { type: 'note', label: '随手记' },
];

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

function titleOf(doc: NoteDoc): string {
  const t = doc.frontmatter.title;
  return typeof t === 'string' && t.trim() ? t.trim() : withoutExt(doc.path);
}

export function App({ client }: { client: YanClient }): React.ReactElement {
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
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [status, setStatus] = useState('就绪');
  const [palette, setPalette] = useState<'command' | 'search' | null>(null);

  const docRef = useRef<NoteDoc | null>(null);
  const bodyRef = useRef('');
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      setTree(await client.vault.tree());
    } catch {
      setTree([]);
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
      await openPath(target.path);
      if (target.kind === 'line') setHighlightLine(target.line);
    },
    [openPath],
  );

  const createNote = useCallback(
    async (type: NoteType): Promise<void> => {
      const label = NEW_TYPES.find((t) => t.type === type)?.label ?? '笔记';
      const title = window.prompt(`新建${label} · 标题`, `${label} ${new Date().toLocaleDateString('zh-CN')}`);
      if (!title) return;
      const created = await client.notes.create({ type, title });
      await refreshTree();
      await openPath(created.path);
      setStatus(`已新建 ${created.path}`);
    },
    [client, openPath, refreshTree],
  );

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

  // 初始化
  useEffect(() => {
    void (async () => {
      try {
        const info = await client.vault.info();
        setVault(info);
        await refreshTree();
      } catch {
        setNeedVault(true);
      }
    })();
  }, [client, refreshTree]);

  // 事件订阅
  useEffect(
    () =>
      client.events.subscribe((e) => {
        if (e.type === 'vault:changed') void refreshTree();
        if (e.type === 'capture:saved') setStatus('随记已归档');
      }),
    [client, refreshTree],
  );

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'p' && !e.shiftKey) {
        e.preventDefault();
        setPalette('command');
      } else if (e.key.toLowerCase() === 'p' && e.shiftKey) {
        e.preventDefault();
        setPalette('search');
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openVault = async (): Promise<void> => {
    if (!vaultInput.trim()) return;
    const info = await client.vault.open(vaultInput.trim());
    setVault(info);
    setNeedVault(false);
    await refreshTree();
  };

  const commandItems = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = NEW_TYPES.map((t) => ({
      id: `new-${t.type}`,
      label: `新建${t.label}`,
      hint: '命令',
      run: () => void createNote(t.type),
    }));
    const files: PaletteItem[] = [];
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.kind === 'file') files.push({ id: n.path, label: withoutExt(n.name), hint: n.path, run: () => void openPath(n.path) });
        else if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return [...actions, ...files];
  }, [createNote, openPath, tree]);

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
          <h1>砚 · Yan</h1>
          <p>输入一个文件夹路径作为 vault（不存在会自动创建）</p>
          <input className="input" value={vaultInput} onChange={(e) => setVaultInput(e.target.value)} placeholder="C:\\Users\\你\\Documents\\yan-vault" />
          <button className="btn primary" onClick={() => void openVault()}>
            打开
          </button>
        </div>
      </div>
    );
  }

  const isFramework = framework !== null && doc !== null && String(doc.frontmatter.type) === 'framework';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">砚</span>
          <span className="vault-name">{vault?.name ?? '—'}</span>
          <button className="icon-btn" title="刷新" onClick={() => void refreshTree()}>
            ↻
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="btn ghost" onClick={() => setPalette('command')}>
            <span>＋ 新建</span>
            <kbd>Ctrl P</kbd>
          </button>
          <button className="btn ghost" onClick={() => setPalette('search')}>
            <span>⌕ 搜索</span>
            <kbd>Ctrl ⇧ P</kbd>
          </button>
        </div>

        <div className="tree">
          <TreeView nodes={tree} activePath={active} onOpen={(p) => void openPath(p)} />
        </div>

        <div className="sidebar-foot">
          <span>{vault?.noteCount ?? 0} 篇</span>
          <span className="dot" />
          <span>{status}</span>
        </div>
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
          {doc && (
            <button className="btn ghost" onClick={() => { setMode((m) => (m === 'edit' ? 'preview' : 'edit')); setBody(bodyRef.current); }}>
              {mode === 'edit' ? '预览' : '编辑'} <kbd>Ctrl E</kbd>
            </button>
          )}
        </div>

        <div className="content">
          {!doc && (
            <div className="empty">
              <div>从左侧选一篇，或按 Ctrl+P 新建</div>
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
              collapsed={collapsed}
              onToggle={toggleCollapse}
              highlightLine={highlightLine}
            />
          )}

          {doc && !isFramework && mode === 'edit' && (
            <Editor docKey={doc.path} value={bodyRef.current} onChange={onBodyChange} />
          )}

          {doc && !isFramework && mode === 'preview' && (
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
          )}
        </div>
      </main>

      {doc && !isFramework && (
        <aside className="right">
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
          <div className="right-foot">
            {doc.path}
            <br />
            {String(doc.frontmatter.type ?? 'note')}
          </div>
        </aside>
      )}

      {palette === 'command' && (
        <Palette placeholder="搜索文件或执行命令…" items={commandItems} onClose={() => setPalette(null)} />
      )}
      {palette === 'search' && (
        <Palette placeholder="全文搜索（中文可直接搜）…" search={searchFn} onClose={() => setPalette(null)} />
      )}
    </div>
  );
}

function TreeView({
  nodes,
  activePath,
  onOpen,
}: {
  nodes: FileNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (p: string): void => {
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
        const expanded = open.has(n.path) || depth === 0;
        return (
          <div key={n.path}>
            <div className="tree-row dir" style={{ paddingLeft: depth * 12 + 6 }} onClick={() => toggle(n.path)}>
              <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
              <span className="tree-name">{n.name}</span>
            </div>
            {expanded && n.children && render(n.children, depth + 1)}
          </div>
        );
      }
      return (
        <div
          key={n.path}
          className={`tree-row file ${activePath === n.path ? 'on' : ''}`}
          style={{ paddingLeft: depth * 12 + 20 }}
          onClick={() => onOpen(n.path)}
          title={n.path}
        >
          <span className="tree-name">{withoutExt(n.name)}</span>
        </div>
      );
    });

  return <>{render(nodes, 0)}</>;
}
