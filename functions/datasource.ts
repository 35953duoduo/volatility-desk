// 数据源层：本地真实快照 + 运行时实时上游刷新（含缓存与降级状态上报）
import { snapshot, type SnapshotData } from "./data/snapshot.ts";
import {
  dividendSnapshot,
  type DividendRecordData,
} from "./data/dividendSnapshot.ts";
import { DIVIDEND_WATCHLIST, type DividendGroupTag } from "./data/dividendWatchlist.ts";
import { buildSeries, type Row, type VolPoint } from "./analytics.ts";

export interface SymbolConfig {
  key: string;
  label: string;
  secid: string;
  /** 快照起始日 */
  from: string;
  to: string;
  rows: number;
}

export interface SourceStatus {
  id: string;
  label: string;
  kind: "price" | "implied_vol";
  mode: "live" | "snapshot";
  ok: boolean;
  note: string;
  rows?: number;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PRICE_TTL_MS = 5 * 60 * 1000;
const VOL_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;

export const SNAPSHOT_META = snapshot;

function symbolConfigs(data: SnapshotData): SymbolConfig[] {
  return Object.entries(data.symbols).map(([key, s]) => ({
    key,
    label: s.label,
    secid: s.secid,
    from: s.rows[0][0],
    to: s.rows[s.rows.length - 1][0],
    rows: s.rows.length,
  }));
}

export const SYMBOLS = symbolConfigs(snapshot);
export const DEFAULT_SYMBOL = "NDX100";

/** 东方财富国际指数日线（快照同源，运行时用于增量刷新） */
async function fetchEastmoney(secid: string, beg: string): Promise<Row[]> {
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" +
    encodeURIComponent(secid) +
    "&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=" +
    beg +
    "&end=20500101";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json: unknown = await res.json();
  const data = (json as { data?: { klines?: string[] } })?.data;
  const klines = data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) throw new Error("empty payload");
  const rows: Row[] = [];
  for (const line of klines) {
    const p = line.split(",");
    const value = Number(p[2]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p[0]) && Number.isFinite(value) && value > 0) rows.push([p[0], value]);
  }
  if (!rows.length) throw new Error("no parsable rows");
  return rows;
}

/** CBOE CDN 冷启动首字节常需 3–4 秒，隐含波动率单独用更长的超时 */
const IMPLIED_TIMEOUT_MS = 12000;

type ImpliedKind = "cboe" | "fred" | "yahoo";

/**
 * 隐含波动率上游优先级：CBOE 官方日线（cdn-api 更快）→ CBOE 备用域名 → FRED 收盘序列（通常晚一个交易日）→ Yahoo。
 * 均为公开的官方/镜像接口；不使用转载型财经站点（反爬且非原始数据）。
 */
const IMPLIED_SOURCE_SETS: Record<"VIX" | "VXN", { id: string; label: string; url: string; kind: ImpliedKind }[]> = {
  VXN: [
    {
      id: "cboe_vxn_csv",
      label: "CBOE VXN_History.csv（cdn-api）",
      url: "https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv",
      kind: "cboe",
    },
    {
      id: "cboe_vxn_csv_alt",
      label: "CBOE VXN_History.csv（cdn）",
      url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv",
      kind: "cboe",
    },
    {
      id: "fred_vxncls",
      label: "FRED VXNCLS（CBOE 收盘序列镜像）",
      url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=VXNCLS",
      kind: "fred",
    },
    {
      id: "yahoo_vxn",
      label: "Yahoo Finance ^VXN",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EVXN?range=15y&interval=1d",
      kind: "yahoo",
    },
  ],
  VIX: [
    {
      id: "cboe_vix_csv",
      label: "CBOE VIX_History.csv（cdn-api）",
      url: "https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
      kind: "cboe",
    },
    {
      id: "cboe_vix_csv_alt",
      label: "CBOE VIX_History.csv（cdn）",
      url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
      kind: "cboe",
    },
    {
      id: "fred_vixcls",
      label: "FRED VIXCLS（CBOE 收盘序列镜像）",
      url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS",
      kind: "fred",
    },
    {
      id: "yahoo_vix",
      label: "Yahoo Finance ^VIX",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=15y&interval=1d",
      kind: "yahoo",
    },
  ],
};

function toIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!us) return null;
  return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

/** CBOE 日线 CSV：DATE,OPEN,HIGH,LOW,CLOSE（收盘在第 5 列，日期为 MM/DD/YYYY） */
function parseCboeCsv(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 5) continue;
    const date = toIsoDate(p[0]);
    const value = Number(p[4]);
    if (date && Number.isFinite(value) && value > 0) rows.push([date, value]);
  }
  return rows;
}

/** FRED CSV：observation_date,VIXCLS / VXNCLS（缺失值写作 .） */
function parseFredCsv(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 2) continue;
    const date = toIsoDate(p[0]);
    const value = Number(p[1]);
    if (date && Number.isFinite(value) && value > 0) rows.push([date, value]);
  }
  return rows;
}

function parseYahooChart(text: string): Row[] {
  const json = JSON.parse(text) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const rows: Row[] = [];
  for (let i = 0; i < ts.length; i++) {
    const value = closes[i];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    rows.push([new Date(ts[i] * 1000).toISOString().slice(0, 10), value as number]);
  }
  return rows;
}

const lastImpliedErrors: Record<"VIX" | "VXN", string> = { VIX: "", VXN: "" };

/** 尝试任一可达的隐含波动率上游；全部失败时返回 null（前端与 API 均会明确标注） */
async function fetchImpliedVol(name: "VIX" | "VXN"): Promise<{ rows: Row[]; source: SourceStatus } | null> {
  const attempts = await Promise.all(
    IMPLIED_SOURCE_SETS[name].map(async (src) => {
      try {
        const res = await fetch(src.url, {
          headers: { "User-Agent": UA, Accept: "text/csv,application/json,*/*" },
          redirect: "follow",
          signal: AbortSignal.timeout(IMPLIED_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        const rows =
          src.kind === "cboe" ? parseCboeCsv(text) : src.kind === "fred" ? parseFredCsv(text) : parseYahooChart(text);
        if (!rows.length) throw new Error("未识别到数据行");
        return {
          src,
          rows,
          note: src.kind === "fred" ? "FRED 镜像（通常较 CBOE 晚一个交易日）" : "官方日线收盘",
        } as const;
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        return { src, rows: null, note: note.slice(0, 80) } as const;
      }
    }),
  );
  const failures: string[] = [];
  for (const a of attempts) {
    if (a.rows && a.rows.length) {
      return {
        rows: a.rows,
        source: {
          id: name === "VIX" ? "implied_vol_vix" : "implied_vol",
          label: a.src.label,
          kind: "implied_vol",
          mode: "live",
          ok: true,
          note: `${a.note}（${a.src.id}）`,
          rows: a.rows.length,
        },
      };
    }
    failures.push(`${a.src.id}=${a.note}`);
  }
  lastImpliedErrors[name] = failures.join("，").slice(0, 160);
  return null;
}

export interface ImpliedQuote {
  id: string;
  label: string;
  level: number;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  lastTrade: string | null;
}

const CBOE_QUOTE_URLS = [
  "https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/_VIX.json",
  "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json",
];

/** CBOE 官方延迟报价（约 15 分钟延迟）：只作盘中参考，日线、分位与 Z 分数仍以收盘序列为准 */
async function fetchVixQuote(): Promise<ImpliedQuote | null> {
  for (const url of CBOE_QUOTE_URLS) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(IMPLIED_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: {
          current_price?: number;
          price_change?: number;
          price_change_percent?: number;
          prev_day_close?: number;
          last_trade_time?: string;
        };
      };
      const d = json.data;
      const level = Number(d?.current_price);
      if (!d || !Number.isFinite(level) || level <= 0) continue;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      return {
        id: "cboe_vix_quote",
        label: "CBOE 延迟报价",
        level,
        change: num(d.price_change),
        changePct: num(d.price_change_percent),
        prevClose: num(d.prev_day_close),
        lastTrade: typeof d.last_trade_time === "string" ? d.last_trade_time : null,
      };
    } catch {
      /* 报价失败不影响日线序列 */
    }
  }
  return null;
}

function mergeRows(base: Row[], extra: Row[] | null): Row[] {
  if (!extra || !extra.length) return base;
  const map = new Map<string, number>();
  for (const [d, v] of base) map.set(d, v);
  for (const [d, v] of extra) map.set(d, v);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, v] as Row);
}

interface Dataset {
  series: Record<string, VolPoint[]>;
  statuses: SourceStatus[];
  updatedAt: number;
  impliedVol: Row[] | null;
  vixRows: Row[] | null;
  vixQuote: ImpliedQuote | null;
}

let liveCache: { data: Dataset; at: number } | null = null;
let snapCache: { data: Dataset; at: number } | null = null;
let liveInflight: Promise<Dataset> | null = null;
let snapInflight: Promise<Dataset> | null = null;

const LIVE_BEG = "20240101";

async function buildDataset(refresh: boolean): Promise<Dataset> {
  const statuses: SourceStatus[] = [];
  let vxnRows: Row[] | null = snapshot.vxn ? snapshot.vxn.rows : null;
  let vixBase: Row[] | null = snapshot.vix ? snapshot.vix.rows : null;
  let vixQuote: ImpliedQuote | null = null;
  const liveExtra = new Map<string, Row[]>();
  const liveVxn = new Map<string, number>();
  const liveVix = new Map<string, number>();

  if (refresh) {
    // 隐含波动率、CBOE 延迟报价与价格增量并行请求；仅隐含波动率使用更长超时
    const [vxnImplied, vixImplied, quote, ...priceResults] = await Promise.all([
      fetchImpliedVol("VXN"),
      fetchImpliedVol("VIX"),
      fetchVixQuote(),
      ...SYMBOLS.map((cfg) =>
        fetchEastmoney(cfg.secid, LIVE_BEG)
          .then((rows) => ({ cfg, rows, err: null as Error | null }))
          .catch((err: unknown) => ({ cfg, rows: null as Row[] | null, err: err as Error })),
      ),
    ]);
    vixQuote = quote;

    if (vxnImplied) {
      for (const [d, v] of vxnImplied.rows) liveVxn.set(d, v);
      vxnRows = mergeRows(vxnRows ?? [], vxnImplied.rows);
      statuses.push(vxnImplied.source);
    } else {
      statuses.push({
        id: "implied_vol",
        label: "VXN 隐含波动率（CBOE 官方 / FRED）",
        kind: "implied_vol",
        mode: "snapshot",
        ok: false,
        note: (lastImpliedErrors.VXN || "上游均不可达") + "，回落快照",
      });
    }
    if (vixImplied) {
      for (const [d, v] of vixImplied.rows) liveVix.set(d, v);
      vixBase = mergeRows(vixBase ?? [], vixImplied.rows);
      statuses.push(vixImplied.source);
    } else {
      statuses.push({
        id: "implied_vol_vix",
        label: "VIX 恐慌指数（CBOE 官方 / FRED）",
        kind: "implied_vol",
        mode: "snapshot",
        ok: false,
        note: (lastImpliedErrors.VIX || "上游均不可达") + "，回落快照",
      });
    }

    for (const r of priceResults) {
      if (!r) continue;
      if (r.rows && r.rows.length) {
        liveExtra.set(r.cfg.key, r.rows);
        statuses.push({
          id: "price_" + r.cfg.key,
          label: r.cfg.label + " 日线（东方财富）",
          kind: "price",
          mode: "live",
          ok: true,
          note: "实时增量 " + r.rows.length + " 条",
          rows: r.rows.length,
        });
      } else {
        statuses.push({
          id: "price_" + r.cfg.key,
          label: r.cfg.label + " 日线（东方财富）",
          kind: "price",
          mode: "snapshot",
          ok: false,
          note: "实时刷新失败，使用快照：" + String(r.err && r.err.message ? r.err.message : r.err).slice(0, 80),
        });
      }
    }
  } else {
    statuses.push({
      id: "snapshot",
      label: "本地真实行情快照",
      kind: "price",
      mode: "snapshot",
      ok: true,
      note: snapshot.source + "（生成于 " + snapshot.generatedAt.slice(0, 10) + "）",
    });
    statuses.push({
      id: "implied_vol",
      label: "VXN 隐含波动率",
      kind: "implied_vol",
      mode: "snapshot",
      ok: Boolean(snapshot.vxn),
      note: snapshot.vxn
        ? "快照包含 VXN"
        : "抓取时上游不可达（" + (snapshot.vxnProbeNotes.map((n) => n.id + "=" + (n.ok ? "ok" : n.note)).join("，") || "无记录") + "）",
    });
    statuses.push({
      id: "implied_vol_vix",
      label: "VIX 恐慌指数",
      kind: "implied_vol",
      mode: "snapshot",
      ok: Boolean(snapshot.vix),
      note: snapshot.vix
        ? "快照包含 VIX"
        : "抓取时上游不可达（" +
          (snapshot.vixProbeNotes.map((n) => n.id + "=" + (n.ok ? "ok" : n.note)).join("，") || "无记录") +
          "）",
    });
  }

  const mergedVxn: Row[] = [];
  if (vxnRows) {
    const dedupe = new Map<string, number>();
    for (const [d, v] of vxnRows) dedupe.set(d, v);
    for (const [d, v] of liveVxn) dedupe.set(d, v);
    for (const [d, v] of [...dedupe.entries()].sort((a, b) => a[0].localeCompare(b[0]))) mergedVxn.push([d, v]);
  }

  const mergedVix: Row[] = [];
  if (vixBase) {
    const dedupe = new Map<string, number>();
    for (const [d, v] of vixBase) dedupe.set(d, v);
    for (const [d, v] of liveVix) dedupe.set(d, v);
    for (const [d, v] of [...dedupe.entries()].sort((a, b) => a[0].localeCompare(b[0]))) mergedVix.push([d, v]);
  }

  const series: Record<string, VolPoint[]> = {};
  for (const cfg of SYMBOLS) {
    const base = snapshot.symbols[cfg.key]?.rows ?? [];
    const rows = mergeRows(base, liveExtra.get(cfg.key) ?? null);
    series[cfg.key] = buildSeries(rows, mergedVxn.length ? mergedVxn : null);
  }

  return {
    series,
    statuses,
    updatedAt: Date.now(),
    impliedVol: mergedVxn.length ? mergedVxn : null,
    vixRows: mergedVix.length ? mergedVix : null,
    vixQuote,
  };
}

export async function getDataset(opts: { refresh?: boolean } = {}): Promise<Dataset> {
  const refresh = opts.refresh === true;
  const now = Date.now();
  // 实时数据是快照的超集，新鲜时优先返回
  if (liveCache && now - liveCache.at < PRICE_TTL_MS) return liveCache.data;
  if (refresh) {
    if (liveInflight) return liveInflight;
    liveInflight = buildDataset(true)
      .then((d) => {
        liveCache = { data: d, at: d.updatedAt };
        return d;
      })
      .finally(() => {
        liveInflight = null;
      });
    return liveInflight;
  }
  if (snapCache && now - snapCache.at < VOL_TTL_MS) return snapCache.data;
  if (snapInflight) return snapInflight;
  snapInflight = buildDataset(false)
    .then((d) => {
      snapCache = { data: d, at: d.updatedAt };
      return d;
    })
    .finally(() => {
      snapInflight = null;
    });
  return snapInflight;
}

export function symbolKeys(): string[] {
  return SYMBOLS.map((s) => s.key);
}

export function symbolLabel(key: string): string {
  return SYMBOLS.find((s) => s.key === key)?.label ?? key;
}

export function symbolConfig(key: string): SymbolConfig | undefined {
  return SYMBOLS.find((s) => s.key === key);
}

// ---------------- 个股诊断数据层（A 股观察清单 + 韩国综合指数） ----------------

interface StockSeriesMeta {
  code: string;
  name: string;
  sector: string;
  secid: string;
  rows: Row[];
}

export interface StockDataset {
  stocks: Record<string, StockSeriesMeta>;
  kospi: Row[];
  statuses: SourceStatus[];
  updatedAt: number;
  /** 本次请求额外按需抓取的手动添加个股（仅存在于内存缓存，不写入快照） */
  extraInfos?: StockInfo[];
  extraErrors?: Record<string, string>;
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

const STOCK_TTL_MS = 5 * 60 * 1000;
let stockLiveCache: { data: StockDataset; at: number } | null = null;
let stockSnapCache: { data: StockDataset; at: number } | null = null;
let stockInflight: Promise<StockDataset> | null = null;

interface StockQuoteDetail {
  price: number;
  /** 报价对应的交易日（按北京时间换算）；停牌或缺失时为 null */
  quoteDate: string | null;
}

/** 东方财富批量行情：最新价 + 报价时间（f124 为 Unix 秒） */
async function fetchStockQuoteDetails(secids: string[]): Promise<Map<string, StockQuoteDetail>> {
  const url =
    "https://push2.eastmoney.com/api/qt/ulist.np/get?secids=" +
    secids.map(encodeURIComponent).join(",") +
    "&fields=f2,f12,f14,f124&fltt=2";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json: unknown = await res.json();
  const diff = (json as { data?: { diff?: { f12?: string; f2?: number; f124?: number }[] } })?.data?.diff;
  if (!Array.isArray(diff) || diff.length === 0) throw new Error("empty quotes");
  const map = new Map<string, StockQuoteDetail>();
  for (const d of diff) {
    const code = String(d.f12 ?? "");
    const price = Number(d.f2);
    const ts = Number(d.f124);
    const quoteDate =
      Number.isFinite(ts) && ts > 0 ? new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10) : null;
    if (/^\d{6}$/.test(code) && Number.isFinite(price) && price > 0) map.set(code, { price, quoteDate });
  }
  if (!map.size) throw new Error("no parsable quotes");
  return map;
}

async function fetchStockQuotes(secids: string[]): Promise<Map<string, number>> {
  const details = await fetchStockQuoteDetails(secids);
  const map = new Map<string, number>();
  for (const [code, q] of details) map.set(code, q.price);
  return map;
}

function snapshotStocks(): Record<string, StockSeriesMeta> {
  const out: Record<string, StockSeriesMeta> = {};
  for (const s of snapshot.stocks) {
    out[s.code] = {
      code: s.code,
      name: s.label,
      sector: s.sector,
      secid: s.secid,
      rows: s.rows.map((r) => [r[0], r[1]] as Row),
    };
  }
  return out;
}

async function buildStockDataset(refresh: boolean): Promise<StockDataset> {
  const stocks = snapshotStocks();
  let kospi: Row[] = snapshot.kospi ? snapshot.kospi.rows.map((r) => [r[0], r[1]] as Row) : [];
  const statuses: SourceStatus[] = [];
  const count = Object.keys(stocks).length;

  if (!refresh) {
    statuses.push({
      id: "stock_snapshot",
      label: "个股行情快照",
      kind: "price",
      mode: "snapshot",
      ok: count > 0,
      note: count + " 只（生成于 " + snapshot.generatedAt.slice(0, 10) + "）",
    });
    statuses.push({
      id: "kospi",
      label: "韩国综合指数",
      kind: "price",
      mode: "snapshot",
      ok: kospi.length > 0,
      note: kospi.length ? "快照最新 " + kospi[kospi.length - 1][0] : "快照缺失",
    });
    return { stocks, kospi, statuses, updatedAt: Date.now() };
  }

  const codes = Object.keys(stocks);
  const [quoteRes, sseRes, kospiRes] = await Promise.allSettled([
    fetchStockQuotes(codes.map((c) => stocks[c].secid)),
    fetchEastmoney("1.000001", LIVE_BEG),
    fetchEastmoney("100.KS11", LIVE_BEG),
  ]);

  // 批量报价不带日期：用上证指数的最新交易日做锚；失败再退到 KOSPI 的最新日期
  let tradeDate: string | null = null;
  if (sseRes.status === "fulfilled" && sseRes.value.length) tradeDate = sseRes.value[sseRes.value.length - 1][0];
  else if (kospiRes.status === "fulfilled" && kospiRes.value.length) tradeDate = kospiRes.value[kospiRes.value.length - 1][0];

  if (quoteRes.status === "fulfilled" && tradeDate) {
    let updated = 0;
    for (const [code, price] of quoteRes.value) {
      const entry = stocks[code];
      if (!entry) continue;
      const last = entry.rows[entry.rows.length - 1];
      if (last && last[0] === tradeDate) last[1] = price;
      else entry.rows.push([tradeDate, price]);
      updated++;
    }
    statuses.push({
      id: "stock_quotes",
      label: "个股实时报价（东方财富批量行情）",
      kind: "price",
      mode: "live",
      ok: true,
      note: updated + " 只更新至 " + tradeDate,
      rows: updated,
    });
  } else {
    const reason = quoteRes.status === "rejected" ? quoteRes.reason : null;
    statuses.push({
      id: "stock_quotes",
      label: "个股实时报价（东方财富批量行情）",
      kind: "price",
      mode: "snapshot",
      ok: false,
      note: reason
        ? String((reason as Error)?.message ?? reason).slice(0, 80)
        : "无法确定最新交易日，回落快照",
    });
  }

  if (kospiRes.status === "fulfilled" && kospiRes.value.length) {
    kospi = mergeRows(kospi, kospiRes.value);
    statuses.push({
      id: "kospi",
      label: "韩国综合指数（东方财富）",
      kind: "price",
      mode: "live",
      ok: true,
      note: "实时增量 " + kospiRes.value.length + " 条，最新 " + kospi[kospi.length - 1][0],
    });
  } else {
    statuses.push({
      id: "kospi",
      label: "韩国综合指数",
      kind: "price",
      mode: "snapshot",
      ok: kospi.length > 0,
      note: "实时刷新失败，使用快照（" + (kospi.length ? kospi[kospi.length - 1][0] : "缺失") + "）",
    });
  }

  return { stocks, kospi, statuses, updatedAt: Date.now() };
}

export async function getBaseStockDataset(opts: { refresh?: boolean } = {}): Promise<StockDataset> {
  const refresh = opts.refresh === true;
  const now = Date.now();
  if (stockLiveCache && now - stockLiveCache.at < STOCK_TTL_MS) return stockLiveCache.data;
  if (!refresh) {
    if (stockSnapCache && now - stockSnapCache.at < VOL_TTL_MS) return stockSnapCache.data;
  } else if (stockInflight) {
    return stockInflight;
  }
  if (refresh) {
    stockInflight = buildStockDataset(true)
      .then((d) => {
        stockLiveCache = { data: d, at: d.updatedAt };
        return d;
      })
      .finally(() => {
        stockInflight = null;
      });
    return stockInflight;
  }
  const built = buildStockDataset(false).then((d) => {
    stockSnapCache = { data: d, at: d.updatedAt };
    return d;
  });
  return built;
}

export function stockInfos(): StockInfo[] {
  return snapshot.stocks.map((s) => ({
    code: s.code,
    name: s.label,
    sector: s.sector,
    secid: s.secid,
    from: s.rows[0][0],
    to: s.rows[s.rows.length - 1][0],
    rows: s.rows.length,
  }));
}

export function stockMeta(code: string): StockInfo | undefined {
  return stockInfos().find((s) => s.code === code);
}

export function kospiMeta(): StockInfo | null {
  const k = snapshot.kospi;
  if (!k) return null;
  return {
    code: "KS11",
    name: k.label,
    sector: "韩国",
    secid: k.secid,
    from: k.rows[0][0],
    to: k.rows[k.rows.length - 1][0],
    rows: k.rows.length,
  };
}

// ---------------- 手动添加的个股（GET 参数触发，按需抓取，不写入快照） ----------------

export const EXTRA_STOCK_LIMIT = 6;
const EXTRA_BEG = "20150101";
const EXTRA_TTL_MS = 10 * 60 * 1000;
const EXTRA_ERROR_TTL_MS = 60 * 1000;
const EXTRA_SECTOR = "手动添加";

interface ExtraEntry {
  at: number;
  info: StockInfo;
  meta: StockSeriesMeta;
}

const extraCache = new Map<string, ExtraEntry>();
const extraErrors = new Map<string, { at: number; error: string }>();
const extraInflight = new Map<string, Promise<{ name: string; rows: Row[] }>>();

/** 仅支持沪深 A 股常见板块：沪市 60/68、深市 00/30 */
export function isSupportedStockCode(code: string): boolean {
  return /^(60|68|00|30)\d{4}$/.test(code);
}

function stockSecid(code: string): string {
  return (code.startsWith("6") ? "1." : "0.") + code;
}

function tencentSymbol(code: string): string {
  return (code.startsWith("6") ? "sh" : "sz") + code;
}

function dateMinusOneDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 东方财富全历史日线（单请求，2015 起，前复权） */
async function fetchEastmoneyKlineFull(code: string): Promise<{ name: string; rows: Row[] }> {
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" +
    encodeURIComponent(stockSecid(code)) +
    "&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=" +
    EXTRA_BEG +
    "&end=20500101";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    // 全历史日线比实时增量大，给更宽的超时
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("东方财富 HTTP " + res.status);
  const json: unknown = await res.json();
  const data = (json as { data?: { name?: string; klines?: string[] } })?.data;
  const klines = data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error("该代码没有日线数据（可能不存在、已退市或不属于沪深 A 股）");
  }
  const rows: Row[] = [];
  for (const line of klines) {
    const p = line.split(",");
    const value = Number(p[2]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p[0]) && Number.isFinite(value) && value > 0) rows.push([p[0], value]);
  }
  if (rows.length < 30) throw new Error("日线样本不足 30 条，无法计算个股信号");
  const name = typeof data?.name === "string" && data.name.trim() ? data.name.trim() : code;
  return { name, rows };
}

/** 腾讯行情日线（前复权，单页上限 640 条，按最早日期向前翻页补全 2015 起） */
async function fetchTencentKlineFull(code: string): Promise<{ name: string; rows: Row[] }> {
  const symbol = tencentSymbol(code);
  const byDate = new Map<string, number>();
  let name = "";
  let end = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  for (let page = 0; page < 5; page++) {
    const url =
      "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" +
      encodeURIComponent(`${symbol},day,2015-01-01,${end},640,qfq`);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("腾讯行情 HTTP " + res.status);
    const json = (await res.json()) as {
      data?: Record<string, { qfqday?: string[][]; qt?: Record<string, string[]> }>;
    };
    const block = json.data?.[symbol];
    const list = block?.qfqday;
    if (!name) {
      const qt = block?.qt?.[symbol]?.[1];
      if (typeof qt === "string" && qt.trim()) name = qt.trim();
    }
    if (!Array.isArray(list) || list.length === 0) {
      if (page === 0) throw new Error("该代码没有日线数据（可能不存在、已退市或不属于沪深 A 股）");
      break;
    }
    let earliest = "";
    for (const p of list) {
      const date = String(p?.[0] ?? "");
      const value = Number(p?.[2]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) {
        byDate.set(date, value);
        if (!earliest || date < earliest) earliest = date;
      }
    }
    if (!earliest || earliest <= "2015-01-05") break;
    const next = dateMinusOneDay(earliest);
    if (next >= end) break;
    end = next;
  }
  const rows: Row[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => [date, value] as Row);
  if (rows.length < 30) throw new Error("日线样本不足 30 条，无法计算个股信号");
  return { name: name || code, rows };
}

/** 按需抓取单只个股的前复权日线（2015 起）：东方财富优先，失败回退腾讯分页 */
async function fetchStockKlineFull(code: string): Promise<{ name: string; rows: Row[] }> {
  try {
    return await fetchEastmoneyKlineFull(code);
  } catch (primary) {
    try {
      return await fetchTencentKlineFull(code);
    } catch (fallback) {
      const a = String((primary as Error)?.message ?? primary).slice(0, 80);
      const b = String((fallback as Error)?.message ?? fallback).slice(0, 80);
      throw new Error(`东方财富：${a}；腾讯：${b}`);
    }
  }
}

async function loadExtraStock(code: string): Promise<{ info: StockInfo | null; meta: StockSeriesMeta | null; error: string | null }> {
  const now = Date.now();
  const cached = extraCache.get(code);
  if (cached && now - cached.at < EXTRA_TTL_MS) return { info: cached.info, meta: cached.meta, error: null };
  const failed = extraErrors.get(code);
  if (failed && now - failed.at < EXTRA_ERROR_TTL_MS) return { info: null, meta: null, error: failed.error };
  let task = extraInflight.get(code);
  if (!task) {
    task = fetchStockKlineFull(code).finally(() => extraInflight.delete(code));
    extraInflight.set(code, task);
  }
  try {
    const data = await task;
    const info: StockInfo = {
      code,
      name: data.name,
      sector: EXTRA_SECTOR,
      secid: stockSecid(code),
      from: data.rows[0][0],
      to: data.rows[data.rows.length - 1][0],
      rows: data.rows.length,
    };
    const meta: StockSeriesMeta = { code, name: data.name, sector: EXTRA_SECTOR, secid: info.secid, rows: data.rows };
    extraCache.set(code, { at: Date.now(), info, meta });
    extraErrors.delete(code);
    return { info, meta, error: null };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 120);
    extraErrors.set(code, { at: Date.now(), error: msg });
    return { info: null, meta: null, error: msg };
  }
}

export interface ExtraStockResolution {
  infos: StockInfo[];
  stocks: Record<string, StockSeriesMeta>;
  errors: Record<string, string>;
  status: SourceStatus;
}

/** 解析并加载手动添加的个股；失败只影响该代码，不阻塞基础观察清单 */
export async function resolveExtraStocks(codes: string[]): Promise<ExtraStockResolution> {
  const unique = [...new Set(codes.filter(isSupportedStockCode))];
  const loaded = await Promise.all(unique.map(loadExtraStock));
  const infos: StockInfo[] = [];
  const stocks: Record<string, StockSeriesMeta> = {};
  const errors: Record<string, string> = {};
  unique.forEach((code, i) => {
    const r = loaded[i];
    if (r.info && r.meta) {
      infos.push(r.info);
      stocks[code] = r.meta;
    } else {
      errors[code] = r.error ?? "加载失败";
      infos.push({ code, name: code, sector: EXTRA_SECTOR, secid: stockSecid(code), from: "", to: "", rows: 0 });
    }
  });
  const ok = Object.keys(stocks).length;
  return {
    infos,
    stocks,
    errors,
    status: {
      id: "stock_extra",
      label: "手动添加个股（东方财富 / 腾讯按需抓取）",
      kind: "price",
      mode: "live",
      ok: ok === unique.length,
      note: `${ok}/${unique.length} 只已加载，内存缓存 10 分钟；不写入服务端、不修改快照`,
    },
  };
}

/** 数据集里最新的交易日：基础个股票与 KOSPI 的最新日期取最大值 */
function latestTradeDate(ds: StockDataset): string | null {
  let max: string | null = null;
  for (const s of Object.values(ds.stocks)) {
    const last = s.rows[s.rows.length - 1];
    if (last && (!max || last[0] > max)) max = last[0];
  }
  const lastK = ds.kospi[ds.kospi.length - 1];
  if (lastK && (!max || lastK[0] > max)) max = lastK[0];
  return max;
}

/** 用实时报价把自选股补到最新交易日，避免日线源滞后一天导致 KOSPI 联动读数与卡片不一致 */
async function overlayExtraQuotes(resolved: ExtraStockResolution, base: StockDataset): Promise<void> {
  const codes = Object.keys(resolved.stocks);
  if (!codes.length) return;
  const tradeDate = latestTradeDate(base);
  if (!tradeDate) return;
  try {
    const quotes = await fetchStockQuotes(codes.map(stockSecid));
    for (const code of codes) {
      const price = quotes.get(code);
      if (!price) continue;
      const rows = resolved.stocks[code].rows;
      const last = rows[rows.length - 1];
      if (last && last[0] === tradeDate) last[1] = price;
      else if (!last || last[0] < tradeDate) rows.push([tradeDate, price]);
    }
  } catch {
    // 实时报价失败时保留日线源的最新收盘价，不阻塞自选股诊断
  }
}

/** 基础观察清单 + 本次请求手动添加的个股（按需抓取，缓存 10 分钟） */
export async function getStockDataset(opts: { refresh?: boolean; extras?: string[] } = {}): Promise<StockDataset> {
  const base = await getBaseStockDataset({ refresh: opts.refresh === true });
  const extras = [...new Set(opts.extras ?? [])].filter((c) => isSupportedStockCode(c) && !base.stocks[c]);
  if (!extras.length) return base;
  const resolved = await resolveExtraStocks(extras);
  if (opts.refresh === true) await overlayExtraQuotes(resolved, base);
  return {
    ...base,
    stocks: { ...base.stocks, ...resolved.stocks },
    statuses: [...base.statuses, resolved.status],
    extraInfos: resolved.infos,
    extraErrors: Object.keys(resolved.errors).length ? resolved.errors : undefined,
    updatedAt: Date.now(),
  };
}

// ---------------- 红利策略数据层（国企高分红股，周线） ----------------

export interface DividendStockSeries {
  code: string;
  name: string;
  sector: string;
  secid: string;
  note: string;
  weekly: Row[];
  dividends: DividendRecordData[];
}

export interface DividendInfo {
  code: string;
  name: string;
  sector: string;
  secid: string;
  note: string;
  from: string;
  to: string;
  rows: number;
  groups: DividendGroupTag[];
}

export interface DividendDataset {
  stocks: Record<string, DividendStockSeries>;
  statuses: SourceStatus[];
  updatedAt: number;
  asOf: string | null;
  extraInfos?: DividendInfo[];
  extraErrors?: Record<string, string>;
}

const DIVIDEND_LIVE_TTL_MS = 5 * 60 * 1000;
const DIVIDEND_SNAP_TTL_MS = 10 * 60 * 1000;
const DIVIDEND_EXTRA_TTL_MS = 10 * 60 * 1000;
const DIVIDEND_EXTRA_ERROR_TTL_MS = 60 * 1000;
const DIVIDEND_EXTRA_NOTE = "手动添加：东方财富不复权日线（失败回退腾讯）+ 东方财富分红明细（税前）";
let dividendLiveCache: { data: DividendDataset; at: number } | null = null;
let dividendSnapCache: { data: DividendDataset; at: number } | null = null;
let dividendInflight: Promise<DividendDataset> | null = null;

function snapshotDividendStocks(): Record<string, DividendStockSeries> {
  const out: Record<string, DividendStockSeries> = {};
  for (const s of dividendSnapshot.stocks) {
    out[s.code] = {
      code: s.code,
      name: s.name,
      sector: s.sector,
      secid: s.secid,
      note: s.note,
      weekly: s.weekly.map((r) => [r[0], r[1]] as Row),
      dividends: s.dividends.map((r) => ({ ...r })),
    };
  }
  return out;
}

function dividendAsOf(stocks: Record<string, DividendStockSeries>): string | null {
  let max: string | null = null;
  for (const s of Object.values(stocks)) {
    const last = s.weekly[s.weekly.length - 1];
    if (last && (!max || last[0] > max)) max = last[0];
  }
  return max;
}

function weekKeyOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** 用批量报价覆盖本周最新一根周线；不修改导入的快照数组，避免污染 refresh=0 的结果 */
async function overlayDividendQuotes(
  stocks: Record<string, DividendStockSeries>,
  statuses: SourceStatus[],
): Promise<void> {
  try {
    const quotes = await fetchStockQuoteDetails(Object.values(stocks).map((s) => s.secid));
    let updated = 0;
    let latest: string | null = null;
    for (const [code, entry] of Object.entries(stocks)) {
      const q = quotes.get(code);
      if (!q) continue;
      const last = entry.weekly[entry.weekly.length - 1];
      const date = q.quoteDate ?? (last ? last[0] : null);
      if (!date) continue;
      if (last && weekKeyOf(last[0]) === weekKeyOf(date)) {
        if (date > last[0]) last[0] = date;
        last[1] = q.price;
        updated++;
      } else if (!last || date > last[0]) {
        entry.weekly.push([date, q.price]);
        updated++;
      }
      if (!latest || date > latest) latest = date;
    }
    statuses.push({
      id: "dividend_quotes",
      label: "红利股实时报价（东方财富批量行情）",
      kind: "price",
      mode: "live",
      ok: updated > 0,
      note:
        updated > 0
          ? `${updated} 只更新至 ${latest}；本周 K 线可能尚未收盘，盘中价格会变动`
          : "未取到可用报价，使用周线快照",
      rows: updated,
    });
  } catch (err) {
    statuses.push({
      id: "dividend_quotes",
      label: "红利股实时报价（东方财富批量行情）",
      kind: "price",
      mode: "snapshot",
      ok: false,
      note: "实时报价失败，使用周线快照：" + String((err as Error)?.message ?? err).slice(0, 80),
    });
  }
}

async function buildDividendDataset(refresh: boolean): Promise<DividendDataset> {
  const stocks = snapshotDividendStocks();
  const statuses: SourceStatus[] = [];
  const count = Object.keys(stocks).length;
  if (!refresh) {
    statuses.push({
      id: "dividend_snapshot",
      label: "红利股周线与分红快照",
      kind: "price",
      mode: "snapshot",
      ok: count > 0,
      note: `${count} 只（生成于 ${dividendSnapshot.generatedAt.slice(0, 10)}）；不复权周线 + 税前分红`,
    });
    return { stocks, statuses, updatedAt: Date.now(), asOf: dividendAsOf(stocks) };
  }
  await overlayDividendQuotes(stocks, statuses);
  statuses.push({
    id: "dividend_snapshot",
    label: "红利股周线与分红快照",
    kind: "price",
    mode: "snapshot",
    ok: count > 0,
    note: `${count} 只（生成于 ${dividendSnapshot.generatedAt.slice(0, 10)}）；不复权周线 + 税前分红`,
  });
  return { stocks, statuses, updatedAt: Date.now(), asOf: dividendAsOf(stocks) };
}

async function getBaseDividendDataset(refresh: boolean): Promise<DividendDataset> {
  const now = Date.now();
  if (dividendLiveCache && now - dividendLiveCache.at < DIVIDEND_LIVE_TTL_MS) return dividendLiveCache.data;
  if (!refresh) {
    if (dividendSnapCache && now - dividendSnapCache.at < DIVIDEND_SNAP_TTL_MS) return dividendSnapCache.data;
    const built = buildDividendDataset(false).then((d) => {
      dividendSnapCache = { data: d, at: d.updatedAt };
      return d;
    });
    return built;
  }
  if (dividendInflight) return dividendInflight;
  dividendInflight = buildDividendDataset(true)
    .then((d) => {
      dividendLiveCache = { data: d, at: d.updatedAt };
      return d;
    })
    .finally(() => {
      dividendInflight = null;
    });
  return dividendInflight;
}

// ---------------- 手动添加的红利股（GET 参数触发，按需抓取，不写入快照） ----------------

interface DividendExtraData {
  name: string;
  weekly: Row[];
  dividends: DividendRecordData[];
}

interface DividendExtraEntry {
  at: number;
  entry: DividendStockSeries;
  info: DividendInfo;
}

const dividendExtraCache = new Map<string, DividendExtraEntry>();
const dividendExtraErrors = new Map<string, { at: number; error: string }>();
const dividendExtraInflight = new Map<string, Promise<DividendExtraData>>();

/** 东方财富不复权日线（fqt=0，2015 起）；红利股息率必须与不复权价格同口径 */
async function fetchEastmoneyDividendDaily(code: string): Promise<{ name: string; rows: Row[] }> {
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" +
    encodeURIComponent(stockSecid(code)) +
    "&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=" +
    EXTRA_BEG +
    "&end=20500101";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error("东方财富 HTTP " + res.status);
  const json: unknown = await res.json();
  const data = (json as { data?: { name?: string; klines?: string[] } })?.data;
  const klines = data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error("该代码没有不复权日线数据（可能不存在、已退市或不属于沪深 A 股）");
  }
  const rows: Row[] = [];
  for (const line of klines) {
    const p = line.split(",");
    const value = Number(p[2]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p[0]) && Number.isFinite(value) && value > 0) rows.push([p[0], value]);
  }
  if (rows.length < 30) throw new Error("日线样本不足 30 条，无法计算红利指标");
  const name = typeof data?.name === "string" && data.name.trim() ? data.name.trim() : code;
  return { name, rows };
}

/** 腾讯不复权日线（kline/kline，单页上限 640 条，按最早日期向前翻页补全 2015 起） */
async function fetchTencentDividendDaily(code: string): Promise<{ name: string; rows: Row[] }> {
  const symbol = tencentSymbol(code);
  const byDate = new Map<string, number>();
  let name = "";
  let end = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  for (let page = 0; page < 5; page++) {
    const url =
      "https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=" +
      encodeURIComponent(`${symbol},day,2015-01-01,${end},640`);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("腾讯行情 HTTP " + res.status);
    const json = (await res.json()) as {
      data?: Record<string, { day?: string[][]; qt?: Record<string, string[]> }>;
    };
    const block = json.data?.[symbol];
    const list = block?.day;
    if (!name) {
      const qt = block?.qt?.[symbol]?.[1];
      if (typeof qt === "string" && qt.trim()) name = qt.trim();
    }
    if (!Array.isArray(list) || list.length === 0) {
      if (page === 0) throw new Error("该代码没有日线数据（可能不存在、已退市或不属于沪深 A 股）");
      break;
    }
    let earliest = "";
    for (const p of list) {
      const date = String(p?.[0] ?? "");
      const value = Number(p?.[2]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) {
        byDate.set(date, value);
        if (!earliest || date < earliest) earliest = date;
      }
    }
    if (!earliest || earliest <= "2015-01-05") break;
    const next = dateMinusOneDay(earliest);
    if (next >= end) break;
    end = next;
  }
  const rows: Row[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => [date, value] as Row);
  if (rows.length < 30) throw new Error("日线样本不足 30 条，无法计算红利指标");
  return { name: name || code, rows };
}

/** 东方财富分红明细（税前每 10 股派息），按除息日升序；无记录时返回空数组 */
async function fetchDividendRecords(code: string): Promise<DividendRecordData[]> {
  const url =
    "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=ALL&filter=" +
    encodeURIComponent(`(SECURITY_CODE="${code}")`) +
    "&pageNumber=1&pageSize=200&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1&source=WEB&client=WEB";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error("东方财富分红 HTTP " + res.status);
      const json = (await res.json()) as {
        success?: boolean;
        message?: string;
        result?: { data?: unknown[] } | null;
      };
      if (json.success === false) {
        const message = json.message || "东方财富分红接口拒绝请求";
        // 东财对「该代码没有任何分红记录」返回 success:false + 返回数据为空，按空记录处理而非抓取失败
        if (/返回数据为空|暂无数据|没有找到|无数据/.test(message)) return [];
        throw new Error(message);
      }
      if (!json.result) return [];
      const list = json.result.data;
      if (!Array.isArray(list)) return [];
      return list
        .map((raw) => {
          const r = (raw ?? {}) as Record<string, unknown>;
          const exDate = String(r.EX_DIVIDEND_DATE ?? "").slice(0, 10);
          const dps = Number(r.PRETAX_BONUS_RMB) / 10;
          return {
            exDate,
            dps: Math.round(dps * 10000) / 10000,
            plan: String(r.IMPL_PLAN_PROFILE ?? ""),
            reportDate: String(r.REPORT_DATE ?? "").slice(0, 10),
            progress: String(r.ASSIGN_PROGRESS ?? ""),
          };
        })
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.exDate) && Number.isFinite(r.dps) && r.dps > 0)
        .sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error("分红明细抓取失败：" + String((lastErr as Error)?.message ?? lastErr).slice(0, 80));
}

/** 日线 → 周线：按周一归组，保留每周最后一个交易日的日期与收盘价 */
function weeklyFromDaily(rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const [date, close] of rows) {
    const key = weekKeyOf(date);
    const prev = map.get(key);
    if (!prev || date > prev[0]) map.set(key, [date, close]);
  }
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

async function fetchDividendDaily(code: string): Promise<{ name: string; rows: Row[]; fallback: boolean }> {
  try {
    const primary = await fetchEastmoneyDividendDaily(code);
    return { ...primary, fallback: false };
  } catch (primary) {
    try {
      const fallback = await fetchTencentDividendDaily(code);
      return { ...fallback, fallback: true };
    } catch (err) {
      const a = String((primary as Error)?.message ?? primary).slice(0, 80);
      const b = String((err as Error)?.message ?? err).slice(0, 80);
      throw new Error(`东方财富：${a}；腾讯：${b}`);
    }
  }
}

async function loadExtraDividendStock(
  code: string,
): Promise<{ entry: DividendStockSeries | null; info: DividendInfo | null; error: string | null }> {
  const now = Date.now();
  const cached = dividendExtraCache.get(code);
  if (cached && now - cached.at < DIVIDEND_EXTRA_TTL_MS) return { entry: cached.entry, info: cached.info, error: null };
  const failed = dividendExtraErrors.get(code);
  if (failed && now - failed.at < DIVIDEND_EXTRA_ERROR_TTL_MS) return { entry: null, info: null, error: failed.error };
  let task = dividendExtraInflight.get(code);
  if (!task) {
    task = (async () => {
      const [daily, dividends] = await Promise.all([fetchDividendDaily(code), fetchDividendRecords(code)]);
      const weekly = weeklyFromDaily(daily.rows);
      if (weekly.length < 60) throw new Error(`周线样本不足 60 条（仅 ${weekly.length} 条），无法计算红利指标`);
      return { name: daily.name, weekly, dividends };
    })().finally(() => dividendExtraInflight.delete(code));
    dividendExtraInflight.set(code, task);
  }
  try {
    const data = await task;
    const secid = stockSecid(code);
    const note = data.dividends.length
      ? DIVIDEND_EXTRA_NOTE
      : "手动添加：未取到公开分红记录，股息率维度为「暂无」，仅按价格与周线规则评估";
    const entry: DividendStockSeries = {
      code,
      name: data.name || code,
      sector: EXTRA_SECTOR,
      secid,
      note,
      weekly: data.weekly,
      dividends: data.dividends,
    };
    const info: DividendInfo = {
      code,
      name: entry.name,
      sector: entry.sector,
      secid,
      note,
      from: data.weekly[0][0],
      to: data.weekly[data.weekly.length - 1][0],
      rows: data.weekly.length,
      groups: [],
    };
    dividendExtraCache.set(code, { at: Date.now(), entry, info });
    dividendExtraErrors.delete(code);
    return { entry, info, error: null };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 160);
    dividendExtraErrors.set(code, { at: Date.now(), error: msg });
    return { entry: null, info: null, error: msg };
  }
}

export interface ExtraDividendResolution {
  infos: DividendInfo[];
  stocks: Record<string, DividendStockSeries>;
  errors: Record<string, string>;
  status: SourceStatus;
}

/** 解析并加载手动添加的红利股；失败只影响该代码，不阻塞基础清单 */
export async function resolveExtraDividendStocks(codes: string[]): Promise<ExtraDividendResolution> {
  const unique = [...new Set(codes.filter(isSupportedStockCode))];
  const loaded = await Promise.all(unique.map(loadExtraDividendStock));
  const infos: DividendInfo[] = [];
  const stocks: Record<string, DividendStockSeries> = {};
  const errors: Record<string, string> = {};
  unique.forEach((code, i) => {
    const r = loaded[i];
    if (r.entry && r.info) {
      infos.push(r.info);
      stocks[code] = r.entry;
    } else {
      errors[code] = r.error ?? "加载失败";
    }
  });
  const ok = Object.keys(stocks).length;
  return {
    infos,
    stocks,
    errors,
    status: {
      id: "dividend_extra",
      label: "手动添加红利股（东方财富 / 腾讯按需抓取）",
      kind: "price",
      mode: "live",
      ok: ok === unique.length,
      note: `${ok}/${unique.length} 只已加载，内存缓存 10 分钟；不写入快照、不保存自选列表`,
    },
  };
}

/** 基础红利清单 + 本次请求手动添加的个股（按需抓取，缓存 10 分钟） */
export async function getDividendDataset(opts: { refresh?: boolean; extras?: string[] } = {}): Promise<DividendDataset> {
  const base = await getBaseDividendDataset(opts.refresh === true);
  const extras = [...new Set(opts.extras ?? [])].filter((c) => isSupportedStockCode(c) && !base.stocks[c]);
  if (!extras.length) return base;
  const resolved = await resolveExtraDividendStocks(extras);
  const stocks = { ...base.stocks, ...resolved.stocks };
  return {
    ...base,
    stocks,
    statuses: [...base.statuses, resolved.status],
    asOf: dividendAsOf(stocks),
    updatedAt: Date.now(),
    extraInfos: resolved.infos,
    extraErrors: Object.keys(resolved.errors).length ? resolved.errors : undefined,
  };
}

const DIVIDEND_GROUPS_BY_CODE = new Map(DIVIDEND_WATCHLIST.map((s) => [s.code, s.groups]));

export function dividendInfos(): DividendInfo[] {
  return dividendSnapshot.stocks.map((s) => ({
    code: s.code,
    name: s.name,
    sector: s.sector,
    secid: s.secid,
    note: s.note,
    from: s.weekly[0][0],
    to: s.weekly[s.weekly.length - 1][0],
    rows: s.weekly.length,
    groups: DIVIDEND_GROUPS_BY_CODE.get(s.code) ?? [],
  }));
}

export function dividendMeta() {
  return {
    source: dividendSnapshot.source,
    generatedAt: dividendSnapshot.generatedAt,
    window: dividendSnapshot.window,
  };
}
