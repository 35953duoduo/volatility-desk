// 纯计算模块：不依赖任何运行时扩展，Deno / Node 通用。
// 输入为 [交易日, 收盘价] 序列，输出波动率序列、信号与诊断结果。

export type Row = [string, number];

export interface VolPoint {
  /** 交易日 YYYY-MM-DD */
  date: string;
  /** 指数或 ETF 收盘价 */
  close: number;
  /** 21 日年化已实现波动率（%） */
  rv21: number | null;
  /** 63 日年化已实现波动率（%） */
  rv63: number | null;
  /** 隐含波动率（VXN，仅在数据源可达时有值） */
  vxn: number | null;
  /** rv21 在滚动 5 年窗口内的历史分位（0-100） */
  pct5y: number | null;
  /** rv21 在全部可用样本内的扩展分位（0-100） */
  pctAll: number | null;
  /** rv21 相对其 252 日均值的 z 分数 */
  z21: number | null;
  /** rv21 相对 21 个交易日前的变化（百分点） */
  rv21Slope: number | null;
  /** 相对 252 日高点的回撤（%） */
  drawdown: number | null;
  ma50: number | null;
  ma200: number | null;
  /** 63 个交易日累计涨跌幅（%） */
  mom63: number | null;
}

export interface Signal {
  id: string;
  name: string;
  group: "波动率" | "趋势" | "价格结构" | "情绪";
  /** 人类可读取值 */
  display: string;
  raw: number | null;
  state: "看多倾向" | "看空倾向" | "中性" | "数据不足";
  /** 规则得分，-2 到 2 */
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

const TRADING_DAYS = 252;

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
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

/** 滚动窗口分位数：当前值相对自身过去 window 个观测的百分位 */
function rollingPercentile(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const sorted: number[] = [];
  const lowerBound = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upperBound = (v: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null) {
      if (sorted.length >= 60) out[i] = (upperBound(v) / sorted.length) * 100;
      sorted.splice(lowerBound(v), 0, v);
    }
    if (i >= window) {
      const old = values[i - window];
      if (old !== null) {
        const pos = lowerBound(old);
        if (sorted[pos] === old) sorted.splice(pos, 1);
      }
    }
  }
  return out;
}

/** 扩展窗口分位（使用截至当日之前的全部历史观测） */
function expandingPercentile(values: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const sorted: number[] = [];
  const bound = (v: number, inclusive: boolean) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inclusive ? sorted[mid] <= v : sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (sorted.length >= 60) out[i] = (bound(v, true) / sorted.length) * 100;
    sorted.splice(bound(v, false), 0, v);
  }
  return out;
}

function rollingZ(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    const start = Math.max(0, i - window + 1);
    const slice: number[] = [];
    for (let j = start; j < i; j++) {
      const x = values[j];
      if (x !== null) slice.push(x);
    }
    if (slice.length < 60) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const varsum = slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / slice.length;
    const sd = Math.sqrt(varsum);
    if (sd > 1e-9) out[i] = (v - mean) / sd;
  }
  return out;
}

function drawdownFromHigh(closes: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - window + 1);
    let hi = -Infinity;
    for (let j = start; j <= i; j++) if (closes[j] > hi) hi = closes[j];
    if (hi > 0) out[i] = (closes[i] / hi - 1) * 100;
  }
  return out;
}

/**
 * 由收盘价序列构建波动率与价格结构序列。
 * @param rows 升序 [date, close]
 * @param vxnRows 可选的隐含波动率 [date, value]
 */
export function buildSeries(rows: Row[], vxnRows?: Row[] | null): VolPoint[] {
  const closes = rows.map((r) => r[1]);
  const n = closes.length;
  const logRet: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) logRet[i] = Math.log(closes[i] / closes[i - 1]);

  function realized(window: number): (number | null)[] {
    const out: (number | null)[] = new Array(n).fill(null);
    let sumSq = 0;
    for (let i = 1; i < n; i++) {
      sumSq += logRet[i] * logRet[i];
      if (i - window >= 1) sumSq -= logRet[i - window] * logRet[i - window];
      if (i >= window) {
        const variance = sumSq / window;
        out[i] = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100;
      }
    }
    return out;
  }

  const rv21Raw = realized(21);
  const rv63Raw = realized(63);
  const pct5y = rollingPercentile(rv21Raw, 5 * TRADING_DAYS);
  const pctAll = expandingPercentile(rv21Raw);
  const z21 = rollingZ(rv21Raw, TRADING_DAYS);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const dd = drawdownFromHigh(closes, TRADING_DAYS);

  const vxnMap = new Map<string, number>();
  if (vxnRows) for (const [d, v] of vxnRows) vxnMap.set(d, v);

  const series: VolPoint[] = [];
  for (let i = 0; i < n; i++) {
    const rv21 = rv21Raw[i];
    const prev21 = i >= 21 ? rv21Raw[i - 21] : null;
    series.push({
      date: rows[i][0],
      close: round(closes[i], 3) as number,
      rv21: round(rv21),
      rv63: round(rv63Raw[i]),
      vxn: vxnMap.has(rows[i][0]) ? round(vxnMap.get(rows[i][0]) as number) : null,
      pct5y: round(pct5y[i], 1),
      pctAll: round(pctAll[i], 1),
      z21: round(z21[i]),
      rv21Slope: rv21 !== null && prev21 !== null ? round(rv21 - prev21) : null,
      drawdown: round(dd[i]),
      ma50: round(ma50[i]),
      ma200: round(ma200[i]),
      mom63: i >= 63 ? round((closes[i] / closes[i - 63] - 1) * 100) : null,
    });
  }
  return series;
}

export function lastValid(series: VolPoint[], key: keyof VolPoint): VolPoint | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i][key] !== null) return series[i];
  return null;
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

/** 波动率区间标签（纳斯达克品种常用经验阈值，同时适用已实现波动率） */
export function volRegime(value: number): { label: string; key: Metrics["volRegimeKey"] } {
  if (value < 15) return { label: "低波动（<15）", key: "compressed" };
  if (value < 22) return { label: "中性（15–22）", key: "normal" };
  if (value < 30) return { label: "偏高（22–30）", key: "elevated" };
  return { label: "恐慌（≥30）", key: "panic" };
}

export function computeMetrics(series: VolPoint[]): Metrics | null {
  if (series.length < 3) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const volForRegime = last.rv21;
  const regime = volForRegime === null ? { label: "样本不足", key: "normal" as Metrics["volRegimeKey"] } : volRegime(volForRegime);
  let impliedVol: number | null = null;
  let impliedVolAsOf: string | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].vxn !== null) {
      impliedVol = series[i].vxn;
      impliedVolAsOf = series[i].date;
      break;
    }
  }
  return {
    asOf: last.date,
    close: last.close,
    dayChangePct: prev && prev.close > 0 ? round((last.close / prev.close - 1) * 100) : null,
    impliedVol,
    impliedVolAsOf,
    realizedVol21: last.rv21,
    realizedVol63: last.rv63,
    volPercentile5y: last.pct5y,
    volPercentileAll: last.pctAll,
    volZScore: last.z21,
    volSlope21: last.rv21Slope,
    drawdown52w: last.drawdown,
    aboveMa50: last.ma50 === null ? null : last.close > last.ma50,
    aboveMa200: last.ma200 === null ? null : last.close > last.ma200,
    momentum63: last.mom63,
    volRegime: regime.label,
    volRegimeKey: regime.key,
    impliedPremium: impliedVol !== null && last.rv21 !== null ? round(impliedVol - last.rv21) : null,
  };
}

function stateOf(score: number): Signal["state"] {
  if (score > 0.4) return "看多倾向";
  if (score < -0.4) return "看空倾向";
  return "中性";
}

const insufficient = (id: string, name: string, group: Signal["group"], why: string): Signal => ({
  id,
  name,
  group,
  display: "—",
  raw: null,
  state: "数据不足",
  score: 0,
  weight: 0,
  rationale: why,
});

/**
 * 规则信号：结合波动率均值回归、价格趋势与市场情绪。
 * 正向得分 = 历史上更利于分批买入的状态；负向得分 = 更需要谨慎/减仓的状态。
 */
export function buildSignals(series: VolPoint[], m: Metrics): Signal[] {
  const out: Signal[] = [];
  const volBasis = m.impliedVol !== null ? "隐含波动率 VXN" : "21 日已实现波动率";

  // 1. 波动率绝对水平
  const levelValue = m.impliedVol ?? m.realizedVol21;
  if (levelValue === null) {
    out.push(insufficient("vol_level", "波动率水平", "波动率", "尚未形成有效波动率样本。"));
  } else {
    let score = 0;
    let why = "";
    if (levelValue >= 30) {
      score = 1.6;
      why = "进入恐慌区（≥30）。历史上纳斯达克恐慌顶部往往对应中期中位买点，但需分批、避免一次性抄底。";
    } else if (levelValue >= 22) {
      score = 0.7;
      why = "波动率偏高，风险溢价上升，适合开始关注左侧机会、降低追高冲动。";
    } else if (levelValue >= 15) {
      score = 0;
      why = "波动率处于中性区间，趋势跟随为主。";
    } else {
      score = -0.6;
      why = "波动率被压缩，市场自满情绪较重，尾部风险性价比低。";
    }
    out.push({
      id: "vol_level",
      name: `波动率水平（${volBasis}）`,
      group: "波动率",
      display: `${levelValue.toFixed(1)}`,
      raw: levelValue,
      state: stateOf(score),
      score,
      weight: 1,
      rationale: why,
    });
  }

  // 2. 波动率历史分位
  if (m.volPercentile5y === null) {
    out.push(insufficient("vol_percentile", "波动率 5 年分位", "波动率", "滚动 5 年样本不足 60 个交易日。"));
  } else {
    const p = m.volPercentile5y;
    let score = 0;
    let why = "";
    if (p >= 90) {
      score = 2;
      why = "处于近 5 年 90 分位以上，属极端恐慌区，历史上中期反弹概率较高，是可分批介入的信号。";
    } else if (p >= 75) {
      score = 1.1;
      why = "高于 75 分位，恐慌溢价明显，可考虑逐步建仓。";
    } else if (p >= 40) {
      score = 0;
      why = "分位中性，波动率既不便宜也不昂贵，按趋势与仓位纪律处理。";
    } else if (p >= 20) {
      score = -0.5;
      why = "低于 40 分位，市场平静，追高的风险回报比一般。";
    } else {
      score = -1;
      why = "处于 20 分位以下的极度压缩状态，历史上往往先于剧烈波动出现，建议保留对冲或降低杠杆。";
    }
    out.push({
      id: "vol_percentile",
      name: "波动率 5 年历史分位",
      group: "波动率",
      display: `${p.toFixed(1)}%`,
      raw: p,
      state: stateOf(score),
      score,
      weight: 1.2,
      rationale: why,
    });
  }

  // 3. 波动率均值回归速度（z 分数）
  if (m.volZScore === null) {
    out.push(insufficient("vol_zscore", "波动率 Z 分数", "波动率", "缺少 252 日基准窗口。"));
  } else {
    const z = m.volZScore;
    let score = 0;
    let why = "";
    if (z >= 2) {
      score = 1.5;
      why = `波动率高于自身年均值 ${z.toFixed(1)} 个标准差，均值回归力量强，恐慌溢价可交易。`;
    } else if (z >= 1) {
      score = 0.7;
      why = "波动率明显高于常态，情绪偏紧张。";
    } else if (z <= -1.5) {
      score = -1;
      why = "波动率显著低于常态，市场低估风险，需警惕突发放大回撤。";
    } else {
      score = 0;
      why = "波动率接近常态水平，无显著均值回归信号。";
    }
    out.push({
      id: "vol_zscore",
      name: "波动率 Z 分数（vs 252 日均值）",
      group: "波动率",
      display: z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2),
      raw: z,
      state: stateOf(score),
      score,
      weight: 1.2,
      rationale: why,
    });
  }

  // 4. 恐慌是否见顶回落
  if (m.realizedVol21 === null || m.volSlope21 === null) {
    out.push(insufficient("vol_turn", "波动率拐头", "情绪", "需要至少 42 个交易日波动率样本。"));
  } else {
    const high = m.realizedVol21 >= 22;
    const falling = m.volSlope21 < 0;
    let score = 0;
    let why = "";
    if (high && falling) {
      score = 1.5;
      why = `高波动且已开始回落（21 日变化 ${m.volSlope21.toFixed(1)}pp），情绪修复通常伴随反弹，属于较经典的加仓窗口。`;
    } else if (high && !falling) {
      score = -0.2;
      why = "高波动仍在抬升，恐慌未见顶，等待拐点更稳妥。";
    } else if (!high && !falling && m.volSlope21 <= -1) {
      score = 0.4;
      why = "波动率温和回落，风险偏好修复中。";
    } else {
      score = 0;
      why = "波动率斜率无明显方向性信息。";
    }
    out.push({
      id: "vol_turn",
      name: "高波动是否拐头回落",
      group: "情绪",
      display: `${m.volSlope21 > 0 ? "+" : ""}${m.volSlope21.toFixed(1)}pp / 21日`,
      raw: m.volSlope21,
      state: stateOf(score),
      score,
      weight: 0.9,
      rationale: why,
    });
  }

  // 5. 隐含-已实现价差（仅 VXN 可达时）
  if (m.impliedPremium === null) {
    out.push(
      insufficient(
        "implied_premium",
        "隐含-已实现价差",
        "情绪",
        "隐含波动率（VXN）数据源当前不可达，无法计算保险成本。",
      ),
    );
  } else {
    const sp = m.impliedPremium;
    let score = 0;
    let why = "";
    if (sp >= 4) {
      score = 0.8;
      why = "隐含波动率大幅高于实际波动，市场为下行保护支付高溢价，情绪悲观但已部分定价。";
    } else if (sp <= -2) {
      score = -1;
      why = "隐含低于已实现，保护近乎免费或被忽视，自满迹象。";
    } else {
      score = 0;
      why = "隐含与实际价差处于正常范围。";
    }
    out.push({
      id: "implied_premium",
      name: "隐含 − 已实现（保险成本）",
      group: "情绪",
      display: `${sp > 0 ? "+" : ""}${sp.toFixed(1)}`,
      raw: sp,
      state: stateOf(score),
      score,
      weight: 0.6,
      rationale: why,
    });
  }

  // 6. 长期均线趋势
  if (m.aboveMa200 === null) {
    out.push(insufficient("trend_long", "长期趋势（200 日线）", "趋势", "价格样本不足 200 个交易日。"));
  } else {
    const score = m.aboveMa200 ? 0.6 : -0.6;
    out.push({
      id: "trend_long",
      name: "相对 200 日均线位置",
      group: "趋势",
      display: m.aboveMa200 ? "上方" : "下方",
      raw: m.close,
      state: stateOf(score),
      score,
      weight: 1,
      rationale: m.aboveMa200
        ? "价格位于 200 日线上方，长期趋势健康，顺势持有优于逆势博弈。"
        : "价格跌破 200 日线，长期趋势转弱，波动率信号需要趋势确认再放大仓位。",
    });
  }

  // 7. 中期均线交叉
  const cross = detectMaCross(series, 20);
  if (cross === "golden") {
    out.push({
      id: "ma_cross",
      name: "50/200 日均线交叉",
      group: "趋势",
      display: "近 20 日金叉",
      raw: 1,
      state: "看多倾向",
      score: 1,
      weight: 0.8,
      rationale: "50 日线上穿 200 日线，趋势由弱转强，配合波动率下行时是较可靠的加仓组合。",
    });
  } else if (cross === "death") {
    out.push({
      id: "ma_cross",
      name: "50/200 日均线交叉",
      group: "趋势",
      display: "近 20 日死叉",
      raw: -1,
      state: "看空倾向",
      score: -1.2,
      weight: 0.8,
      rationale: "50 日线下穿 200 日线，趋势恶化，即使波动率很高也应控制仓位、分批而非一次性买入。",
    });
  } else if (cross === "none") {
    out.push({
      id: "ma_cross",
      name: "50/200 日均线交叉",
      group: "趋势",
      display: "无近期交叉",
      raw: 0,
      state: "中性",
      score: 0,
      weight: 0.8,
      rationale: "近 20 个交易日未发生均线交叉，趋势状态延续。",
    });
  } else {
    out.push(insufficient("ma_cross", "50/200 日均线交叉", "趋势", "需要至少 220 个交易日样本。"));
  }

  // 8. 回撤深度
  if (m.drawdown52w === null) {
    out.push(insufficient("drawdown", "52 周回撤", "价格结构", "缺少 252 日高点窗口。"));
  } else {
    const dd = m.drawdown52w;
    let score = 0;
    let why = "";
    if (dd <= -20) {
      score = 1.1;
      why = "距 52 周高点回撤超过 20%，进入技术性熊市区间，历史上与高波动叠加时中长期赔率改善。";
    } else if (dd <= -10) {
      score = 0.4;
      why = "回撤进入调整区（10%–20%），可结合波动率分位分批布局。";
    } else if (dd > -3) {
      score = -0.4;
      why = "接近 52 周高点，安全边际小，若同时波动率极低则不宜追高。";
    } else {
      score = 0;
      why = "回撤幅度温和。";
    }
    out.push({
      id: "drawdown",
      name: "距 52 周高点回撤",
      group: "价格结构",
      display: `${dd.toFixed(1)}%`,
      raw: dd,
      state: stateOf(score),
      score,
      weight: 0.9,
      rationale: why,
    });
  }

  // 9. 中期动量 + 恐慌抛售
  if (m.momentum63 === null || m.volPercentile5y === null) {
    out.push(insufficient("capitulation", "恐慌抛售识别", "价格结构", "需要 63 日动量与波动率分位。"));
  } else {
    const mom = m.momentum63;
    const panic = mom <= -12 && m.volPercentile5y >= 75;
    const overheated = mom >= 15 && m.volPercentile5y <= 25;
    let score = 0;
    let why = "";
    if (panic) {
      score = 1.2;
      why = `近 63 日下跌 ${Math.abs(mom).toFixed(1)}% 且波动率处于高分位，符合恐慌性抛售特征，中长期赔率提升。`;
    } else if (overheated) {
      score = -0.9;
      why = `近 63 日上涨 ${mom.toFixed(1)}% 而波动率被压至低分位，情绪过热，宜分批止盈或收紧止损。`;
    } else {
      score = 0;
      why = "动量与波动率组合未出现极端状态。";
    }
    out.push({
      id: "capitulation",
      name: "恐慌抛售 / 过热识别",
      group: "价格结构",
      display: `${mom > 0 ? "+" : ""}${mom.toFixed(1)}% / 63日`,
      raw: mom,
      state: stateOf(score),
      score,
      weight: 0.9,
      rationale: why,
    });
  }

  // 10. 短长波动率结构
  if (m.realizedVol21 === null || m.realizedVol63 === null) {
    out.push(insufficient("vol_term", "短期 vs 中期波动结构", "波动率", "需要 21 日与 63 日波动率。"));
  } else {
    const spread = m.realizedVol21 - m.realizedVol63;
    let score = 0;
    let why = "";
    if (spread <= -3) {
      score = 0.6;
      why = "短期波动明显低于 63 日波动，冲击已过、风险在释放后回落。";
    } else if (spread >= 3) {
      score = -0.5;
      why = "短期波动高于中期波动，冲击仍在发酵。";
    } else {
      score = 0;
      why = "期限结构平滑，无短期冲击信号。";
    }
    out.push({
      id: "vol_term",
      name: "21 日 − 63 日波动差",
      group: "波动率",
      display: `${spread > 0 ? "+" : ""}${spread.toFixed(1)}pp`,
      raw: round(spread),
      state: stateOf(score),
      score,
      weight: 0.7,
      rationale: why,
    });
  }

  return out;
}

function detectMaCross(series: VolPoint[], lookback: number): "golden" | "death" | "none" | null {
  const n = series.length;
  if (n < 220) return null;
  const start = Math.max(1, n - lookback);
  let sawGolden = false;
  let sawDeath = false;
  for (let i = start; i < n; i++) {
    const a = series[i];
    const b = series[i - 1];
    if (a.ma50 === null || a.ma200 === null || b.ma50 === null || b.ma200 === null) continue;
    if (b.ma50 <= b.ma200 && a.ma50 > a.ma200) sawGolden = true;
    if (b.ma50 >= b.ma200 && a.ma50 < a.ma200) sawDeath = true;
  }
  if (sawDeath && !sawGolden) return "death";
  if (sawGolden && !sawDeath) return "golden";
  if (sawGolden && sawDeath) return "none";
  return "none";
}

export function composite(signals: Signal[]): Composite {
  const active = signals.filter((s) => s.state !== "数据不足");
  const weightSum = active.reduce((a, s) => a + s.weight, 0) || 1;
  const raw = active.reduce((a, s) => a + s.weight * s.score, 0);
  const score = Math.max(-100, Math.min(100, Math.round((raw / (weightSum * 2)) * 100)));
  let stanceKey: Composite["stanceKey"] = "hold";
  let stance = "持有观望";
  if (score >= 30) {
    stanceKey = "buy";
    stance = "分批买入区间";
  } else if (score >= 10) {
    stanceKey = "add";
    stance = "可小幅加仓 / 加速定投";
  } else if (score <= -30) {
    stanceKey = "reduce";
    stance = "明显减仓 / 降低杠杆";
  } else if (score <= -10) {
    stanceKey = "trim";
    stance = "谨慎持有 / 部分减仓";
  }
  const pos = active.filter((s) => s.score > 0.4).map((s) => s.name);
  const neg = active.filter((s) => s.score < -0.4).map((s) => s.name);
  const summary =
    `正向 ${pos.length} 项${pos.length ? `（${pos.slice(0, 3).join("、")}）` : ""}，` +
    `负向 ${neg.length} 项${neg.length ? `（${neg.slice(0, 3).join("、")}）` : ""}。` +
    "规则权重固定、可复现，供量化诊断与 AI 判断参考，不构成投资建议。";
  return { score, stance, stanceKey, summary };
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

/** 波动率分位桶 → 未来 63/126 交易日表现（实证研究表） */
export function regimeStudy(series: VolPoint[], horizons = [63, 126]): RegimeRow[] {
  const buckets = [
    { label: "0–20 分位（极度压缩）", min: 0, max: 20 },
    { label: "20–40 分位", min: 20, max: 40 },
    { label: "40–60 分位", min: 40, max: 60 },
    { label: "60–80 分位", min: 60, max: 80 },
    { label: "80–95 分位", min: 80, max: 95 },
    { label: "95–100 分位（极端恐慌）", min: 95, max: 101 },
  ];
  const rows: RegimeRow[] = [];
  for (const b of buckets) {
    const f63: number[] = [];
    const f126: number[] = [];
    for (let i = 0; i < series.length; i++) {
      const p = series[i].pct5y;
      if (p === null || p < b.min || p >= b.max) continue;
      const base = series[i].close;
      if (i + horizons[0] < series.length) f63.push((series[i + horizons[0]].close / base - 1) * 100);
      if (i + horizons[1] < series.length) f126.push((series[i + horizons[1]].close / base - 1) * 100);
    }
    if (!f63.length) {
      rows.push({ bucket: b.label, samples: 0, avg63: null, median63: null, winRate63: null, worst63: null, best63: null, avg126: null });
      continue;
    }
    const sorted = [...f63].sort((x, y) => x - y);
    rows.push({
      bucket: b.label,
      samples: f63.length,
      avg63: round(mean(f63)),
      median63: round(sorted[Math.floor(sorted.length / 2)]),
      winRate63: round((f63.filter((x) => x > 0).length / f63.length) * 100, 1),
      worst63: round(sorted[0]),
      best63: round(sorted[sorted.length - 1]),
      avg126: f126.length ? round(mean(f126)) : null,
    });
  }
  return rows;
}

/** 波动率 × 趋势 双维矩阵，用于情景化诊断 */
export interface MatrixCell {
  vol: string;
  trend: string;
  samples: number;
  avg63: number | null;
  winRate63: number | null;
}

export function volTrendMatrix(series: VolPoint[]): MatrixCell[] {
  const volStates = [
    { label: "低波动 <15", test: (v: number) => v < 15 },
    { label: "中性 15–22", test: (v: number) => v >= 15 && v < 22 },
    { label: "偏高 22–30", test: (v: number) => v >= 22 && v < 30 },
    { label: "恐慌 ≥30", test: (v: number) => v >= 30 },
  ];
  const trendStates = [
    { label: "200 日线上方", above: true },
    { label: "200 日线下方", above: false },
  ];
  const cells: MatrixCell[] = [];
  for (const v of volStates) {
    for (const t of trendStates) {
      const f: number[] = [];
      for (let i = 200; i < series.length - 63; i++) {
        const rv = series[i].rv21;
        const ma = series[i].ma200;
        if (rv === null || ma === null) continue;
        if (!v.test(rv)) continue;
        if ((series[i].close > ma) !== t.above) continue;
        f.push((series[i + 63].close / series[i].close - 1) * 100);
      }
      cells.push({
        vol: v.label,
        trend: t.label,
        samples: f.length,
        avg63: f.length ? round(mean(f)) : null,
        winRate63: f.length ? round((f.filter((x) => x > 0).length / f.length) * 100, 1) : null,
      });
    }
  }
  return cells;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 按年份聚合：年度已实现波动率均值与年度涨跌幅 */
export interface AnnualRow {
  year: string;
  avgRv21: number | null;
  maxRv21: number | null;
  avgVxn: number | null;
  changePct: number | null;
}

export function annualSummary(series: VolPoint[]): AnnualRow[] {
  const byYear = new Map<string, VolPoint[]>();
  for (const p of series) {
    const y = p.date.slice(0, 4);
    const list = byYear.get(y);
    if (list) list.push(p);
    else byYear.set(y, [p]);
  }
  const years = [...byYear.keys()].sort((a, b) => a.localeCompare(b));
  const out: AnnualRow[] = [];
  let prevLast: VolPoint | null = null;
  for (const year of years) {
    const list = byYear.get(year) as VolPoint[];
    const rvs = list.map((p) => p.rv21).filter((x): x is number => x !== null);
    const vxns = list.map((p) => p.vxn).filter((x): x is number => x !== null);
    const lastP = list[list.length - 1];
    // 年度涨跌幅：相对上一年最后一个交易日；无上一年样本时相对本年首个交易日
    const base = prevLast ?? list[0];
    out.push({
      year,
      avgRv21: rvs.length ? round(mean(rvs)) : null,
      maxRv21: rvs.length ? round(Math.max(...rvs)) : null,
      avgVxn: vxns.length ? round(mean(vxns)) : null,
      changePct: base && base.close > 0 ? round((lastP.close / base.close - 1) * 100) : null,
    });
    prevLast = lastP;
  }
  return out;
}

/** 降采样，用于长周期图表 */
export function resample(series: VolPoint[], freq: "1d" | "1w" | "1m"): VolPoint[] {
  if (freq === "1d") return series;
  const out: VolPoint[] = [];
  let key = "";
  for (const p of series) {
    const k = freq === "1w" ? isoWeek(p.date) : p.date.slice(0, 7);
    if (k !== key) {
      out.push({ ...p });
      key = k;
    } else {
      // 同一周/月内保留最后一个交易日的观测
      out[out.length - 1] = { ...p };
    }
  }
  return out;
}

function isoWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function sliceByYears(series: VolPoint[], years: number | null): VolPoint[] {
  if (!years) return series;
  const bars = Math.round(years * TRADING_DAYS);
  return series.length > bars ? series.slice(series.length - bars) : series;
}

export function distribution(
  series: VolPoint[],
  bins = 18,
): { label: string; from: number; to: number; count: number }[] {
  const values = series.map((p) => p.rv21).filter((x): x is number => x !== null);
  if (!values.length) return [];
  const lo = Math.floor(Math.min(...values));
  const hi = Math.ceil(Math.max(...values));
  const step = Math.max(0.5, (hi - lo) / bins);
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - lo) / step));
    counts[idx]++;
  }
  return counts.map((count, i) => {
    const from = round(lo + i * step, 1) as number;
    const to = round(lo + (i + 1) * step, 1) as number;
    return { label: `${from.toFixed(0)}–${to.toFixed(0)}`, from, to, count };
  });
}

/* ===================== 事件研究：研报发布后的指数表现 ===================== */

/** 事件研究默认观察的前向交易日 */
export const EVENT_HORIZONS = [1, 5, 20, 60, 120];
/** 绘图路径：报告日前 20 至后 60 个交易日 */
export const EVENT_PATH_BACK = 20;
export const EVENT_PATH_FWD = 60;

export interface EventOutcome {
  eventId: string;
  symbol: string;
  /** 报告记载日 */
  eventDate: string;
  /** 实际对齐的交易日（报告日当日或其后的首个交易日） */
  anchorDate: string;
  /** 报告日到对齐交易日的自然日差 */
  shiftDays: number;
  anchorClose: number;
  /** 相对锚点收盘价的累计涨跌幅序列（%） */
  path: { offset: number; date: string; ret: number }[];
  /** 各前向交易日的累计涨跌幅（%），未到期为 null */
  forward: { days: number; ret: number | null }[];
  /** 其后 60 个交易日内的最大涨幅与最大回撤（%） */
  peak60: number | null;
  trough60: number | null;
  /** 报告时点与报告后 21 个交易日的已实现波动率，用于判断「消息是否出现在高波动环境」 */
  rv21At: number | null;
  rv21After: number | null;
}

/** 二分查找：序列中首个 date >= target 的下标，全部更早时返回 -1 */
function lowerBound(series: VolPoint[], target: string): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < series.length ? lo : -1;
}

/** 单个标的对一组事件的研究：报告前后累计收益、前向收益与波动环境 */
export function eventStudy(
  series: VolPoint[],
  symbol: string,
  events: { id: string; date: string }[],
  horizons: number[] = EVENT_HORIZONS,
): EventOutcome[] {
  const out: EventOutcome[] = [];
  for (const ev of events) {
    const i0 = lowerBound(series, ev.date);
    if (i0 === -1) continue;
    const anchor = series[i0];
    const base = anchor.close;
    if (!Number.isFinite(base) || base <= 0) continue;

    const path: EventOutcome["path"] = [];
    for (let k = -EVENT_PATH_BACK; k <= EVENT_PATH_FWD; k++) {
      const i = i0 + k;
      if (i < 0 || i >= series.length) continue;
      path.push({ offset: k, date: series[i].date, ret: round((series[i].close / base - 1) * 100) as number });
    }

    const forward = horizons.map((h) => {
      const i = i0 + h;
      return { days: h, ret: i < series.length ? round((series[i].close / base - 1) * 100) as number : null };
    });

    let peak: number | null = null;
    let trough: number | null = null;
    for (let k = 1; k <= Math.min(EVENT_PATH_FWD, series.length - i0 - 1); k++) {
      const ret = (series[i0 + k].close / base - 1) * 100;
      peak = peak === null ? ret : Math.max(peak, ret);
      trough = trough === null ? ret : Math.min(trough, ret);
    }

    const after = series[Math.min(series.length - 1, i0 + 21)];

    out.push({
      eventId: ev.id,
      symbol,
      eventDate: ev.date,
      anchorDate: anchor.date,
      shiftDays: Math.round((Date.parse(anchor.date) - Date.parse(ev.date)) / 86400000),
      anchorClose: round(base) as number,
      path,
      forward,
      peak60: round(peak),
      trough60: round(trough),
      rv21At: anchor.rv21,
      rv21After: after ? after.rv21 : null,
    });
  }
  return out;
}

export interface BaselineRow {
  days: number;
  samples: number;
  avg: number | null;
  median: number | null;
  winRate: number | null;
}

/** 无条件基线：同一序列上任意交易日的 h 日前向收益分布，用于与事件后表现对比 */
export function baselineForward(series: VolPoint[], horizons: number[] = EVENT_HORIZONS): BaselineRow[] {
  return horizons.map((h) => {
    const rets: number[] = [];
    for (let i = 0; i + h < series.length; i++) {
      const base = series[i].close;
      if (Number.isFinite(base) && base > 0) rets.push((series[i + h].close / base - 1) * 100);
    }
    if (!rets.length) return { days: h, samples: 0, avg: null, median: null, winRate: null };
    const sorted = [...rets].sort((a, b) => a - b);
    return {
      days: h,
      samples: rets.length,
      avg: round(mean(rets)),
      median: round(sorted[Math.floor(sorted.length / 2)]),
      winRate: round((rets.filter((x) => x > 0).length / rets.length) * 100, 1),
    };
  });
}

export interface StanceSummaryRow {
  stance: string;
  events: number;
  rows: { days: number; avg: number | null; winRate: number | null; samples: number }[];
}

/** 按报告方向（看多 / 看空）汇总事件后表现，样本极少时仍如实给出事件数 */
export function stanceSummary(
  outcomes: EventOutcome[],
  stanceOf: Map<string, string>,
  horizons: number[] = EVENT_HORIZONS,
): StanceSummaryRow[] {
  const groups = new Map<string, EventOutcome[]>();
  for (const o of outcomes) {
    const s = stanceOf.get(o.eventId) ?? "未分类";
    const list = groups.get(s);
    if (list) list.push(o);
    else groups.set(s, [o]);
  }
  const rows: StanceSummaryRow[] = [];
  for (const [stance, list] of groups) {
    rows.push({
      stance,
      events: list.length,
      rows: horizons.map((h) => {
        const vals = list
          .map((o) => o.forward.find((f) => f.days === h)?.ret)
          .filter((x): x is number => typeof x === "number");
        return {
          days: h,
          samples: vals.length,
          avg: vals.length ? round(mean(vals)) : null,
          winRate: vals.length ? round((vals.filter((x) => x > 0).length / vals.length) * 100, 1) : null,
        };
      }),
    });
  }
  return rows.sort((a, b) => b.events - a.events);
}

/* ===================== 恐慌指数（VIX / VXN 水平序列） ===================== */

export interface PanicPoint {
  date: string;
  level: number;
  /** level 相对滚动 5 年窗口的百分位（0-100） */
  pct5y: number | null;
  /** level 相对全部可得样本的扩展分位（0-100） */
  pctAll: number | null;
  /** level 相对其 252 日均值的 z 分数 */
  z: number | null;
}

/** 对恐慌指数「水平」序列（非价格序列）计算分位与 z 分数 */
export function panicSeries(rows: Row[]): PanicPoint[] {
  const levels = rows.map((r) => r[1]);
  const pct5y = rollingPercentile(levels, 5 * TRADING_DAYS);
  const pctAll = expandingPercentile(levels);
  const z = rollingZ(levels, TRADING_DAYS);
  return rows.map((r, i) => ({
    date: r[0],
    level: round(levels[i]),
    pct5y: round(pct5y[i], 1),
    pctAll: round(pctAll[i], 1),
    z: round(z[i]),
  }));
}

export interface PanicLatest {
  asOf: string;
  level: number;
  pct5y: number | null;
  pctAll: number | null;
  z: number | null;
  regime: ReturnType<typeof volRegime>;
}

export function panicLatest(series: PanicPoint[]): PanicLatest | null {
  const last = series[series.length - 1];
  if (!last) return null;
  return {
    asOf: last.date,
    level: last.level,
    pct5y: last.pct5y,
    pctAll: last.pctAll,
    z: last.z,
    regime: volRegime(last.level),
  };
}

/* ===================== A 股个股诊断（含韩国综合指数联动） ===================== */

export interface StockSignal {
  id: string;
  name: string;
  group: "趋势" | "动量" | "波动率" | "价格结构" | "区域联动";
  display: string;
  raw: number | null;
  state: "看多倾向" | "看空倾向" | "中性" | "数据不足";
  /** 规则得分 -2..2 */
  score: number;
  /** 信息系数：该规则多空状态间的前向 63 日收益差（百分点），权重据此动态取值 */
  ic: number | null;
  /** 动态权重（%），全规则合计 100 */
  weight: number;
  rationale: string;
}

export interface StockMetrics {
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
  /** 对韩国综合指数的 63 日对数收益 beta */
  betaKospi63: number | null;
}

export interface StockComposite {
  score: number;
  stance: string;
  stanceKey: "buy" | "add" | "hold" | "trim" | "reduce";
  summary: string;
}

/** 个股收盘价序列的 63 日对数收益 beta（个股对 KOSPI） */
export function kospiBeta(stock: VolPoint[], kospi: VolPoint[]): number | null {
  const map = new Map<string, number>();
  for (const p of kospi) map.set(p.date, p.close);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < stock.length; i++) {
    const k1 = map.get(stock[i - 1].date);
    const k2 = map.get(stock[i].date);
    if (k1 === undefined || k2 === undefined || k1 <= 0 || k2 <= 0) continue;
    if (stock[i - 1].close <= 0 || stock[i].close <= 0) continue;
    xs.push(Math.log(k2 / k1));
    ys.push(Math.log(stock[i].close / stock[i - 1].close));
  }
  const n = Math.min(xs.length, 63);
  if (n < 40) return null;
  const sx = xs.slice(-n);
  const sy = ys.slice(-n);
  const mx = mean(sx);
  const my = mean(sy);
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < n; i++) {
    cov += (sx[i] - mx) * (sy[i] - my);
    varx += (sx[i] - mx) * (sx[i] - mx);
  }
  return varx > 1e-12 ? round(cov / varx, 2) : null;
}

function clampScore(v: number): number {
  return Math.max(-2, Math.min(2, v));
}

/** 个股规则：在序列下标 i 处给出得分（-2..2）与解释；同一函数用于全历史回测 IC 与最新一期信号 */
function stockRuleScore(
  id: string,
  series: VolPoint[],
  i: number,
  kospi: Map<string, VolPoint>,
): { score: number; display: string; raw: number | null; state: StockSignal["state"]; rationale: string } | null {
  const p = series[i];
  const k = kospi.get(p.date);
  const kospiPct5 = k?.pct5y ?? null;
  const kospiMom = k?.mom63 ?? null;
  const insuff = (why: string) => ({ score: 0, display: "—", raw: null, state: "数据不足" as const, rationale: why });

  if (id === "trend") {
    if (p.ma50 === null || p.ma200 === null) return insuff("需要至少 200 个交易日均线样本。");
    const above50 = p.close > p.ma50;
    const above200 = p.close > p.ma200;
    const score = above50 && above200 ? 1 : !above50 && !above200 ? -1 : 0;
    const label = above50 && above200 ? "双线上方" : !above50 && !above200 ? "双线下方" : "均线之间";
    return {
      score,
      display: label,
      raw: (p.close / p.ma200 - 1) * 100,
      state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性",
      rationale:
        score > 0
          ? "股价位于 50 日与 200 日均线上方，中期趋势健康。"
          : score < 0
            ? "股价跌破 50 日与 200 日均线，趋势转弱，需要更多信号确认再介入。"
            : "股价位于两条均线之间，方向未明。",
    };
  }

  if (id === "momentum") {
    if (p.mom63 === null) return insuff("需要至少 63 个交易日样本。");
    const m = p.mom63;
    let score = 0;
    let why = "";
    if (m >= 12) {
      score = 1.2;
      why = "63 日涨幅超过 12%，趋势动能强，顺势持有优于逆向卖出。";
    } else if (m >= 5) {
      score = 0.6;
      why = "中期动量温和向上。";
    } else if (m <= -12) {
      score = -1.2;
      why = "63 日跌幅超过 12%，下跌动能未止，避免逆势重仓。";
    } else if (m <= -5) {
      score = -0.6;
      why = "中期动量偏弱。";
    } else {
      why = "中期动量接近零，无方向性信息。";
    }
    return { score, display: `${m > 0 ? "+" : ""}${m.toFixed(1)}%`, raw: m, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  if (id === "vol_percentile") {
    if (p.pct5y === null) return insuff("波动率 5 年分位样本不足。");
    const pc = p.pct5y;
    let score = 0;
    let why = "";
    if (pc >= 85) {
      score = 1;
      why = "波动率处于近 5 年 85 分位以上，个股情绪恐慌、错杀概率上升，是分批布局区。";
    } else if (pc >= 60) {
      score = 0.4;
      why = "波动率偏高，风险溢价上升。";
    } else if (pc <= 15) {
      score = -0.8;
      why = "波动率处于 15 分位以下的极度压缩状态，历史上常先于剧烈波动，不宜追高。";
    } else if (pc <= 35) {
      score = -0.3;
      why = "波动率偏低，市场平静。";
    } else {
      why = "波动率分位中性。";
    }
    return { score, display: `${pc.toFixed(0)}%`, raw: pc, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  if (id === "vol_level") {
    if (p.rv21 === null) return insuff("需要至少 21 个交易日样本。");
    const v = p.rv21;
    let score = 0;
    let why = "";
    if (v >= 50) {
      score = -0.8;
      why = "21 日年化波动率超过 50%，个股风险极高，仓位需明显收缩。";
    } else if (v >= 35) {
      score = -0.4;
      why = "波动率偏高，仓位应偏谨慎。";
    } else if (v < 20) {
      score = 0.3;
      why = "波动率温和，持有体验较好。";
    } else {
      why = "波动率处于个股常见区间。";
    }
    return { score, display: `${v.toFixed(1)}%`, raw: v, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  if (id === "vol_zscore") {
    if (p.z21 === null) return insuff("缺少 252 日波动率基准。");
    const z = p.z21;
    let score = 0;
    let why = "";
    if (z >= 2) {
      score = 0.6;
      why = `波动率高于自身年均值 ${z.toFixed(1)} 个标准差，情绪过度，均值回归力量偏强。`;
    } else if (z >= 1) {
      score = 0.3;
      why = "波动率明显高于常态。";
    } else if (z <= -1.5) {
      score = -0.5;
      why = "波动率显著低于常态，风险被低估。";
    } else {
      why = "波动率接近常态，无显著信号。";
    }
    return { score, display: z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2), raw: z, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  if (id === "vol_turn") {
    if (p.rv21 === null || p.rv21Slope === null) return insuff("需要至少 42 个交易日样本。");
    const v = p.rv21;
    const s = p.rv21Slope;
    let score = 0;
    let why = "";
    if (v >= 35 && s < 0) {
      score = 0.8;
      why = `高波动且已回落（21 日变化 ${s.toFixed(1)}pp），冲击释放中，是情绪修复信号。`;
    } else if (v >= 35 && s >= 0) {
      score = -0.3;
      why = "高波动仍在抬升，冲击未止。";
    } else if (s <= -2) {
      score = 0.3;
      why = "波动率温和回落。";
    } else {
      why = "波动率斜率无方向性信息。";
    }
    return { score, display: `${s > 0 ? "+" : ""}${s.toFixed(1)}pp`, raw: s, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  if (id === "drawdown") {
    if (p.drawdown === null) return insuff("缺少 252 日高点窗口。");
    const dd = p.drawdown;
    let score = 0;
    let why = "";
    if (dd <= -30) {
      score = 1.2;
      why = "距 52 周高点回撤超过 30%，深度超跌区，中长期赔率改善。";
    } else if (dd <= -20) {
      score = 0.8;
      why = "回撤超过 20%，进入调整深水区。";
    } else if (dd <= -10) {
      score = 0.4;
      why = "回撤 10%–20%，可结合波动率分位分批。";
    } else if (dd > -3) {
      score = -0.4;
      why = "贴近 52 周高点，安全边际小。";
    } else {
      why = "回撤幅度温和。";
    }
    return { score, display: `${dd.toFixed(1)}%`, raw: dd, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  if (id === "kospi") {
    if (kospiMom === null) return insuff("韩国综合指数序列不足 63 日。");
    let score = clampScore(kospiMom / 15) * 1.5;
    if (kospiPct5 !== null && kospiPct5 >= 80) score -= 0.4;
    score = round(score) as number;
    let why = `韩国综合指数 63 日动量 ${kospiMom > 0 ? "+" : ""}${kospiMom.toFixed(1)}%（区域风险偏好${kospiMom >= 0 ? "回暖" : "回落"}）`;
    if (kospiPct5 !== null && kospiPct5 >= 80) why += "，且其波动率处于高分位，区域情绪偏恐慌";
    why += "。";
    return { score, display: `${kospiMom > 0 ? "+" : ""}${kospiMom.toFixed(1)}%`, raw: kospiMom, state: score > 0.4 ? "看多倾向" : score < -0.4 ? "看空倾向" : "中性", rationale: why };
  }

  return null;
}

const STOCK_RULES: { id: string; name: string; group: StockSignal["group"] }[] = [
  { id: "trend", name: "均线趋势（50/200 日）", group: "趋势" },
  { id: "momentum", name: "中期动量（63 日）", group: "动量" },
  { id: "vol_percentile", name: "波动率 5 年分位", group: "波动率" },
  { id: "vol_level", name: "波动率绝对水平", group: "波动率" },
  { id: "vol_zscore", name: "波动率 Z 分数", group: "波动率" },
  { id: "vol_turn", name: "高波动是否拐头回落", group: "波动率" },
  { id: "drawdown", name: "距 52 周高点回撤", group: "价格结构" },
  { id: "kospi", name: "韩国综合指数联动", group: "区域联动" },
];

/** 前向 h 个交易日收益序列（%），最后 h 天为 null */
function forwardReturns(series: VolPoint[], h: number): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  for (let i = 0; i + h < series.length; i++) {
    if (series[i].close > 0) out[i] = round((series[i + h].close / series[i].close - 1) * 100);
  }
  return out;
}

export interface StockWeighting {
  horizon: number;
  method: string;
  floor: number;
  cap: number;
}

export const STOCK_WEIGHTING: StockWeighting = {
  horizon: 63,
  method:
    "权重按历史信息系数动态取值：对每条规则，取全部历史中得分 >0.4 与 <-0.4 两个状态组的未来 63 日收益均值差（信息系数 IC，百分点），|IC| 截断到 [0.5, 3]，再归一化为合计 100%。样本越有区分度的规则权重越大，随数据更新自动变化。",
  floor: 0.5,
  cap: 3,
};

/**
 * 个股信号与动态 IC 权重：
 * 1) 对全历史逐日计算 8 条规则得分，用未来 63 日收益估计每条规则的 IC；
 * 2) 权重 = |IC| 截断 [0.5,3] 后归一化；
 * 3) 用最新一期得分合成五档建议（买入/加仓/持有/减仓/卖出）。
 */
export function stockSignals(
  series: VolPoint[],
  kospi: VolPoint[],
): { signals: StockSignal[]; composite: StockComposite } {
  const kospiMap = new Map<string, VolPoint>();
  for (const p of kospi) kospiMap.set(p.date, p);

  // 全历史逐日得分（用于 IC 估计），最后一期得分用于输出
  const fwd = forwardReturns(series, STOCK_WEIGHTING.horizon);

  const icOf = new Map<string, number | null>();
  for (const rule of STOCK_RULES) {
    const pos: number[] = [];
    const neg: number[] = [];
    for (let i = 0; i < series.length; i++) {
      const r = stockRuleScore(rule.id, series, i, kospiMap);
      const s = r ? r.score : 0;
      const f = fwd[i];
      if (f === null) continue;
      if (s > 0.4) pos.push(f);
      else if (s < -0.4) neg.push(f);
    }
    let ic: number | null = null;
    if (pos.length >= 5 && neg.length >= 5) {
      const eff = mean(pos) - mean(neg);
      ic = round(Math.max(-STOCK_WEIGHTING.cap, Math.min(STOCK_WEIGHTING.cap, eff)));
    }
    icOf.set(rule.id, ic);
  }

  // 动态权重：|IC| 截断后归一化，IC 缺失（样本不足）的规则按底限 0.5 参与
  const rawWeights = STOCK_RULES.map((r) => {
    const ic = icOf.get(r.id);
    return Math.max(STOCK_WEIGHTING.floor, Math.min(STOCK_WEIGHTING.cap, Math.abs(ic ?? STOCK_WEIGHTING.floor)));
  });
  const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const weights = rawWeights.map((w) => round((w / weightSum) * 100, 1));

  const signals: StockSignal[] = STOCK_RULES.map((rule, idx) => {
    const lastIdx = series.length - 1;
    const r = stockRuleScore(rule.id, series, lastIdx, kospiMap);
    const ic = icOf.get(rule.id) ?? null;
    if (!r || r.state === "数据不足") {
      return {
        id: rule.id,
        name: rule.name,
        group: rule.group,
        display: "—",
        raw: null,
        state: "数据不足",
        score: 0,
        ic: ic ?? null,
        weight: 0,
        rationale: r?.rationale ?? "样本不足。",
      };
    }
    return { id: rule.id, name: rule.name, group: rule.group, display: r.display, raw: r.raw, state: r.state, score: r.score, ic, weight: weights[idx], rationale: r.rationale };
  });

  const active = signals.filter((s) => s.state !== "数据不足" && s.weight > 0);
  const wSum = active.reduce((a, s) => a + s.weight, 0) || 1;
  const raw = active.reduce((a, s) => a + s.weight * s.score, 0);
  const score = Math.max(-100, Math.min(100, Math.round((raw / (wSum * 2)) * 100)));
  let stanceKey: StockComposite["stanceKey"] = "hold";
  let stance = "持有";
  if (score >= 30) {
    stanceKey = "buy";
    stance = "买入";
  } else if (score >= 10) {
    stanceKey = "add";
    stance = "加仓";
  } else if (score <= -30) {
    stanceKey = "reduce";
    stance = "卖出";
  } else if (score <= -10) {
    stanceKey = "trim";
    stance = "减仓";
  }
  const pos = active.filter((s) => s.score > 0.4).map((s) => s.name);
  const neg = active.filter((s) => s.score < -0.4).map((s) => s.name);
  const summary =
    `正向 ${pos.length} 项${pos.length ? `（${pos.slice(0, 3).join("、")}）` : ""}，负向 ${neg.length} 项${neg.length ? `（${neg.slice(0, 3).join("、")}）` : ""}；` +
    `权重为 ${STOCK_WEIGHTING.horizon} 日前向收益信息系数动态归一化，随行情自动更新。`;
  return { signals, composite: { score, stance, stanceKey, summary } };
}

/** 个股最新核心指标 */
export function stockMetrics(series: VolPoint[], beta: number | null): StockMetrics | null {
  if (series.length < 3) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const mom21 = last.mom63 !== null && series.length >= 21 ? round((last.close / series[series.length - 22]?.close - 1) * 100) : null;
  return {
    asOf: last.date,
    close: last.close,
    dayChangePct: prev && prev.close > 0 ? round((last.close / prev.close - 1) * 100) : null,
    rv21: last.rv21,
    rv63: last.rv63,
    volPercentile5y: last.pct5y,
    volPercentileAll: last.pctAll,
    volZScore: last.z21,
    volSlope21: last.rv21Slope,
    momentum21: mom21,
    momentum63: last.mom63,
    drawdown52w: last.drawdown,
    aboveMa50: last.ma50 === null ? null : last.close > last.ma50,
    aboveMa200: last.ma200 === null ? null : last.close > last.ma200,
    betaKospi63: beta,
  };
}

