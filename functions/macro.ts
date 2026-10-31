// 跨资产分析：黄金 / 原油 / 美债（GLD / USO / TLT）+ 10 年期美债收益率（FRED DGS10）。
// 快照为真实日线，运行时用同一公开上游增量刷新；失败时保留快照并显式标注降级。
import type { Row } from "./analytics.ts";
import { macroSnapshot } from "./data/macroSnapshot.ts";

export type MacroAssetKey = "gold" | "oil" | "bond";
export type MacroCorrKey = MacroAssetKey | "ust10y";
export type MacroRiskLevel = "low" | "medium" | "high";
export type MacroRegimeKey = "tightening" | "reflation" | "riskoff" | "easing" | "divergent";

interface SnapshotAsset {
  key: MacroAssetKey;
  symbol: string;
  label: string;
  name: string;
  unit: string;
  note: string;
  rows: readonly (readonly [string, number])[];
}

interface SnapshotShape {
  generatedAt: string;
  source: string;
  window: { from: string; to: string };
  assets: Record<MacroAssetKey, SnapshotAsset>;
  ust10y: {
    key: string;
    label: string;
    unit: string;
    note: string;
    rows: readonly (readonly [string, number])[];
  };
  sources: { id: string; label: string; url: string; fetchedAt: string; rows: unknown }[];
}

const SNAP = macroSnapshot as unknown as SnapshotShape;
export const MACRO_ASSET_ORDER: MacroAssetKey[] = ["gold", "oil", "bond"];
export const MACRO_YEARS_ALLOWED = [1, 2, 3, 5, 10];
const TRADING_DAYS = 252;

export interface MacroSourceStatus {
  id: string;
  label: string;
  kind: "price" | "yield";
  mode: "live" | "snapshot";
  ok: boolean;
  note: string;
  rows?: number;
}

interface MacroBase {
  assets: Record<MacroAssetKey, Row[]>;
  yieldRows: Row[];
  statuses: MacroSourceStatus[];
  updatedAt: number;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LIVE_TTL_MS = 10 * 60 * 1000;
const SNAP_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7000;

let liveCache: { data: MacroBase; at: number } | null = null;
let snapCache: { data: MacroBase; at: number } | null = null;
let liveInflight: Promise<MacroBase> | null = null;

export function macroSnapshotMeta() {
  return {
    generatedAt: SNAP.generatedAt,
    source: SNAP.source,
    window: SNAP.window,
    rows: Object.fromEntries(MACRO_ASSET_ORDER.map((k) => [k, SNAP.assets[k].rows.length])),
    yieldRows: SNAP.ust10y.rows.length,
    sources: SNAP.sources,
  };
}

function toRows(rows: readonly (readonly [string, number])[]): Row[] {
  return rows.map(([d, v]) => [d, v] as Row);
}

const SNAP_ROWS: Record<MacroAssetKey, Row[]> = {
  gold: toRows(SNAP.assets.gold.rows),
  oil: toRows(SNAP.assets.oil.rows),
  bond: toRows(SNAP.assets.bond.rows),
};
const SNAP_YIELD = toRows(SNAP.ust10y.rows);

function mergeRows(base: Row[], extra: Row[] | null): Row[] {
  if (!extra || !extra.length) return base;
  const map = new Map<string, number>();
  for (const [d, v] of base) map.set(d, v);
  for (const [d, v] of extra) map.set(d, v);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, v] as Row);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function parseUsDate(value: unknown): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

function numeric(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Nasdaq 官方公开历史行情（ETF 模式），单次 7 秒超时，由快照兜底 */
async function fetchNasdaqEtf(symbol: string): Promise<Row[]> {
  const url =
    "https://api.nasdaq.com/api/quote/" +
    encodeURIComponent(symbol) +
    "/historical?assetclass=etf&fromdate=" +
    // Nasdaq 只接受最近约 10 年的区间，恰好 3650 天会落在边界外并被拒绝（返回 data:null）
    isoDaysAgo(3600) +
    "&limit=9999";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nasdaq.com/" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = (await res.json()) as { data?: { tradesTable?: { rows?: { date?: string; close?: string }[] } } };
  const raw = json.data?.tradesTable?.rows;
  if (!Array.isArray(raw)) throw new Error("返回结构异常");
  const byDate = new Map<string, number>();
  for (const r of raw) {
    const date = parseUsDate(r?.date);
    const close = numeric(r?.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && close !== null && close > 0) byDate.set(date, close);
  }
  const rows = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, v] as Row);
  if (rows.length < 500) throw new Error("有效收盘价不足：" + rows.length);
  return rows;
}

/** FRED DGS10：10 年期美国国债恒定到期收益率（%，日频，'.' 为缺失） */
async function fetchFred10y(): Promise<Row[]> {
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=" + isoDaysAgo(3653);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, raw] = lines[i].split(",");
    const value = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) rows.push([date, value]);
  }
  if (rows.length < 500) throw new Error("有效收益率不足：" + rows.length);
  return rows;
}

function snapshotStatuses(): MacroSourceStatus[] {
  return [
    {
      id: "nasdaq_etf",
      label: "Nasdaq GLD / USO / TLT 历史日线",
      kind: "price",
      mode: "snapshot",
      ok: true,
      note: `本地真实快照，生成于 ${SNAP.generatedAt.slice(0, 10)}；GLD / USO / TLT 各 ${SNAP.assets.gold.rows.length} 条`,
      rows: SNAP.assets.gold.rows.length,
    },
    {
      id: "fred_dgs10",
      label: "FRED DGS10 10 年期美债收益率",
      kind: "yield",
      mode: "snapshot",
      ok: true,
      note: `本地真实快照，生成于 ${SNAP.generatedAt.slice(0, 10)}；${SNAP.ust10y.rows.length} 个交易日`,
      rows: SNAP.ust10y.rows.length,
    },
  ];
}

async function buildLiveBase(): Promise<MacroBase> {
  const keys = MACRO_ASSET_ORDER;
  const fredPromise = fetchFred10y()
    .then((rows) => ({ rows, err: null as string | null }))
    .catch((err: unknown) => ({ rows: null as Row[] | null, err: String(err instanceof Error ? err.message : err).slice(0, 80) }));
  // Nasdaq 对并发请求会返回 data:null（反爬限流），因此逐只刷新并留出间隔
  const results: { key: MacroAssetKey; rows: Row[] | null; err: string | null }[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const rows = await fetchNasdaqEtf(SNAP.assets[key].symbol);
      results.push({ key, rows, err: null });
    } catch (err) {
      results.push({ key, rows: null, err: String(err instanceof Error ? err.message : err).slice(0, 80) });
    }
    if (i < keys.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
  const fred = await fredPromise;

  const assets: Record<MacroAssetKey, Row[]> = {
    gold: SNAP_ROWS.gold,
    oil: SNAP_ROWS.oil,
    bond: SNAP_ROWS.bond,
  };
  const parts: string[] = [];
  const failed: string[] = [];
  for (const r of results) {
    if (r.rows && r.rows.length) {
      assets[r.key] = mergeRows(SNAP_ROWS[r.key], r.rows);
      parts.push(`${SNAP.assets[r.key].symbol} ${r.rows.length} 条`);
    } else {
      failed.push(`${SNAP.assets[r.key].symbol}（${r.err ?? "未知错误"}）`);
    }
  }
  const statuses: MacroSourceStatus[] = [
    {
      id: "nasdaq_etf",
      label: "Nasdaq GLD / USO / TLT 历史日线",
      kind: "price",
      mode: failed.length === keys.length ? "snapshot" : "live",
      ok: failed.length === 0,
      note:
        failed.length === 0
          ? `实时刷新成功，已合并到快照：${parts.join("、")}`
          : `部分失败，保留本地快照：${failed.join("；")}${parts.length ? `；已刷新 ${parts.join("、")}` : ""}`,
      rows: assets.gold.length,
    },
  ];
  const yieldRows = fred.rows && fred.rows.length ? mergeRows(SNAP_YIELD, fred.rows) : SNAP_YIELD;
  statuses.push({
    id: "fred_dgs10",
    label: "FRED DGS10 10 年期美债收益率",
    kind: "yield",
    mode: fred.rows ? "live" : "snapshot",
    ok: Boolean(fred.rows),
    note: fred.rows
      ? `实时刷新成功，抓取 ${fred.rows.length} 条并合并到快照：共 ${yieldRows.length} 个交易日`
      : `刷新失败，保留本地快照：${fred.err ?? "未知错误"}`,
    rows: yieldRows.length,
  });

  return { assets, yieldRows, statuses, updatedAt: Date.now() };
}

function buildSnapshotBase(): MacroBase {
  return {
    assets: { gold: SNAP_ROWS.gold, oil: SNAP_ROWS.oil, bond: SNAP_ROWS.bond },
    yieldRows: SNAP_YIELD,
    statuses: snapshotStatuses(),
    updatedAt: Date.now(),
  };
}

async function loadBase(refresh: boolean): Promise<MacroBase> {
  const now = Date.now();
  if (liveCache && now - liveCache.at < LIVE_TTL_MS) return liveCache.data;
  if (!refresh) {
    if (snapCache && now - snapCache.at < SNAP_TTL_MS) return snapCache.data;
    const data = buildSnapshotBase();
    snapCache = { data, at: data.updatedAt };
    return data;
  }
  if (liveInflight) return liveInflight;
  liveInflight = buildLiveBase()
    .then((data) => {
      liveCache = { data, at: data.updatedAt };
      return data;
    })
    .finally(() => {
      liveInflight = null;
    });
  return liveInflight;
}

/* ===================== 指标计算 ===================== */

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

function pctChange(latest: number, past: number | null | undefined): number | null {
  if (past === undefined || past === null || !Number.isFinite(past) || past <= 0) return null;
  return round((latest / past - 1) * 100, 2);
}

function bpChange(latest: number, past: number | null | undefined): number | null {
  if (past === undefined || past === null || !Number.isFinite(past)) return null;
  return round((latest - past) * 100, 1);
}

function percentileOf(value: number, values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length || !Number.isFinite(value)) return null;
  let below = 0;
  for (const v of valid) if (v <= value) below += 1;
  return round((below / valid.length) * 100, 1);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) * (v - m), 0) / values.length);
}

function annualizedVol(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  const rets: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (i <= 0) continue;
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < period) return null;
  const sd = stdev(rets);
  return Number.isFinite(sd) ? round(sd * Math.sqrt(TRADING_DAYS) * 100, 2) : null;
}

/** 全历史的 21 日滚动年化波动，用于当前波动率的历史分位 */
function rollingVol(closes: number[], period = 21): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (i < period) continue;
    const rets: number[] = [];
    for (let j = i - period + 1; j <= i; j++) rets.push(Math.log(closes[j] / closes[j - 1]));
    const sd = stdev(rets);
    if (Number.isFinite(sd)) out.push(sd * Math.sqrt(TRADING_DAYS) * 100);
  }
  return out;
}

function maxDrawdown(closes: number[]): number | null {
  if (!closes.length) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.min(worst, c / peak - 1);
  }
  return round(worst * 100, 2);
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 10 || b.length < 10) return null;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return null;
  return round(cov / Math.sqrt(va * vb), 2);
}

export interface MacroPoint {
  date: string;
  gold: number;
  oil: number;
  bond: number;
  ust10y: number | null;
}

function buildPoints(base: MacroBase): MacroPoint[] {
  const gold = new Map(base.assets.gold.map(([d, v]) => [d, v]));
  const oil = new Map(base.assets.oil.map(([d, v]) => [d, v]));
  const bond = new Map(base.assets.bond.map(([d, v]) => [d, v]));
  const yields = new Map(base.yieldRows.map(([d, v]) => [d, v]));
  const dates = [...gold.keys()].filter((d) => oil.has(d) && bond.has(d)).sort();
  const out: MacroPoint[] = [];
  let lastYield: number | null = null;
  for (const date of dates) {
    if (yields.has(date)) lastYield = yields.get(date) as number;
    out.push({
      date,
      gold: gold.get(date) as number,
      oil: oil.get(date) as number,
      bond: bond.get(date) as number,
      ust10y: lastYield,
    });
  }
  return out;
}

function windowPoints(points: MacroPoint[], years: number | null): MacroPoint[] {
  if (!years) return points;
  const bars = Math.round(years * TRADING_DAYS);
  return points.length > bars ? points.slice(points.length - bars) : points;
}

interface AssetMetricsView {
  key: MacroAssetKey;
  symbol: string;
  label: string;
  name: string;
  unit: string;
  note: string;
  asOf: string;
  close: number;
  dayChangePct: number | null;
  returns: { w1: number | null; m1: number | null; m3: number | null; ytd: number | null; y1: number | null; window: number | null };
  vol21: number | null;
  vol63: number | null;
  volPct5y: number | null;
  maxDrawdown: number | null;
  drawdown1y: number | null;
}

function ytdBaseIndex(points: { date: string }[]): number {
  const latest = points[points.length - 1]?.date ?? "";
  const yearStart = latest.slice(0, 4) + "-01-01";
  let idx = -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].date < yearStart) {
      idx = i;
      break;
    }
  }
  return idx;
}

function assetView(
  key: MacroAssetKey,
  closes: number[],
  dates: string[],
  fullCloses: number[],
  prevClose: number | null,
): AssetMetricsView {
  const info = SNAP.assets[key];
  const n = closes.length;
  const latest = closes[n - 1];
  const idx = ytdBaseIndex(dates.map((d) => ({ date: d })));
  const ytdBase = idx >= 0 ? closes[idx] : closes[0];
  const volHistory = rollingVol(fullCloses, 21);
  const recent = volHistory.slice(-5 * TRADING_DAYS);
  const currentVol = annualizedVol(closes, 21);
  const high1y = Math.max(...closes.slice(-TRADING_DAYS));
  return {
    key,
    symbol: info.symbol,
    label: info.label,
    name: info.name,
    unit: info.unit,
    note: info.note,
    asOf: dates[n - 1],
    close: round(latest, 2) as number,
    dayChangePct: prevClose !== null ? pctChange(latest, prevClose) : null,
    returns: {
      w1: n > 5 ? pctChange(latest, closes[n - 6]) : null,
      m1: n > 21 ? pctChange(latest, closes[n - 22]) : null,
      m3: n > 63 ? pctChange(latest, closes[n - 64]) : null,
      ytd: pctChange(latest, ytdBase),
      y1: n > TRADING_DAYS ? pctChange(latest, closes[n - 1 - TRADING_DAYS]) : null,
      window: pctChange(latest, closes[0]),
    },
    vol21: currentVol,
    vol63: annualizedVol(closes, 63),
    volPct5y: currentVol !== null ? percentileOf(currentVol, recent) : null,
    maxDrawdown: maxDrawdown(closes),
    drawdown1y: round((latest / high1y - 1) * 100, 2),
  };
}

export interface MacroYieldView {
  key: "ust10y";
  label: string;
  unit: string;
  note: string;
  asOf: string;
  latest: number;
  dayChangeBp: number | null;
  changesBp: { w1: number | null; m1: number | null; m3: number | null; ytd: number | null; y1: number | null; window: number | null };
  pct5y: number | null;
  pctAll: number | null;
  high5y: number | null;
  low5y: number | null;
}

function yieldView(rows: Row[], years: number | null): MacroYieldView {
  const all = rows;
  const latestRow = all[all.length - 1];
  const dates = all.map((r) => r[0]);
  const values = all.map((r) => r[1]);
  const n = values.length;
  const latest = values[n - 1];
  const windowed = years ? all.slice(-Math.max(2, Math.round(years * TRADING_DAYS))) : all;
  const wDates = windowed.map((r) => r[0]);
  const wValues = windowed.map((r) => r[1]);
  const idx = ytdBaseIndex(wDates.map((d) => ({ date: d })));
  const ytdBase = idx >= 0 ? wValues[idx] : wValues[0];
  const recent5y = values.slice(-5 * TRADING_DAYS);
  return {
    key: "ust10y",
    label: SNAP.ust10y.label,
    unit: SNAP.ust10y.unit,
    note: SNAP.ust10y.note,
    asOf: latestRow[0],
    latest: round(latest, 2) as number,
    dayChangeBp: n > 1 ? bpChange(latest, values[n - 2]) : null,
    changesBp: {
      w1: n > 5 ? bpChange(latest, values[n - 6]) : null,
      m1: n > 21 ? bpChange(latest, values[n - 22]) : null,
      m3: n > 63 ? bpChange(latest, values[n - 64]) : null,
      ytd: bpChange(latest, ytdBase),
      y1: n > TRADING_DAYS ? bpChange(latest, values[n - 1 - TRADING_DAYS]) : null,
      window: bpChange(latest, wValues[0]),
    },
    pct5y: percentileOf(latest, recent5y),
    pctAll: percentileOf(latest, values),
    high5y: round(Math.max(...recent5y), 2),
    low5y: round(Math.min(...recent5y), 2),
  };
}

interface CorrelationView {
  keys: MacroCorrKey[];
  labels: string[];
  windowDays: number;
  matrix: (number | null)[][];
}

const CORR_LABELS: Record<MacroCorrKey, string> = {
  gold: "黄金",
  oil: "原油",
  bond: "美债",
  ust10y: "10Y 收益率变动",
};

/** 日收益率（收益率为日变动 bp）的 Pearson 相关矩阵 */
function correlationView(points: MacroPoint[], yieldRows: Row[], span: number): CorrelationView {
  const assetChanges: Record<MacroAssetKey, Map<string, number>> = { gold: new Map(), oil: new Map(), bond: new Map() };
  const tail = points.slice(-(span + 1));
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1];
    const cur = tail[i];
    assetChanges.gold.set(cur.date, cur.gold / prev.gold - 1);
    assetChanges.oil.set(cur.date, cur.oil / prev.oil - 1);
    assetChanges.bond.set(cur.date, cur.bond / prev.bond - 1);
  }
  const yieldChanges = new Map<string, number>();
  const from = tail[0]?.date ?? "";
  for (let i = 1; i < yieldRows.length; i++) {
    const [date, value] = yieldRows[i];
    if (date <= from) continue;
    yieldChanges.set(date, (value - yieldRows[i - 1][1]) * 100);
  }
  const maps: Record<MacroCorrKey, Map<string, number>> = { ...assetChanges, ust10y: yieldChanges };
  const keys: MacroCorrKey[] = ["gold", "oil", "bond", "ust10y"];
  const matrix: (number | null)[][] = keys.map(() => keys.map(() => null));
  let maxPairs = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i === j) {
        const size = maps[keys[i]].size;
        matrix[i][j] = size >= 10 ? 1 : null;
        continue;
      }
      if (j < i) {
        matrix[i][j] = matrix[j][i];
        continue;
      }
      const a = maps[keys[i]];
      const b = maps[keys[j]];
      const dates = [...a.keys()].filter((d) => b.has(d)).sort();
      const xs = dates.map((d) => a.get(d) as number);
      const ys = dates.map((d) => b.get(d) as number);
      matrix[i][j] = pearson(xs, ys);
      maxPairs = Math.max(maxPairs, dates.length);
    }
  }
  return {
    keys,
    labels: keys.map((k) => CORR_LABELS[k]),
    windowDays: maxPairs,
    matrix,
  };
}

export interface MacroDriver {
  key: string;
  label: string;
  score: number;
  state: string;
  reading: string;
  note: string;
}

export interface MacroRiskView {
  score: number;
  level: MacroRiskLevel;
  levelLabel: string;
  regime: MacroRegimeKey;
  regimeLabel: string;
  summary: string;
  drivers: MacroDriver[];
  watch: string[];
  components: { rate: number; bond: number; oil: number; link: number };
}

const REGIME_LABEL: Record<MacroRegimeKey, string> = {
  tightening: "利率冲击",
  reflation: "再通胀",
  riskoff: "避险",
  easing: "宽松交易",
  divergent: "走势分化",
};

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function stateLabel(score: number): string {
  return score >= 65 ? "压力高" : score >= 35 ? "压力中" : "压力低";
}

function riskView(args: {
  assets: AssetMetricsView[];
  yield10y: MacroYieldView;
  corr63: CorrelationView;
}): MacroRiskView {
  const { assets, yield10y, corr63 } = args;
  const gold = assets.find((a) => a.key === "gold");
  const oil = assets.find((a) => a.key === "oil");
  const bond = assets.find((a) => a.key === "bond");
  const ret63 = (a?: AssetMetricsView) => (a && a.returns.m3 !== null ? a.returns.m3 : 0);
  const yieldChg63 = yield10y.changesBp.m3 ?? 0;
  const yieldPct = yield10y.pct5y ?? 50;
  const bondDD = bond?.drawdown1y ?? 0;
  const oilVolPct = oil?.volPct5y ?? 50;
  const pairs: number[] = [];
  for (let i = 0; i < corr63.matrix.length; i++) {
    for (let j = i + 1; j < corr63.matrix.length; j++) {
      const v = corr63.matrix[i][j];
      if (v !== null) pairs.push(Math.abs(v));
    }
  }
  const avgAbsCorr = pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : 0.3;

  const rate = clampScore(0.6 * yieldPct + 0.4 * Math.min(100, (Math.abs(yieldChg63) / 60) * 100));
  const bondScore = clampScore(
    0.6 * Math.min(100, (Math.max(0, -bondDD) / 15) * 100) + 0.4 * Math.min(100, (Math.max(0, -ret63(bond)) / 10) * 100),
  );
  const oilScore = clampScore(0.5 * oilVolPct + 0.5 * Math.min(100, (Math.abs(ret63(oil)) / 25) * 100));
  const link = clampScore(avgAbsCorr * 100);
  const score = Math.round(rate * 0.3 + bondScore * 0.25 + oilScore * 0.25 + link * 0.2);
  const level: MacroRiskLevel = score >= 65 ? "high" : score >= 35 ? "medium" : "low";
  const levelLabel = level === "high" ? "高" : level === "medium" ? "中" : "低";

  let regime: MacroRegimeKey = "divergent";
  const gold63 = ret63(gold);
  const oil63 = ret63(oil);
  const bond63 = ret63(bond);
  if (yieldChg63 >= 30 && bond63 <= -3) regime = "tightening";
  else if (oil63 >= 5 && yieldChg63 >= 15) regime = "reflation";
  else if (gold63 >= 2 && bond63 >= 1 && yieldChg63 <= -10) regime = "riskoff";
  else if (yieldChg63 <= -20 && bond63 >= 2) regime = "easing";

  const fmtSigned = (v: number | null, digits = 2, suffix = "%") =>
    v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;

  const summaryByRegime: Record<MacroRegimeKey, string> = {
    tightening: `10 年期收益率 63 日上行 ${fmtSigned(yieldChg63, 0, "bp")}、TLT 同期 ${fmtSigned(bond63)}，利率冲击主导，长久期美债承压；黄金和原油是否同涨决定这是一次纯紧缩还是再通胀。`,
    reflation: `原油 63 日 ${fmtSigned(oil63)}、10 年期收益率 ${fmtSigned(yieldChg63, 0, "bp")}，组合呈现再通胀特征：商品走强、长端利率上行、美债价格承压。`,
    riskoff: `黄金 63 日 ${fmtSigned(gold63)}、TLT ${fmtSigned(bond63)}、10 年期收益率 ${fmtSigned(yieldChg63, 0, "bp")}，避险与久期需求同时占优；原油的弱势幅度决定避险的强度。`,
    easing: `10 年期收益率 63 日下行 ${fmtSigned(yieldChg63, 0, "bp")}、TLT ${fmtSigned(bond63)}，久期交易占优；黄金与原油的方向决定这是衰退式宽松还是流动性宽松。`,
    divergent: `黄金 ${fmtSigned(gold63)}、原油 ${fmtSigned(oil63)}、美债 ${fmtSigned(bond63)}（均为 63 日），三资产方向分化，缺少统一的宏观主线；此时相关性本身比单边方向更值得关注。`,
  };

  const drivers: MacroDriver[] = [
    {
      key: "rate",
      label: "10Y 利率压力",
      score: Math.round(rate),
      state: stateLabel(rate),
      reading: `${yield10y.latest.toFixed(2)}%｜63 日 ${fmtSigned(yieldChg63, 0, "bp")}｜5 年分位 ${yield10y.pct5y === null ? "—" : yield10y.pct5y.toFixed(0) + "%"}`,
      note: "收益率上行直接压低长久期美债价格；分位越高，进一步上行对估值的边际压力越大。",
    },
    {
      key: "bond",
      label: "美债价格压力",
      score: Math.round(bondScore),
      state: stateLabel(bondScore),
      reading: `TLT 距 1 年高点 ${fmtSigned(bondDD)}｜63 日 ${fmtSigned(bond63)}`,
      note: "TLT 代表 20 年以上久期美债价格；回撤越深，久期风险与再平衡需求越强。",
    },
    {
      key: "oil",
      label: "原油波动压力",
      score: Math.round(oilScore),
      state: stateLabel(oilScore),
      reading: `USO 63 日 ${fmtSigned(oil63)}｜21 日年化波动 ${oil?.vol21 === null || oil?.vol21 === undefined ? "—" : oil.vol21.toFixed(1) + "%"}（5 年分位 ${oilVolPct.toFixed(0)}%）`,
      note: "原油波动既反映供需，也通过通胀预期传导到长端利率；期货展期成本会放大 USO 的偏离。",
    },
    {
      key: "link",
      label: "联动性",
      score: Math.round(link),
      state: stateLabel(link),
      reading: `63 日平均 |相关系数| ${avgAbsCorr.toFixed(2)}｜黄金-美债 ${fmtSigned(corr63.matrix[0][2], 2, "")}｜原油-美债 ${fmtSigned(corr63.matrix[1][2], 2, "")}`,
      note: "相关性走高意味着分散效果下降、宏观因子主导增强；相关性不等于因果。",
    },
  ];

  const watch = [
    `10 年期收益率能否守住 ${yield10y.low5y === null ? "近 5 年低位" : yield10y.low5y.toFixed(2) + "%"}–${yield10y.high5y === null ? "近 5 年高位" : yield10y.high5y.toFixed(2) + "%"} 区间；突破方向决定美债与黄金的下一段主逻辑。`,
    `TLT 是否跌破近一年低点（当前距高点 ${fmtSigned(bondDD)}）；若跌破且原油同步走强，利率冲击情景升级。`,
    `原油 21 日年化波动是否升破 ${oil?.vol21 ? (oil.vol21 * 1.2).toFixed(0) : "—"}%；波动抬升会通过通胀预期传导至长端利率。`,
    "黄金与美债是否继续同向：同涨通常对应避险或降息交易，同跌则更接近流动性收紧。",
  ];

  return {
    score,
    level,
    levelLabel,
    regime,
    regimeLabel: REGIME_LABEL[regime],
    summary: `跨资产压力评分 ${score}/100（${levelLabel}）：${summaryByRegime[regime]}`,
    drivers,
    watch,
    components: {
      rate: Math.round(rate),
      bond: Math.round(bondScore),
      oil: Math.round(oilScore),
      link: Math.round(link),
    },
  };
}

export interface MacroChartPoint {
  date: string;
  gold: number;
  oil: number;
  bond: number;
  ust10y: number | null;
}

export interface MacroPayload {
  asOf: string;
  window: { from: string; to: string; years: number; days: number };
  assets: AssetMetricsView[];
  yield10y: MacroYieldView;
  correlations: CorrelationView;
  corr63: CorrelationView;
  chart: MacroChartPoint[];
  chartFreq: "1d" | "1w";
  risk: MacroRiskView;
}

export interface MacroResult {
  payload: MacroPayload;
  statuses: MacroSourceStatus[];
  snapshot: { generatedAt: string; source: string; window: { from: string; to: string } };
  live: boolean;
}

function weekKey(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function sampleChart(points: MacroPoint[]): { rows: MacroPoint[]; freq: "1d" | "1w" } {
  if (points.length <= 320) return { rows: points, freq: "1d" };
  const out: MacroPoint[] = [];
  let key = "";
  for (const p of points) {
    const k = weekKey(p.date);
    if (k !== key) {
      out.push(p);
      key = k;
    } else {
      out[out.length - 1] = p;
    }
  }
  return { rows: out, freq: "1w" };
}

export async function getMacroAnalysis(opts: { refresh?: boolean; years?: number | null } = {}): Promise<MacroResult> {
  const refresh = opts.refresh === true;
  const years = opts.years ?? 3;
  const base = await loadBase(refresh);
  const allPoints = buildPoints(base);
  if (allPoints.length < 70) {
    throw new Error("跨资产日线样本不足，无法计算指标");
  }
  const points = windowPoints(allPoints, years);
  const closesOf = (key: MacroAssetKey) => allPoints.map((p) => p[key]);
  const fullCloses: Record<MacroAssetKey, number[]> = {
    gold: closesOf("gold"),
    oil: closesOf("oil"),
    bond: closesOf("bond"),
  };
  const dates = points.map((p) => p.date);
  const assets = MACRO_ASSET_ORDER.map((key) => {
    const closes = points.map((p) => p[key]);
    const prev = allPoints.length > 1 ? allPoints[allPoints.length - 2][key] : null;
    return assetView(key, closes, dates, fullCloses[key], prev);
  });
  const yield10y = yieldView(base.yieldRows, years);
  const corrSpan = Math.min(TRADING_DAYS, points.length - 1);
  const correlations = correlationView(points, base.yieldRows, corrSpan);
  const corr63 = correlationView(points, base.yieldRows, Math.min(63, points.length - 1));
  const risk = riskView({ assets, yield10y, corr63 });

  const baseGold = points[0].gold;
  const baseOil = points[0].oil;
  const baseBond = points[0].bond;
  const sampled = sampleChart(points);
  const chart: MacroChartPoint[] = sampled.rows.map((p) => ({
    date: p.date,
    gold: round((p.gold / baseGold) * 100, 2) as number,
    oil: round((p.oil / baseOil) * 100, 2) as number,
    bond: round((p.bond / baseBond) * 100, 2) as number,
    ust10y: p.ust10y === null ? null : round(p.ust10y, 2),
  }));

  return {
    payload: {
      asOf: allPoints[allPoints.length - 1].date,
      window: { from: points[0].date, to: points[points.length - 1].date, years, days: points.length },
      assets,
      yield10y,
      correlations,
      corr63,
      chart,
      chartFreq: sampled.freq,
      risk,
    },
    statuses: base.statuses,
    snapshot: { generatedAt: SNAP.generatedAt, source: SNAP.source, window: SNAP.window },
    live: base.statuses.some((s) => s.mode === "live" && s.ok),
  };
}

/* ===================== AI 上下文 ===================== */

export const MACRO_LIMITS = [
  "黄金 / 原油 / 美债分别以 GLD / USO / TLT 收盘价作为可交易代理，不是现货定盘价或期货连续合约；ETF 管理费、跟踪误差、期货展期成本与基金规则会造成偏离。",
  "10 年期美债收益率来自 FRED DGS10（恒定到期收益率），与 TLT 的久期、票息和价格变动不是一一对应；收益率上行对应美债价格下跌。",
  "相关性按日收益率（收益率为日变动 bp）计算，只描述历史同步程度，不代表因果，也不保证未来保持。",
  "风险评分为固定权重的启发式打分（利率 30% / 美债 25% / 原油 25% / 联动性 20%），不是概率、预测或交易信号。",
  "所有收益为价格收益，不含股息、票息、费用、税收与汇率换算；美债 ETF 的美元计价收益未做人民币对冲。",
  "数据为日频收盘，存在上游延迟、节假日缺失与盘中不更新；快照生成后不会自动回补历史修订。",
];

const MACRO_DEFINITION = {
  returns: "以各 ETF 收盘价计算；1W=5、1M=21、3M=63、1Y=252 个交易日，YTD 以最近一个上年最后一个交易日为基准，窗口收益以所选区间首个交易日为基准。",
  volatility: "21 / 63 日对数收益率标准差 × sqrt(252) × 100，年化（%）。",
  maxDrawdown: "所选窗口内从历史峰值到后续最低点的最大回撤（%）。",
  drawdown1y: "最新收盘相对最近 252 个交易日最高收盘的涨跌幅（%）。",
  correlation: "日收益率（10Y 收益率为日变动 bp）的 Pearson 相关系数；展示矩阵取所选区间最近 252 个交易日，风险联动性取最近 63 个交易日；少于 10 对观测返回 null。相关性不代表因果。",
  yield: "FRED DGS10 恒定到期收益率；bp 变动 = 收益率差 × 100。收益率上行代表美债价格下跌。",
  risk: "0–100 启发式压力评分：利率压力 30% + 美债价格压力 25% + 原油波动压力 25% + 联动性 20%；<35 低、<65 中、≥65 高。不是概率或预测。",
  chart: "归一化走势以所选区间首个交易日 = 100；10Y 收益率为原始水平（右轴），不是归一化值。",
};

export function macroDefinition() {
  return MACRO_DEFINITION;
}

export function macroAiBundle(result: MacroResult, refresh: boolean) {
  const p = result.payload;
  return {
    meta: {
      kind: "cross-asset-macro",
      asOf: p.asOf,
      generatedAt: new Date().toISOString(),
      liveRefresh: refresh,
      snapshot: result.snapshot,
      sources: result.statuses,
    },
    subject: {
      name: "黄金 / 原油 / 美债 跨资产风险",
      window: p.window,
      proxies: {
        gold: "GLD（SPDR Gold Shares）",
        oil: "USO（United States Oil Fund）",
        bond: "TLT（iShares 20+ Year Treasury Bond ETF）",
        yield: "FRED DGS10 10 年期美债恒定到期收益率",
      },
    },
    assets: p.assets,
    yield10y: p.yield10y,
    correlations: p.correlations,
    corr63: p.corr63,
    risk: p.risk,
    definition: MACRO_DEFINITION,
    limits: MACRO_LIMITS,
    taskForAssistant: {
      role: "你是跨资产宏观风险分析师。请仅依据以上真实日线数据，分析黄金、原油、美债当前涨跌背后的宏观传导与风险，不给出具体买卖点位、仓位或收益承诺。",
      requiredOutput: [
        "风险等级与置信度：确认或修正启发式评分，给出 0–1 置信度并说明理由",
        "三资产表现：引用黄金、原油、美债的最新价格、1M/3M/窗口收益与波动、回撤中的具体数值",
        "利率传导：说明 10Y 收益率水平、63 日 bp 变化与 5 年分位如何影响长久期美债，再如何传导到黄金与原油",
        "相关性解读：引用 63 日与 252 日相关矩阵中的具体系数，明确指出相关性不等于因果",
        "情景分析：分别给出再通胀、避险、宽松、利率冲击四种情景下的跨资产表现与触发条件",
        "观察清单：列出 3–5 个可核验的后续观察指标与阈值，注明数据来源",
        "数据缺口：指出 ETF 代理、期货展期、汇率、票息与日频数据带来的偏差，并说明对结论的影响",
        "结论边界：明确本分析不构成投资建议、不预测点位或收益，并给出失效条件",
      ],
      guardrails: [
        "不得编造行情、宏观数据、政策或机构观点；只能引用上下文中的数值",
        "不得给出具体买卖点位、仓位比例、收益承诺或本金安全保证",
        "相关性不等于因果；不得把历史相关关系直接外推为未来保证",
        "数据缺失、降级或代理偏差必须显式说明，并据此降低置信度",
      ],
    },
    api: {
      crossAsset: "/functions/v1/app/api/macro/cross-asset?years=" + p.window.years,
      aiContext: "/functions/v1/app/api/macro/ai-context?years=" + p.window.years + "&format=markdown",
    },
  };
}

export function macroMarkdown(result: MacroResult): string {
  const p = result.payload;
  const lines: string[] = [];
  const f = (v: number | null, digits = 2, suffix = "%") =>
    v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`;
  lines.push("# 跨资产风险上下文（黄金 / 原油 / 美债）");
  lines.push(`数据截至 ${p.asOf}｜窗口 ${p.window.from} → ${p.window.to}（${p.window.years} 年，${p.window.days} 个交易日）｜生成时间 ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 一、三资产最新表现");
  lines.push("| 资产 | 代码 | 最新收盘 | 当日 | 1W | 1M | 3M | YTD | 1Y | 窗口 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const a of p.assets) {
    lines.push(
      `| ${a.label} | ${a.symbol} | ${a.close.toFixed(2)} | ${f(a.dayChangePct)} | ${f(a.returns.w1)} | ${f(a.returns.m1)} | ${f(a.returns.m3)} | ${f(a.returns.ytd)} | ${f(a.returns.y1)} | ${f(a.returns.window)} |`,
    );
  }
  lines.push("");
  lines.push("## 二、波动与回撤");
  lines.push("| 资产 | 21 日年化波动 | 63 日年化波动 | 波动 5 年分位 | 窗口最大回撤 | 距 1 年高点 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const a of p.assets) {
    lines.push(
      `| ${a.label} | ${a.vol21 === null ? "—" : a.vol21.toFixed(2) + "%"} | ${a.vol63 === null ? "—" : a.vol63.toFixed(2) + "%"} | ${a.volPct5y === null ? "—" : a.volPct5y.toFixed(0) + "%"} | ${f(a.maxDrawdown)} | ${f(a.drawdown1y)} |`,
    );
  }
  lines.push("");
  lines.push("## 三、10 年期美债收益率");
  const y = p.yield10y;
  lines.push(`- 最新：${y.latest.toFixed(2)}%（${y.asOf}）｜5 年分位 ${y.pct5y === null ? "—" : y.pct5y.toFixed(0) + "%"}｜全样本分位 ${y.pctAll === null ? "—" : y.pctAll.toFixed(0) + "%"}｜近 5 年区间 ${y.low5y ?? "—"}%–${y.high5y ?? "—"}%`);
  lines.push(
    `- 变动：1W ${f(y.changesBp.w1, 1, "bp")}｜1M ${f(y.changesBp.m1, 1, "bp")}｜3M ${f(y.changesBp.m3, 1, "bp")}｜YTD ${f(y.changesBp.ytd, 1, "bp")}｜1Y ${f(y.changesBp.y1, 1, "bp")}｜窗口 ${f(y.changesBp.window, 1, "bp")}`,
  );
  lines.push("- 口径：收益率上行代表美债价格下跌；TLT 为 20 年以上久期美债价格代理。");
  lines.push("");
  lines.push("## 四、相关性矩阵（日收益 / 收益率日变动）");
  lines.push(`展示窗口：最近 ${p.correlations.windowDays} 对日变动；风险联动性使用最近 ${p.corr63.windowDays} 对日变动。`);
  lines.push("| | " + p.correlations.labels.join(" | ") + " |");
  lines.push("| --- | " + p.correlations.labels.map(() => "---").join(" | ") + " |");
  p.correlations.matrix.forEach((row, i) => {
    lines.push(`| ${p.correlations.labels[i]} | ${row.map((v) => (v === null ? "—" : v.toFixed(2))).join(" | ")} |`);
  });
  lines.push("");
  lines.push("## 五、风险状态（启发式）");
  lines.push(`- 评分：${p.risk.score}/100（${p.risk.levelLabel}）｜情景：${p.risk.regimeLabel}`);
  lines.push(`- 结论：${p.risk.summary}`);
  for (const d of p.risk.drivers) lines.push(`- ${d.label}：${d.score}/100（${d.state}）｜${d.reading}｜${d.note}`);
  lines.push("观察点：");
  for (const w of p.risk.watch) lines.push(`- ${w}`);
  lines.push("");
  lines.push("## 六、数据来源与口径");
  for (const s of result.statuses) lines.push(`- ${s.label}：${s.ok ? "正常" : "降级"}（${s.mode}）— ${s.note}`);
  for (const l of MACRO_LIMITS) lines.push(`- ${l}`);
  lines.push("");
  lines.push("## 七、给 AI 的分析任务");
  const bundle = macroAiBundle(result, false);
  for (const r of bundle.taskForAssistant.requiredOutput) lines.push(`- ${r}`);
  lines.push("约束：");
  for (const g of bundle.taskForAssistant.guardrails) lines.push(`- ${g}`);
  return lines.join("\n");
}
