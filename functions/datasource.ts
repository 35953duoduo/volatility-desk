// 数据源层：本地真实快照 + 运行时实时上游刷新（含缓存与降级状态上报）
import { snapshot, type SnapshotData } from "./data/snapshot.ts";
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

const IMPLIED_SOURCE_SETS: Record<"VIX" | "VXN", { id: string; label: string; url: string; kind: "cboe" | "yahoo" }[]> = {
  VXN: [
    {
      id: "cboe_csv",
      label: "CBOE VXN_History.csv",
      url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv",
      kind: "cboe",
    },
    {
      id: "cboe_alt",
      label: "CBOE VXN（备用域名）",
      url: "https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv",
      kind: "cboe",
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
      label: "CBOE VIX_History.csv",
      url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
      kind: "cboe",
    },
    {
      id: "cboe_vix_alt",
      label: "CBOE VIX（备用域名）",
      url: "https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
      kind: "cboe",
    },
    {
      id: "yahoo_vix",
      label: "Yahoo Finance ^VIX",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=15y&interval=1d",
      kind: "yahoo",
    },
  ],
};

function parseCboeCsv(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const value = Number(p[2]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p[0]) && Number.isFinite(value) && value > 0) rows.push([p[0], value]);
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
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        const rows = src.kind === "cboe" ? parseCboeCsv(text) : parseYahooChart(text);
        if (!rows.length) throw new Error("未识别到数据行");
        return { src, rows, note: "实时上游" } as const;
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
        source: { id: a.src.id, label: a.src.label, kind: "implied_vol", mode: "live", ok: true, note: a.note, rows: a.rows.length },
      };
    }
    failures.push(`${a.src.id}=${a.note}`);
  }
  lastImpliedErrors[name] = failures.join("，").slice(0, 160);
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
  const liveExtra = new Map<string, Row[]>();
  const liveVxn = new Map<string, number>();
  const liveVix = new Map<string, number>();

  if (refresh) {
    // 隐含波动率（VXN、VIX）与价格增量并行请求，单路超时 3.5s，整体最坏约 4s
    const [vxnImplied, vixImplied, ...priceResults] = await Promise.all([
      fetchImpliedVol("VXN"),
      fetchImpliedVol("VIX"),
      ...SYMBOLS.map((cfg) =>
        fetchEastmoney(cfg.secid, LIVE_BEG)
          .then((rows) => ({ cfg, rows, err: null as Error | null }))
          .catch((err: unknown) => ({ cfg, rows: null as Row[] | null, err: err as Error })),
      ),
    ]);

    if (vxnImplied) {
      for (const [d, v] of vxnImplied.rows) liveVxn.set(d, v);
      vxnRows = mergeRows(vxnRows ?? [], vxnImplied.rows);
      statuses.push(vxnImplied.source);
    } else {
      statuses.push({
        id: "implied_vol",
        label: "VXN 隐含波动率（CBOE / Yahoo 上游）",
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
        label: "VIX 恐慌指数（CBOE / Yahoo 上游）",
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

/** 东方财富批量行情：一次请求取全部个股的最新价（fltt=2 时 f2 为两位小数价格） */
async function fetchStockQuotes(secids: string[]): Promise<Map<string, number>> {
  const url =
    "https://push2.eastmoney.com/api/qt/ulist.np/get?secids=" +
    secids.map(encodeURIComponent).join(",") +
    "&fields=f2,f12,f14&fltt=2";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com/" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json: unknown = await res.json();
  const diff = (json as { data?: { diff?: { f12?: string; f2?: number }[] } })?.data?.diff;
  if (!Array.isArray(diff) || diff.length === 0) throw new Error("empty quotes");
  const map = new Map<string, number>();
  for (const d of diff) {
    const code = String(d.f12 ?? "");
    const price = Number(d.f2);
    if (/^\d{6}$/.test(code) && Number.isFinite(price) && price > 0) map.set(code, price);
  }
  if (!map.size) throw new Error("no parsable quotes");
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
