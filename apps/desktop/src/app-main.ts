import { app, BrowserWindow, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen } from 'electron';
import path from 'node:path';
import { CoreHost } from '../../../core/src/host';

const IPC_INVOKE = 'flyleaf:invoke';
const IPC_EVENT = 'flyleaf:event';

const RENDERER = path.join(__dirname, 'renderer');
const PRELOAD = path.join(__dirname, 'preload.cjs');

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

let mainWin: BrowserWindow | null = null;
let cardWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let host: CoreHost | null = null;

function defaultVault(): string {
  return process.env.FLYLEAF_VAULT ?? process.env.YAN_VAULT ?? path.join(app.getPath('documents'), 'flyleaf-vault');
}

function clampToScreen(b: Bounds): Bounds {
  const rect = { x: b.x, y: b.y, width: b.w, height: b.h };
  const area = screen.getDisplayMatching(rect).workArea;
  const w = Math.min(Math.max(240, b.w), area.width);
  const h = Math.min(Math.max(140, b.h), area.height);
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - w);
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - h);
  return { x, y, w, h };
}

async function loadCardBounds(): Promise<Bounds> {
  try {
    const cfg = await host!.current.configRepo.load();
    return clampToScreen(cfg.card.bounds);
  } catch {
    return { x: 160, y: 160, w: 340, h: 200 };
  }
}

async function saveCardBounds(b: Bounds): Promise<void> {
  try {
    const repo = host!.current.configRepo;
    const cfg = await repo.load();
    cfg.card.bounds = b;
    await repo.save(cfg);
  } catch {
    // 配置写失败不影响使用
  }
}

function toggleCard(): void {
  if (!cardWin) return;
  if (cardWin.isVisible()) {
    cardWin.hide();
    return;
  }
  void loadCardBounds().then((b) => {
    if (!cardWin) return;
    cardWin.setBounds({ x: b.x, y: b.y, width: b.w, height: b.h });
    cardWin.show();
    cardWin.focus();
    cardWin.webContents.send(IPC_EVENT, { type: 'card:shown' });
  });
}

function createCardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void win.loadFile(path.join(RENDERER, 'card.html'));

  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });

  const persist = (): void => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    void saveCardBounds({ x: b.x, y: b.y, w: b.width, h: b.height });
  };
  win.on('moved', persist);
  win.on('resized', persist);

  return win;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0e1013',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void win.loadFile(path.join(RENDERER, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWin = null;
  });
  return win;
}

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  if (!host) throw new Error('核心未初始化');
  const c = host.client;
  switch (method) {
    case 'vault.open':
      return host.open(String(args[0] ?? ''));
    case 'vault.info':
      return c.vault.info();
    case 'vault.tree':
      return c.vault.tree();
    case 'vault.recent':
      return c.vault.recent(args[0] as number | undefined);
    case 'vault.listFolders':
      return c.vault.listFolders();
    case 'vault.createFolder':
      return c.vault.createFolder(args[0] as Parameters<typeof c.vault.createFolder>[0]);
    case 'vault.renameFolder':
      return c.vault.renameFolder(args[0] as Parameters<typeof c.vault.renameFolder>[0]);
    case 'vault.deleteFolder':
      return c.vault.deleteFolder(args[0] as Parameters<typeof c.vault.deleteFolder>[0]);
    case 'vault.setInbox':
      return c.vault.setInbox(String(args[0]));
    case 'notes.read':
      return c.notes.read(String(args[0]));
    case 'notes.write':
      return c.notes.write(
        String(args[0]),
        String(args[1] ?? ''),
        args[2] as Record<string, unknown> | undefined,
        args[3] as number | undefined,
      );
    case 'notes.create':
      return c.notes.create(args[0] as Parameters<typeof c.notes.create>[0]);
    case 'notes.rename':
      return c.notes.rename(String(args[0]), String(args[1]));
    case 'notes.delete':
      return c.notes.delete(args[0] as Parameters<typeof c.notes.delete>[0]);
    case 'notes.clearTrash':
      return c.notes.clearTrash();
    case 'notes.listTrash':
      return c.notes.listTrash(args[0] as number | undefined);
    case 'notes.restore':
      return c.notes.restore(args[0] as Parameters<typeof c.notes.restore>[0]);
    case 'notes.backlinks':
      return c.notes.backlinks(String(args[0]));
    case 'search.query':
      return c.search.query(args[0] as Parameters<typeof c.search.query>[0]);
    case 'framework.tree':
      return c.framework.tree(String(args[0]));
    case 'framework.setState':
      return c.framework.setState(String(args[0]), Number(args[1]), args[2] as 'todo' | 'learning' | 'known' | 'used');
    case 'framework.expandNode':
      return c.framework.expandNode(String(args[0]), Number(args[1]));
    case 'capture.getDraft':
      return c.capture.getDraft();
    case 'capture.saveDraft':
      return c.capture.saveDraft(String(args[0] ?? ''));
    case 'capture.archive':
      return c.capture.archive(String(args[0] ?? ''));
    case 'assets.saveImage':
      return c.assets.saveImage(String(args[0]));
    default:
      throw new Error(`未知方法：${method}`);
  }
}

async function bootstrap(): Promise<void> {
  const root = defaultVault();
  host = new CoreHost();
  try {
    await host.open(root);
  } catch (e) {
    dialog.showErrorBox('无法打开 vault', `${root}\n${String(e)}`);
    app.quit();
    return;
  }

  host.client.events.subscribe((e) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC_EVENT, e);
    }
  });

  ipcMain.handle(IPC_INVOKE, async (_evt, payload: unknown) => {
    const p = payload as { method?: string; args?: unknown[] };
    if (!p?.method) throw new Error('缺少 method');
    return dispatch(p.method, p.args ?? []);
  });

  ipcMain.on('card:hide', () => cardWin?.hide());

  mainWin = createMainWindow();
  cardWin = createCardWindow();

  try {
    globalShortcut.register('CommandOrControl+Alt+Space', toggleCard);
  } catch {
    // 热键被占用时忽略
  }

  try {
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOElEQVR42u3NMQEAAAgDoC251a3gLwSgcyfTVFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVfVvHzhRBAFkf1sAAAAASUVORK5CYII=',
    );
    tray = new Tray(icon);
    tray.setToolTip('Flyleaf');
    tray.on('click', toggleCard);
    tray.on('double-click', () => {
      if (!mainWin) mainWin = createMainWindow();
      mainWin.show();
      mainWin.focus();
    });
  } catch {
    tray = null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWin) return;
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  });

  void app.whenReady().then(bootstrap);

  // 托盘常驻：窗口全关也不退出
  app.on('window-all-closed', () => {
    // 保留托盘与热键
  });

  app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    void host?.close();
  });
}
