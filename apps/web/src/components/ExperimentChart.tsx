import { useMemo } from 'react';

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** 从 markdown 正文里抽第一张表 */
export function parseFirstTable(body: string): ParsedTable | null {
  const lines = body.split(/\r?\n/);
  const cells = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  const start = lines.findIndex((l) => l.trim().startsWith('|'));
  if (start === -1) return null;

  const raw: string[][] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim().startsWith('|')) break;
    raw.push(cells(line));
  }
  if (raw.length < 3) return null;

  const headers = raw[0] ?? [];
  const sep = raw[1] ?? [];
  if (!sep.every((c) => /^:?-{2,}:?$/.test(c))) return null;

  return { headers, rows: raw.slice(2) };
}

function isNumericColumn(rows: string[][], col: number): boolean {
  const values = rows.map((r) => r[col]).filter((v): v is string => !!v && v !== '');
  if (values.length === 0) return false;
  return values.every((v) => Number.isFinite(Number(v)));
}

export interface ExperimentChartProps {
  body: string;
}

const COLORS = ['#5a6270', '#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68'];

const TABLE_HINT = `| 版本 | 设备 | 帧时间(ms) | DrawCall | 显存(MB) |
| --- | --- | --- | --- | --- |
| before |  |  |  |  |
| after |  |  |  |  |`;

export function ExperimentChart({ body }: ExperimentChartProps): React.ReactElement | null {
  const table = useMemo(() => parseFirstTable(body), [body]);

  const model = useMemo(() => {
    if (!table) return null;
    const numeric: number[] = [];
    for (let c = 1; c < table.headers.length; c++) {
      if (isNumericColumn(table.rows, c)) numeric.push(c);
    }
    if (numeric.length === 0) return null;

    const groups = table.rows.map((row, i) => ({
      label: row[0] || `#${i + 1}`,
      color: COLORS[i % COLORS.length] ?? '#7aa2f7',
      values: numeric.map((c) => Number(row[c] ?? 0)),
    }));

    const max = Math.max(1, ...groups.flatMap((g) => g.values));
    return {
      metrics: numeric.map((c) => table.headers[c] ?? `列${c}`),
      groups,
      max,
    };
  }, [table]);

  if (!model) {
    return (
      <div className="exp exp-empty">
        <div className="exp-head">
          <span className="exp-title">对比图</span>
          <span className="exp-sub">还没有可画的表</span>
        </div>
        <div className="exp-hint">
          在正文里写一张 Markdown 表（第一列是组别，后面列填数字）。新建实验时默认带模板；也可直接粘贴：
          <pre className="exp-hint-pre">{TABLE_HINT}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="exp">
      <div className="exp-head">
        <span className="exp-title">对比</span>
        <span className="exp-sub">{table?.rows.length ?? 0} 组数据</span>
        <div className="exp-legend">
          {model.groups.map((g) => (
            <span key={g.label} className="exp-legend-item">
              <i style={{ background: g.color }} />
              {g.label}
            </span>
          ))}
        </div>
      </div>

      <div className="exp-chart">
        {model.metrics.map((metric, mi) => (
          <div className="exp-group" key={metric}>
            <div className="exp-bars">
              {model.groups.map((g) => {
                const v = g.values[mi] ?? 0;
                // 每个指标单独归一：帧时间与 DrawCall 量级差太大，用同一个分母会把小值压没
                const colMax = Math.max(1, ...model.groups.map((x) => x.values[mi] ?? 0));
                const h = Math.max(3, (v / colMax) * 100);
                return (
                  <div className="exp-bar-wrap" key={g.label} title={`${g.label} · ${metric} = ${v}`}>
                    <span className="exp-val">{v}</span>
                    <div className="exp-bar" style={{ height: `${h}%`, background: g.color }} />
                  </div>
                );
              })}
            </div>
            <div className="exp-metric">{metric}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
