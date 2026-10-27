import type { SearchHit, SearchQuery } from '../contracts';
import { matchesFilters, scoreNote, tokenize } from '../domain/search';
import type { IndexProvider, IndexEntry } from '../ports';

export class SearchService {
  constructor(private readonly index: IndexProvider) {}

  async query(q: SearchQuery): Promise<SearchHit[]> {
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const text = (q.text ?? '').trim();
    const tokens = tokenize(text);

    const candidates: IndexEntry[] = [];
    for (const e of this.index.all()) {
      if (
        !matchesFilters(
          { path: e.path, title: e.title, type: e.type, tags: e.tags, project: e.project, body: e.body },
          { type: q.type, tag: q.tag, project: q.project },
        )
      ) {
        continue;
      }
      if (q.nodes && !e.nodes.some((n) => n.toLowerCase() === q.nodes!.toLowerCase())) continue;
      candidates.push(e);
    }

    if (tokens.length === 0) {
      return candidates
        .slice()
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, limit)
        .map((e) => ({
          path: e.path,
          title: e.title,
          type: e.type,
          snippet: e.body.replace(/\s+/g, ' ').trim().slice(0, 110),
          score: 0,
        }));
    }

    const hits: SearchHit[] = [];
    for (const e of candidates) {
      const scored = scoreNote(tokens, {
        path: e.path,
        title: e.title,
        type: e.type,
        tags: e.tags,
        project: e.project,
        body: e.body,
      });
      if (!scored) continue;
      hits.push({ path: e.path, title: e.title, type: e.type, snippet: scored.snippet, score: scored.score });
    }

    return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-Hans-CN')).slice(0, limit);
  }
}
