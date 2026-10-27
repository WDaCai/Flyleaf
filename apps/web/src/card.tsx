import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createHttpClient } from '@flyleaf/core/client';
import '@flyleaf/ui/tokens.css';
import './card.css';

const THEME_KEY = 'flyleaf-theme';

function applyStoredTheme(): void {
  let theme = 'dark';
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') theme = v;
    else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) theme = 'light';
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', theme);
}

applyStoredTheme();


const client = createHttpClient();

interface WebViewHost {
  postMessage(message: string): void;
}

function hostBridge(): WebViewHost | null {
  const chrome = (window as unknown as { chrome?: { webview?: WebViewHost } }).chrome;
  return chrome?.webview ?? null;
}

function postHost(message: 'drag' | 'resize'): void {
  hostBridge()?.postMessage(message);
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Card(): React.ReactElement {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('草稿随输随存');
  const timer = useRef<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

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
      void client.capture.saveDraft(value).then(() => setStatus(`已保存 ${nowTime()}`));
    }, 300);
  };

  const archive = async (): Promise<void> => {
    if (!text.trim()) return;
    try {
      const r = await client.capture.archive(text);
      setText('');
      setStatus(`已归档 → ${r.file} 第 ${r.line} 行`);
      areaRef.current?.focus();
    } catch (e) {
      setStatus(`归档失败：${String(e)}`);
    }
  };

  const hide = (): void => {
    void client.capture.saveDraft(text).finally(() => window.close());
  };

  return (
    <div className="card">
      <div
        className="card-head"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          postHost('drag');
        }}
      >
        <span className="card-dot" />
        <span className="card-title">随记</span>
        <button className="card-close" title="隐藏（Esc）" onClick={hide}>
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
            hide();
          }
        }}
      />
      <div className="card-foot">
        <span className="card-status">{status}</span>
        <button className="card-btn" onClick={() => void archive()}>
          归档
        </button>
      </div>
      <div className="card-resize" onMouseDown={() => postHost('resize')} />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root 不存在');
createRoot(root).render(<Card />);
