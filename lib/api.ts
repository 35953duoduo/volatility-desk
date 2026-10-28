// 波动率站点的类型与请求封装（同源调用 Sites Function：/functions/v1/app）
export const BASE = "/functions/v1/app";

export interface SourceStatus {
  id: string;
  label: string;
  kind?: "price" | "implied_vol";
  mode: "live" | "snapshot" | string;
  ok: boolean;
  note: string;
  rows?: number;
}

export interface Meta {
  service: string;
  version: string;
  symbol: string;
  symbolLabel: string;
  years: number | null;
  freq: string;
  asOf: string | null;
  liveRefresh: boolean;
  snapshot: { source: string; generatedAt: string; window: { from: string; to: string } };
  sources: SourceStatus[];
}

export interface VolPointRow {
  date: string;
  close: number;
  rv21: number | null;
  rv63: number | null;
  vxn: number | null;
  pct5y: number | null;
  pctAll: number | null;
  z21: number | null;
  rv21Slope: number | null;
  drawdown: number | null;
  ma50: number | null;
  ma200: number | null;
  mom63: number | null;
}

export interface Metrics {
  asOf: string;
  close: number;
  dayChangePct: number | null;
  impliedVol: number | null;
  impliedVolAsOf: string | null;
  realizedVol21: number | null;
  realizedVol63: number | null;
  volPercentile5y: number | null;
  volPercentileAll: number | null;
  volZScore: number | null;
  volSlope21: number | null;
  drawdown52w: number | null;
  aboveMa50: boolean | null;
  aboveMa200: boolean | null;
  momentum63: number | null;
  volRegime: string;
  volRegimeKey: "compressed" | "normal" | "elevated" | "panic";
  impliedPremium: number | null;
}

export interface SignalRow {
  id: string;
  name: string;
  group: string;
  display: string;
  raw: number | null;
  state: "看多倾向" | "看空倾向" | "中性" | "数据不足";
  score: number;
  weight: number;
  rationale: string;
}

export interface Composite {
  score: number;
  stance: string;
  stanceKey: "buy" | "add" | "hold" | "trim" | "reduce";
  summary: string;
}

export interface RegimeRow {
  bucket: string;
  samples: number;
  avg63: number | null;
  median63: number | null;
  winRate63: number | null;
  worst63: number | null;
  best63: number | null;
  avg126: number | null;
}

export interface MatrixCell {
  vol: string;
  trend: string;
  samples: number;
  avg63: number | null;
  winRate63: number | null;
}

export interface AnnualRow {
  year: string;
  avgRv21: number | null;
  maxRv21: number | null;
  avgVxn: number | null;
  changePct: number | null;
}

export interface DistRow {
  label: string;
  from: number;
  to: number;
  count: number;
}

export interface SymbolInfo {
  key: string;
  label: string;
  secid: string;
  from: string;
  to: string;
  rows: number;
}

export interface HealthPayload {
  ok: boolean;
  service: string;
  version: string;
  time: string;
  symbols: SymbolInfo[];
  snapshot: { source: string; generatedAt: string; window: { from: string; to: string } };
  impliedVolAvailable: boolean;
  vixAvailable?: boolean;
  stocks?: { count: number; kospi: boolean; note: string };
  sources: SourceStatus[];
}

export interface HistoryPayload {
  ok: boolean;
  meta: Meta;
  fields: string[];
  definition: Record<string, string>;
  count: number;
  series: VolPointRow[];
}

export interface SnapshotPayload {
  ok: boolean;
  meta: Meta;
  metrics: Metrics;
  annual: AnnualRow[];
  distribution: DistRow[];
  points: number;
}

export interface SignalsPayload {
  ok: boolean;
  meta: Meta;
  signals: SignalRow[];
  composite: Composite;
}

export interface DiagnosisPayload {
  ok: boolean;
  meta: Meta;
  composite: Composite;
  metrics: Metrics;
  signals: SignalRow[];
  regimeStudy: RegimeRow[];
  volTrendMatrix: MatrixCell[];
  disclaimer: string;
}

export interface AiContextPayload {
  ok: boolean;
  meta: Meta;
  format: string;
  markdown: string;
  bundle: Record<string, unknown>;
}

export interface DocsPayload {
  ok: boolean;
  service: string;
  version: string;
  description: string;
  auth: string;
  basePath: string;
  commonParams: Record<string, string>;
  endpoints: { path: string; method: string; purpose: string; params?: Record<string, string>; returns: string }[];
  data_quality_notes: string[];
}

/* ===== 大摩 A 股报告事件与复盘 ===== */

export interface ReportTarget {
  index: string;
  from: number | null;
  to: number;
  horizon: string;
}

export interface ReportEventRow {
  id: string;
  date: string;
  title: string;
  action: string;
  stance: "看多" | "看空";
  summary: string;
  team: string;
  targets: ReportTarget[];
  sources: { label: string; url: string }[];
  confidence: string;
  dateNote: string;
}

export interface EventsProvenance {
  broker: string;
  curatedBy: string;
  exhaustive: boolean;
  caveat: string;
}

export interface EventsPayload {
  ok: boolean;
  meta: { version: string; count: number };
  broker: string;
  provenance: EventsProvenance;
  events: ReportEventRow[];
}

export interface EventOutcomeRow {
  eventId: string;
  symbol: string;
  eventDate: string;
  anchorDate: string;
  shiftDays: number;
  anchorClose: number;
  path: { offset: number; date: string; ret: number }[];
  forward: { days: number; ret: number | null }[];
  peak60: number | null;
  trough60: number | null;
  rv21At: number | null;
  rv21After: number | null;
}

export interface EventStudyPayload {
  ok: boolean;
  meta: {
    version: string;
    broker: string;
    events: number;
    symbols: string[];
    horizons: number[];
    liveRefresh: boolean;
    asOf: string;
  };
  definition: Record<string, string>;
  provenance: EventsProvenance;
  events: ReportEventRow[];
  study: {
    symbol: string;
    label: string;
    bars: number;
    window: { from: string; to: string };
    outcomes: EventOutcomeRow[];
  }[];
  baseline: {
    symbol: string;
    label: string;
    rows: { days: number; samples: number; avg: number | null; median: number | null; winRate: number | null }[];
  }[];
  stanceSummary: {
    symbol: string;
    label: string;
    rows: {
      stance: string;
      events: number;
      rows: { days: number; samples: number; avg: number | null; winRate: number | null }[];
    }[];
  }[];
  skipped: string[];
}

/* ===== VIX 恐慌指数 ===== */

export interface PanicPointRow {
  date: string;
  level: number;
  pct5y: number | null;
  pctAll: number | null;
  z: number | null;
}

export interface PanicPayload {
  ok: boolean;
  available: boolean;
  meta: { service?: string; version: string; liveRefresh: boolean; asOf: string | null };
  source: SourceStatus | null;
  reason?: string;
  latest: {
    asOf: string;
    level: number;
    pct5y: number | null;
    pctAll: number | null;
    z: number | null;
    regime: { label: string; key: "compressed" | "normal" | "elevated" | "panic" };
  } | null;
  count: number;
  series: PanicPointRow[];
  definition: Record<string, string>;
}

/* ===== A 股个股诊断（含韩国综合指数联动） ===== */

/** 手动添加个股：一次最多 6 只，只支持沪市 60/68、深市 00/30 开头的 6 位代码 */
export const EXTRA_STOCK_LIMIT = 6;
export const EXTRA_STOCK_STORAGE_KEY = "vol-desk-extra-stocks";
/** 红利策略的手动添加清单与个股诊断分开保存，互不影响 */
export const EXTRA_DIVIDEND_LIMIT = 6;
export const EXTRA_DIVIDEND_STORAGE_KEY = "vol-desk-extra-dividends";

export function isValidStockCode(code: string): boolean {
  return /^(60|68|00|30)\d{4}$/.test(code);
}

export interface StockInfo {
  code: string;
  name: string;
  sector: string;
  secid: string;
  from: string;
  to: string;
  rows: number;
}

export interface StockListItem extends StockInfo {
  asOf: string | null;
  close: number | null;
  dayChangePct: number | null;
}

export interface StocksListPayload {
  ok: boolean;
  meta: {
    version: string;
    liveRefresh: boolean;
    watchlistNote: string;
    kospi: StockInfo | null;
    extras?: string[];
    sources: SourceStatus[];
  };
  count: number;
  stocks: StockListItem[];
}

export interface StockSignalRow {
  id: string;
  name: string;
  group: string;
  display: string;
  raw: number | null;
  state: "看多倾向" | "看空倾向" | "中性" | "数据不足";
  score: number;
  ic: number | null;
  weight: number;
  rationale: string;
}

export interface StockMetricsPayload {
  asOf: string;
  close: number;
  dayChangePct: number | null;
  rv21: number | null;
  rv63: number | null;
  volPercentile5y: number | null;
  volPercentileAll: number | null;
  volZScore: number | null;
  volSlope21: number | null;
  momentum21: number | null;
  momentum63: number | null;
  drawdown52w: number | null;
  aboveMa50: boolean | null;
  aboveMa200: boolean | null;
  betaKospi63: number | null;
}

export interface StockCompositeRow {
  score: number;
  stance: string;
  stanceKey: "buy" | "add" | "hold" | "trim" | "reduce";
  summary: string;
}

export interface StockAnalysisRow extends StockInfo {
  rank: number;
  metrics: StockMetricsPayload | null;
  composite: StockCompositeRow | null;
  signals: StockSignalRow[];
  error?: string | null;
}

export interface StockWeighting {
  horizon: number;
  method: string;
  floor: number;
  cap: number;
}

export interface StocksSignalsPayload {
  ok: boolean;
  meta: {
    version: string;
    liveRefresh: boolean;
    count: number;
    extras?: string[];
    sources: SourceStatus[];
    kospiInfo: StockInfo | null;
  };
  weighting: StockWeighting;
  kospi: {
    info: StockInfo | null;
    metrics: StockMetricsPayload | null;
    regime: { label: string; key: "compressed" | "normal" | "elevated" | "panic" } | null;
    samples: number;
  };
  stocks: StockAnalysisRow[];
  disclaimer: string;
}

export interface StockHistoryPayload {
  ok: boolean;
  meta: { version: string; liveRefresh: boolean; asOf: string | null; sources: SourceStatus[] };
  stock: StockInfo;
  fields: string[];
  count: number;
  metrics: StockMetricsPayload | null;
  composite: StockCompositeRow | null;
  signals: StockSignalRow[];
  weighting: StockWeighting;
  series: (VolPointRow & { kospi: number | null })[];
  disclaimer: string;
}

/* ===== 红利策略（国企高分红股 · 周线高抛低吸） ===== */

export interface DividendSnapshotMeta {
  source: string;
  generatedAt: string;
  window: { from: string; to: string };
}

export interface DividendMeta {
  service: string;
  version: string;
  liveRefresh: boolean;
  asOf: string;
  snapshot: DividendSnapshotMeta;
  /** 基础清单数量（不含手动添加） */
  baseCount?: number;
  /** 本次请求手动添加的代码 */
  extras?: string[];
  /** 手动添加代码的抓取失败原因 */
  extraErrors?: Record<string, string>;
  sources: SourceStatus[];
}

export interface DividendStrategy {
  title: string;
  horizon: string;
  method: string;
  weights: { id: string; name: string; weight: number }[];
  position: { base: string; satellite: string };
  definition: Record<string, string>;
  definitionLabels: Record<string, string>;
}

export interface DividendRecord {
  exDate: string;
  dps: number;
  plan: string;
  reportDate: string;
  progress: string;
}

export interface DividendMetricsPayload {
  asOf: string;
  close: number;
  weekChangePct: number | null;
  yieldFY: number | null;
  dpsFY: number | null;
  fy: number | null;
  dpsTTM: number | null;
  yieldTTM: number | null;
  yieldPct5y: number | null;
  yieldPctAll: number | null;
  pricePct3y: number | null;
  pricePct5y: number | null;
  rsi14w: number | null;
  ma20w: number | null;
  ma60w: number | null;
  distMa20w: number | null;
  distMa60w: number | null;
  drawdown3y: number | null;
  weekVol52: number | null;
  streakYears: number;
  dividendYears: number;
  dividendCount: number;
  latestDividend: DividendRecord | null;
  weekPartial: boolean;
}

export interface DividendSignalRow {
  id: string;
  name: string;
  display: string;
  state: string;
  score: number;
  weight: number;
  rationale: string;
}

export interface DividendCompositeRow {
  score: number;
  stance: string;
  stanceKey: "accumulate" | "add" | "hold" | "trim" | "reduce";
  summary: string;
  actionHint: string;
  basePosition: string;
  satellite: string;
}

export interface DividendStockInfo {
  code: string;
  name: string;
  sector: string;
  secid: string;
  note: string;
  from: string;
  to: string;
  rows: number;
}

export interface DividendListRow extends DividendStockInfo {
  rank: number;
  asOf: string | null;
  close: number | null;
  weekChangePct: number | null;
  yieldFY: number | null;
  yieldPct5y: number | null;
  yieldTTM: number | null;
  pricePct3y: number | null;
  rsi14w: number | null;
  ma20w: number | null;
  ma60w: number | null;
  distMa60w: number | null;
  drawdown3y: number | null;
  streakYears: number;
  weekPartial: boolean;
  score: number;
  stance: string;
  stanceKey: DividendCompositeRow["stanceKey"];
  summary: string;
  actionHint: string;
}

export interface DividendListPayload {
  ok: boolean;
  meta: DividendMeta;
  summary: { count: number; lowBuy: number; highSell: number; neutral: number; avgYield: number | null };
  strategy: DividendStrategy;
  count: number;
  stocks: DividendListRow[];
  disclaimer: string;
}

export interface DividendPointRow {
  date: string;
  close: number;
  ma20w: number | null;
  ma60w: number | null;
  rsi14w: number | null;
  yieldFY: number | null;
  yieldTTM: number | null;
  yieldPct5y: number | null;
  pricePct3y: number | null;
  drawdown3y: number | null;
}

export interface DividendHistoryPayload {
  ok: boolean;
  meta: DividendMeta;
  stock: DividendStockInfo;
  fields: string[];
  count: number;
  metrics: DividendMetricsPayload;
  composite: DividendCompositeRow;
  signals: DividendSignalRow[];
  dividends: DividendRecord[];
  series: DividendPointRow[];
  strategy: DividendStrategy;
  definition: Record<string, string>;
  disclaimer: string;
}

export interface DividendAiContextPayload {
  ok: boolean;
  meta: DividendMeta & { kind: string; code: string; name: string };
  format: string;
  markdown?: string;
  bundle: Record<string, unknown>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 统一的 JSON 请求：保留 401/403 语义、屏蔽原始服务端错误文本、校验成功负载 */
export async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "GET", credentials: "same-origin", signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("无法连接站点服务，请稍后重试。", 0, "network_error");
  }
  const text = await res.text();
  if (res.status === 401) throw new ApiError("需要登录后才能访问该接口。", 401, "login_required");
  if (res.status === 403) throw new ApiError("当前账号没有访问该接口的权限。", 403, "forbidden");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("服务返回了非 JSON 内容（可能是接口未部署或网关异常）。", res.status, "bad_payload");
  }
  const body = parsed as { ok?: boolean; error?: string; message?: string };
  if (!res.ok || body?.ok === false) {
    throw new ApiError(body?.message || `接口返回错误（HTTP ${res.status}）。`, res.status, body?.error || "request_failed");
  }
  return parsed as T;
}

export function query(params: Record<string, string | number | null | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function fmtSigned(value: number | null | undefined, digits = 1, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("zh-CN");
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length >= 10 ? value.slice(0, 10) : value;
}
