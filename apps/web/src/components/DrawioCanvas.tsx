import { useEffect, useRef, useState } from 'react';
import type { DrawioBoot, DrawioLabel, FrameworkCanvasDoc, FrameworkCanvasLoadResult } from '@flyleaf/core/contracts';
import { bootDrawioFromCanvas, isDrawioXml } from '@flyleaf/core/contracts';
import {
  buildDrawioEmbedUrl,
  drawioOriginAllowed,
  readDrawioMessage,
  resolveDrawioIndex,
} from './drawioEmbed';

export interface DrawioCanvasProps {
  /** bound：框架 md 路径。scratch：.flycanvas.json 路径 */
  canvasPath: string;
  mode: 'bound' | 'scratch';
  theme: 'light' | 'dark';
  pageName?: string;
  title?: string;
  /** 仅用于把旧节点文件迁进 draw.io。打开后不再跟大纲对齐。 */
  labels?: DrawioLabel[];
  loadCanvas: (path: string) => Promise<FrameworkCanvasLoadResult>;
  saveCanvas: (path: string, doc: FrameworkCanvasDoc) => Promise<FrameworkCanvasDoc>;
  onTitleChange?: (title: string) => void;
}

const SAVE_MS = 400;
const LINK_MS = 15_000;

const EMPTY_BOOT: DrawioBoot = { xml: '', notice: '', kind: 'empty' };

/**
 * 整页 diagrams.net。图经 postMessage 进出，防抖写进笔记库，不走浏览器另存为。
 * 外壳不拦截滚轮：滚轮留在 iframe 里。宿主整页缩放在 Host.cs 保持关闭。
 */
export function DrawioCanvas({
  canvasPath,
  mode,
  theme,
  pageName,
  title = '',
  labels,
  loadCanvas,
  saveCanvas,
  onTitleChange,
}: DrawioCanvasProps): React.ReactElement {
  const [phase, setPhase] = useState<'loading' | 'editor'>('loading');
  const [indexUrl, setIndexUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [linkNote, setLinkNote] = useState('');
  const [hint, setHint] = useState('');

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const labelsRef = useRef(labels);
  const pageNameRef = useRef(pageName);
  const titleRef = useRef(title);
  const loadRef = useRef(loadCanvas);
  const saveRef = useRef(saveCanvas);
  const onTitleRef = useRef(onTitleChange);
  const pathRef = useRef(canvasPath);
  const modeRef = useRef(mode);
  const xmlRef = useRef('');
  const legacyRef = useRef<FrameworkCanvasDoc['legacy']>(undefined);
  const bootRef = useRef<DrawioBoot>(EMPTY_BOOT);
  const echoRef = useRef<string | null>(null);
  const autosaveCount = useRef(0);
  const armedRef = useRef(false);
  const lastSig = useRef('');
  const titleAtBoot = useRef(title);
  const timerRef = useRef(0);
  const mountedRef = useRef(true);
  const localRef = useRef(false);
  const migratedSaved = useRef(false);
  const persistRef = useRef<() => Promise<void>>(async () => {});
  const scheduleRef = useRef<(immediate?: boolean) => void>(() => {});

  labelsRef.current = labels;
  pageNameRef.current = pageName;
  titleRef.current = title;
  loadRef.current = loadCanvas;
  saveRef.current = saveCanvas;
  onTitleRef.current = onTitleChange;
  pathRef.current = canvasPath;
  modeRef.current = mode;

  const post = (msg: unknown): void => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(JSON.stringify(msg), '*');
  };

  persistRef.current = async (): Promise<void> => {
    const xml = xmlRef.current;
    if (!isDrawioXml(xml)) return;
    const nextTitle = (titleRef.current || '').trim();
    const sig = `${modeRef.current}\n${nextTitle}\n${xml}`;
    if (sig === lastSig.current) return;
    const doc: FrameworkCanvasDoc = {
      version: 2,
      mode: modeRef.current,
      frameworkPath: modeRef.current === 'bound' ? pathRef.current : '',
      ...(modeRef.current === 'scratch' || nextTitle ? { title: nextTitle || '梳理画布' } : {}),
      viewport: { k: 1, tx: 0, ty: 0 },
      nodes: [],
      edges: [],
      xml,
      ...(legacyRef.current ? { legacy: legacyRef.current } : {}),
    };
    if (mountedRef.current) setHint('保存中…');
    try {
      await saveRef.current(pathRef.current, doc);
      lastSig.current = sig;
      if (mountedRef.current) setHint('已存到笔记库');
      post({ action: 'status', message: '已存到笔记库', modified: false });
    } catch (e) {
      if (mountedRef.current) setHint(`没保存成：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  scheduleRef.current = (immediate = false): void => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    if (immediate) {
      void persistRef.current();
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      void persistRef.current();
    }, SAVE_MS);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    setPhase('loading');
    setNotice('');
    setLinkNote('');
    setHint('');
    echoRef.current = null;
    autosaveCount.current = 0;
    armedRef.current = false;
    migratedSaved.current = false;
    lastSig.current = '';
    const titleWhenStarted = titleRef.current;
    void (async () => {
      let loaded: FrameworkCanvasLoadResult;
      try {
        const [index, result] = await Promise.all([resolveDrawioIndex(), loadRef.current(canvasPath)]);
        if (cancel) return;
        loaded = result;
        localRef.current = index.startsWith('/');
        setIndexUrl(index);
      } catch {
        if (cancel) return;
        loaded = { degraded: true, doc: null, reason: 'read-error' };
        localRef.current = false;
        setIndexUrl('https://embed.diagrams.net/');
      }
      const boot = bootDrawioFromCanvas(loaded, {
        labels: labelsRef.current,
        pageName: pageNameRef.current || titleRef.current || '画布',
      });
      bootRef.current = boot;
      xmlRef.current = boot.xml;
      legacyRef.current = boot.legacy;
      const fileTitle = loaded.doc?.title;
      if (fileTitle && fileTitle !== titleRef.current) {
        onTitleRef.current?.(fileTitle);
        titleAtBoot.current = fileTitle;
      } else {
        titleAtBoot.current = titleRef.current;
      }
      if (!cancel) {
        setNotice(boot.notice);
        setPhase('editor');
        if (titleRef.current !== titleWhenStarted) scheduleRef.current(false);
      }
    })();
    return () => {
      cancel = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = 0;
        void persistRef.current();
      }
    };
  }, [canvasPath]);

  useEffect(() => {
    if (phase !== 'editor' || mode !== 'scratch') return;
    if (title === titleAtBoot.current) return;
    titleAtBoot.current = title;
    scheduleRef.current(false);
  }, [title, phase, mode]);

  const src = indexUrl ? buildDrawioEmbedUrl(indexUrl, theme === 'dark') : null;

  useEffect(() => {
    if (!src || !indexUrl) return;
    echoRef.current = null;
    autosaveCount.current = 0;
    const originPage = window.location.origin;
    let linked = false;
    const wait = window.setTimeout(() => {
      if (linked) return;
      setLinkNote(
        localRef.current
          ? '本机 draw.io 页面没有在 15 秒内就绪。'
          : '编辑器还没有连上 diagrams.net。打开画布需要联网。笔记库里的图还在。安装目录若放了 renderer/drawio，断网也可以开。',
      );
    }, LINK_MS);

    const onMsg = (ev: MessageEvent): void => {
      if (!drawioOriginAllowed(ev.origin, indexUrl, originPage)) return;
      const msg = readDrawioMessage(ev.data);
      if (!msg) return;
      const event = typeof msg.event === 'string' ? msg.event : '';
      const xml = typeof msg.xml === 'string' ? msg.xml : '';
      if (event === 'configure') {
        post({ action: 'configure', config: {} });
        return;
      }
      if (event === 'init') {
        linked = true;
        window.clearTimeout(wait);
        setLinkNote('');
        post({ action: 'load', xml: xmlRef.current, autosave: 1 });
        if (bootRef.current.kind === 'migrated' && !migratedSaved.current) {
          migratedSaved.current = true;
          scheduleRef.current(true);
        }
        return;
      }
      if ((event === 'autosave' || event === 'save') && xml) {
        xmlRef.current = xml;
        if (event === 'save') {
          armedRef.current = true;
          void persistRef.current();
          return;
        }
        autosaveCount.current += 1;
        if (echoRef.current === null) {
          echoRef.current = xml;
          return;
        }
        const degraded = bootRef.current.kind === 'degraded';
        if (!armedRef.current) return;
        if (degraded && autosaveCount.current < 2) return;
        scheduleRef.current(false);
      }
    };

    window.addEventListener('message', onMsg);
    return () => {
      window.clearTimeout(wait);
      window.removeEventListener('message', onMsg);
    };
  }, [src, indexUrl]);

  useEffect(() => {
    const arm = (): void => {
      if (armedRef.current) return;
      const ae = document.activeElement;
      if (!ae || ae.tagName !== 'IFRAME' || !ae.classList.contains('drawio-frame')) return;
      armedRef.current = true;
      if (bootRef.current.kind === 'degraded') return;
      const snap = xmlRef.current;
      window.setTimeout(() => {
        if (xmlRef.current !== snap) scheduleRef.current(false);
      }, 800);
    };
    window.addEventListener('blur', arm);
    return () => window.removeEventListener('blur', arm);
  }, []);

  const banner = linkNote || notice;

  return (
    <div className="drawio-host">
      {banner ? (
        <div className="drawio-note" role="status">
          <span>{banner}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setLinkNote('');
              setNotice('');
            }}
          >
            知道了
          </button>
        </div>
      ) : null}
      {phase === 'loading' || !src ? (
        <div className="drawio-wait">正在打开画布…</div>
      ) : (
        <iframe
          key={canvasPath}
          ref={frameRef}
          className="drawio-frame"
          title={mode === 'scratch' ? '梳理画布' : '框架画布'}
          src={src}
        />
      )}
      <div className="drawio-hint">{hint}</div>
    </div>
  );
}
