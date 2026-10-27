import { useEffect, useMemo, useRef, useState } from 'react';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export interface PaletteProps {
  placeholder: string;
  items?: PaletteItem[];
  /** 提供异步搜索时，走搜索模式 */
  search?: (q: string) => Promise<PaletteItem[]>;
  onClose: () => void;
}

export function Palette({ placeholder, items, search, onClose }: PaletteProps): React.ReactElement {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [asyncItems, setAsyncItems] = useState<PaletteItem[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!search) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void search(q).then((list) => {
        setAsyncItems(list);
        setIdx(0);
      });
    }, 160);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [q, search]);

  const list = useMemo(() => {
    if (search) return asyncItems;
    const base = items ?? [];
    const key = q.trim().toLowerCase();
    if (!key) return base;
    return base.filter((i) => i.label.toLowerCase().includes(key) || (i.hint ?? '').toLowerCase().includes(key));
  }, [items, asyncItems, q, search]);

  const run = (item: PaletteItem | undefined): void => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          autoFocus
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(list.length - 1, i + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            }
            if (e.key === 'Enter') run(list[idx]);
          }}
        />
        <div className="palette-list">
          {list.length === 0 && <div className="palette-empty">没有结果</div>}
          {list.map((item, i) => (
            <div
              key={item.id}
              className={`palette-row ${i === idx ? 'on' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(item)}
            >
              <span>{item.label}</span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
