import type { BriefResult, SearchHit } from "./deepseek";

export interface CachedBrief {
  at: number;
  context: string;
  brief: BriefResult;
  sources: SearchHit[];
  model: string;
  searched: boolean;
}

const CACHE_PREFIX = "vol-desk-brief-";
const CACHE_TTL_MS = 30 * 60 * 1000;

export function readBriefCache(topic: string, context: string, now = Date.now()): CachedBrief | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + topic);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBrief;
    if (!parsed?.at || !parsed.brief || parsed.context !== context || now - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBriefCache(topic: string, value: CachedBrief): void {
  try {
    localStorage.setItem(CACHE_PREFIX + topic, JSON.stringify(value));
  } catch {
    /* 无痕模式下存不下，仅当前会话有效 */
  }
}
