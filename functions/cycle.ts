// 康波周期 × 三大指数（纳斯达克100 / 标普500 / 上证指数）。
// 康波（Kondratiev wave）是 40–60 年的长波假说，阶段年份划分在研究者之间并不一致；
// 本站不做「当前处于第几波第几年」的断言，只把三指数的可观测状态（趋势、压力、回撤深度、修复）
// 按固定规则映射到繁荣 / 衰退 / 萧条 / 回升四阶段的典型特征，属于启发式对照，不是预测。
// 行情全部来自现有真实快照与同一公开上游的增量刷新，不引入任何估算或虚构数据。
import { getDataset } from "./datasource.ts";
import type { SourceStatus } from "./datasource.ts";

export type CycleIndexKey = "NDX100" | "SPX" | "SSE";
export type CyclePhaseKey = "prosperity" | "recession" | "depression" | "recovery";

export const CYCLE_INDEX_ORDER: CycleIndexKey[] = ["NDX100", "SPX", "SSE"];
export const CYCLE_YEARS_ALLOWED = [1, 3, 5, 10];
const TRADING_DAYS = 252;

export const CYCLE_INDEX_META: Record<CycleIndexKey, { label: string; short: string; market: string; note: string }> = {
  NDX100: { label: "纳斯达克100", short: "纳指100", market: "美股成长", note: "科技股权重高，对利率与盈利预期最敏感，用作美股成长风格的代表。" },
  SPX: { label: "标普500", short: "标普500", market: "美股大盘", note: "美股大盘宽基，用作美国整体权益市场的代表，也是巴菲特指数板块的对照指数。" },
  SSE: { label: "上证指数", short: "上证", market: "A 股", note: "A 股代表指数，与美股存在交易时段、汇率与政策周期差异，对比时不做收益承诺。" },
};

/** 康波四阶段的教科书式特征描述（理论框架，不是实时数据，也不是本站对当前年份的判定） */
export const CYCLE_PHASES: {
  key: CyclePhaseKey;
  label: string;
  english: string;
  growth: string;
  inflation: string;
  rates: string;
  equity: string;
  observable: string;
}[] = [
  {
    key: "prosperity",
    label: "繁荣",
    english: "Prosperity",
    growth: "增长强劲，新技术进入大规模商业化",
    inflation: "通胀温和上行",
    rates: "利率逐步抬升但仍被增长消化",
    equity: "权益趋势向上、回撤较浅、波动受控",
    observable: "本站判据：价格在 200 日线上方、63 日动量为正、距一年高点回撤浅、波动分位不高。",
  },
  {
    key: "recession",
    label: "衰退",
    english: "Recession",
    growth: "增长放缓，过剩产能与债务压力显现",
    inflation: "通胀或利率压力仍在高位",
    rates: "高利率开始压制估值",
    equity: "动量转弱、波动抬升、自高位回落但尚未深度出清",
    observable: "本站判据：动量转负或跌破长期均线、波动分位抬升，回撤已出现但修复特征尚不明显。",
  },
  {
    key: "depression",
    label: "萧条",
    english: "Depression",
    growth: "增长与通胀同步走弱，债务出清",
    inflation: "通缩压力或通胀快速回落",
    rates: "政策转向宽松，利率下行",
    equity: "深度回撤、高波动、长期均线下方筑底",
    observable: "本站判据：距一年高点回撤深（约 12% 以上）、价格位于 200 日线下方、波动分位偏高。",
  },
  {
    key: "recovery",
    label: "回升",
    english: "Recovery",
    growth: "增长自低位修复，新技术重新扩散",
    inflation: "通胀温和",
    rates: "利率处于低位，流动性改善",
    equity: "自深度回撤中修复、动量转正、波动回落",
    observable: "本站判据：距一年高点仍有明显回撤但 63 日动量转正、波动分位回落、逐步收复长期均线。",
  },
];

export interface CycleIndexMetrics {
  key: CycleIndexKey;
  label: string;
  short: string;
  market: string;
  note: string;
  asOf: string;
  close: number;
  dayChangePct: number | null;
  returns: { m1: number | null; m3: number | null; ytd: number | null; y1: number | null; window: number | null };
  cagr3y: number | null;
  vol21: number | null;
  vol63: number | null;
  volPct5y: number | null;
  drawdown1y: number | null;
  maxDrawdown: number | null;
  aboveMa200: boolean | null;
  ma200DistancePct: number | null;
  momentum63: number | null;
}

export interface CyclePhaseScore {
  key: CyclePhaseKey;
  label: string;
  score: number;
}

export interface CyclePhaseView {
  index: CycleIndexKey;
  label: string;
  phase: CyclePhaseKey;
  phaseLabel: string;
  /** 四阶段匹配分（0-100），只表示特征接近程度，不是概率 */
  scores: CyclePhaseScore[];
  /** 最高分与次高分的差值，越小说明阶段越难区分 */
  separation: number;
  drivers: { trend: number; stress: number; deepDrawdown: number; repair: number };
  explanation: string;
}

export interface CycleRatioView {
  pair: string;
  label: string;
  latest: number;
  windowChangePct: number | null;
  y1ChangePct: number | null;
  interpretation: string;
}

export interface CycleChartPoint {
  date: string;
  NDX100: number;
  SPX: number;
  SSE: number;
  ndxSpx: number | null;
  ndxSse: number | null;
}

export interface CycleCorrelation {
  keys: CycleIndexKey[];
  labels: string[];
  windowDays: number;
  matrix: (number | null)[][];
}

export interface CyclePayload {
  asOf: string;
  window: { from: string; to: string; years: number | null; days: number };
  /** 康波四阶段理论文本，由后端统一下发，前端不另存副本 */
  framework: typeof CYCLE_PHASES;
  indices: CycleIndexMetrics[];
  phases: CyclePhaseView[];
  resonance: { key: string; label: string; summary: string };
  ratios: CycleRatioView[];
  correlations: CycleCorrelation;
  corr63: CycleCorrelation;
  chart: CycleChartPoint[];
  chartFreq: "1d" | "1w";
  sources: SourceStatus[];
}

export interface CycleResult {
  payload: CyclePayload;
  live: boolean;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

function pctChange(latest: number, past: number | null | undefined): number | null {
  if (past === undefined || past === null || !Number.isFinite(past) || past <= 0) return null;
  return round((latest / past - 1) * 100, 2);
}

function clamp(value: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, value));
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

function percentileOf(value: number, values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length || !Number.isFinite(value)) return null;
  let below = 0;
  for (const v of valid) if (v <= value) below += 1;
  return round((below / valid.length) * 100, 1);
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

interface Aligned {
  dates: string[];
  closes: Record<CycleIndexKey, number[]>;
  fullCloses: Record<CycleIndexKey, number[]>;
  sources: SourceStatus[];
}

function align(series: Record<string, { date: string; close: number }[]>, sources: SourceStatus[]): Aligned {
  const maps = CYCLE_INDEX_ORDER.map((k) => new Map((series[k] ?? []).map((p) => [p.date, p.close])));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  const closes = {} as Record<CycleIndexKey, number[]>;
  const fullCloses = {} as Record<CycleIndexKey, number[]>;
  CYCLE_INDEX_ORDER.forEach((k, i) => {
    closes[k] = dates.map((d) => maps[i].get(d) as number);
    fullCloses[k] = (series[k] ?? []).map((p) => p.close);
  });
  return { dates, closes, fullCloses, sources };
}

function ytdBaseIndex(dates: string[]): number {
  const latest = dates[dates.length - 1] ?? "";
  const yearStart = latest.slice(0, 4) + "-01-01";
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] < yearStart) return i;
  }
  return -1;
}

function indexMetrics(key: CycleIndexKey, dates: string[], closes: number[], fullCloses: number[], prevClose: number | null): CycleIndexMetrics {
  const n = closes.length;
  const latest = closes[n - 1];
  const ytdIdx = ytdBaseIndex(dates);
  const ytdBase = ytdIdx >= 0 ? closes[ytdIdx] : closes[0];
  const ma200 = n >= 200 ? mean(closes.slice(-200)) : null;
  const volHistory = rollingVol(fullCloses, 21).slice(-5 * TRADING_DAYS);
  const vol21 = annualizedVol(closes, 21);
  const cagrBase = fullCloses.length > 3 * TRADING_DAYS ? fullCloses[fullCloses.length - 1 - 3 * TRADING_DAYS] : null;
  return {
    key,
    label: CYCLE_INDEX_META[key].label,
    short: CYCLE_INDEX_META[key].short,
    market: CYCLE_INDEX_META[key].market,
    note: CYCLE_INDEX_META[key].note,
    asOf: dates[n - 1],
    close: round(latest, 2) as number,
    dayChangePct: prevClose !== null ? pctChange(latest, prevClose) : null,
    returns: {
      m1: n > 21 ? pctChange(latest, closes[n - 22]) : null,
      m3: n > 63 ? pctChange(latest, closes[n - 64]) : null,
      ytd: pctChange(latest, ytdBase),
      y1: n > TRADING_DAYS ? pctChange(latest, closes[n - 1 - TRADING_DAYS]) : null,
      window: pctChange(latest, closes[0]),
    },
    cagr3y: cagrBase ? round((Math.pow(latest / cagrBase, 1 / 3) - 1) * 100, 2) : null,
    vol21,
    vol63: annualizedVol(closes, 63),
    volPct5y: vol21 !== null ? percentileOf(vol21, volHistory) : null,
    drawdown1y: n >= 2 ? round((latest / Math.max(...closes.slice(-TRADING_DAYS)) - 1) * 100, 2) : null,
    maxDrawdown: maxDrawdown(closes),
    aboveMa200: ma200 === null ? null : latest > ma200,
    ma200DistancePct: ma200 === null ? null : round((latest / ma200 - 1) * 100, 2),
    momentum63: n > 63 ? pctChange(latest, closes[n - 64]) : null,
  };
}

/** 把可观测状态映射到康波四阶段特征：全部规则固定、可复算，不做年份断言 */
export function phaseView(m: CycleIndexMetrics): CyclePhaseView {
  const maScore = m.ma200DistancePct === null ? 50 : clamp(50 + m.ma200DistancePct * 2.5);
  const momScore = m.momentum63 === null ? 50 : clamp(50 + (m.momentum63 * 100) / 30);
  const trend = 0.5 * maScore + 0.5 * momScore;
  const ddDepth = Math.max(0, -(m.drawdown1y ?? 0));
  const ddScore = clamp((ddDepth / 30) * 100);
  const volScore = m.volPct5y ?? (m.vol21 === null ? 50 : clamp(((m.vol21 - 10) / 25) * 100));
  const stress = 0.5 * ddScore + 0.5 * volScore;
  const deepDrawdown = clamp(((ddDepth - 12) / 23) * 100);
  const repair = 0.4 * clamp(((ddDepth - 5) / 25) * 100) + 0.4 * momScore + 0.2 * (100 - volScore);

  const raw: Record<CyclePhaseKey, number> = {
    prosperity: 0.65 * trend + 0.35 * (100 - stress),
    recession: 0.4 * (100 - trend) + 0.35 * stress + 0.25 * (100 - repair),
    depression: 0.45 * deepDrawdown + 0.35 * (100 - trend) + 0.2 * stress,
    recovery: 0.6 * repair + 0.25 * trend + 0.15 * (100 - stress),
  };
  const scores: CyclePhaseScore[] = CYCLE_PHASES.map((p) => ({ key: p.key, label: p.label, score: Math.round(raw[p.key]) }));
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const separation = Math.round(top.score - sorted[1].score);
  const f = (v: number | null, digits = 1) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`);
  const explanation =
    `${m.short}：200 日线距离 ${f(m.ma200DistancePct)}、63 日动量 ${f(m.momentum63)}、距一年高点 ${f(m.drawdown1y)}、` +
    `21 日波动 ${m.vol21 === null ? "—" : m.vol21.toFixed(1) + "%"}（5 年分位 ${m.volPct5y === null ? "—" : m.volPct5y.toFixed(0) + "%"}）。` +
    `趋势 ${Math.round(trend)}、压力 ${Math.round(stress)}、深度回撤 ${Math.round(deepDrawdown)}、修复 ${Math.round(repair)}，` +
    `因此最接近「${top.label}」特征；与次高阶段相差 ${separation} 分，${separation < 8 ? "阶段区分度低，可能处于过渡带" : "阶段区分度尚可"}。`;
  return {
    index: m.key,
    label: m.label,
    phase: top.key,
    phaseLabel: top.label,
    scores,
    separation,
    drivers: { trend: Math.round(trend), stress: Math.round(stress), deepDrawdown: Math.round(deepDrawdown), repair: Math.round(repair) },
    explanation,
  };
}

function correlation(dates: string[], closes: Record<CycleIndexKey, number[]>, span: number): CycleCorrelation {
  const n = dates.length;
  const start = Math.max(1, n - span);
  const rets: Record<CycleIndexKey, number[]> = { NDX100: [], SPX: [], SSE: [] };
  for (const k of CYCLE_INDEX_ORDER) {
    for (let i = start; i < n; i++) rets[k].push(closes[k][i] / closes[k][i - 1] - 1);
  }
  const matrix = CYCLE_INDEX_ORDER.map((a) => CYCLE_INDEX_ORDER.map((b) => (a === b ? (rets[a].length >= 10 ? 1 : null) : pearson(rets[a], rets[b]))));
  return { keys: CYCLE_INDEX_ORDER, labels: CYCLE_INDEX_ORDER.map((k) => CYCLE_INDEX_META[k].short), windowDays: rets.NDX100.length, matrix };
}

function weekKey(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export async function getCycleAnalysis(opts: { refresh?: boolean; years?: number | null } = {}): Promise<CycleResult> {
  const refresh = opts.refresh === true;
  const years = opts.years ?? 5;
  const ds = await getDataset({ refresh });
  const aligned = align(ds.series, ds.statuses);
  if (aligned.dates.length < 260) throw new Error("三指数共同交易日不足，无法进行康波对照");

  const allDates = aligned.dates;
  const allCloses = aligned.closes;
  const bars = years ? Math.round(years * TRADING_DAYS) : allDates.length;
  const start = Math.max(0, allDates.length - bars);
  const dates = allDates.slice(start);
  const closes = {} as Record<CycleIndexKey, number[]>;
  for (const k of CYCLE_INDEX_ORDER) closes[k] = allCloses[k].slice(start);

  const indices = CYCLE_INDEX_ORDER.map((k) =>
    indexMetrics(k, dates, closes[k], aligned.fullCloses[k], allDates.length > 1 ? allCloses[k][allDates.length - 2] : null),
  );
  const phases = indices.map(phaseView);

  const chart: CycleChartPoint[] = [];
  const baseValue = {} as Record<CycleIndexKey, number>;
  for (const k of CYCLE_INDEX_ORDER) baseValue[k] = closes[k][0];
  const baseNdxSpx = closes.NDX100[0] / closes.SPX[0];
  const baseNdxSse = closes.NDX100[0] / closes.SSE[0];
  for (let i = 0; i < dates.length; i++) {
    chart.push({
      date: dates[i],
      NDX100: round((closes.NDX100[i] / baseValue.NDX100) * 100, 2) as number,
      SPX: round((closes.SPX[i] / baseValue.SPX) * 100, 2) as number,
      SSE: round((closes.SSE[i] / baseValue.SSE) * 100, 2) as number,
      ndxSpx: round((closes.NDX100[i] / closes.SPX[i] / baseNdxSpx) * 100, 2),
      ndxSse: round((closes.NDX100[i] / closes.SSE[i] / baseNdxSse) * 100, 2),
    });
  }

  let sampled = chart;
  let chartFreq: "1d" | "1w" = "1d";
  if (chart.length > 320) {
    const out: CycleChartPoint[] = [];
    let key = "";
    for (const p of chart) {
      const k = weekKey(p.date);
      if (k !== key) {
        out.push(p);
        key = k;
      } else {
        out[out.length - 1] = p;
      }
    }
    sampled = out;
    chartFreq = "1w";
  }

  const ratioDefs = [
    { pair: "NDX100/SPX", label: "纳指100 ÷ 标普500", a: "NDX100" as const, b: "SPX" as const, text: "大于 0 表示美股成长风格相对大盘占优，常见于利率下行或科技盈利预期上修阶段。" },
    { pair: "NDX100/SSE", label: "纳指100 ÷ 上证", a: "NDX100" as const, b: "SSE" as const, text: "大于 0 表示美股成长相对 A 股走强；该比值不含汇率换算，只比较各自本币指数的相对表现。" },
    { pair: "SPX/SSE", label: "标普500 ÷ 上证", a: "SPX" as const, b: "SSE" as const, text: "大于 0 表示美股大盘相对 A 股走强，用于观察中美宽基的相对强弱与分化程度。" },
  ];
  const ratios: CycleRatioView[] = ratioDefs.map((d) => {
    const seriesA = closes[d.a];
    const seriesB = closes[d.b];
    const n = seriesA.length;
    const latest = seriesA[n - 1] / seriesB[n - 1];
    const first = seriesA[0] / seriesB[0];
    const y1 = n > TRADING_DAYS ? seriesA[n - 1 - TRADING_DAYS] / seriesB[n - 1 - TRADING_DAYS] : null;
    const windowChange = pctChange(latest, first);
    const y1Change = y1 === null ? null : pctChange(latest, y1);
    return {
      pair: d.pair,
      label: d.label,
      latest: round(latest, 4) as number,
      windowChangePct: windowChange,
      y1ChangePct: y1Change,
      interpretation: `${d.text} 窗口内相对变化 ${windowChange === null ? "—" : (windowChange > 0 ? "+" : "") + windowChange.toFixed(1) + "%"}，近一年 ${y1Change === null ? "—" : (y1Change > 0 ? "+" : "") + y1Change.toFixed(1) + "%"}。`,
    };
  });

  const phaseSet = new Set(phases.map((p) => p.phase));
  const usSame = phases[0].phase === phases[1].phase;
  let resonanceKey = "divergent";
  let resonanceLabel = "三市场阶段特征分化";
  if (phaseSet.size === 1) {
    resonanceKey = "aligned";
    resonanceLabel = `三市场同向：均接近「${phases[0].phaseLabel}」特征`;
  } else if (usSame) {
    resonanceKey = "us_vs_cn";
    resonanceLabel = `美股内部一致（${phases[0].phaseLabel}），与 A 股（${phases[2].phaseLabel}）分化`;
  }
  const best = [...indices].sort((a, b) => (b.returns.window ?? -999) - (a.returns.window ?? -999))[0];
  const summary =
    `窗口 ${dates[0]} → ${dates[dates.length - 1]}：${resonanceLabel}。` +
    `窗口收益最高的是${best.short}（${best.returns.window === null ? "—" : (best.returns.window > 0 ? "+" : "") + best.returns.window.toFixed(1) + "%"}）。` +
    `康波对照只描述当前状态与四阶段典型特征的接近程度，不能据此推断长波年份或未来涨跌。`;

  const correlations = correlation(dates, closes, Math.min(TRADING_DAYS, dates.length - 1));
  const corr63 = correlation(dates, closes, Math.min(63, dates.length - 1));

  return {
    payload: {
      asOf: dates[dates.length - 1],
      window: { from: dates[0], to: dates[dates.length - 1], years, days: dates.length },
      framework: CYCLE_PHASES,
      indices,
      phases,
      resonance: { key: resonanceKey, label: resonanceLabel, summary },
      ratios,
      correlations,
      corr63,
      chart: sampled,
      chartFreq,
      sources: ds.statuses,
    },
    live: ds.statuses.some((s) => s.mode === "live" && s.ok),
  };
}

/* ===================== AI 上下文 ===================== */

export const CYCLE_LIMITS = [
  "康波（Kondratiev wave）是 40–60 年的长波假说，阶段年份划分在研究者之间并不一致；本站不判定当前处于第几波第几年，也不给出长波时间预测。",
  "四阶段匹配分只是把价格、动量、回撤与波动映射到教科书特征的启发式打分，权重固定（见指标定义），不是概率、不是模型回测结论，也不是买卖信号。",
  "三指数共同交易日自 2019 年 4 月起（纳斯达克100快照起点），约七年多，远短于一轮康波；因此本板块无法验证或否定长波理论，只能做中短期状态对照。",
  "指数为本币计价的价格指数，不含股息、费用、税收与汇率换算；跨市场比较不等于可投资组合的真实收益差。",
  "美股与 A 股交易时段、节假日与政策周期不同，相关性按共同交易日的日收益计算，只描述历史同步程度，不代表因果。",
  "数据为日频收盘，存在上游延迟与节假日缺失；快照生成后不会自动回补历史修订，实时刷新失败时会保留快照并显式标注。",
];

const CYCLE_DEFINITION = {
  returns: "以共同交易日收盘价计算；1M=21、3M=63、1Y=252 个交易日，YTD 以最近一个上年最后一个交易日为基准，窗口收益以所选区间首个共同交易日为基准。",
  cagr3y: "以最近 756 个交易日（约 3 年）首末收盘计算的年化复合收益，用作长周期趋势的近似；样本不足时返回 null。",
  volatility: "21 / 63 日对数收益率标准差 × sqrt(252) × 100，年化（%）；5 年分位基于全部历史的 21 日滚动年化波动。",
  drawdown: "距一年高点 = 最新收盘相对最近 252 个交易日最高收盘的涨跌幅；窗口最大回撤为窗口内峰值到后续最低点的最大跌幅。",
  phaseScore: "趋势 = 0.5×200 日线距离映射 + 0.5×63 日动量映射；压力 = 0.5×回撤深度 + 0.5×波动分位；深度回撤 = 距一年高点跌幅超过 12% 后的线性映射；修复 = 0.4×中等回撤 + 0.4×动量 + 0.2×(100−波动分位)。繁荣 = 0.65×趋势 + 0.35×(100−压力)；衰退 = 0.40×(100−趋势) + 0.35×压力 + 0.25×(100−修复)；萧条 = 0.45×深度回撤 + 0.35×(100−趋势) + 0.20×压力；回升 = 0.60×修复 + 0.25×趋势 + 0.15×(100−压力)。",
  separation: "最高阶段分与次高阶段分的差值；差值小于 8 视为阶段区分度低，可能处于过渡带。",
  relativeStrength: "比值 = 指数 A 收盘 ÷ 指数 B 收盘；窗口与近一年变化为该比值的涨跌幅，大于 0 表示 A 相对 B 走强，不含汇率换算。",
  chart: "归一化走势以所选窗口首个共同交易日 = 100；相对强弱线同样以窗口首日 = 100。",
};

export function cycleDefinition() {
  return CYCLE_DEFINITION;
}

export function cycleAiBundle(result: CycleResult, refresh: boolean) {
  const p = result.payload;
  return {
    meta: { kind: "kondratiev-cycle-comparison", asOf: p.asOf, generatedAt: new Date().toISOString(), liveRefresh: refresh, sources: p.sources },
    subject: {
      name: "康波周期 × 纳斯达克100 / 标普500 / 上证指数",
      framework: "康波四阶段（繁荣 / 衰退 / 萧条 / 回升）作为理论框架；本站不判定长波年份",
      window: p.window,
    },
    phases: CYCLE_PHASES,
    indices: p.indices,
    phaseMatch: p.phases,
    resonance: p.resonance,
    relativeStrength: p.ratios,
    correlations: p.correlations,
    corr63: p.corr63,
    definition: CYCLE_DEFINITION,
    limits: CYCLE_LIMITS,
    taskForAssistant: {
      role: "你是长周期与跨市场研究员。请仅依据以上真实指数数据，讨论三指数状态与康波四阶段特征的对照，不给出具体买卖点位、仓位或收益预测。",
      requiredOutput: [
        "三指数状态：引用最新收盘、3M/1Y/窗口收益、21 日波动、距一年高点与 200 日线距离的具体数值",
        "阶段对照：逐一评价启发式给出的阶段匹配是否合理，可以反驳，并指出区分度低的地方",
        "相对强弱：解释纳指/标普与纳指/上证比值变化背后的风格与区域含义，引用具体百分比",
        "相关性：引用 63 日与 252 日相关系数，说明跨市场联动或分化，并指出相关不等于因果",
        "康波边界：说明为什么约七年的样本无法验证 40–60 年长波，以及本对照能与不能回答的问题",
        "情景分析：给出趋势延续、高位转弱、修复延续三种情景下三指数可能的相对表现与触发条件",
        "观察清单：列出 3–5 个可核验的观察指标与阈值，注明数据频率与来源",
        "结论边界：明确不构成投资建议、不预测点位或收益，并给出失效条件",
      ],
      guardrails: [
        "不得编造行情、宏观数据、政策、历史事件或机构观点；只能引用上下文中的数值",
        "不得给出具体买卖点位、仓位比例、收益承诺或本金安全保证",
        "不得宣称当前处于康波第几波第几年，不得把四阶段匹配写成确定的长波预测",
        "数据缺失、降级或样本不足必须显式说明，并据此降低置信度",
      ],
    },
    api: {
      cycle: "/functions/v1/app/api/cycle/kondratiev?years=" + (p.window.years ?? "all"),
      aiContext: "/functions/v1/app/api/cycle/ai-context?years=" + (p.window.years ?? "all") + "&format=markdown",
    },
  };
}

export function cycleMarkdown(result: CycleResult): string {
  const p = result.payload;
  const lines: string[] = [];
  const f = (v: number | null, digits = 1, suffix = "%") => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${suffix}`);
  lines.push("# 康波周期 × 三大指数对照上下文");
  lines.push(`数据截至 ${p.asOf}｜窗口 ${p.window.from} → ${p.window.to}（${p.window.days} 个共同交易日）｜生成时间 ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 一、康波四阶段理论框架（非实时数据）");
  for (const ph of CYCLE_PHASES) {
    lines.push(`- ${ph.label}（${ph.english}）：增长—${ph.growth}；通胀—${ph.inflation}；利率—${ph.rates}；权益—${ph.equity}。${ph.observable}`);
  }
  lines.push("");
  lines.push("## 二、三指数真实指标");
  lines.push("| 指数 | 最新收盘 | 当日 | 1M | 3M | YTD | 1Y | 窗口 | 3 年年化 | 21 日波动 | 距 1 年高点 | 200 日线距离 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of p.indices) {
    lines.push(
      `| ${m.label} | ${m.close.toFixed(2)} | ${f(m.dayChangePct)} | ${f(m.returns.m1)} | ${f(m.returns.m3)} | ${f(m.returns.ytd)} | ${f(m.returns.y1)} | ${f(m.returns.window)} | ${f(m.cagr3y)} | ${m.vol21 === null ? "—" : m.vol21.toFixed(1) + "%"} | ${f(m.drawdown1y)} | ${f(m.ma200DistancePct)} |`,
    );
  }
  lines.push("");
  lines.push("## 三、四阶段匹配（启发式）");
  for (const ph of p.phases) {
    lines.push(`- ${ph.label}：最接近「${ph.phaseLabel}」（${ph.scores.map((s) => `${s.label} ${s.score}`).join(" / ")}），区分度 ${ph.separation}。${ph.explanation}`);
  }
  lines.push(`- 组合判断：${p.resonance.summary}`);
  lines.push("");
  lines.push("## 四、相对强弱");
  for (const r of p.ratios) lines.push(`- ${r.label}：最新比值 ${r.latest.toFixed(4)}，窗口 ${f(r.windowChangePct)}，近一年 ${f(r.y1ChangePct)}。${r.interpretation}`);
  lines.push("");
  lines.push("## 五、相关性（日收益）");
  lines.push(`展示窗口 ${p.correlations.windowDays} 对，风险联动 ${p.corr63.windowDays} 对。`);
  lines.push("| | " + p.correlations.labels.join(" | ") + " |");
  lines.push("| --- | " + p.correlations.labels.map(() => "---").join(" | ") + " |");
  p.correlations.matrix.forEach((row, i) => {
    lines.push(`| ${p.correlations.labels[i]} | ${row.map((v) => (v === null ? "—" : v.toFixed(2))).join(" | ")} |`);
  });
  lines.push("");
  lines.push("## 六、数据来源与限制");
  for (const s of p.sources) lines.push(`- ${s.label}：${s.ok ? "正常" : "降级"}（${s.mode}）— ${s.note}`);
  for (const l of CYCLE_LIMITS) lines.push(`- ${l}`);
  lines.push("");
  lines.push("## 七、给 AI 的分析任务");
  const bundle = cycleAiBundle(result, false);
  for (const r of bundle.taskForAssistant.requiredOutput) lines.push(`- ${r}`);
  lines.push("约束：");
  for (const g of bundle.taskForAssistant.guardrails) lines.push(`- ${g}`);
  return lines.join("\n");
}
