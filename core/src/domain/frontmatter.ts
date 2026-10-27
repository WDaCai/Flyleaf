import { parseDocument, stringify } from 'yaml';

/** 解析 frontmatter：保持字段顺序，未知字段原样保留，解析失败不抛错 */
export function parseFrontmatter(raw: string | null): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const doc = parseDocument(raw);
    const js = doc.toJS() as unknown;
    if (js && typeof js === 'object' && !Array.isArray(js)) {
      return js as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** 序列化 frontmatter（不含分隔线） */
export function serializeFrontmatter(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return '';
  try {
    return stringify(data, { lineWidth: 0 }).replace(/\n$/, '');
  } catch {
    return '';
  }
}

export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** ISO 时间串，兼容 YAML 解析出的 Date 对象 */
export function asIsoString(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'string') return v;
  return '';
}
