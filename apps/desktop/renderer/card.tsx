import '@flyleaf/ui/tokens.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createIpcClient, type IpcBridge } from '@flyleaf/core/client';
import './card.css';

const THEME_KEY = 'flyleaf-theme';

function applyStoredTheme(): void {
  let theme = 'light';
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') theme = v;
    else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) theme = 'dark';
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', theme);
}

applyStoredTheme();


interface FlyleafBridge extends IpcBridge {
  invokeChannel: string;
  eventChannel: string;
}

const bridge = (window as unknown as { flyleaf: FlyleafBridge }).flyleaf;
const client = createIpcClient(bridge);

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Card(): React.ReactElement {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('草稿随输随存');
  const timer = useRef<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftChain = useRef<Promise<void>>(Promise.resolve());

  const enqueueDraft = (value: string): Promise<void> => {
    const job = draftChain.current.catch(() => undefined).then(() => client.capture.saveDraft(value));
    draftChain.current = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };

  useEffect(() => {
    void client.capture
      .getDraft()
      .then((d) => {
        if (d.text) {
          setText(d.text);
          setStatus('已恢复上次草稿');
        }
      })
      .catch(() => setStatus('未连接核心'));
    areaRef.current?.focus();
  }, []);

  const onChange = (value: string): void => {
    setText(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void enqueueDraft(value)
        .then(() => setStatus(`已保存 ${nowTime()}`))
        .catch(() => setStatus('草稿保存失败'));
    }, 300);
  };

  const archive = async (): Promise<void> => {
    if (!text.trim()) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    try {
      await draftChain.current;
      const r = await client.capture.archive(text);
      setText('');
      setStatus(`已归档 → ${r.file} 第 ${r.line} 行`);
      areaRef.current?.focus();
    } catch (e) {
      setStatus(`归档失败：${String(e)}`);
    }
  };

  const openScratch = async (): Promise<void> => {
    try {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      await enqueueDraft(text);
      setStatus('正在打开梳理画布…');
      await client.framework.createScratch();
      setStatus('已在主窗口打开梳理画布');
    } catch (e) {
      setStatus(`打开失败：${String(e)}`);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-dot" />
        <span className="card-title">随记</span>
        <button
          className="card-close"
          title="隐藏（Esc）"
          onClick={() => {
            if (timer.current) window.clearTimeout(timer.current);
            void enqueueDraft(text).finally(() => window.close());
          }}
        >
          ×
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="card-area"
        value={text}
        placeholder="随手记一句…  Ctrl+Enter 归档"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void archive();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            if (timer.current) window.clearTimeout(timer.current);
            void enqueueDraft(text).finally(() => window.close());
          }
        }}
      />
      <div className="card-foot">
        <span className="card-status">{status}</span>
        <button className="card-btn" type="button" title="打开梳理画布（draw.io，不写笔记）" onClick={() => void openScratch()}>
          开梳理画布
        </button>
        <button className="card-btn" onClick={() => void archive()}>
          归档
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');
createRoot(root).render(<Card />);
