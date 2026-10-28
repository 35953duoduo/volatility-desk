// 红利策略（国企高分红股）周线分析：股息率、价格分位、周线 RSI、均线偏离与连续分红年数。
// 设计取向：长期持有吃股息 + 只用 20%–30% 卫星仓做周线级别高抛低吸。
// 与个股诊断不同，这里使用固定权重：周线样本自相关强、有效独立样本少，动态 IC 容易过拟合。
import {
  dividendSnapshot,
  type DividendRecordData,
} from "./data/dividendSnapshot.ts";

export type DividendStance = "accumulate" | "add" | "hold" | "trim" | "reduce";

export interface DividendPoint {
  date: string;
  close: number;
  ma20w: number | null;
  ma60w: number | null;
  rsi14w: number | null;
  /** 最新一个已实施完整年度（含中期+末期）的每股分红 / 当周收盘价 */
  yieldFY: number | null;
  /** 仅近 365 天已除息的每股分红 / 当周收盘价（现金口径，可能受派息节奏影响） */
  yieldTTM: number | null;
  yieldPct5y: number | null;
  pricePct3y: number | null;
  drawdown3y: number | null;
}

export interface DividendMetrics {
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
  latestDividend: DividendRecordData | null;
  weekPartial: boolean;
}

export interface DividendSignal {
  id: string;
  name: string;
  display: string;
  state: string;
  /** 规则分量 -100..100（正=偏低估/低吸，负=偏高估/高抛） */
  score: number;
  /** 固定权重（%），五项合计 100 */
  weight: number;
  rationale: string;
}

export interface DividendComposite {
  score: number;
  stance: string;
  stanceKey: DividendStance;
  summary: string;
  actionHint: string;
  basePosition: string;
  satellite: string;
}

export interface DividendStrategyMeta {
  title: string;
  horizon: string;
  method: string;
  weights: { id: string; name: string; weight: number }[];
  position: { base: string; satellite: string };
  definition: Record<string, string>;
  definitionLabels: Record<string, string>;
}

export const DIVIDEND_STRATEGY: DividendStrategyMeta = {
  title: "国企红利股 · 周线高抛低吸",
  horizon: "周线（每周最后一个交易日收盘；盘中报价会覆盖本周最新价）",
  method:
    "固定权重打分：股息率分位 30% + 3 年价格分位 25% + 周线 RSI 20% + 60 周均线偏离 15% + 连续分红年数 10%。不使用动态 IC：周线序列自相关强、独立样本少，动态优化容易把噪音当规律。",
  weights: [
    { id: "div_yield_fy", name: "股息率 5 年分位", weight: 30 },
    { id: "price_position", name: "3 年价格分位", weight: 25 },
    { id: "rsi_weekly", name: "周线 RSI(14)", weight: 20 },
    { id: "ma60_dev", name: "60 周均线偏离", weight: 15 },
    { id: "div_streak", name: "连续分红年数", weight: 10 },
  ],
  position: {
    base: "长期底仓 70%–80%：只负责收息，不参与周线波段，避免被短期波动洗出长期现金流。",
    satellite: "卫星仓 20%–30%：只按本信号做周线级别高抛低吸；分档执行，不一次性满仓或清仓。",
  },
  definition: {
    yieldFY: "最新一个已实施完整年度（中期+末期，必要时含特别分红）的税前每股分红 ÷ 当前不复权收盘价；未含尚未实施的年度。",
    yieldTTM: "近 365 天已除息的税前每股分红合计 ÷ 当前价；银行等改为中期+末期派息后，过渡期可能出现一年三次派息，故只作参考。",
    yieldPct5y: "当前股息率相对过去 260 周（不足则用全部可得周）股息率分布的分位，0–100，越高越便宜。",
    pricePct3y: "当前收盘价相对过去 156 周价格分布的分位，0–100，越低越便宜。",
    rsi14w: "周线 RSI(14)：低于 30 视为周线超卖，高于 70 视为周线超买。",
    ma60Dev: "当前价相对 60 周均线的偏离百分比（负值=低于均线）。",
    streak: "按除息年份统计的连续分红年数；最近一个除息年度起向前连续计算。",
    caveat: "全部为不复权收盘价与税前分红，未考虑红利税、交易成本、股息再投资与个人持仓成本。",
  },
  definitionLabels: {
    yieldFY: "年度股息率（主口径）",
    yieldTTM: "近 12 个月现金口径（参考）",
    yieldPct5y: "股息率 5 年分位",
    pricePct3y: "3 年价格分位",
    rsi14w: "周线 RSI(14)",
    ma60Dev: "60 周均线偏离",
    streak: "连续分红年数",
    caveat: "统一口径限制",
  },
};

/** 全部接口与页面统一使用的免责声明 */
export const DIVIDEND_DISCLAIMER =
  "红利策略输出为量化规则与历史统计，不构成投资建议、收益承诺或个性化推荐。底仓/卫星仓比例是通用框架，不是针对任何人的资产配置；股息率会随股价与分红方案变化，历史分红不保证未来继续。";

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 周线 RSI（Wilder 平滑）：需要至少 15 个周收盘价 */
function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = () => {
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = value();
  }
  return out;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function reportYear(record: DividendRecordData): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.reportDate)) return Number.NaN;
  return Number(record.reportDate.slice(0, 4));
}

/** 某个日期可见的最新完整年度分红（必须已经派发年度末期） */
function annualDpsAt(date: string, records: DividendRecordData[]): { fy: number; dps: number } | null {
  let fy: number | null = null;
  for (const r of records) {
    if (!r.reportDate.endsWith("12-31") || r.exDate > date) continue;
    const year = reportYear(r);
    if (!Number.isFinite(year)) continue;
    if (fy === null || year > fy) fy = year;
  }
  if (fy === null) return null;
  let dps = 0;
  for (const r of records) {
    if (reportYear(r) === fy) dps += r.dps;
  }
  return { fy, dps };
}

/** 近 365 天已除息分红合计（现金口径） */
function ttmDpsAt(date: string, records: DividendRecordData[]): number {
  const cutoff = shiftDate(date, -365);
  let dps = 0;
  for (const r of records) {
    if (r.exDate > cutoff && r.exDate <= date) dps += r.dps;
  }
  return dps;
}

/** 滚动分位：当前值相对自身及过去 window-1 个观测，只在有效样本 ≥ minSamples 时给出 */
function rollingPercentile(values: (number | null)[], window: number, minSamples = 26): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const buffer: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null) buffer.push(v);
    if (i >= window) {
      const old = values[i - window];
      if (old !== null) {
        const pos = buffer.indexOf(old);
        if (pos >= 0) buffer.splice(pos, 1);
      }
    }
    if (v === null || buffer.length < minSamples) continue;
    let less = 0;
    let equal = 0;
    for (const x of buffer) {
      if (x < v) less++;
      else if (x === v) equal++;
    }
    out[i] = ((less + equal * 0.5) / buffer.length) * 100;
  }
  return out;
}

function consecutiveYears(records: DividendRecordData[]): { streak: number; years: number } {
  const years = new Set<number>();
  for (const r of records) {
    const year = Number(r.exDate.slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  }
  if (!years.size) return { streak: 0, years: 0 };
  const latest = Math.max(...years);
  let streak = 0;
  for (let y = latest; years.has(y); y--) streak++;
  return { streak, years: years.size };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 单只红利股的完整周线序列与指标 */
export function buildDividendSeries(stock: {
  weekly: [string, number][];
  dividends: DividendRecordData[];
}): DividendPoint[] {
  const closes = stock.weekly.map((r) => r[1]);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const rsi = rsiWilder(closes, 14);
  const yieldsFY: (number | null)[] = [];
  const yieldsTTM: (number | null)[] = [];
  for (const [date, close] of stock.weekly) {
    const annual = annualDpsAt(date, stock.dividends);
    yieldsFY.push(annual && close > 0 ? (annual.dps / close) * 100 : null);
    yieldsTTM.push(close > 0 ? (ttmDpsAt(date, stock.dividends) / close) * 100 : null);
  }
  const yieldPct = rollingPercentile(yieldsFY, 260, 26);
  const pricePct = rollingPercentile(closes, 156, 26);
  const pricePct5y = rollingPercentile(closes, 260, 26);

  return stock.weekly.map(([date, close], i) => {
    let peak3y = close;
    for (let j = Math.max(0, i - 155); j <= i; j++) peak3y = Math.max(peak3y, closes[j]);
    return {
      date,
      close,
      ma20w: round(ma20[i], 3),
      ma60w: round(ma60[i], 3),
      rsi14w: round(rsi[i], 1),
      yieldFY: round(yieldsFY[i], 2),
      yieldTTM: round(yieldsTTM[i], 2),
      yieldPct5y: round(yieldPct[i], 1),
      pricePct3y: round(pricePct[i], 1),
      pricePct5y: round(pricePct5y[i], 1),
      drawdown3y: round(peak3y > 0 ? (close / peak3y - 1) * 100 : null, 2),
    };
  });
}

function weekOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function isPartialWeek(date: string): boolean {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 3600 * 1000);
  const today = cst.toISOString().slice(0, 10);
  const weekday = (cst.getUTCDay() + 6) % 7;
  return weekOf(today) === weekOf(date) && weekday < 5;
}

export function dividendMetrics(series: DividendPoint[], dividends: DividendRecordData[]): DividendMetrics | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const annual = annualDpsAt(last.date, dividends);
  const ttm = ttmDpsAt(last.date, dividends);
  const yieldsAll = series.map((p) => p.yieldFY).filter((v): v is number => v !== null);
  let yieldPctAll: number | null = null;
  if (last.yieldFY !== null && yieldsAll.length >= 26) {
    let less = 0;
    let equal = 0;
    for (const v of yieldsAll) {
      if (v < last.yieldFY) less++;
      else if (v === last.yieldFY) equal++;
    }
    yieldPctAll = round(((less + equal * 0.5) / yieldsAll.length) * 100, 1);
  }
  const returns: number[] = [];
  const start = Math.max(1, series.length - 52);
  for (let i = start; i < series.length; i++) {
    const prevClose = series[i - 1].close;
    if (prevClose > 0 && series[i].close > 0) returns.push(Math.log(series[i].close / prevClose));
  }
  const weekVol52 =
    returns.length >= 26 && returns.length > 1
      ? round(Math.sqrt(mean(returns.map((r) => (r - mean(returns)) ** 2))) * Math.sqrt(52) * 100, 1)
      : null;
  const streak = consecutiveYears(dividends);
  const latest = dividends.length ? dividends[dividends.length - 1] : null;

  return {
    asOf: last.date,
    close: last.close,
    weekChangePct: prev && prev.close > 0 ? round((last.close / prev.close - 1) * 100, 2) : null,
    yieldFY: last.yieldFY,
    dpsFY: annual ? round(annual.dps, 4) : null,
    fy: annual ? annual.fy : null,
    dpsTTM: round(ttm, 4),
    yieldTTM: ttm > 0 && last.close > 0 ? round((ttm / last.close) * 100, 2) : null,
    yieldPct5y: last.yieldPct5y,
    yieldPctAll,
    pricePct3y: last.pricePct3y,
    pricePct5y: last.pricePct5y,
    rsi14w: last.rsi14w,
    ma20w: last.ma20w,
    ma60w: last.ma60w,
    distMa20w: last.ma20w && last.ma20w > 0 ? round((last.close / last.ma20w - 1) * 100, 2) : null,
    distMa60w: last.ma60w && last.ma60w > 0 ? round((last.close / last.ma60w - 1) * 100, 2) : null,
    drawdown3y: last.drawdown3y,
    weekVol52,
    streakYears: streak.streak,
    dividendYears: streak.years,
    dividendCount: dividends.length,
    latestDividend: latest,
    weekPartial: isPartialWeek(last.date),
  };
}

export function dividendSignals(series: DividendPoint[], dividends: DividendRecordData[]): {
  signals: DividendSignal[];
  composite: DividendComposite;
} {
  const m = dividendMetrics(series, dividends);
  const weights = new Map(DIVIDEND_STRATEGY.weights.map((w) => [w.id, w.weight]));
  const score = (id: string) => {
    if (id === "div_yield_fy") {
      if (!m || m.yieldPct5y === null) return 0;
      return clamp((m.yieldPct5y - 50) * 2, -100, 100);
    }
    if (id === "price_position") {
      if (!m || m.pricePct3y === null) return 0;
      return clamp((50 - m.pricePct3y) * 2, -100, 100);
    }
    if (id === "rsi_weekly") {
      if (!m || m.rsi14w === null) return 0;
      // 25 个 RSI 点对应满格：RSI 25 → +100，75 → -100，避免 65 附近被过度惩罚
      return clamp((50 - m.rsi14w) * (100 / 25), -100, 100);
    }
    if (id === "ma60_dev") {
      if (!m || m.distMa60w === null) return 0;
      // 低于 60 周均线 15% 记满分低吸，高于 15% 记满分高抛
      return clamp((-m.distMa60w / 15) * 100, -100, 100);
    }
    if (id === "div_streak") {
      if (!m) return 0;
      return clamp((m.streakYears / 10) * 100, 0, 100);
    }
    return 0;
  };
  const comp = (id: string) => score(id);
  const yieldPct = m?.yieldPct5y ?? null;
  const pricePct = m?.pricePct3y ?? null;
  const rsi = m?.rsi14w ?? null;
  const dev = m?.distMa60w ?? null;
  const streak = m?.streakYears ?? 0;

  const signals: DividendSignal[] = [
    {
      id: "div_yield_fy",
      name: "股息率 5 年分位",
      display:
        m?.yieldFY === null || m?.yieldFY === undefined
          ? "暂无完整年度分红"
          : `${m.yieldFY.toFixed(2)}%${yieldPct === null ? "" : ` · 近 5 年 ${yieldPct.toFixed(0)}% 分位`}${
              m.fy ? `（FY${m.fy}）` : ""
            }`,
      state:
        yieldPct === null
          ? "数据不足"
          : yieldPct >= 70
            ? "股息率偏高"
            : yieldPct <= 30
              ? "股息率偏低"
              : "股息率中性",
      score: round(comp("div_yield_fy"), 1) ?? 0,
      weight: weights.get("div_yield_fy") ?? 30,
      rationale:
        yieldPct === null
          ? "完整年度分红样本不足，暂不参与打分（权重按 0 分计）。"
          : `当前股息率处于近 5 年 ${yieldPct.toFixed(0)}% 分位：越高代表同样的分红现金流对应更低的买入价格，但需排除一次性特别分红。`,
    },
    {
      id: "price_position",
      name: "3 年价格分位",
      display:
        pricePct === null
          ? "样本不足"
          : `${pricePct.toFixed(0)}% 分位 · 距 3 年高点 ${m?.drawdown3y === null || m?.drawdown3y === undefined ? "—" : `${m.drawdown3y.toFixed(1)}%`}`,
      state: pricePct === null ? "数据不足" : pricePct <= 30 ? "价格低位" : pricePct >= 70 ? "价格高位" : "价格中位",
      score: round(comp("price_position"), 1) ?? 0,
      weight: weights.get("price_position") ?? 25,
      rationale:
        pricePct === null
          ? "周线样本不足 26 周，暂不参与打分。"
          : `不复权收盘价处于过去 3 年 ${pricePct.toFixed(0)}% 分位；与股息率分位相互印证，避免只看单一估值指标。`,
    },
    {
      id: "rsi_weekly",
      name: "周线 RSI(14)",
      display: rsi === null ? "样本不足" : `${rsi.toFixed(1)}${rsi < 30 ? " · 超卖" : rsi < 45 ? " · 偏低" : rsi > 70 ? " · 超买" : rsi > 55 ? " · 偏高" : ""}`,
      state:
        rsi === null
          ? "数据不足"
          : rsi < 30
            ? "周线超卖"
            : rsi < 45
              ? "周线偏低"
              : rsi > 70
                ? "周线超买"
                : rsi > 55
                  ? "周线偏高"
                  : "周线中性",
      score: round(comp("rsi_weekly"), 1) ?? 0,
      weight: weights.get("rsi_weekly") ?? 20,
      rationale:
        rsi === null
          ? "需要至少 15 个周收盘价。"
          : `周线 RSI(14) 为 ${rsi.toFixed(1)}：30 以下视为周线超卖（低吸机会），70 以上视为超买（高抛机会）；强趋势中 RSI 可能长期钝化，不单独使用。`,
    },
    {
      id: "ma60_dev",
      name: "60 周均线偏离",
      display: dev === null ? "样本不足" : `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%`,
      state: dev === null ? "数据不足" : dev <= -10 ? "显著低于均线" : dev < 0 ? "低于均线" : dev >= 10 ? "显著高于均线" : "高于均线",
      score: round(comp("ma60_dev"), 1) ?? 0,
      weight: weights.get("ma60_dev") ?? 15,
      rationale:
        dev === null
          ? "需要至少 60 个周收盘价。"
          : `当前价相对 60 周均线 ${dev > 0 ? "高" : "低"} ${Math.abs(dev).toFixed(1)}%：把均线当作长期成本中枢，偏离越大越适合分批再平衡。`,
    },
    {
      id: "div_streak",
      name: "连续分红年数",
      display: `${streak} 年`,
      state: streak >= 10 ? "分红稳定" : streak >= 5 ? "分红较稳定" : streak > 0 ? "分红记录较短" : "无分红记录",
      score: round(comp("div_streak"), 1) ?? 0,
      weight: weights.get("div_streak") ?? 10,
      rationale: `按除息年份统计已连续分红 ${streak} 年（共 ${new Set(dividends.map((d) => d.exDate.slice(0, 4))).size} 个年度有记录）。只加不减，用于奖励分红连续性，不判断未来是否会继续。`,
    },
  ];

  const total = round(
    signals.reduce((acc, s) => acc + s.score * (s.weight / 100), 0),
    0,
  ) ?? 0;
  const verdict = dividendVerdict(total);
  return { signals, composite: { score: total, ...verdict } };
}

function dividendVerdict(score: number): Omit<DividendComposite, "score"> {
  if (score >= 30) {
    return {
      stance: "分批低吸",
      stanceKey: "accumulate",
      summary: "股息率处于历史高位、价格在 3 年低位或周线超卖，卫星仓适合分批低吸；底仓继续持有收息，不追一次性满仓。",
      actionHint: "卫星仓分 3 批：现价 1/3；较 60 周均线再低 3% 或周 RSI 跌破 30 时各补 1/3。低吸的是卫星仓，底仓不动。",
      basePosition: DIVIDEND_STRATEGY.position.base,
      satellite: DIVIDEND_STRATEGY.position.satellite,
    };
  }
  if (score >= 10) {
    return {
      stance: "小仓低吸",
      stanceKey: "add",
      summary: "估值与价格略偏低位，但信号强度一般；先用小比例卫星仓试探，保留后续分批空间。",
      actionHint: "卫星仓先用 1/3 试探；若继续下跌 3%–5% 或周 RSI 跌破 30，再补 1/3；不追反弹。",
      basePosition: DIVIDEND_STRATEGY.position.base,
      satellite: DIVIDEND_STRATEGY.position.satellite,
    };
  }
  if (score > -10) {
    return {
      stance: "持有收息",
      stanceKey: "hold",
      summary: "股息率与价格都接近历史中位，周线没有明显极端；保持仓位、以收息为主，不做频繁波段。",
      actionHint: "底仓与卫星仓都不动；收到的股息可先留存，等价格回到 60 周均线下方或股息率分位 ≥70% 再考虑再投入。",
      basePosition: DIVIDEND_STRATEGY.position.base,
      satellite: DIVIDEND_STRATEGY.position.satellite,
    };
  }
  if (score > -30) {
    return {
      stance: "分批高抛",
      stanceKey: "trim",
      summary: "价格偏高或股息率偏低，周线动能偏强；卫星仓适合分批高抛锁定波段收益，底仓继续收息。",
      actionHint: "卫星仓每次反弹减持 1/3，最多减到只剩底仓；不因为高抛而清掉长期收息仓位。",
      basePosition: DIVIDEND_STRATEGY.position.base,
      satellite: DIVIDEND_STRATEGY.position.satellite,
    };
  }
  return {
    stance: "显著高抛",
    stanceKey: "reduce",
    summary: "价格处于 3 年高位、周线偏强且股息率分位偏低；卫星仓显著高抛，底仓保留以维持股息现金流。",
    actionHint: "卫星仓减持 2/3 或全部了结；底仓保留，避免一次性清仓后失去长期股息现金流。等回落至 60 周均线附近再评估。",
    basePosition: DIVIDEND_STRATEGY.position.base,
    satellite: DIVIDEND_STRATEGY.position.satellite,
  };
}

/** 观察清单顺序即接口返回顺序；排序由调用方按得分处理 */
export const DIVIDEND_STOCKS = dividendSnapshot.stocks;

export function dividendSnapshotMeta() {
  return {
    generatedAt: dividendSnapshot.generatedAt,
    source: dividendSnapshot.source,
    window: dividendSnapshot.window,
    count: dividendSnapshot.stocks.length,
  };
}
