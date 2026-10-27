import { DEFAULT_CONFIG, type AppConfig, type CardBounds } from '../contracts';

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function normalizeBounds(input: unknown): CardBounds {
  const d = DEFAULT_CONFIG.card.bounds;
  if (!input || typeof input !== 'object') return { ...d };
  const o = input as Record<string, unknown>;
  return {
    x: num(o.x, d.x),
    y: num(o.y, d.y),
    w: Math.max(220, num(o.w, d.w)),
    h: Math.max(120, num(o.h, d.h)),
  };
}

/** 宽容地合并配置：缺字段补默认值，类型不对就回落，绝不抛错 */
export function normalizeConfig(input: unknown): AppConfig {
  const base = DEFAULT_CONFIG;
  if (!input || typeof input !== 'object') return structuredClone(base);
  const o = input as Record<string, unknown>;
  const defaults = (o.defaults ?? {}) as Record<string, unknown>;
  const card = (o.card ?? {}) as Record<string, unknown>;
  const tabs = (o.tabs ?? {}) as Record<string, unknown>;

  return {
    vaultPath: typeof o.vaultPath === 'string' ? o.vaultPath : null,
    defaults: {
      project: str(defaults.project, base.defaults.project),
      engine: str(defaults.engine, base.defaults.engine),
      platform: str(defaults.platform, base.defaults.platform),
    },
    card: {
      bounds: normalizeBounds(card.bounds),
      opacity: Math.min(1, Math.max(0.3, num(card.opacity, base.card.opacity))),
      hotkey: str(card.hotkey, base.card.hotkey),
      pinned: bool(card.pinned, base.card.pinned),
    },
    tabs: {
      max: Math.max(1, Math.min(20, num(tabs.max, base.tabs.max))),
    },
  };
}
