// 美股巴菲特指数（市值 / GDP）：分子为美联储 Z.1 非金融企业股权市值，分母为美国名义 GDP，均为 FRED 季度序列。
// FRED 的 Wilshire 5000 全市场系列已下架（404），因此本板块是 Z.1 口径的变体，不能与 Wilshire/GDP 的历史水平直接比较。
// 快照为真实季度数据，运行时用同一公开上游增量刷新；失败时保留快照并显式标注降级。
import type { Row } from "./analytics.ts";
import { valuationSnapshot } from "./data/valuationSnapshot.ts";
import { getDataset } from "./datasource.ts";

export const VALUATION_YEARS_ALLOWED = [1, 3, 5, 10, 20];

interface SnapshotSeries {
  id: string;
  label: string;
  unit: string;
  note: string;
  rows: readonly (readonly [string, number])[];
}

interface SnapshotShape {
  generatedAt: string;
  source: string;
  window: { from: string; to: string };
  cap: SnapshotSeries;
  gdp: SnapshotSeries;
  sources: { id: string; label: string; url: string; fetchedAt: string; rows: number }[];
}

const SNAP = valuationSnapshot as unknown as SnapshotShape;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LIVE_TTL_MS = 30 * 60 * 1000;
const SNAP_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface ValuationSourceStatus {
  id: string;
  label: string;
  kind: "valuation" | "price";
  mode: "live" | "snapshot";
  ok: boolean;
  note: string;
  rows?: number;
}

interface Base {
  cap: Row[];
  gdp: Row[];
  statuses: ValuationSourceStatus[];
  updatedAt: number;
}

let liveCache: { data: Base; at: number } | null = null;
let snapCache: { data: Base; at: number } | null = null;
let liveInflight: Promise<Base> | null = null;

export function valuationSnapshotMeta() {
  return {
    generatedAt: SNAP.generatedAt,
    source: SNAP.source,
    window: SNAP.window,
    capRows: SNAP.cap.rows.length,
    gdpRows: SNAP.gdp.rows.length,
    sources: SNAP.sources,
  };
}

function toRows(rows: readonly (readonly [string, number])[]): Row[] {
  return rows.map(([d, v]) => [d, v] as Row);
}

const SNAP_CAP = toRows(SNAP.cap.rows);
const SNAP_GDP = toRows(SNAP.gdp.rows);

function mergeRows(base: Row[], extra: Row[] | null): Row[] {
  if (!extra || !extra.length) return base;
  const map = new Map<string, number>();
  for (const [d, v] of base) map.set(d, v);
  for (const [d, v] of extra) map.set(d, v);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, v] as Row);
}

async function fetchFred(id: string): Promise<Row[]> {
  const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id, {
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
  if (rows.length < 40) throw new Error("有效季度不足：" + rows.length);
  return rows;
}

function snapshotStatuses(): ValuationSourceStatus[] {
  return [
    {
      id: "fred_market_cap",
      label: "FRED NCBEILQ027S 非金融企业股权市值",
      kind: "valuation",
      mode: "snapshot",
      ok: true,
      note: `本地真实快照，生成于 ${SNAP.generatedAt.slice(0, 10)}；${SNAP_CAP.length} 个季度，最新 ${SNAP_CAP[SNAP_CAP.length - 1][0]}`,
      rows: SNAP_CAP.length,
    },
    {
      id: "fred_gdp",
      label: "FRED GDP 美国名义 GDP",
      kind: "valuation",
      mode: "snapshot",
      ok: true,
      note: `本地真实快照，生成于 ${SNAP.generatedAt.slice(0, 10)}；${SNAP_GDP.length} 个季度，最新 ${SNAP_GDP[SNAP_GDP.length - 1][0]}`,
      rows: SNAP_GDP.length,
    },
  ];
}

function buildSnapshotBase(): Base {
  return { cap: SNAP_CAP, gdp: SNAP_GDP, statuses: snapshotStatuses(), updatedAt: Date.now() };
}

async function buildLiveBase(): Promise<Base> {
  const [capRes, gdpRes] = await Promise.all([
    fetchFred("NCBEILQ027S").then((rows) => ({ rows, err: null as string | null })).catch((e: unknown) => ({ rows: null as Row[] | null, err: String(e instanceof Error ? e.message : e).slice(0, 80) })),
    fetchFred("GDP").then((rows) => ({ rows, err: null as string | null })).catch((e: unknown) => ({ rows: null as Row[] | null, err: String(e instanceof Error ? e.message : e).slice(0, 80) })),
  ]);
  const cap = capRes.rows ? mergeRows(SNAP_CAP, capRes.rows) : SNAP_CAP;
  const gdp = gdpRes.rows ? mergeRows(SNAP_GDP, gdpRes.rows) : SNAP_GDP;
  const statuses: ValuationSourceStatus[] = [
    {
      id: "fred_market_cap",
      label: "FRED NCBEILQ027S 非金融企业股权市值",
      kind: "valuation",
      mode: capRes.rows ? "live" : "snapshot",
      ok: Boolean(capRes.rows),
      note: capRes.rows ? `实时刷新成功，共 ${cap.length} 个季度，最新 ${cap[cap.length - 1][0]}` : `刷新失败，保留本地快照：${capRes.err ?? "未知错误"}`,
      rows: cap.length,
    },
    {
      id: "fred_gdp",
      label: "FRED GDP 美国名义 GDP",
      kind: "valuation",
      mode: gdpRes.rows ? "live" : "snapshot",
      ok: Boolean(gdpRes.rows),
      note: gdpRes.rows ? `实时刷新成功，共 ${gdp.length} 个季度，最新 ${gdp[gdp.length - 1][0]}` : `刷新失败，保留本地快照：${gdpRes.err ?? "未知错误"}`,
      rows: gdp.length,
    },
  ];
  return { cap, gdp, statuses, updatedAt: Date.now() };
}

async function loadBase(refresh: boolean): Promise<Base> {
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

export interface QuarterPoint {
  /** 季度起始日（FRED 观测日期，如 2026-04-01 代表 2026Q2） */
  date: string;
  /** 股权市值（百万美元） */
  cap: number;
  /** 名义 GDP（十亿美元，年化） */
  gdp: number;
  /** 市值 / GDP × 100（%） */
  ratio: number;
}

export function buildQuarters(cap: Row[], gdp: Row[]): QuarterPoint[] {
  const gdpMap = new Map(gdp.map(([d, v]) => [d, v]));
  const out: QuarterPoint[] = [];
  for (const [date, capValue] of cap) {
    const gdpValue = gdpMap.get(date);
    if (gdpValue === undefined || gdpValue <= 0 || capValue <= 0) continue;
    out.push({ date, cap: capValue, gdp: gdpValue, ratio: Math.round(((capValue / 1000 / gdpValue) * 100 + Number.EPSILON) * 100) / 100 });
  }
  return out;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return round(v, 2);
}

function percentileOf(value: number, values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length || !Number.isFinite(value)) return null;
  let below = 0;
  for (const v of valid) if (v <= value) below += 1;
  return round((below / valid.length) * 100, 1);
}

export interface ValuationStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

function statsOf(values: number[]): ValuationStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted.length ? round(sorted[0], 2) : null,
    max: sorted.length ? round(sorted[sorted.length - 1], 2) : null,
    mean: sorted.length ? round(sorted.reduce((a, b) => a + b, 0) / sorted.length, 2) : null,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  };
}

export interface ValuationChartPoint {
  date: string;
  ratio: number;
  /** 标普500季度末收盘，窗口内首个有值季度 = 100；该季度之前为 null */
  spx: number | null;
}

export interface ValuationPayload {
  asOf: string;
  window: { from: string; to: string; years: number | null; quarters: number };
  latest: {
    date: string;
    quarter: string;
    ratio: number;
    capTrn: number;
    gdpTrn: number;
    percentileAll: number | null;
    percentile20y: number | null;
    medianAll: number | null;
    median20y: number | null;
    deviationFromMedian: number | null;
    qoqChange: number | null;
    yoyChange: number | null;
    positionLabel: string;
  };
  stats: { all: ValuationStats; recent20y: ValuationStats; window: ValuationStats };
  chart: ValuationChartPoint[];
  spx: { label: string; asOf: string; close: number; quarters: number; note: string } | null;
  sources: ValuationSourceStatus[];
}

export interface ValuationResult {
  payload: ValuationPayload;
  snapshot: { generatedAt: string; source: string; window: { from: string; to: string } };
  live: boolean;
}

function quarterLabel(date: string): string {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `${y}Q${q}`;
}

/** 相对自身历史的统计位置，只是分位描述，不是"高估/低估"的投资结论 */
function positionLabel(pct: number | null): string {
  if (pct === null) return "样本不足";
  if (pct >= 90) return "历史最高分位区（≥90%）";
  if (pct >= 70) return "历史偏高分位区（70–90%）";
  if (pct >= 30) return "历史中间分位区（30–70%）";
  return "历史偏低分位区（<30%）";
}

function windowQuarters(points: QuarterPoint[], years: number | null): QuarterPoint[] {
  if (!years) return points;
  const bars = Math.round(years * 4);
  return points.length > bars ? points.slice(points.length - bars) : points;
}

export async function getValuationAnalysis(opts: { refresh?: boolean; years?: number | null } = {}): Promise<ValuationResult> {
  const refresh = opts.refresh === true;
  const years = opts.years ?? 20;
  const base = await loadBase(refresh);
  const quarters = buildQuarters(base.cap, base.gdp);
  if (quarters.length < 8) throw new Error("市值与 GDP 的共同季度不足，无法计算估值指标");

  // 标普500季度末收盘：复用指数快照与实时增量，只作对照，不参与估值计算
  const ds = await getDataset({ refresh });
  const spxSeries = ds.series.SPX ?? [];
  const spxByQuarter = new Map<string, { date: string; close: number }>();
  for (const p of spxSeries) {
    const key = quarterLabel(p.date);
    const prev = spxByQuarter.get(key);
    if (!prev || p.date > prev.date) spxByQuarter.set(key, { date: p.date, close: p.close });
  }

  const points = windowQuarters(quarters, years);
  const latest = quarters[quarters.length - 1];
  const allRatios = quarters.map((q) => q.ratio);
  const recent20 = allRatios.slice(-80);
  const medianAll = statsOf(allRatios).median;
  const pctAll = percentileOf(latest.ratio, allRatios);
  const prev = quarters[quarters.length - 2];
  const lastYear = quarters[quarters.length - 5];

  const chart: ValuationChartPoint[] = [];
  let spxBase: number | null = null;
  let spxQuarters = 0;
  for (const q of points) {
    const spxPoint = spxByQuarter.get(quarterLabel(q.date));
    let spxNorm: number | null = null;
    if (spxPoint) {
      if (spxBase === null) spxBase = spxPoint.close;
      spxNorm = round((spxPoint.close / spxBase) * 100, 2);
      spxQuarters += 1;
    }
    chart.push({ date: q.date, ratio: q.ratio, spx: spxNorm });
  }

  const spxLast = spxSeries[spxSeries.length - 1];
  const payload: ValuationPayload = {
    asOf: latest.date,
    window: { from: points[0].date, to: points[points.length - 1].date, years, quarters: points.length },
    latest: {
      date: latest.date,
      quarter: quarterLabel(latest.date),
      ratio: latest.ratio,
      capTrn: round(latest.cap / 1e6, 2) as number,
      gdpTrn: round(latest.gdp / 1000, 2) as number,
      percentileAll: pctAll,
      percentile20y: percentileOf(latest.ratio, recent20),
      medianAll,
      median20y: statsOf(recent20).median,
      deviationFromMedian: medianAll ? round((latest.ratio / medianAll - 1) * 100, 1) : null,
      qoqChange: prev ? round(latest.ratio - prev.ratio, 2) : null,
      yoyChange: lastYear ? round(latest.ratio - lastYear.ratio, 2) : null,
      positionLabel: positionLabel(pctAll),
    },
    stats: { all: statsOf(allRatios), recent20y: statsOf(recent20), window: statsOf(points.map((q) => q.ratio)) },
    chart,
    spx: spxLast
      ? {
          label: "标普500（SPX）",
          asOf: spxLast.date,
          close: round(spxLast.close, 2) as number,
          quarters: spxQuarters,
          note: "季度末收盘价按窗口内首个有值季度 = 100 归一化，仅作走势对照；指数快照自 2015 年起，更早季度为空白。",
        }
      : null,
    sources: base.statuses,
  };

  return {
    payload,
    snapshot: { generatedAt: SNAP.generatedAt, source: SNAP.source, window: SNAP.window },
    live: base.statuses.some((s) => s.mode === "live" && s.ok),
  };
}

/* ===================== AI 上下文 ===================== */

export const VALUATION_LIMITS = [
  "分子是美联储 Z.1「非金融企业股权市值」（NCBEILQ027S），包含非上市公司股权，口径宽于 Wilshire 5000 全市场指数；FRED 的 Wilshire 系列已停止提供，因此本序列不能与媒体常见的 Wilshire/GDP 巴菲特指数直接比较绝对水平或套用其经验阈值。",
  "分子与分母都是季度数据：GDP 已年化且会被后续修订，股权市值为季末水平值，两者都存在发布滞后；最新读数对应的季度可能早于当前日期一到两个季度。",
  "比值 = 市值（百万美元）÷1000 ÷ GDP（十亿美元）×100，得到百分比；市值按负债端口径计量，不等于自由流通市值，也不含共同基金与 ETF 之外的调整。",
  "历史分位只描述当前读数在本序列自身历史中的位置，不是估值模型输出的内在价值，也不构成买卖依据；利率、利润率、海外收入占比与行业结构变化都会改变合理区间。",
  "标普500仅作走势对照，按季度末收盘归一化，指数快照自 2015 年起；价格收益不含股息、费用、税收与汇率因素。",
  "本板块不提供未来收益预测；估值处于高分位不等于立即下跌，低分位也不等于马上上涨。",
];

const VALUATION_DEFINITION = {
  buffettRatio: "非金融企业股权市值 ÷ 名义 GDP ×100（%）。分子单位为百万美元，先 ÷1000 换算为十亿美元再与 GDP 相除。",
  quarter: "FRED 观测日期为季度首日，例如 2026-04-01 代表 2026Q2；只有市值与 GDP 都有值的季度才参与计算。",
  percentile: "当前比值在全部可比季度（1945 年起）与最近 80 个季度（约 20 年）中的历史分位，按小于等于当前值的样本占比计算。",
  deviationFromMedian: "当前比值 ÷ 全样本中位数 − 1，衡量相对长期中枢的偏离幅度；不是预期收益率。",
  qoq_yoy: "QoQ 为与上一共同季度的差值（百分点），YoY 为与 4 个季度前的差值（百分点）。",
  spxNormalized: "标普500季度末收盘价按窗口内首个有值季度 = 100 归一化，与估值比值共用时间轴、使用右轴。",
  positionLabel: "按全样本分位划分的统计描述：≥90% 历史最高分位区、70–90% 偏高、30–70% 中间、<30% 偏低；不是高估或低估的投资结论。",
};

export function valuationDefinition() {
  return VALUATION_DEFINITION;
}

export function valuationAiBundle(result: ValuationResult, refresh: boolean) {
  const p = result.payload;
  return {
    meta: {
      kind: "us-buffett-valuation",
      asOf: p.asOf,
      generatedAt: new Date().toISOString(),
      liveRefresh: refresh,
      snapshot: result.snapshot,
      sources: p.sources,
    },
    subject: {
      name: "美股巴菲特指数（市值 / GDP，Z.1 口径）",
      numerator: "FRED NCBEILQ027S 非金融企业股权市值（季度，百万美元）",
      denominator: "FRED GDP 美国名义 GDP（季度，十亿美元，年化）",
      window: p.window,
    },
    latest: p.latest,
    stats: p.stats,
    spx: p.spx,
    definition: VALUATION_DEFINITION,
    limits: VALUATION_LIMITS,
    taskForAssistant: {
      role: "你是美股长期估值研究员。请仅依据以上真实季度数据解读市值/GDP 的位置与含义，不给出具体买卖点位、仓位或收益预测。",
      requiredOutput: [
        "估值位置：引用最新比值、对应季度、全样本与近 20 年分位、中位数偏离，说明它在本序列历史中的位置",
        "口径提醒：解释 Z.1 非金融企业股权口径与 Wilshire/GDP 的差异，以及为什么不能套用常见的 100%/120% 经验阈值",
        "驱动因素：从利率水平、利润率、海外收入、行业结构与 GDP 修订角度解释比值变化，不得编造未提供的宏观数值",
        "与标普500的关系：说明估值与指数走势可以长期背离，估值不是短期择时工具",
        "情景与风险：给出估值继续扩张、均值回归、长期高位横盘三种情景各自需要的条件与可观察信号",
        "观察清单：列出 3–5 个可核验的后续指标（如下一季度 NCBEILQ027S、GDP 修订、利率与利润率），注明数据频率",
        "数据缺口：指出季度滞后、口径差异、缺少利率与利润率序列带来的限制，并说明对结论的影响",
        "结论边界：明确本分析不构成投资建议、不预测收益或点位，并给出失效条件",
      ],
      guardrails: [
        "不得编造行情、宏观数据、政策或机构观点；只能引用上下文中的数值",
        "不得给出具体买卖点位、仓位比例、收益承诺或本金安全保证",
        "高估值分位不等于即将下跌，低分位不等于马上上涨；不得把历史分位外推为确定预测",
        "数据缺失、降级或口径偏差必须显式说明，并据此降低置信度",
      ],
    },
    api: {
      buffett: "/functions/v1/app/api/valuation/buffett?years=" + (p.window.years ?? "all"),
      aiContext: "/functions/v1/app/api/valuation/ai-context?years=" + (p.window.years ?? "all") + "&format=markdown",
    },
  };
}

export function valuationMarkdown(result: ValuationResult): string {
  const p = result.payload;
  const l = p.latest;
  const lines: string[] = [];
  const f = (v: number | null, digits = 2, suffix = "") => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`);
  lines.push("# 美股巴菲特指数上下文（市值 / GDP，Z.1 口径）");
  lines.push(`数据季度 ${l.quarter}（观测日 ${l.date}）｜窗口 ${p.window.from} → ${p.window.to}（${p.window.quarters} 个季度）｜生成时间 ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 一、最新读数");
  lines.push(`- 市值 / GDP：${l.ratio.toFixed(2)}%（${l.quarter}）`);
  lines.push(`- 分子：非金融企业股权市值 ${l.capTrn.toFixed(2)} 万亿美元；分母：名义 GDP ${l.gdpTrn.toFixed(2)} 万亿美元（年化）`);
  lines.push(`- 全样本分位：${l.percentileAll === null ? "—" : l.percentileAll.toFixed(1) + "%"}｜近 20 年分位：${l.percentile20y === null ? "—" : l.percentile20y.toFixed(1) + "%"}｜位置：${l.positionLabel}`);
  lines.push(`- 全样本中位数：${l.medianAll ?? "—"}%｜近 20 年中位数：${l.median20y ?? "—"}%｜较全样本中位数偏离：${f(l.deviationFromMedian, 1, "%")}`);
  lines.push(`- 变化：QoQ ${f(l.qoqChange, 2, " 个百分点")}｜YoY ${f(l.yoyChange, 2, " 个百分点")}`);
  lines.push("");
  lines.push("## 二、历史分布");
  for (const [label, s] of [["全样本（1945 年起）", p.stats.all], ["近 20 年", p.stats.recent20y], ["当前窗口", p.stats.window]] as const) {
    lines.push(
      `- ${label}：${s.count} 个季度｜均值 ${s.mean ?? "—"}%｜中位数 ${s.median ?? "—"}%｜P25 ${s.p25 ?? "—"}%｜P75 ${s.p75 ?? "—"}%｜最低 ${s.min ?? "—"}%｜最高 ${s.max ?? "—"}%`,
    );
  }
  lines.push("");
  lines.push("## 三、与标普500对照");
  if (p.spx) {
    lines.push(`- ${p.spx.label} 最新收盘 ${p.spx.close.toFixed(2)}（${p.spx.asOf}）；窗口内 ${p.spx.quarters} 个季度有对照值，按首个有值季度 = 100 归一化。`);
    lines.push(`- ${p.spx.note}`);
  } else {
    lines.push("- 本次请求未取到标普500对照序列。");
  }
  lines.push("- 窗口内最近 12 个季度的比值与归一化指数：");
  for (const c of p.chart.slice(-12)) {
    lines.push(`  - ${quarterLabel(c.date)}：市值/GDP ${c.ratio.toFixed(2)}%，标普500归一化 ${c.spx === null ? "—" : c.spx.toFixed(1)}`);
  }
  lines.push("");
  lines.push("## 四、数据来源与口径");
  for (const s of p.sources) lines.push(`- ${s.label}：${s.ok ? "正常" : "降级"}（${s.mode}）— ${s.note}`);
  for (const l2 of VALUATION_LIMITS) lines.push(`- ${l2}`);
  lines.push("");
  lines.push("## 五、给 AI 的分析任务");
  const bundle = valuationAiBundle(result, false);
  for (const r of bundle.taskForAssistant.requiredOutput) lines.push(`- ${r}`);
  lines.push("约束：");
  for (const g of bundle.taskForAssistant.guardrails) lines.push(`- ${g}`);
  return lines.join("\n");
}
