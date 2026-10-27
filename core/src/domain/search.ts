export interface SearchableNote {
  path: string;
  title: string;
  type: string;
  tags: string[];
  project: string;
  body: string;
}

export interface SearchToken {
  kind: 'latin' | 'cjk';
  value: string;
  /** 中文长串拆出的 bigram，用于容忍语序差异 */
  bigrams: string[];
}

const LATIN = /[a-z0-9_#.+-]+/g;
const CJK_RUN = /[\u4e00-\u9fff]+/g;

/**
 * 分词：拉丁词整取；中文按连续串切分（不跨空格/标点）。
 * 长串额外拆 bigram，用于容忍「材质打包」vs「打包后材质」这种语序差异。
 */
export function tokenize(q: string): SearchToken[] {
  const lower = q.toLowerCase();
  const out: SearchToken[] = [];
  const seen = new Set<string>();

  for (const m of lower.match(LATIN) ?? []) {
    const key = `l:${m}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'latin', value: m, bigrams: [] });
  }

  for (const run of lower.match(CJK_RUN) ?? []) {
    const key = `c:${run}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bigrams: string[] = [];
    if (run.length > 2) {
      for (let i = 0; i < run.length - 1; i++) bigrams.push(run.slice(i, i + 2));
    }
    out.push({ kind: 'cjk', value: run, bigrams });
  }

  return out;
}

const SNIPPET_RADIUS = 48;

function makeSnippet(body: string, at: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(body.length, at + SNIPPET_RADIUS);
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < body.length ? '…' : ''}`;
}

interface Haystack {
  title: string;
  tags: string;
  project: string;
  body: string;
}

function firstIndexOf(hay: Haystack, needle: string): number {
  const order: Array<keyof Haystack> = ['title', 'tags', 'project', 'body'];
  for (const field of order) {
    const i = hay[field].indexOf(needle);
    if (i !== -1) return field === 'body' ? i : -1;
  }
  return -1;
}

/**
 * 打分：拉丁 token 必须命中；中文串允许 bigram 命中率 ≥ 60%（长度 ≥ 4 时）。
 * 返回 null 表示不匹配。
 */
export function scoreNote(
  tokens: SearchToken[],
  note: SearchableNote,
): { score: number; snippet: string } | null {
  if (tokens.length === 0) return null;

  const hay: Haystack = {
    title: note.title.toLowerCase(),
    tags: note.tags.join(' ').toLowerCase(),
    project: note.project.toLowerCase(),
    body: note.body.toLowerCase(),
  };

  let score = 0;
  let firstHit = -1;

  for (const t of tokens) {
    const direct = t.value;
    let hit = false;

    if (hay.title.includes(direct)) {
      score += 6;
      hit = true;
    }
    if (hay.tags.includes(direct)) {
      score += 4;
      hit = true;
    }
    if (hay.project.includes(direct)) {
      score += 3;
      hit = true;
    }

    const idx = hay.body.indexOf(direct);
    if (idx !== -1) {
      hit = true;
      score += 2;
      let count = 1;
      let p = hay.body.indexOf(direct, idx + 1);
      while (p !== -1 && count < 3) {
        count++;
        p = hay.body.indexOf(direct, p + 1);
      }
      score += count - 1;
      if (firstHit === -1 || idx < firstHit) firstHit = idx;
    }

    // 语序容忍：长中文串按 bigram 命中率兜底
    if (!hit && t.kind === 'cjk' && t.bigrams.length >= 2) {
      const joined = `${hay.title} ${hay.tags} ${hay.project} ${hay.body}`;
      let matched = 0;
      let earliest = Number.POSITIVE_INFINITY;
      for (const bg of t.bigrams) {
        const i = joined.indexOf(bg);
        if (i !== -1) {
          matched++;
          if (i < earliest) earliest = i;
        }
      }
      if (matched / t.bigrams.length >= 0.6) {
        hit = true;
        score += matched;
        if (firstHit === -1) firstHit = Math.min(earliest, hay.body.length);
      }
    }

    if (!hit) return null;
  }

  const snippet =
    firstHit === -1 || firstHit >= hay.body.length
      ? note.body.slice(0, 120).replace(/\s+/g, ' ').trim()
      : makeSnippet(note.body, firstHit);

  return { score, snippet };
}

export interface NoteFilters {
  type?: string;
  tag?: string;
  project?: string;
}

export function matchesFilters(note: SearchableNote, filters: NoteFilters): boolean {
  if (filters.type && note.type !== filters.type) return false;
  if (filters.tag) {
    const want = filters.tag.toLowerCase();
    if (!note.tags.some((t) => t.toLowerCase() === want)) return false;
  }
  if (filters.project && note.project !== filters.project) return false;
  return true;
}

/** 解析 `type:pitfall tag:材质 关键词` 这种查询串 */
export function parseQueryString(input: string): { text: string; filters: NoteFilters } {
  const filters: NoteFilters = {};
  const words: string[] = [];
  for (const raw of input.split(/\s+/)) {
    if (!raw) continue;
    const m = /^(type|tag|project):(.+)$/i.exec(raw);
    if (m) {
      const key = (m[1] ?? '').toLowerCase() as keyof NoteFilters;
      filters[key] = m[2] ?? '';
    } else {
      words.push(raw);
    }
  }
  return { text: words.join(' '), filters };
}
