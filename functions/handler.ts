// Qoder Sites Edge Function：波动率分析、事件复盘与受保护的 DeepSeek 服务端诊断接口
import {
  annualSummary,
  baselineForward,
  buildSeries,
  buildSignals,
  composite,
  computeMetrics,
  distribution,
  eventStudy,
  EVENT_HORIZONS,
  EVENT_PATH_BACK,
  EVENT_PATH_FWD,
  kospiBeta,
  panicLatest,
  panicSeries,
  regimeStudy,
  resample,
  sliceByYears,
  stanceSummary,
  stockMetrics,
  stockSignals,
  STOCK_WEIGHTING,
  volRegime,
  volTrendMatrix,
  type Metrics,
  type Signal,
  type VolPoint,
} from "./analytics.ts";
import {
  DEFAULT_SYMBOL,
  EXTRA_STOCK_LIMIT,
  SNAPSHOT_META,
  SYMBOLS,
  dividendInfos,
  dividendMeta,
  getDataset,
  getDividendDataset,
  getStockDataset,
  isSupportedStockCode,
  kospiMeta,
  stockInfos,
  stockMeta,
  symbolConfig,
  symbolKeys,
} from "./datasource.ts";
import {
  DIVIDEND_DISCLAIMER,
  DIVIDEND_STRATEGY,
  buildDividendSeries,
  dividendMetrics,
  dividendSignals,
} from "./dividend.ts";
import { DIVIDEND_GROUPS, DIVIDEND_WATCHLIST_NOTE } from "./data/dividendWatchlist.ts";
import {
  MACRO_LIMITS,
  MACRO_YEARS_ALLOWED,
  getMacroAnalysis,
  macroAiBundle,
  macroDefinition,
  macroMarkdown,
  macroSnapshotMeta,
} from "./macro.ts";
import {
  CYCLE_LIMITS,
  CYCLE_YEARS_ALLOWED,
  cycleAiBundle,
  cycleDefinition,
  cycleMarkdown,
  getCycleAnalysis,
} from "./cycle.ts";
import {
  VALUATION_LIMITS,
  VALUATION_YEARS_ALLOWED,
  getValuationAnalysis,
  valuationAiBundle,
  valuationDefinition,
  valuationMarkdown,
  valuationSnapshotMeta,
} from "./valuation.ts";
import { EVENTS_PROVENANCE, REPORT_BROKER, reportEvents } from "./data/events.ts";
import { WATCHLIST_NOTE } from "./data/watchlist.ts";

const VERSION = "1.9.0";
const ROUTE_ROOTS = ["api", "health", "docs"];

/** A 股主要指数：大摩报告复盘的默认研究标的 */
const A_SHARE_SYMBOLS = ["SSE", "CSI300"];

const PANIC_DEFINITION = {
  level: "VIX 收盘指数（CBOE 标普500 30 天隐含波动率）",
  pct5y: "level 相对滚动 5 年窗口的百分位（0-100）",
  pctAll: "level 相对全部可得样本的扩展分位（0-100）",
  z: "level 相对其 252 日均值的标准分数",
  regime: "按绝对水平分档：<15 压缩、15–22 中性、22–30 偏高、≥30 恐慌",
  note: "VIX 度量标普500 期权隐含波动率；纳斯达克100 对应的隐含波动率是 VXN，两者走势高度同步但水平不同。",
};

const STOCK_DISCLAIMER =
  "个股诊断为量化规则与历史统计输出（权重按历史信息系数动态取值），不构成投资建议、收益承诺或个性化推荐；历史表现不保证未来结果。";

const MACRO_DISCLAIMER =
  "跨资产分析为基于 GLD / USO / TLT 收盘价与 FRED DGS10 的量化统计与启发式风险提示，不构成投资建议、收益预测或交易信号；ETF 代理存在管理费、跟踪误差与期货展期成本。";

const CYCLE_DISCLAIMER =
  "康波对照为基于真实指数收盘价的量化统计与启发式阶段匹配，不判定长波年份、不预测涨跌，不构成投资建议或交易信号。";

const VALUATION_DISCLAIMER =
  "巴菲特指数为美联储 Z.1 非金融企业股权市值 ÷ 名义 GDP 的季度统计，与 Wilshire/GDP 口径不同；历史分位只描述相对位置，不构成投资建议、收益预测或择时信号。";

const YEARS_ALLOWED = [1, 2, 3, 5, 10, 20];
const FREQ_ALLOWED = ["1d", "1w", "1m"];

interface Ctx {
  symbol: string;
  years: number | null;
  freq: "1d" | "1w" | "1m";
  series: VolPoint[];
  full: VolPoint[];
  metrics: Metrics | null;
  signals: Signal[];
  comp: ReturnType<typeof composite>;
  refresh: boolean;
  statuses: { id: string; label: string; mode: string; ok: boolean; note: string }[];
}

function json(data: unknown, status = 200, extra: Headers | Record<string, string> = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60",
    "Access-Control-Allow-Origin": "*",
    ...(extra as Record<string, string>),
  };
  return new Response(JSON.stringify(data), { status, headers: { ...headers } });
}

function error(code: string, message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ ok: false, error: code, message, ...extra }, status);
}

function resolveRoute(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const rootIndex = segments.findIndex((s) => ROUTE_ROOTS.includes(s));
  if (rootIndex === -1) return "";
  return segments.slice(rootIndex).join("/");
}

function parseParams(url: URL): { route: string; symbol: string; years: number | null; freq: "1d" | "1w" | "1m"; refresh: boolean } {
  const route = resolveRoute(url.pathname);
  const symbolParam = (url.searchParams.get("symbol") ?? DEFAULT_SYMBOL).toUpperCase();
  const yearsParam = url.searchParams.get("years");
  let years: number | null = yearsParam === null || yearsParam === "" || yearsParam === "all" ? null : Number(yearsParam);
  if (years !== null && (!Number.isFinite(years) || !YEARS_ALLOWED.includes(years))) years = 5;
  const freqParam = (url.searchParams.get("freq") ?? "1d") as "1d" | "1w" | "1m";
  const freq = FREQ_ALLOWED.includes(freqParam) ? freqParam : "1d";
  const refresh = url.searchParams.get("refresh") !== "0";
  return { route, symbol: symbolParam, years, freq, refresh };
}

/** 跨资产板块的窗口参数：只接受快照覆盖的整数年，非法值直接 400，避免静默回退 */
function parseMacroYears(url: URL): { years: number; err?: Response } {
  const raw = url.searchParams.get("years");
  if (raw === null || raw === "") return { years: 3 };
  if (raw === "all") return { years: 10 };
  const value = Number(raw);
  if (!Number.isFinite(value) || !MACRO_YEARS_ALLOWED.includes(value)) {
    return {
      years: 3,
      err: error("invalid_years", `years 只支持 ${MACRO_YEARS_ALLOWED.join(" | ")}（或 all），收到 "${raw}"。`, 400, {
        allowed: MACRO_YEARS_ALLOWED,
      }),
    };
  }
  return { years: value };
}

/** 康波对照与巴菲特指数的窗口参数：非法值直接 400，all 表示使用全部可比样本 */
function parsePanelYears(url: URL, allowed: number[], fallback: number | null): { years: number | null; err?: Response } {
  const raw = url.searchParams.get("years");
  if (raw === null || raw === "") return { years: fallback };
  if (raw === "all") return { years: null };
  const value = Number(raw);
  if (!Number.isFinite(value) || !allowed.includes(value)) {
    return {
      years: fallback,
      err: error("invalid_years", `years 只支持 ${allowed.join(" | ")}（或 all），收到 "${raw}"。`, 400, { allowed }),
    };
  }
  return { years: value };
}

async function buildCtx(symbol: string, years: number | null, freq: "1d" | "1w" | "1m", refresh: boolean): Promise<Ctx | { err: Response }> {
  const cfg = symbolConfig(symbol);
  if (!cfg) {
    return {
      err: error("invalid_symbol", `未知标的 "${symbol}"，可选：${symbolKeys().join(" | ")}`, 400, {
        allowed: symbolKeys(),
        default: DEFAULT_SYMBOL,
      }),
    };
  }
  const dataset = await getDataset({ refresh });
  const full = dataset.series[symbol] ?? [];
  const windowed = sliceByYears(full, years);
  const series = resample(windowed, freq);
  const metrics = computeMetrics(full);
  const signals = metrics ? buildSignals(full, metrics) : [];
  return {
    symbol,
    years,
    freq,
    series,
    full,
    metrics,
    signals,
    comp: composite(signals),
    refresh,
    statuses: dataset.statuses,
  };
}

function meta(ctx: Ctx) {
  return {
    service: "nasdaq-volatility-api",
    version: VERSION,
    symbol: ctx.symbol,
    symbolLabel: symbolConfig(ctx.symbol)?.label ?? ctx.symbol,
    years: ctx.years,
    freq: ctx.freq,
    asOf: ctx.metrics?.asOf ?? null,
    liveRefresh: ctx.refresh,
    snapshot: {
      source: SNAPSHOT_META.source,
      generatedAt: SNAPSHOT_META.generatedAt,
      window: SNAPSHOT_META.window,
    },
    sources: ctx.statuses,
  };
}

const HISTORY_FIELDS = ["date", "close", "rv21", "rv63", "vxn", "pct5y", "pctAll", "z21", "rv21Slope", "drawdown", "ma50", "ma200", "mom63"];

function docsPayload() {
  return {
    ok: true,
    service: "nasdaq-volatility-api",
    version: VERSION,
    description: "波动率只读分析接口（美股科技指数 + A 股主要指数 + A 股个股 + 国企红利股 + 黄金 / 原油 / 美债跨资产）：真实行情快照 + 运行时实时上游，输出波动率序列、规则信号、量化诊断、大摩 A 股报告事件复盘、VIX 恐慌指数、带动态 IC 权重与韩国综合指数联动的个股五档建议、红利股的周线高抛低吸与股息率分析，以及黄金 / 原油 / 美债的区间收益、波动、回撤、相关性与启发式风险状态，并可生成可直接投喂大模型的上下文包。",
    auth: "全部接口公开只读（GET / HEAD），无需凭据、已开启跨域，便于 AI 工具 / MCP 客户端直接调用；服务端不代持大模型密钥，也不接受任何写操作。",
    basePath: "/functions/v1/app",
    commonParams: {
      symbol: `标的，可选 ${symbolKeys().join(" | ")}（默认 ${DEFAULT_SYMBOL}）`,
      years: "回溯年数：1 | 2 | 3 | 5 | 10 | 20 | all（默认 5）",
      freq: "采样频率：1d | 1w | 1m（默认 1d）",
      refresh: "1=尝试实时上游并缓存 5 分钟（默认），0=仅用本地快照",
    },
    endpoints: [
      {
        path: "/functions/v1/app/health",
        method: "GET",
        purpose: "服务与数据源健康状态",
        returns: "{ ok, version, symbols[], sources[], snapshot }",
      },
      {
        path: "/functions/v1/app/api/symbols",
        method: "GET",
        purpose: "标的清单与各自可用区间",
        returns: "{ ok, symbols[{key,label,from,to,rows}] }",
      },
      {
        path: "/functions/v1/app/api/volatility/history",
        method: "GET",
        purpose: "波动率与价格时间序列（画图/回算用）",
        returns: "{ ok, meta, fields[], series[{date,close,rv21,rv63,vxn,pct5y,pctAll,z21,...}] }",
      },
      {
        path: "/functions/v1/app/api/volatility/snapshot",
        method: "GET",
        purpose: "最新一期核心指标与年度统计、分布",
        returns: "{ ok, meta, metrics, annual[], distribution[] }",
      },
      {
        path: "/functions/v1/app/api/signals",
        method: "GET",
        purpose: "10 条规则信号及权重、得分与解释",
        returns: "{ ok, meta, signals[{id,name,display,state,score,weight,rationale}], composite }",
      },
      {
        path: "/functions/v1/app/api/diagnosis",
        method: "GET",
        purpose: "综合倾向评分 + 历史分位表现 + 波动率×趋势矩阵",
        returns: "{ ok, meta, composite, metrics, regimeStudy[], volTrendMatrix[] }",
      },
      {
        path: "/functions/v1/app/api/events",
        method: "GET",
        purpose: "大摩（摩根士丹利）中国 / A 股策略报告事件表，含目标位变化与公开来源",
        returns: "{ ok, broker, provenance, events[{id,date,title,action,stance,summary,targets[],sources[],confidence,dateNote}] }",
      },
      {
        path: "/functions/v1/app/api/events/study",
        method: "GET",
        purpose: "报告发布后 A 股主要指数的走势复盘：前后累计收益、前向收益、与无条件基线及方向分组对比",
        params: {
          symbols: "研究标的，逗号分隔，默认 SSE,CSI300",
          horizons: "前向交易日，逗号分隔，默认 1,5,20,60,120",
        },
        returns: "{ ok, events[], study[{symbol,label,outcomes[]}], baseline[], stanceSummary[], definition }",
      },
      {
        path: "/functions/v1/app/api/volatility/panic",
        method: "GET",
        purpose: "VIX 恐慌指数水平序列与最新读数（分位、Z 分数、分档状态）",
        returns: "{ ok, available, meta, latest{asOf,level,pct5y,pctAll,z,regime}, series[{date,level,pct5y,pctAll,z}], definition }",
      },
      {
        path: "/functions/v1/app/api/macro/cross-asset",
        method: "GET",
        purpose: "黄金 / 原油 / 美债跨资产对比：最新价格、区间收益、波动、回撤、相关矩阵、10 年期美债收益率与启发式风险状态",
        params: {
          years: "窗口年数：1 | 2 | 3 | 5 | 10 | all（默认 3）",
          refresh: "1=尝试 Nasdaq / FRED 实时刷新并缓存 10 分钟（默认），0=仅用本地快照",
        },
        returns: "{ ok, meta, window, assets[{key,symbol,close,returns,vol21,vol63,maxDrawdown,...}], yield10y, correlations, corr63, chart, chartFreq, risk, definition, limits }",
      },
      {
        path: "/functions/v1/app/api/macro/ai-context",
        method: "GET",
        purpose: "为 DeepSeek 跨资产风险分析生成上下文（黄金 / 原油 / 美债涨跌、相关性、利率传导与风险评分）",
        params: {
          years: "窗口年数：1 | 2 | 3 | 5 | 10 | all（默认 3）",
          format: "markdown（默认，可直接粘贴给模型）| json（结构化）",
        },
        returns: "{ ok, meta, format, markdown | bundle }",
      },
      {
        path: "/functions/v1/app/api/cycle/kondratiev",
        method: "GET",
        purpose: "康波周期 × 纳斯达克100 / 标普500 / 上证指数：归一化走势、区间收益、长周期年化、波动与回撤、相关性、相对强弱与四阶段启发式匹配",
        params: {
          years: "窗口年数：1 | 3 | 5 | 10 | all（默认 5，all 为全部共同交易日）",
          refresh: "1=尝试实时上游并缓存 5 分钟（默认），0=仅用本地快照",
        },
        returns: "{ ok, meta, window, indices[], phases[], resonance, ratios[], correlations, corr63, chart, chartFreq, definition, limits }",
      },
      {
        path: "/functions/v1/app/api/cycle/ai-context",
        method: "GET",
        purpose: "为 DeepSeek 生成康波对照上下文（三指数指标、四阶段匹配、相对强弱与相关性，含长波样本边界）",
        params: { years: "窗口年数：1 | 3 | 5 | 10 | all（默认 5）", format: "markdown（默认）| json（结构化）" },
        returns: "{ ok, meta, format, markdown | bundle }",
      },
      {
        path: "/functions/v1/app/api/valuation/buffett",
        method: "GET",
        purpose: "美股巴菲特指数（Z.1 非金融企业股权市值 ÷ 名义 GDP）：最新读数、历史分位、中位数偏离、历史分布与标普500季度对照",
        params: {
          years: "窗口年数：1 | 3 | 5 | 10 | 20 | all（默认 20，all 为 1945 年以来全部可比季度）",
          refresh: "1=尝试 FRED 实时刷新并缓存 30 分钟（默认），0=仅用本地快照",
        },
        returns: "{ ok, meta, window, latest, stats{all,recent20y,window}, chart[{date,ratio,spx}], spx, sources, definition, limits }",
      },
      {
        path: "/functions/v1/app/api/valuation/ai-context",
        method: "GET",
        purpose: "为 DeepSeek 生成巴菲特指数上下文（估值分位、口径差异、历史分布与标普500对照）",
        params: { years: "窗口年数：1 | 3 | 5 | 10 | 20 | all（默认 20）", format: "markdown（默认）| json（结构化）" },
        returns: "{ ok, meta, format, markdown | bundle }",
      },
      {
        path: "/functions/v1/app/api/stocks/list",
        method: "GET",
        purpose: "A 股个股观察清单（基础清单来自 functions/data/watchlist.ts）及最新收盘与涨跌；可用 extra 附加任意沪深 A 股代码",
        params: { extra: "手动添加的 6 位代码，逗号分隔，最多 6 只；仅支持沪市 60/68、深市 00/30 开头" },
        returns: "{ ok, meta, count, stocks[{code,name,sector,from,to,rows,asOf,close,dayChangePct}] }",
      },
      {
        path: "/functions/v1/app/api/stocks/signals",
        method: "GET",
        purpose: "个股八规则信号 + 按历史信息系数（IC）动态加权的五档买卖建议，含韩国综合指数联动与市场环境",
        params: { extra: "手动添加的个股代码，逗号分隔，最多 6 只；按需抓取前复权日线（2015 起），缓存 10 分钟" },
        returns: "{ ok, meta, weighting, kospi{...metrics,regime}, stocks[{code,name,sector,metrics,composite,signals[],error}] }",
      },
      {
        path: "/functions/v1/app/api/stocks/history",
        method: "GET",
        purpose: "单只个股的波动率与价格时间序列（含同日韩国综合指数收盘），用于个股详情图表；支持观察清单之外的代码",
        params: { code: `6 位股票代码（基础清单 ${stockInfos().map((s) => s.code).join(" | ")}，或任意沪市 60/68、深市 00/30 代码）` },
        returns: "{ ok, meta, stock, fields[], count, metrics, composite, signals[], series[{date,close,rv21,...,kospi}] }",
      },
      {
        path: "/functions/v1/app/api/dividend/list",
        method: "GET",
        purpose: "国企红利股观察清单：不复权周线、股息率分位、3 年价格分位、周线 RSI 与五档高抛低吸建议；可用 extra 附加任意沪深 A 股",
        params: {
          refresh: "1=用东方财富批量报价覆盖本周最新价（默认），0=仅用本地周线快照",
          extra: "手动添加的 6 位代码，逗号分隔，最多 6 只；按需抓取不复权日线与分红明细，缓存 10 分钟",
        },
        returns: "{ ok, meta, count, summary, strategy, stocks[{rank,code,name,sector,close,weekChangePct,yieldFY,yieldPct5y,pricePct3y,rsi14w,ma60w,score,stance,stanceKey,actionHint}] }",
      },
      {
        path: "/functions/v1/app/api/dividend/history",
        method: "GET",
        purpose: "单只红利股的周线序列、分红明细、五项规则与五档建议（长期底仓 + 卫星仓框架）；支持红利清单之外的沪深 A 股",
        params: { code: `6 位股票代码（基础清单 ${dividendInfos().length} 只，完整代码见 /api/dividend/list 的 stocks[].code；或任意沪市 60/68、深市 00/30 代码）` },
        returns: "{ ok, meta, stock, fields[], count, metrics, composite, signals[], dividends[], series[], strategy, disclaimer }",
      },
      {
        path: "/functions/v1/app/api/dividend/ai-context",
        method: "GET",
        purpose: "为 DeepSeek 辅助诊断生成红利策略上下文（价值投资 / 长期收息 / 卫星仓高抛低吸）",
        params: { code: "6 位股票代码（红利清单或任意沪市 60/68、深市 00/30 代码）", format: "markdown（默认，可直接粘贴给模型）| json（结构化）" },
        returns: "{ ok, meta, format, markdown | bundle }",
      },
      {
        path: "/functions/v1/app/api/ai-context",
        method: "GET",
        purpose: "为 AI 辅助买卖诊断准备的上下文包",
        params: { format: "markdown（默认，可直接粘贴给模型）| json（结构化，适合工具调用）" },
        returns: "{ ok, meta, format, markdown | bundle }",
      },
    ],
    data_quality_notes: [
      "rv21 / rv63 为由真实收盘价计算的 21 / 63 日年化已实现波动率（%），sqrt(252) 年化。",
      "vxn 为 CBOE 纳斯达克100 隐含波动率；本环境若能访问上游则给出，否则为 null 并在 sources 中说明原因。",
      "VIX 恐慌指数（/api/volatility/panic）与 VXN 同路径：CBOE 官方日线 CSV（cdn-api 优先）、FRED 收盘序列镜像与 Yahoo 任一可达即提供完整历史；quote 为 CBOE 官方延迟报价（约 15 分钟延迟，只作盘中参考，不参与分位与 Z 分数）。全部不可达时接口显式返回 available=false 与原因，页面回落到已实现波动率与分位。",
      "pct5y 为 rv21 相对滚动 5 年窗口的分位；pctAll 为相对全部可得样本的分位。",
      "A 股无对应 VXN 的连续隐含波动率序列，因此上证 / 沪深300 的波动率一律用收盘价计算的已实现波动率。",
      "个股清单来自 functions/data/watchlist.ts（前复权日线，东方财富）；运行时以批量行情把最新价并入最新交易日，交易日锚定上证指数最新 K 线日期。",
      "手动添加的个股通过 GET 参数 extra=code1,code2 触发（最多 6 只，仅沪市 60/68 与深市 00/30）：服务端按需抓取 2015 起的前复权日线并内存缓存 10 分钟，不写入快照或数据库；单只失败只影响该代码并返回 error 字段。",
      "红利策略同样支持手动添加任意沪深 A 股（extra=code1,code2，最多 6 只）：服务端按需抓取 2015 起的不复权日线与东方财富分红明细（失败回退腾讯日线），缓存 10 分钟且不写入快照；单个代码失败只影响该行并在 meta.extraErrors 中说明原因。手动添加的个股不一定属于国企红利样本，groups 为空数组，其股息率与规则结果只按公开数据计算。",
      "个股建议的规则权重不是固定常数：每条规则用全历史「未来 63 日收益 / 规则多空状态」估计信息系数 IC，|IC| 截断到 [0.5, 3] 后归一化为合计 100%，随数据更新自动变化。",
      "红利策略清单（/api/dividend/*）由 16 只国企 / 中央国企红利底仓与 38 只中国诚通 / 国新投资 / 国新宏盛新增跟踪标的组成（连同底仓中的中国神华，截图去重后共 39 只）；分组来自用户提供的截图（未标注年份），只采用证券简称与变动方向，持股数量与比例未纳入。跟踪标的不是高股息筛选结果。行情为不复权周线（每周最后一个交易日收盘），分红来自东方财富分红明细（税前每 10 股派息），周线快照由 node dev/fetch-dividend-data.mjs 生成；运行时用东方财富批量报价覆盖本周最新价。",
      "红利股息率以「最近一个已实施完整年度（中期+末期，必要时含特别分红）」的税前每股分红 ÷ 当前不复权价计算；另有近 365 天现金口径。红利股改为中期+末期派息后，过渡期近 12 个月可能出现三次派息，不能直接年化。",
      "红利策略使用固定权重（股息率分位 30% + 3 年价格分位 25% + 周线 RSI 20% + 60 周均线偏离 15% + 连续分红 10%），不做动态 IC：周线自相关强、独立样本少，动态优化容易过拟合。底仓 70%–80% 与卫星仓 20%–30% 是通用框架，不是个性化配置。",
      "所有红利统计未考虑红利税、交易成本、股息再投资与个人持仓成本；历史分红不保证未来继续，量化输出不构成投资建议。",
      "跨资产板块（/api/macro/*）以 GLD / USO / TLT 收盘价分别代理黄金 / 原油 / 美债价格，以 FRED DGS10 表示 10 年期美债收益率；ETF 存在管理费、跟踪误差、期货展期成本与基金规则偏差，不是现货定盘价或连续合约。",
      "跨资产收益、波动与回撤均为价格口径，不含股息、票息、费用、税收与汇率换算；相关性为日收益率（10Y 收益率为日变动 bp）的 Pearson 系数，只描述历史同步程度，不代表因果。",
      "跨资产风险评分为固定权重启发式（利率 30% / 美债 25% / 原油 25% / 联动性 20%），用于风险提示，不是概率、预测或交易信号；运行时 Nasdaq 刷新失败时保留本地快照并在 sources 中显式标注降级。",
      "康波对照（/api/cycle/*）使用纳斯达克100、标普500与上证指数的共同交易日收盘价（2019 年 4 月起）；四阶段匹配是固定权重的启发式打分，不判定康波年份、不是概率或交易信号，约七年样本无法验证 40–60 年长波。",
      "巴菲特指数（/api/valuation/*）采用美联储 Z.1 非金融企业股权市值（FRED NCBEILQ027S，季度，百万美元）÷ 美国名义 GDP（FRED GDP，季度，十亿美元，年化）；FRED 的 Wilshire 5000 系列已下架，因此不能与 Wilshire/GDP 口径比较绝对水平或套用其经验阈值。",
      "估值与 GDP 均为季度数据，存在发布滞后且 GDP 会修订；历史分位只描述当前读数在本序列自身历史中的位置，不构成估值结论或择时信号；标普500仅作季度末收盘对照。",
      "数据更新节奏：指数与个股日线在收盘后更新，盘中报价来自东方财富批量行情（有延迟、可能停牌或缺失）；分红明细在方案实施后更新；没有任何逐笔或毫秒级实时行情。",
      "韩国综合指数（KOSPI）只作为个股诊断中的区域联动信号（63 日收益相关性 + beta），不单独作为标的。",
      "大摩报告事件表为人工整理的公开报道，非穷举；每条带来源与可靠性标注，报告日按其后最近交易日对齐。",
      "本站服务端不代持任何大模型密钥，也不提供模型转发接口：AI 辅助诊断由浏览器直连 DeepSeek 官方接口，使用访问者自己的 API Key，消耗其本人账户的额度。",
      "所有诊断输出为量化规则结果与历史统计，不构成投资建议，也不预测收益。",
    ],
  };
}

async function handleHealth(): Promise<Response> {
  const fallback = await getDataset({ refresh: false });
  const live = await getDataset({ refresh: true }).catch(() => fallback);
  return json({
    ok: true,
    service: "nasdaq-volatility-api",
    version: VERSION,
    time: new Date().toISOString(),
    symbols: SYMBOLS,
    snapshot: { source: SNAPSHOT_META.source, generatedAt: SNAPSHOT_META.generatedAt, window: SNAPSHOT_META.window },
    impliedVolAvailable: Boolean(live.impliedVol),
    vixAvailable: Boolean(live.vixRows),
    stocks: {
      count: stockInfos().length,
      kospi: Boolean(kospiMeta()),
      note: WATCHLIST_NOTE,
    },
    dividend: {
      count: dividendInfos().length,
      generatedAt: dividendMeta().generatedAt,
      window: dividendMeta().window,
    },
    macro: {
      proxies: { gold: "GLD", oil: "USO", bond: "TLT", yield: "FRED DGS10" },
      generatedAt: macroSnapshotMeta().generatedAt,
      window: macroSnapshotMeta().window,
      rows: macroSnapshotMeta().rows,
      yieldRows: macroSnapshotMeta().yieldRows,
    },
    valuation: {
      proxies: { marketCap: "FRED NCBEILQ027S", gdp: "FRED GDP" },
      generatedAt: valuationSnapshotMeta().generatedAt,
      window: valuationSnapshotMeta().window,
      capRows: valuationSnapshotMeta().capRows,
      gdpRows: valuationSnapshotMeta().gdpRows,
    },
    cycle: { indices: ["NDX100", "SPX", "SSE"], note: "康波四阶段启发式对照，不判定长波年份" },
    sources: live.statuses,
  });
}

async function handleEvents(): Promise<Response> {
  return json({
    ok: true,
    meta: { version: VERSION, count: reportEvents.length },
    broker: REPORT_BROKER,
    provenance: EVENTS_PROVENANCE,
    events: reportEvents,
  });
}

function parseList(raw: string | null, fallback: string[]): string[] {
  if (!raw) return fallback;
  const list = raw
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : fallback;
}

/** extra= 手动添加的个股代码：只接受沪深 A 股常见板块，去重后最多 EXTRA_STOCK_LIMIT 只 */
function parseExtraCodes(url: URL): { codes: string[]; err?: Response } {
  const raw = (url.searchParams.get("extra") ?? "").trim();
  if (!raw) return { codes: [] };
  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const invalid = parts.filter((x) => !isSupportedStockCode(x));
  if (invalid.length) {
    return {
      codes: [],
      err: error("invalid_extra", `手动添加的代码需为 6 位数字，且以沪市 60/68 或深市 00/30 开头：${invalid.join("、")}`, 400),
    };
  }
  const codes = [...new Set(parts)];
  if (codes.length > EXTRA_STOCK_LIMIT) {
    return { codes: [], err: error("too_many_extra", `一次最多附加 ${EXTRA_STOCK_LIMIT} 只手动添加的个股（当前 ${codes.length} 只）。`, 400) };
  }
  return { codes };
}

function parseHorizons(raw: string | null): number[] {
  if (!raw) return EVENT_HORIZONS;
  const list = raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0 && x <= 504);
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : EVENT_HORIZONS;
}

/** 事件研究核心：对给定标的与期限计算报告前后表现，供 /api/events/study 与 ai-context 共用 */
async function computeReportStudy(refresh: boolean, symbols: string[], horizons: number[]) {
  const dataset = await getDataset({ refresh });
  const valid = symbols.filter((k) => symbolConfig(k) && (dataset.series[k]?.length ?? 0) > 0);
  const stanceOf = new Map<string, string>(reportEvents.map((e) => [e.id, e.stance] as const));
  const study = valid.map((key) => {
    const series = dataset.series[key];
    return {
      symbol: key,
      label: symbolConfig(key)?.label ?? key,
      bars: series.length,
      window: { from: series[0].date, to: series[series.length - 1].date },
      outcomes: eventStudy(series, key, reportEvents, horizons),
    };
  });
  const baseline = valid.map((key) => ({
    symbol: key,
    label: symbolConfig(key)?.label ?? key,
    rows: baselineForward(dataset.series[key], horizons),
  }));
  const stanceSummaryRows = valid.map((key) => ({
    symbol: key,
    label: symbolConfig(key)?.label ?? key,
    rows: stanceSummary(study.find((s) => s.symbol === key)!.outcomes, stanceOf, horizons),
  }));
  return { valid, skipped: symbols.filter((k) => !valid.includes(k)), study, baseline, stanceSummary: stanceSummaryRows };
}

const STUDY_DEFINITION = {
  anchorDate: "报告记载日当日或其后的首个交易日；shiftDays 为对齐造成的自然日差",
  ret: "相对锚点收盘价的累计涨跌幅（%），非年化",
  peak60: "其后 60 个交易日内的最大涨幅（%）",
  trough60: "其后 60 个交易日内的最大回撤（%）",
  baseline: "同一指数全部交易日的 h 日前向收益分布，作为无条件参照",
  path: `报告前 ${EVENT_PATH_BACK} 至后 ${EVENT_PATH_FWD} 个交易日的逐日累计收益`,
};

async function handleEventStudy(url: URL): Promise<Response> {
  const refresh = url.searchParams.get("refresh") !== "0";
  const wanted = parseList(url.searchParams.get("symbols"), A_SHARE_SYMBOLS);
  const horizons = parseHorizons(url.searchParams.get("horizons"));
  const result = await computeReportStudy(refresh, wanted, horizons);
  if (!result.valid.length) {
    return error("invalid_symbols", `无可用研究标的 "${wanted.join(",")}"，可选：${symbolKeys().join(" | ")}`, 400, {
      allowed: symbolKeys(),
    });
  }
  return json({
    ok: true,
    meta: {
      version: VERSION,
      broker: REPORT_BROKER,
      events: reportEvents.length,
      symbols: result.valid,
      horizons,
      liveRefresh: refresh,
      asOf: SNAPSHOT_META.window.to,
    },
    definition: STUDY_DEFINITION,
    provenance: EVENTS_PROVENANCE,
    events: reportEvents,
    study: result.study,
    baseline: result.baseline,
    stanceSummary: result.stanceSummary,
    skipped: result.skipped,
  });
}

async function handleAiContext(ctx: Ctx, format: string): Promise<Response> {
  const m = ctx.metrics;
  if (!m) return error("insufficient_data", "样本不足以生成诊断上下文", 422);
  const regime = regimeStudy(ctx.full);
  const matrix = volTrendMatrix(ctx.full);
  const subjectLabel = symbolConfig(ctx.symbol)?.label ?? ctx.symbol;

  // A 股标的额外附上大摩报告复盘：研报对 A 股的传导是诊断的一部分
  const study = A_SHARE_SYMBOLS.includes(ctx.symbol)
    ? await computeReportStudy(ctx.refresh, A_SHARE_SYMBOLS, [20, 60])
    : null;
  const studyDigest = study
    ? study.study.map((s) => ({
        symbol: s.symbol,
        label: s.label,
        rows: s.outcomes.map((o) => ({
          eventId: o.eventId,
          eventDate: o.eventDate,
          anchorDate: o.anchorDate,
          stance: reportEvents.find((e) => e.id === o.eventId)?.stance ?? "—",
          title: reportEvents.find((e) => e.id === o.eventId)?.title ?? "",
          ret20: o.forward.find((f) => f.days === 20)?.ret ?? null,
          ret60: o.forward.find((f) => f.days === 60)?.ret ?? null,
          trough60: o.trough60,
          rv21At: o.rv21At,
        })),
      }))
    : null;
  const bundle = {
    meta: meta(ctx),
    subject: {
      symbol: ctx.symbol,
      label: subjectLabel,
      asOf: m.asOf,
      close: m.close,
    },
    indicators: m,
    signals: ctx.signals,
    composite: ctx.comp,
    reportStudy: studyDigest
      ? {
          broker: REPORT_BROKER,
          note: EVENTS_PROVENANCE.caveat,
          perSymbol: studyDigest,
          stanceSummary: study?.stanceSummary ?? [],
          baseline: study?.baseline ?? [],
        }
      : null,
    empirical: {
      note: "以下为该标的历史样本中，处于对应状态后 63 个交易日（约 3 个月）的表现统计，用于校准判断，不代表未来结果。",
      byVolPercentile: regime,
      volTimesTrend: matrix,
    },
    limits: [
      "已实现波动率来自指数/ETF 收盘价，隐含波动率（VXN）在当前运行环境是否可得见 sources。",
      "未纳入估值、盈利、利率与仓位成本等因素。",
      "不构成投资建议；输出必须以“概率与风险管理”语言表述，不得承诺收益。",
    ],
    taskForAssistant: {
      role: `你是资深量化风控分析师，请基于以上结构化数据给出${subjectLabel}相关仓位的诊断。`,
      requiredOutput: [
        "结论：买入 / 加仓 / 持有 / 减仓 / 卖出 五档之一，并给出理由链",
        "置信度：0-1 及主要不确定性来源",
        "关键依据：引用具体信号 id 与数值（如 vol_percentile、vol_zscore）",
        "情景分析：若波动率继续上行 / 拐头回落，各自的操作预案",
        "风控参数：分批份数、单批触发条件、回撤阈值、复评频率",
        "缺失数据：还需要哪些用户信息（持仓成本、期限、可承受回撤、现金比例）",
        ...(studyDigest
          ? [
              "研报传导：结合上文「大摩 A 股报告复盘」，判断当前是否处于研报发布后的历史有效窗口，并说明该统计的样本量限制",
            ]
          : []),
      ],
      guardrails: [
        "不得给出确定性收益承诺或杠杆建议",
        "必须提示历史统计的样本外风险",
        "若数据源标注为不可用，须显式说明该指标缺失对结论的影响",
        ...(studyDigest
          ? ["事件样本仅有个位数次，只能作为情景参照，不得当作可重复的套利信号"]
          : []),
      ],
    },
    api: {
      history: "/functions/v1/app/api/volatility/history?symbol=" + ctx.symbol,
      snapshot: "/functions/v1/app/api/volatility/snapshot?symbol=" + ctx.symbol,
      signals: "/functions/v1/app/api/signals?symbol=" + ctx.symbol,
      diagnosis: "/functions/v1/app/api/diagnosis?symbol=" + ctx.symbol,
      panic: "/functions/v1/app/api/volatility/panic",
      stocksSignals: "/functions/v1/app/api/stocks/signals",
      events: "/functions/v1/app/api/events",
      eventsStudy: "/functions/v1/app/api/events/study?symbols=" + A_SHARE_SYMBOLS.join(","),
    },
  };

  if (format === "json") return json({ ok: true, meta: meta(ctx), format: "json", bundle });

  const lines: string[] = [];
  lines.push(`# 波动率诊断上下文（${subjectLabel}）`);
  lines.push(`数据截至 ${m.asOf}｜接口版本 ${VERSION}｜生成时间 ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 一、核心指标");
  lines.push(`- 收盘价：${m.close}${m.dayChangePct !== null ? `（当日 ${fmtPct(m.dayChangePct)}）` : ""}`);
  lines.push(`- 21 日已实现波动率：${fmtNum(m.realizedVol21)}%，63 日：${fmtNum(m.realizedVol63)}%`);
  lines.push(
    `- 隐含波动率 VXN：${m.impliedVol !== null ? fmtNum(m.impliedVol) + "%（" + m.impliedVolAsOf + "）" : "不可用（见数据源说明）"}`,
  );
  lines.push(`- 波动率状态：${m.volRegime}｜5 年分位 ${fmtNum(m.volPercentile5y, 1)}%｜全样本分位 ${fmtNum(m.volPercentileAll, 1)}%`);
  lines.push(`- 波动率 Z 分数：${fmtNum(m.volZScore)}｜21 日波动率斜率：${fmtNum(m.volSlope21)}pp`);
  lines.push(`- 距 52 周高点回撤：${fmtNum(m.drawdown52w, 1)}%｜63 日动量：${fmtPct(m.momentum63 ?? 0)}`);
  lines.push(
    `- 趋势：价格${m.aboveMa50 === null ? "（均线样本不足）" : m.aboveMa50 ? "位于 50 日线上方" : "位于 50 日线下方"}，${
      m.aboveMa200 === null ? "200 日线样本不足" : m.aboveMa200 ? "位于 200 日线上方" : "位于 200 日线下方"
    }`,
  );
  lines.push("");
  lines.push("## 二、规则信号");
  for (const s of ctx.signals) {
    lines.push(
      `- [${s.id}] ${s.name}＝${s.display}｜${s.state}｜得分 ${s.score > 0 ? "+" : ""}${s.score.toFixed(1)}（权重 ${s.weight}）｜${s.rationale}`,
    );
  }
  lines.push("");
  lines.push("## 三、量化倾向");
  lines.push(
    `综合评分 ${ctx.comp.score > 0 ? "+" : ""}${ctx.comp.score}／-100~+100 → ${ctx.comp.stance}`,
  );
  lines.push(ctx.comp.summary);
  lines.push("");
  lines.push("## 四、历史规律（未来 63 交易日表现）");
  lines.push("| 波动率分位区间 | 样本 | 平均收益 | 中位收益 | 正收益概率 | 最差 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of regime) {
    lines.push(
      `| ${r.bucket} | ${r.samples} | ${fmtPct(r.avg63)} | ${fmtPct(r.median63)} | ${r.winRate63 === null ? "—" : r.winRate63.toFixed(0) + "%"} | ${fmtPct(r.worst63)} |`,
    );
  }
  lines.push("");
  lines.push("| 波动率状态 × 趋势 | 样本 | 平均 63 日收益 | 正收益概率 |");
  lines.push("| --- | --- | --- | --- |");
  for (const c of matrix) {
    lines.push(`| ${c.vol} × ${c.trend} | ${c.samples} | ${fmtPct(c.avg63)} | ${c.winRate63 === null ? "—" : c.winRate63.toFixed(0) + "%"} |`);
  }
  lines.push("");
  if (studyDigest) {
    lines.push("## 五、大摩 A 股报告复盘（研报发布后的指数表现）");
    lines.push(`来源：${REPORT_BROKER}中国策略团队公开研报，人工整理，${EVENTS_PROVENANCE.caveat}`);
    lines.push("| 报告日 | 对齐交易日 | 方向 | 报告要点 | 上证 20日 | 上证 60日 | 沪深300 20日 | 沪深300 60日 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    const byEvent = new Map<string, { date: string; anchor: string; stance: string; title: string; vals: Record<string, string> }>();
    for (const s of studyDigest) {
      for (const r of s.rows) {
        const cell = byEvent.get(r.eventId) ?? {
          date: r.eventDate,
          anchor: r.anchorDate,
          stance: r.stance,
          title: r.title,
          vals: {},
        };
        cell.vals[s.symbol] = `${fmtPct(r.ret20)} / ${fmtPct(r.ret60)}`;
        byEvent.set(r.eventId, cell);
      }
    }
    for (const row of [...byEvent.values()].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push(
        `| ${row.date} | ${row.anchor} | ${row.stance} | ${row.title} | ${(row.vals.SSE ?? "—").split(" / ").join(" | ")} | ${(row.vals.CSI300 ?? "—").split(" / ").join(" | ")} |`,
      );
    }
    lines.push("");
    lines.push("口径：数值为相对研报对齐交易日收盘价的累计涨跌幅；「/」前为 20 个交易日、后为 60 个交易日。");
    for (const s of study?.stanceSummary ?? []) {
      for (const g of s.rows) {
        const h20 = g.rows.find((x) => x.days === 20);
        const h60 = g.rows.find((x) => x.days === 60);
        lines.push(
          `- ${s.label}·${g.stance}（${g.events} 次事件）：20 日均值 ${fmtPct(h20?.avg ?? null)}（正收益 ${h20?.winRate === null ? "—" : h20.winRate.toFixed(0) + "%"}），60 日均值 ${fmtPct(h60?.avg ?? null)}（正收益 ${h60?.winRate === null ? "—" : h60.winRate.toFixed(0) + "%"}）`,
        );
      }
    }
    for (const b of study?.baseline ?? []) {
      const h20 = b.rows.find((x) => x.days === 20);
      const h60 = b.rows.find((x) => x.days === 60);
      lines.push(
        `- ${b.label}·无条件基线：任意交易日往后 20 日均值 ${fmtPct(h20?.avg ?? null)}、60 日均值 ${fmtPct(h60?.avg ?? null)}（样本 ${h60?.samples ?? 0}）`,
      );
    }
    lines.push("");
    lines.push("## 六、数据源与局限");
  } else {
    lines.push("## 五、数据源与局限");
  }
  for (const s of ctx.statuses) {
    lines.push(`- ${s.label}：${s.ok ? "正常" : "降级"}（${s.mode}）— ${s.note}`);
  }
  for (const l of bundle.limits) lines.push(`- ${l}`);
  lines.push("");
  lines.push(`## ${studyDigest ? "七" : "六"}、给 AI 的分析任务`);
  for (const r of bundle.taskForAssistant.requiredOutput) lines.push(`- ${r}`);
  lines.push("约束：");
  for (const g of bundle.taskForAssistant.guardrails) lines.push(`- ${g}`);
  lines.push("");
  lines.push("可复用接口：");
  for (const [k, v] of Object.entries(bundle.api)) lines.push(`- ${k}: ${v}`);

  return json({ ok: true, meta: meta(ctx), format: "markdown", markdown: lines.join("\n"), bundle });
}

function fmtNum(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/* ===================== 红利策略 ===================== */

const DIVIDEND_HISTORY_FIELDS = [
  "date",
  "close",
  "ma20w",
  "ma60w",
  "rsi14w",
  "yieldFY",
  "yieldTTM",
  "yieldPct5y",
  "pricePct3y",
  "drawdown3y",
];

const DIVIDEND_LIMITS = [
  "行情为不复权周线（每周最后一个交易日收盘），包含除息缺口；不是逐笔或毫秒级实时行情。",
  "股息率使用税前分红，未考虑红利税、交易成本、股息再投资与个人持仓成本。",
  "股息率按最近一个已实施完整年度计算，不含尚未公布的年度分红；历史分红不保证未来继续。",
  "未纳入盈利、派息率、自由现金流、利率、监管与行业景气等因素。",
  "观察清单为人工维护：16 只国企 / 中央国企红利底仓 + 38 只国有资本运营公司新增跟踪标的（连同底仓中的中国神华，截图去重后共 39 只），不是全市场红利指数，也不构成推荐。",
  "中国诚通 / 国新投资 / 国新宏盛分组来自用户提供的三季度截图（未标注年份），只表示新进 / 增持方向；持股数量、比例、成本与后续变动均未纳入，跟踪标的不是高股息筛选结果。",
];

interface DividendStockView {
  info: ReturnType<typeof dividendInfos>[number];
  series: ReturnType<typeof buildDividendSeries>;
  dividends: { exDate: string; dps: number; plan: string; reportDate: string; progress: string }[];
  metrics: ReturnType<typeof dividendMetrics>;
  composite: ReturnType<typeof dividendSignals>["composite"];
  signals: ReturnType<typeof dividendSignals>["signals"];
}

function dividendView(info: ReturnType<typeof dividendInfos>[number], entry: Parameters<typeof buildDividendSeries>[0]): DividendStockView {
  const series = buildDividendSeries(entry);
  const metrics = dividendMetrics(series, entry.dividends);
  const result = dividendSignals(series, entry.dividends);
  return { info, series, dividends: entry.dividends, metrics, composite: result.composite, signals: result.signals };
}

function dividendListRow(view: DividendStockView, rank: number) {
  const m = view.metrics;
  return {
    rank,
    ...view.info,
    asOf: m?.asOf ?? null,
    close: m?.close ?? null,
    weekChangePct: m?.weekChangePct ?? null,
    yieldFY: m?.yieldFY ?? null,
    yieldPct5y: m?.yieldPct5y ?? null,
    yieldTTM: m?.yieldTTM ?? null,
    pricePct3y: m?.pricePct3y ?? null,
    rsi14w: m?.rsi14w ?? null,
    ma20w: m?.ma20w ?? null,
    ma60w: m?.ma60w ?? null,
    distMa60w: m?.distMa60w ?? null,
    drawdown3y: m?.drawdown3y ?? null,
    streakYears: m?.streakYears ?? 0,
    weekPartial: m?.weekPartial ?? false,
    score: view.composite.score,
    stance: view.composite.stance,
    stanceKey: view.composite.stanceKey,
    summary: view.composite.summary,
    actionHint: view.composite.actionHint,
  };
}

function dividendListSummary(rows: { score: number; yieldFY: number | null }[]) {
  const yields = rows.map((r) => r.yieldFY).filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    count: rows.length,
    lowBuy: rows.filter((r) => r.score >= 10).length,
    highSell: rows.filter((r) => r.score <= -10).length,
    neutral: rows.filter((r) => r.score > -10 && r.score < 10).length,
    avgYield: yields.length ? Math.round((yields.reduce((a, b) => a + b, 0) / yields.length) * 100) / 100 : null,
  };
}

function dividendGroupSummaries(rows: ReturnType<typeof dividendListRow>[]) {
  return DIVIDEND_GROUPS.map((g) => {
    const members = rows.filter((r) => r.groups.some((t) => t.group === g.key));
    const yields = members.map((r) => r.yieldFY).filter((v): v is number => v !== null && Number.isFinite(v));
    const actionCount = (action: "new" | "increase") =>
      members.filter((r) => r.groups.some((t) => t.group === g.key && t.action === action)).length;
    return {
      key: g.key,
      label: g.label,
      short: g.short,
      description: g.description,
      source: g.source,
      count: members.length,
      newCount: actionCount("new"),
      increaseCount: actionCount("increase"),
      lowBuy: members.filter((r) => r.score >= 10).length,
      highSell: members.filter((r) => r.score <= -10).length,
      avgYield: yields.length ? Math.round((yields.reduce((a, b) => a + b, 0) / yields.length) * 100) / 100 : null,
    };
  });
}

function dividendAiBundle(view: DividendStockView, statuses: { id: string; label: string; mode: string; ok: boolean; note: string }[], refresh: boolean) {
  const m = view.metrics!;
  const code = view.info.code;
  const bundle = {
    meta: {
      service: "nasdaq-volatility-api",
      version: VERSION,
      kind: "dividend-strategy",
      asOf: m.asOf,
      generatedAt: new Date().toISOString(),
      liveRefresh: refresh,
      snapshot: dividendMeta(),
      sources: statuses,
    },
    subject: {
      code,
      name: view.info.name,
      sector: view.info.sector,
      note: view.info.note,
      groups: view.info.groups,
      close: m.close,
      weekPartial: m.weekPartial,
    },
    strategy: DIVIDEND_STRATEGY,
    metrics: m,
    signals: view.signals,
    composite: view.composite,
    dividends: view.dividends.slice(-10),
    limits: DIVIDEND_LIMITS,
    taskForAssistant: {
      role: `你是长期价值与红利策略顾问。请基于以上真实数据，判断${view.info.name}（${code}）的长期底仓是否继续持有，以及 20%–30% 卫星仓应低吸、持有还是高抛。`,
      requiredOutput: [
        "结论：分批低吸 / 小仓低吸 / 持有收息 / 分批高抛 / 显著高抛 五档之一，并明确该结论只针对卫星仓，底仓如何处理",
        "置信度：0–1，并列出主要不确定性来源",
        "关键依据：引用股息率分位、3 年价格分位、周线 RSI、60 周均线偏离、连续分红年数中的具体数值",
        "分批计划：给出 2–3 档触发条件与每档比例，仅限卫星仓",
        "股息视角：说明当前年度分红的现金覆盖与可持续性判断，并列出仍需补充的数据",
        "风险：股价继续下跌、分红下调、除息缺口、红利税、流动性与行业监管",
        "复评频率与失效条件：什么情况下需要重新评估结论",
      ],
      guardrails: [
        "不得承诺股息率、收益或本金安全，不得把历史分红当作未来保证",
        "不得建议一次性满仓或清仓，必须保留底仓长期收息的框架",
        "不得编造财务数据、分红方案、机构观点或政策信息",
        "若数据缺失或标注不可用，必须显式说明对结论的影响",
      ],
    },
    api: {
      list: "/functions/v1/app/api/dividend/list",
      history: "/functions/v1/app/api/dividend/history?code=" + code,
      aiContext: "/functions/v1/app/api/dividend/ai-context?code=" + code + "&format=markdown",
    },
  };
  return bundle;
}

function dividendGroupText(tags: ReturnType<typeof dividendInfos>[number]["groups"]): string {
  if (!tags.length) return "手动添加（无分组）";
  return tags
    .map((t) => {
      const label = DIVIDEND_GROUPS.find((g) => g.key === t.group)?.label ?? t.group;
      if (t.action === "new") return `${label}·新进`;
      if (t.action === "increase") return `${label}·增持`;
      return label;
    })
    .join("、");
}

function dividendMarkdown(view: DividendStockView, bundle: ReturnType<typeof dividendAiBundle>, statuses: { label: string; mode: string; ok: boolean; note: string }[]) {
  const m = view.metrics!;
  const lines: string[] = [];
  lines.push(`# 红利策略上下文（${view.info.name} ${view.info.code}）`);
  lines.push(`数据截至 ${m.asOf}｜接口版本 ${VERSION}｜生成时间 ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 一、标的与核心指标");
  lines.push(`- 行业：${view.info.sector}｜说明：${view.info.note}`);
  lines.push(`- 跟踪分组：${dividendGroupText(view.info.groups)}`);
  lines.push(`- 不复权收盘价：${m.close}${m.weekChangePct === null ? "" : `（本周 ${fmtPct(m.weekChangePct)}）`}${m.weekPartial ? "｜本周 K 线未收盘" : ""}`);
  lines.push(
    `- 最新年度股息率：${m.yieldFY === null ? "暂无完整年度分红" : `${m.yieldFY.toFixed(2)}%（FY${m.fy ?? "—"}，每股税前 ${m.dpsFY ?? "—"} 元）`}`,
  );
  lines.push(
    `- 近 12 个月现金口径：${m.yieldTTM === null ? "—" : `${m.yieldTTM.toFixed(2)}%`}（每股 ${m.dpsTTM ?? "—"} 元；银行等中期+末期派息过渡期可能出现一年三次，不能直接年化）`,
  );
  lines.push(`- 股息率分位：近 5 年 ${fmtNum(m.yieldPct5y, 0)}%｜全样本 ${fmtNum(m.yieldPctAll, 0)}%`);
  lines.push(`- 价格分位：3 年 ${fmtNum(m.pricePct3y, 0)}%｜5 年 ${fmtNum(m.pricePct5y, 0)}%｜距 3 年高点 ${fmtPct(m.drawdown3y)}`);
  lines.push(`- 周线 RSI(14)：${fmtNum(m.rsi14w, 1)}｜MA20w ${fmtNum(m.ma20w, 2)}｜MA60w ${fmtNum(m.ma60w, 2)}｜偏离 60 周均线 ${fmtPct(m.distMa60w)}`);
  lines.push(`- 连续分红：${m.streakYears} 年（累计 ${m.dividendYears} 个年度有派息记录、${m.dividendCount} 条明细）｜52 周年化波动率 ${fmtNum(m.weekVol52, 1)}%`);
  lines.push(`- 最近一次分红：${m.latestDividend ? `${m.latestDividend.exDate} 除息，每股税前 ${m.latestDividend.dps} 元，${m.latestDividend.plan}` : "—"}`);
  lines.push("");
  lines.push("## 二、五项规则");
  lines.push("| 规则 | 读数 | 状态 | 分量得分 | 权重 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const s of view.signals) {
    lines.push(`| ${s.name} | ${s.display} | ${s.state} | ${s.score > 0 ? "+" : ""}${s.score} | ${s.weight}% | ${s.rationale} |`);
  }
  lines.push("");
  lines.push("## 三、量化倾向");
  lines.push(`综合得分 ${view.composite.score > 0 ? "+" : ""}${view.composite.score}／-100~+100 → ${view.composite.stance}（${view.composite.stanceKey}）`);
  lines.push(view.composite.summary);
  lines.push(`执行提示：${view.composite.actionHint}`);
  lines.push(`仓位框架：${view.composite.basePosition} ${view.composite.satellite}`);
  lines.push("");
  lines.push("## 四、分红记录（最近 10 条，税前）");
  lines.push("| 除息日 | 每股分红（元） | 方案 | 报告期 | 进度 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const d of view.dividends.slice(-10).reverse()) {
    lines.push(`| ${d.exDate} | ${d.dps} | ${d.plan || "—"} | ${d.reportDate || "—"} | ${d.progress || "—"} |`);
  }
  lines.push("");
  lines.push("## 五、数据来源与口径");
  for (const s of statuses) lines.push(`- ${s.label}：${s.ok ? "正常" : "降级"}（${s.mode}）— ${s.note}`);
  for (const [k, v] of Object.entries(DIVIDEND_STRATEGY.definition)) {
    lines.push(`- ${DIVIDEND_STRATEGY.definitionLabels[k] ?? k}：${v}`);
  }
  for (const l of bundle.limits) lines.push(`- ${l}`);
  lines.push("");
  lines.push("## 六、给 AI 的分析任务");
  for (const r of bundle.taskForAssistant.requiredOutput) lines.push(`- ${r}`);
  lines.push("约束：");
  for (const g of bundle.taskForAssistant.guardrails) lines.push(`- ${g}`);
  return lines.join("\n");
}

export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = resolveRoute(url.pathname);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  // HEAD 走与 GET 完全相同的路由与缓存，仅省略响应体，便于外部做存活探测
  if (request.method === "HEAD") {
    const mirrored = await handler(new Request(request.url, { method: "GET" }));
    return new Response(null, {
      status: mirrored.status,
      statusText: mirrored.statusText,
      headers: mirrored.headers,
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return error("method_not_allowed", `本站接口全部只读（GET / HEAD），不接受 ${request.method}；大模型调用请在浏览器直连 DeepSeek 官方接口`, 405, {
      Allow: "GET, HEAD, OPTIONS",
    });
  }

  const { symbol, years, freq, refresh } = parseParams(url);

  try {
    if (route === "health") return await handleHealth();
    if (route === "docs" || route === "api/docs") return json(docsPayload());

    if (route === "api/symbols") {
      return json({ ok: true, meta: { version: VERSION }, symbols: SYMBOLS });
    }

    if (route === "api/volatility/history") {
      const ctx = await buildCtx(symbol, years, freq, refresh);
      if ("err" in ctx) return ctx.err;
      const compact = ctx.series.map((p) => {
        const row: Record<string, number | string | null> = {};
        for (const f of HISTORY_FIELDS) row[f] = p[f as keyof VolPoint] as number | string | null;
        return row;
      });
      return json({
        ok: true,
        meta: meta(ctx),
        fields: HISTORY_FIELDS,
        definition: {
          rv21: "21 日对数收益率标准差 × sqrt(252) × 100，年化已实现波动率（%）",
          rv63: "同上，窗口 63 个交易日",
          vxn: "CBOE 纳斯达克100 隐含波动率（上游可达时提供）",
          pct5y: "rv21 相对滚动 5 年窗口的百分位（0-100）",
          z21: "rv21 相对其 252 日均值的标准分数",
          drawdown: "收盘价相对 252 日最高点的百分比回撤",
        },
        count: compact.length,
        series: compact,
      });
    }

    if (route === "api/volatility/snapshot") {
      const ctx = await buildCtx(symbol, years, freq, refresh);
      if ("err" in ctx) return ctx.err;
      if (!ctx.metrics) return error("insufficient_data", "样本不足", 422);
      return json({
        ok: true,
        meta: meta(ctx),
        metrics: ctx.metrics,
        annual: annualSummary(ctx.full),
        distribution: distribution(ctx.full),
        points: ctx.series.length,
      });
    }

    if (route === "api/signals") {
      const ctx = await buildCtx(symbol, years, freq, refresh);
      if ("err" in ctx) return ctx.err;
      return json({
        ok: true,
        meta: meta(ctx),
        weightsVersion: "fixed-v1",
        signals: ctx.signals,
        composite: ctx.comp,
      });
    }

    if (route === "api/diagnosis") {
      const ctx = await buildCtx(symbol, years, freq, refresh);
      if ("err" in ctx) return ctx.err;
      if (!ctx.metrics) return error("insufficient_data", "样本不足", 422);
      return json({
        ok: true,
        meta: meta(ctx),
        composite: ctx.comp,
        metrics: ctx.metrics,
        signals: ctx.signals,
        regimeStudy: regimeStudy(ctx.full),
        volTrendMatrix: volTrendMatrix(ctx.full),
        disclaimer: "量化规则与历史统计输出，不构成投资建议；历史分位表现不保证未来结果。",
      });
    }

    if (route === "api/volatility/panic") {
      const dataset = await getDataset({ refresh });
      const status = dataset.statuses.find((s) => s.id === "implied_vol_vix") ?? null;
      const rows = dataset.vixRows ?? [];
      const base = {
        service: "nasdaq-volatility-api",
        version: VERSION,
        liveRefresh: refresh,
        asOf: rows.length ? rows[rows.length - 1][0] : null,
      };
      if (rows.length < 30) {
        return json({
          ok: true,
          available: false,
          meta: base,
          source: status,
          reason: status?.note ?? "VIX 上游不可达，且本地快照不含 VIX 序列",
          latest: null,
          quote: dataset.vixQuote ?? null,
          count: 0,
          series: [],
          definition: PANIC_DEFINITION,
        });
      }
      const series = panicSeries(rows);
      return json({
        ok: true,
        available: true,
        meta: base,
        source: status,
        count: series.length,
        latest: panicLatest(series),
        quote: dataset.vixQuote ?? null,
        series,
        definition: PANIC_DEFINITION,
      });
    }

    if (route === "api/stocks/list") {
      const extrasParsed = parseExtraCodes(url);
      if (extrasParsed.err) return extrasParsed.err;
      const extras = extrasParsed.codes;
      const ds = await getStockDataset({ refresh, extras });
      const infos = [...stockInfos(), ...(ds.extraInfos ?? [])];
      const stocks = infos.map((info) => {
        const rows = ds.stocks[info.code]?.rows ?? [];
        const last = rows.length ? rows[rows.length - 1] : null;
        const prev = rows.length > 1 ? rows[rows.length - 2] : null;
        const change = last && prev && prev[1] > 0 ? Math.round((last[1] / prev[1] - 1) * 10000) / 100 : null;
        return { ...info, asOf: last ? last[0] : null, close: last ? last[1] : null, dayChangePct: change };
      });
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          watchlistNote: WATCHLIST_NOTE,
          kospi: kospiMeta(),
          extras,
          sources: ds.statuses,
        },
        count: stocks.length,
        stocks,
      });
    }

    if (route === "api/stocks/signals") {
      const extrasParsed = parseExtraCodes(url);
      if (extrasParsed.err) return extrasParsed.err;
      const extras = extrasParsed.codes;
      const ds = await getStockDataset({ refresh, extras });
      const kospiSeries = buildSeries(ds.kospi, null);
      const kospiMetrics = stockMetrics(kospiSeries, null);
      const stocks = [...stockInfos(), ...(ds.extraInfos ?? [])]
        .map((info) => {
          const extraError = ds.extraErrors?.[info.code];
          if (extraError) {
            return { ...info, metrics: null, composite: null, signals: [], error: extraError };
          }
          const entry = ds.stocks[info.code];
          const series = entry ? buildSeries(entry.rows, null) : [];
          if (series.length < 30) {
            return { ...info, metrics: null, composite: null, signals: [], error: "样本不足（<30 个交易日）" };
          }
          const beta = kospiBeta(series, kospiSeries);
          const metrics = stockMetrics(series, beta);
          const result = stockSignals(series, kospiSeries);
          return { ...info, metrics, composite: result.composite, signals: result.signals, error: null };
        })
        .sort(
          (a, b) =>
            (b.composite ? b.composite.score : Number.NEGATIVE_INFINITY) -
            (a.composite ? a.composite.score : Number.NEGATIVE_INFINITY),
        )
        .map((s, i) => ({ rank: i + 1, ...s }));
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          count: stocks.length,
          extras,
          sources: ds.statuses,
          kospiInfo: kospiMeta(),
        },
        weighting: STOCK_WEIGHTING,
        kospi: {
          info: kospiMeta(),
          metrics: kospiMetrics,
          regime: kospiMetrics && kospiMetrics.rv21 !== null ? volRegime(kospiMetrics.rv21) : null,
          samples: kospiSeries.length,
        },
        stocks,
        disclaimer: STOCK_DISCLAIMER,
      });
    }

    if (route === "api/stocks/history") {
      const code = (url.searchParams.get("code") ?? "").trim();
      const baseInfo = code ? stockMeta(code) : undefined;
      if (!baseInfo && !isSupportedStockCode(code)) {
        const allowed = stockInfos().map((s) => s.code);
        return error("invalid_code", `代码 "${code || "(空)"}" 不是支持的沪深 A 股代码（沪市 60/68、深市 00/30 开头）；基础观察清单：${allowed.join(" | ")}`, 400, {
          allowed,
        });
      }
      const ds = await getStockDataset({ refresh, extras: baseInfo ? [] : [code] });
      const info = baseInfo ?? (ds.extraInfos ?? []).find((s) => s.code === code);
      if (!info) {
        return error("no_data", `个股 ${code} 未能加载，请稍后重试。`, 422);
      }
      const extraError = ds.extraErrors?.[code];
      if (extraError) {
        return error("no_data", `个股 ${code} 按需抓取失败：${extraError}`, 422);
      }
      const entry = ds.stocks[code];
      if (!entry) {
        return error("no_data", `个股 ${code} 暂无数据，请稍后重试。`, 422);
      }
      const series = buildSeries(entry.rows, null);
      const kospiSeries = buildSeries(ds.kospi, null);
      const kospiMap = new Map<string, number>();
      for (const r of ds.kospi) kospiMap.set(r[0], r[1]);
      const beta = kospiBeta(series, kospiSeries);
      const metrics = stockMetrics(series, beta);
      const result = stockSignals(series, kospiSeries);
      const compact = series.map((p) => {
        const row: Record<string, number | string | null> = {};
        for (const f of HISTORY_FIELDS) row[f] = p[f as keyof VolPoint] as number | string | null;
        row.kospi = kospiMap.get(p.date) ?? null;
        return row;
      });
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          asOf: metrics ? metrics.asOf : null,
          sources: ds.statuses,
        },
        stock: info,
        fields: [...HISTORY_FIELDS, "kospi"],
        count: compact.length,
        metrics,
        composite: result.composite,
        signals: result.signals,
        weighting: STOCK_WEIGHTING,
        series: compact,
        disclaimer: STOCK_DISCLAIMER,
      });
    }

    if (route === "api/dividend/list") {
      const extrasParsed = parseExtraCodes(url);
      if (extrasParsed.err) return extrasParsed.err;
      const extras = extrasParsed.codes;
      const ds = await getDividendDataset({ refresh, extras });
      const baseInfos = dividendInfos();
      const infos = [...baseInfos, ...(ds.extraInfos ?? [])];
      const views = infos
        .map((info) => {
          const entry = ds.stocks[info.code];
          return entry ? dividendView(info, entry) : null;
        })
        .filter((v): v is DividendStockView => v !== null);
      const rows = views
        .map((v) => dividendListRow(v, 0))
        .sort((a, b) => b.score - a.score)
        .map((r, i) => ({ ...r, rank: i + 1 }));
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          asOf: ds.asOf,
          snapshot: dividendMeta(),
          baseCount: baseInfos.length,
          extras,
          extraErrors: ds.extraErrors,
          sources: ds.statuses,
        },
        summary: dividendListSummary(rows),
        groups: dividendGroupSummaries(rows),
        watchlistNote: DIVIDEND_WATCHLIST_NOTE,
        strategy: DIVIDEND_STRATEGY,
        count: rows.length,
        stocks: rows,
        disclaimer: DIVIDEND_DISCLAIMER,
      });
    }

    if (route === "api/dividend/history") {
      const code = (url.searchParams.get("code") ?? "").trim();
      const baseInfo = dividendInfos().find((s) => s.code === code);
      if (!baseInfo && !isSupportedStockCode(code)) {
        const allowed = dividendInfos().map((s) => s.code);
        return error(
          "invalid_code",
          `代码 "${code || "(空)"}" 不是支持的沪深 A 股代码（沪市 60/68、深市 00/30 开头）；红利基础清单：${allowed.join(" | ")}`,
          400,
          { allowed },
        );
      }
      const ds = await getDividendDataset({ refresh, extras: baseInfo ? [] : [code] });
      const info = baseInfo ?? (ds.extraInfos ?? []).find((s) => s.code === code);
      if (!info) {
        const reason = ds.extraErrors?.[code];
        return error("no_data", reason ? `红利股 ${code} 按需抓取失败：${reason}` : `红利股 ${code} 未能加载，请稍后重试。`, 422, {
          extras: [code],
          extraErrors: ds.extraErrors,
        });
      }
      const entry = ds.stocks[code];
      if (!entry) return error("no_data", `红利股 ${code} 暂无周线快照，请运行 node dev/fetch-dividend-data.mjs 重新抓取。`, 422);
      const view = dividendView(info, entry);
      if (!view.metrics) return error("insufficient_data", `红利股 ${code} 的周线样本不足。`, 422);
      const compact = view.series.map((p) => {
        const row: Record<string, number | string | null> = {};
        for (const f of DIVIDEND_HISTORY_FIELDS) row[f] = p[f as keyof typeof p] as number | string | null;
        return row;
      });
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          asOf: view.metrics.asOf,
          snapshot: dividendMeta(),
          extras: baseInfo ? [] : [code],
          extraErrors: ds.extraErrors,
          sources: ds.statuses,
        },
        stock: info,
        fields: DIVIDEND_HISTORY_FIELDS,
        count: compact.length,
        metrics: view.metrics,
        composite: view.composite,
        signals: view.signals,
        dividends: view.dividends,
        series: compact,
        strategy: DIVIDEND_STRATEGY,
        definition: DIVIDEND_STRATEGY.definition,
        disclaimer: DIVIDEND_DISCLAIMER,
      });
    }

    if (route === "api/dividend/ai-context") {
      const code = (url.searchParams.get("code") ?? "").trim();
      const baseInfo = dividendInfos().find((s) => s.code === code);
      if (!baseInfo && !isSupportedStockCode(code)) {
        const allowed = dividendInfos().map((s) => s.code);
        return error(
          "invalid_code",
          `代码 "${code || "(空)"}" 不是支持的沪深 A 股代码（沪市 60/68、深市 00/30 开头）；红利基础清单：${allowed.join(" | ")}`,
          400,
          { allowed },
        );
      }
      const ds = await getDividendDataset({ refresh, extras: baseInfo ? [] : [code] });
      const info = baseInfo ?? (ds.extraInfos ?? []).find((s) => s.code === code);
      if (!info) {
        const reason = ds.extraErrors?.[code];
        return error("no_data", reason ? `红利股 ${code} 按需抓取失败：${reason}` : `红利股 ${code} 未能加载，请稍后重试。`, 422, {
          extras: [code],
          extraErrors: ds.extraErrors,
        });
      }
      const entry = ds.stocks[code];
      if (!entry) return error("no_data", `红利股 ${code} 暂无周线快照。`, 422);
      const view = dividendView(info, entry);
      if (!view.metrics) return error("insufficient_data", `红利股 ${code} 的周线样本不足。`, 422);
      const bundle = dividendAiBundle(view, ds.statuses, refresh);
      const format = (url.searchParams.get("format") ?? "markdown").toLowerCase();
      const metaPayload = {
        service: "nasdaq-volatility-api",
        version: VERSION,
        kind: "dividend-strategy",
        code,
        name: info.name,
        liveRefresh: refresh,
        asOf: view.metrics.asOf,
        snapshot: dividendMeta(),
        extras: baseInfo ? [] : [code],
        extraErrors: ds.extraErrors,
        sources: ds.statuses,
      };
      if (format === "json") {
        return json({ ok: true, meta: metaPayload, format: "json", bundle });
      }
      return json({
        ok: true,
        meta: metaPayload,
        format: "markdown",
        markdown: dividendMarkdown(view, bundle, ds.statuses),
        bundle,
      });
    }

    if (route === "api/macro/cross-asset") {
      const parsed = parseMacroYears(url);
      if (parsed.err) return parsed.err;
      const result = await getMacroAnalysis({ refresh, years: parsed.years });
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          asOf: result.payload.asOf,
          window: result.payload.window,
          snapshot: result.snapshot,
          sources: result.statuses,
        },
        ...result.payload,
        definition: macroDefinition(),
        limits: MACRO_LIMITS,
        disclaimer: MACRO_DISCLAIMER,
      });
    }

    if (route === "api/macro/ai-context") {
      const parsed = parseMacroYears(url);
      if (parsed.err) return parsed.err;
      const result = await getMacroAnalysis({ refresh, years: parsed.years });
      const bundle = macroAiBundle(result, refresh);
      const format = (url.searchParams.get("format") ?? "markdown").toLowerCase();
      const metaPayload = {
        service: "nasdaq-volatility-api",
        version: VERSION,
        kind: "cross-asset-macro",
        liveRefresh: refresh,
        asOf: result.payload.asOf,
        window: result.payload.window,
        snapshot: result.snapshot,
        sources: result.statuses,
      };
      if (format === "json") {
        return json({ ok: true, meta: metaPayload, format: "json", bundle });
      }
      return json({
        ok: true,
        meta: metaPayload,
        format: "markdown",
        markdown: macroMarkdown(result),
        bundle,
      });
    }

    if (route === "api/cycle/kondratiev") {
      const parsed = parsePanelYears(url, CYCLE_YEARS_ALLOWED, 5);
      if (parsed.err) return parsed.err;
      const result = await getCycleAnalysis({ refresh, years: parsed.years });
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          asOf: result.payload.asOf,
          window: result.payload.window,
          sources: result.payload.sources,
        },
        ...result.payload,
        definition: cycleDefinition(),
        limits: CYCLE_LIMITS,
        disclaimer: CYCLE_DISCLAIMER,
      });
    }

    if (route === "api/cycle/ai-context") {
      const parsed = parsePanelYears(url, CYCLE_YEARS_ALLOWED, 5);
      if (parsed.err) return parsed.err;
      const result = await getCycleAnalysis({ refresh, years: parsed.years });
      const bundle = cycleAiBundle(result, refresh);
      const format = (url.searchParams.get("format") ?? "markdown").toLowerCase();
      const metaPayload = {
        service: "nasdaq-volatility-api",
        version: VERSION,
        kind: "kondratiev-cycle-comparison",
        liveRefresh: refresh,
        asOf: result.payload.asOf,
        window: result.payload.window,
        sources: result.payload.sources,
      };
      if (format === "json") return json({ ok: true, meta: metaPayload, format: "json", bundle });
      return json({ ok: true, meta: metaPayload, format: "markdown", markdown: cycleMarkdown(result), bundle });
    }

    if (route === "api/valuation/buffett") {
      const parsed = parsePanelYears(url, VALUATION_YEARS_ALLOWED, 20);
      if (parsed.err) return parsed.err;
      const result = await getValuationAnalysis({ refresh, years: parsed.years });
      return json({
        ok: true,
        meta: {
          service: "nasdaq-volatility-api",
          version: VERSION,
          liveRefresh: refresh,
          asOf: result.payload.asOf,
          window: result.payload.window,
          snapshot: result.snapshot,
          sources: result.payload.sources,
        },
        ...result.payload,
        definition: valuationDefinition(),
        limits: VALUATION_LIMITS,
        disclaimer: VALUATION_DISCLAIMER,
      });
    }

    if (route === "api/valuation/ai-context") {
      const parsed = parsePanelYears(url, VALUATION_YEARS_ALLOWED, 20);
      if (parsed.err) return parsed.err;
      const result = await getValuationAnalysis({ refresh, years: parsed.years });
      const bundle = valuationAiBundle(result, refresh);
      const format = (url.searchParams.get("format") ?? "markdown").toLowerCase();
      const metaPayload = {
        service: "nasdaq-volatility-api",
        version: VERSION,
        kind: "us-buffett-valuation",
        liveRefresh: refresh,
        asOf: result.payload.asOf,
        window: result.payload.window,
        snapshot: result.snapshot,
        sources: result.payload.sources,
      };
      if (format === "json") return json({ ok: true, meta: metaPayload, format: "json", bundle });
      return json({ ok: true, meta: metaPayload, format: "markdown", markdown: valuationMarkdown(result), bundle });
    }

    if (route === "api/events") return await handleEvents();

    if (route === "api/events/study") return await handleEventStudy(url);

    if (route === "api/ai-context") {
      const ctx = await buildCtx(symbol, years, freq, refresh);
      if ("err" in ctx) return ctx.err;
      const format = (url.searchParams.get("format") ?? "markdown").toLowerCase();
      return await handleAiContext(ctx, format === "json" ? "json" : "markdown");
    }

    return error(
      "not_found",
      `未知路径 "${url.pathname}"。可用：/health、/docs、/api/symbols、/api/volatility/history、/api/volatility/snapshot、/api/volatility/panic、/api/signals、/api/diagnosis、/api/macro/cross-asset、/api/macro/ai-context、/api/cycle/kondratiev、/api/cycle/ai-context、/api/valuation/buffett、/api/valuation/ai-context、/api/stocks/list、/api/stocks/signals、/api/stocks/history、/api/dividend/list、/api/dividend/history、/api/dividend/ai-context、/api/events、/api/events/study、/api/ai-context`,
      404,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error("internal_error", "接口处理失败：" + message.slice(0, 160), 500);
  }
}
