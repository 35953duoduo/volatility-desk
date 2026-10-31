// 本机资产台账：持仓只保存在浏览器 localStorage，站点服务端不保存、不读取。
// 估值、占比与风控规则全部在前端确定性计算，不依赖任何网络数据。

export type HoldingKind = "gold" | "stock" | "fund" | "bond" | "deposit" | "cash" | "other";

export interface KindMeta {
  label: string;
  unit: string;
  /** 只需填金额（元/元），用于现金、存款与无法拆分份额的资产 */
  amountOnly: boolean;
  /** 是否计入风险资产（黄金、股票、基金、其他） */
  risk: boolean;
  /** 是否允许填写买入手续费（按份额计价的持仓） */
  fee: boolean;
}

export const KIND_META: Record<HoldingKind, KindMeta> = {
  gold: { label: "黄金", unit: "克", amountOnly: false, risk: true, fee: true },
  stock: { label: "股票", unit: "股", amountOnly: false, risk: true, fee: true },
  fund: { label: "基金", unit: "份", amountOnly: false, risk: true, fee: true },
  bond: { label: "债券", unit: "张", amountOnly: false, risk: false, fee: true },
  deposit: { label: "存款/理财", unit: "元", amountOnly: true, risk: false, fee: false },
  cash: { label: "现金", unit: "元", amountOnly: true, risk: false, fee: false },
  other: { label: "其他", unit: "元", amountOnly: true, risk: true, fee: false },
};

export const HOLDING_KINDS: HoldingKind[] = ["gold", "stock", "fund", "bond", "deposit", "cash", "other"];

export const PORTFOLIO_STORAGE_KEY = "vol-desk-portfolio";
export const PORTFOLIO_CASH_KEY = "vol-desk-portfolio-cash";
export const PORTFOLIO_LIMIT = 40;
/** 基金代码口径：6 位数字，DeepSeek 优先据此识别基金 */
export const FUND_CODE_RE = /^\d{6}$/;
/** 本机保存的自定义基金名单（只存名称与用户填过的代码） */
export const FUND_NAMES_KEY = "vol-desk-fund-names";
export const FUND_NAME_LIMIT = 80;

/**
 * 持仓页上的常用基金。代码只收录已确认的（018036 来自用户此前提供），
 * 其余基金不猜代码，留空由用户补或让 DeepSeek 按名称识别。
 * 截图里最后一只的名称被系统截断，未收录，输入一次后会自动记住。
 */
export const FUND_PRESETS: ReadonlyArray<{ name: string; code: string }> = [
  { name: "长城全球新能源汽车股票(QDII-LOF)C", code: "018036" },
  { name: "国富全球科技互联混合（QDII）人民币C", code: "" },
  { name: "国富全球科技互联混合（QDII）人民币A", code: "" },
  { name: "建信新兴市场优选混合(QDII)C", code: "" },
  { name: "浦银全球智能科技股票(QDII)C", code: "" },
  { name: "广发全球精选股票(QDII)C", code: "" },
  { name: "汇添富全球医疗保健混合(QDII)", code: "" },
  { name: "华宝纳斯达克精选股票(QDII)C", code: "" },
];

export interface FundOption {
  name: string;
  code: string;
  /** 是否来自内置持仓页名单 */
  preset: boolean;
}

interface FundEntry {
  name: string;
  code: string;
}

function sanitizeFundEntry(raw: unknown): FundEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name || name.length > 30) return null;
  const codeRaw = typeof v.code === "string" ? v.code.trim() : "";
  return { name, code: FUND_CODE_RE.test(codeRaw) ? codeRaw : "" };
}

function readSavedFundEntries(): FundEntry[] {
  const raw = storage()?.getItem(FUND_NAMES_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: FundEntry[] = [];
    for (const item of parsed) {
      const entry = sanitizeFundEntry(item);
      if (!entry || seen.has(entry.name)) continue;
      seen.add(entry.name);
      out.push(entry);
      if (out.length >= FUND_NAME_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** 内置名单 + 本机保存的自定义名称（同名时用用户填过的代码补齐） */
export function readFundOptions(): FundOption[] {
  const merged = new Map<string, FundOption>();
  for (const p of FUND_PRESETS) merged.set(p.name, { name: p.name, code: p.code, preset: true });
  for (const saved of readSavedFundEntries()) {
    const existing = merged.get(saved.name);
    if (existing) {
      if (!existing.code && saved.code) existing.code = saved.code;
    } else {
      merged.set(saved.name, { name: saved.name, code: saved.code, preset: false });
    }
  }
  return [...merged.values()];
}

/** 保存新基金名称（可带 6 位代码），返回合并后的下拉名单 */
export function rememberFundName(name: unknown, code: unknown): FundOption[] {
  const entry = sanitizeFundEntry({ name, code });
  if (!entry) return readFundOptions();
  const preset = FUND_PRESETS.find((p) => p.name === entry.name);
  if (preset && preset.code === entry.code) return readFundOptions();
  const saved = readSavedFundEntries().filter((e) => e.name !== entry.name);
  const next = [entry, ...saved].slice(0, FUND_NAME_LIMIT);
  try {
    storage()?.setItem(FUND_NAMES_KEY, JSON.stringify(next));
  } catch {
    /* 无痕模式下仅当前会话有效 */
  }
  return readFundOptions();
}

export interface Holding {
  id: string;
  kind: HoldingKind;
  name: string;
  code: string;
  /** 克 / 股 / 份 / 张；现金类为金额（元） */
  units: number;
  /** 每单位成本价；现金类固定为 1 */
  cost: number;
  /** 买入手续费合计（元），计入成本与盈亏；现金类固定为 0 */
  fee: number;
  /** 每单位现价；null 表示未填，按成本计价；现金类固定为 1 */
  price: number | null;
  priceAsOf: string | null;
  /** 基金 App 显示的持有收益（元，不含手续费）；null 表示按市值 − 成本自动计算 */
  holdingPnl: number | null;
  /** 基金 App 显示的持有收益率（%）；null 表示按持有收益 / 成本自动计算 */
  holdingPnlPct: number | null;
  note: string;
}

const MAX_UNITS = 1e9;
const MAX_PRICE = 1e7;
const MAX_FEE = 1e8;
const MAX_HOLDING_PNL = 1e9;
const MAX_HOLDING_PCT = 1e6;
const MAX_DRY_POWDER = 1e12;
const MAX_TEXT = 60;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function makeHoldingId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return "h-" + c.randomUUID();
  return "h-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function isKind(value: unknown): value is HoldingKind {
  return typeof value === "string" && (HOLDING_KINDS as string[]).includes(value);
}

function finite(value: unknown, min: number, max: number, exclusive = false): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (exclusive ? value <= min : value < min) return null;
  return value > max ? null : value;
}

/** 把任意输入收敛成合法持仓；不合法返回 null，避免坏数据进入台账 */
export function sanitizeHolding(raw: unknown): Holding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (!isKind(v.kind)) return null;
  const meta = KIND_META[v.kind];

  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name || name.length > 30) return null;
  const code = typeof v.code === "string" ? v.code.trim() : "";
  if (code.length > 16) return null;
  const note = typeof v.note === "string" ? v.note.trim() : "";
  if (note.length > MAX_TEXT) return null;

  const units = finite(v.units, 0, MAX_UNITS, true);
  if (units === null) return null;

  let cost: number;
  let price: number | null;
  let fee: number;
  let holdingPnl: number | null = null;
  let holdingPnlPct: number | null = null;
  if (meta.amountOnly) {
    cost = 1;
    price = 1;
    fee = 0;
  } else {
    const parsedCost = finite(v.cost, 0, MAX_PRICE, true);
    if (parsedCost === null) return null;
    cost = parsedCost;
    if (v.price === null || v.price === undefined || v.price === "") {
      price = null;
    } else {
      price = finite(v.price, 0, MAX_PRICE);
      if (price === null) return null;
    }
    // 旧数据没有 fee 字段，按 0 处理
    const feeRaw = v.fee === null || v.fee === undefined || v.fee === "" ? 0 : finite(v.fee, 0, MAX_FEE);
    if (feeRaw === null) return null;
    fee = feeRaw;
    if (v.kind === "fund") {
      if (v.holdingPnl !== null && v.holdingPnl !== undefined && v.holdingPnl !== "") {
        holdingPnl = finite(v.holdingPnl, -MAX_HOLDING_PNL, MAX_HOLDING_PNL);
        if (holdingPnl === null) return null;
      }
      if (v.holdingPnlPct !== null && v.holdingPnlPct !== undefined && v.holdingPnlPct !== "") {
        holdingPnlPct = finite(v.holdingPnlPct, -MAX_HOLDING_PCT, MAX_HOLDING_PCT);
        if (holdingPnlPct === null) return null;
      }
    }
  }

  const dateRaw = typeof v.priceAsOf === "string" ? v.priceAsOf.trim() : "";
  const priceAsOf = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  const id = typeof v.id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v.id) ? v.id : makeHoldingId();

  return { id, kind: v.kind, name, code, units, cost, fee, price, priceAsOf, holdingPnl, holdingPnlPct, note };
}

/** 读取本机台账；无痕模式、损坏数据或越界数据一律安全退回 */
export function readPortfolio(): Holding[] {
  const raw = storage()?.getItem(PORTFOLIO_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sanitizeList(parsed);
  } catch {
    return [];
  }
}

/** 写回本机台账并返回实际生效的列表（存储不可用时仅当前会话有效） */
export function writePortfolio(list: Holding[]): Holding[] {
  const clean = sanitizeList(list);
  try {
    storage()?.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* 无痕模式下存不下，仅当前会话有效 */
  }
  return clean;
}

function sanitizeList(input: unknown[]): Holding[] {
  const seen = new Set<string>();
  const clean: Holding[] = [];
  for (const item of input) {
    const h = sanitizeHolding(item);
    if (!h || seen.has(h.id)) continue;
    seen.add(h.id);
    clean.push(h);
    if (clean.length >= PORTFOLIO_LIMIT) break;
  }
  return clean;
}

/** 可投入现金：还没建仓的备用金，和台账一样只存在本机 */
export function normalizeDryPowder(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (value > MAX_DRY_POWDER) return MAX_DRY_POWDER;
  return Math.round(value * 100) / 100;
}

export function readDryPowder(): number {
  const raw = storage()?.getItem(PORTFOLIO_CASH_KEY);
  return raw ? normalizeDryPowder(Number(raw)) : 0;
}

export function writeDryPowder(value: number): number {
  const clean = normalizeDryPowder(value);
  try {
    storage()?.setItem(PORTFOLIO_CASH_KEY, String(clean));
  } catch {
    /* 无痕模式：仅当前会话有效 */
  }
  return clean;
}

/* ===== 组合汇总与风控规则 ===== */

/** 固定阈值：写进页面说明与 AI 提示词，保证 AI 与本地规则口径一致 */
export const PORTFOLIO_RULES = {
  singleWarn: 25,
  singleAlert: 40,
  riskWarn: 80,
  riskAlert: 90,
  defenseWarn: 10,
  defenseAlert: 5,
  goldWarn: 20,
  lossWarn: -20,
  lossAlert: -35,
  totalLossWarn: -15,
  tooManyPositions: 12,
} as const;

export interface HoldingRow extends Omit<Holding, "holdingPnl" | "holdingPnlPct"> {
  unitPrice: number;
  value: number;
  costTotal: number;
  /** 数量 × 成本单价（不含手续费），基金 App 的持仓成本口径 */
  costAmount: number;
  /** 含手续费的每单位成本，也是这笔持仓的保本价 */
  breakeven: number;
  pnl: number;
  pnlPct: number | null;
  /** 持有收益（不含手续费）：手填优先，否则按市值 − 成本自动计算 */
  holdingPnl: number;
  holdingPnlPct: number | null;
  holdingPnlManual: boolean;
  weight: number;
  priced: boolean;
}

export interface KindRow {
  kind: HoldingKind;
  label: string;
  count: number;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number | null;
  weight: number;
}

export type CheckLevel = "info" | "warn" | "alert";
export interface RiskCheck {
  level: CheckLevel;
  title: string;
  detail: string;
}

export type RiskBand = "无持仓" | "低" | "中" | "高";

export interface PortfolioSummary {
  count: number;
  totalValue: number;
  totalCost: number;
  pnl: number;
  pnlPct: number | null;
  /** 尚未建仓的可投入现金，不计入风险/防守占比 */
  dryPowder: number;
  /** 持仓市值 + 可投入现金 */
  totalAssets: number;
  dryWeight: number;
  riskValue: number;
  riskWeight: number;
  defenseValue: number;
  defenseWeight: number;
  topWeight: number;
  top3Weight: number;
  rows: HoldingRow[];
  kinds: KindRow[];
  checks: RiskCheck[];
  score: number | null;
  band: RiskBand;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const share = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function pctText(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function signedPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function money(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}¥${Math.abs(v).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 基金净值按 4 位小数展示，其余资产按 2 位 */
export function unitMoney(v: number | null | undefined, kind: HoldingKind): string {
  return money(v, kind === "fund" ? 4 : 2);
}

const LEVEL_ORDER: Record<CheckLevel, number> = { alert: 0, warn: 1, info: 2 };

export function summarizePortfolio(holdings: Holding[], dryPowder = 0): PortfolioSummary {
  const rows: HoldingRow[] = [];
  for (const h of holdings) {
    const unitPrice = h.price ?? h.cost;
    const value = h.units * unitPrice;
    const costAmount = h.units * h.cost;
    const costTotal = costAmount + h.fee;
    const pnl = value - costTotal;
    const holdingPnl = h.holdingPnl ?? value - costAmount;
    rows.push({
      ...h,
      unitPrice,
      value,
      costAmount,
      costTotal,
      breakeven: costTotal / h.units,
      pnl,
      pnlPct: costTotal > 0 ? (pnl / costTotal) * 100 : null,
      holdingPnl,
      holdingPnlPct: h.holdingPnlPct ?? (costAmount > 0 ? (holdingPnl / costAmount) * 100 : null),
      holdingPnlManual: h.holdingPnl !== null || h.holdingPnlPct !== null,
      weight: 0,
      priced: h.price !== null,
    });
  }

  const totalValue = sum(rows.map((r) => r.value));
  const totalCost = sum(rows.map((r) => r.costTotal));
  for (const r of rows) r.weight = share(r.value, totalValue);
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : null;
  const dry = normalizeDryPowder(dryPowder);
  const totalAssets = totalValue + dry;
  const dryWeight = share(dry, totalAssets);

  const kinds: KindRow[] = HOLDING_KINDS.map((kind) => {
    const subset = rows.filter((r) => r.kind === kind);
    const value = sum(subset.map((r) => r.value));
    const cost = sum(subset.map((r) => r.costTotal));
    const kindPnl = value - cost;
    return {
      kind,
      label: KIND_META[kind].label,
      count: subset.length,
      value,
      cost,
      pnl: kindPnl,
      pnlPct: cost > 0 ? (kindPnl / cost) * 100 : null,
      weight: share(value, totalValue),
    };
  })
    .filter((k) => k.count > 0)
    .sort((a, b) => b.value - a.value);

  const riskValue = sum(rows.filter((r) => KIND_META[r.kind].risk).map((r) => r.value));
  // 可投入现金本身就是现金，计入防守垫；风险/防守占比以「持仓市值 + 可投入现金」为分母。
  const defenseValue = totalValue - riskValue + dry;
  const riskWeight = share(riskValue, totalAssets);
  const defenseWeight = share(defenseValue, totalAssets);
  // 现金是防守垫本身，不构成个股/品类风险，集中度统计剔除现金，避免高现金组合被误报。
  const sortedWeights = rows
    .filter((r) => r.kind !== "cash")
    .map((r) => r.weight)
    .sort((a, b) => b - a);
  const topWeight = sortedWeights[0] ?? 0;
  const top3Weight = sum(sortedWeights.slice(0, 3));

  const checks: RiskCheck[] = [];
  if (!rows.length || totalValue <= 0) {
    return {
      count: rows.length,
      totalValue,
      totalCost,
      pnl,
      pnlPct,
      dryPowder: dry,
      totalAssets,
      dryWeight,
      riskValue,
      riskWeight,
      defenseValue,
      defenseWeight,
      topWeight,
      top3Weight,
      rows,
      kinds,
      checks: [],
      score: null,
      band: "无持仓",
    };
  }

  if (topWeight >= PORTFOLIO_RULES.singleAlert) {
    checks.push({
      level: "alert",
      title: "单一持仓过于集中",
      detail: `最大单一持仓占 ${pctText(topWeight)}，超过 ${PORTFOLIO_RULES.singleAlert}% 的硬上限；该标的出现个股或品类风险时，整个组合会被拖累。`,
    });
  } else if (topWeight >= PORTFOLIO_RULES.singleWarn) {
    checks.push({
      level: "warn",
      title: "单一持仓偏高",
      detail: `最大单一持仓占 ${pctText(topWeight)}，高于 ${PORTFOLIO_RULES.singleWarn}% 的观察线；新增资金优先补其他类别，而不是继续加同一只。`,
    });
  }

  if (riskWeight >= PORTFOLIO_RULES.riskAlert) {
    checks.push({
      level: "alert",
      title: "风险资产敞口过高",
      detail: `黄金、股票、基金与其他合计占 ${pctText(riskWeight)}，超过 ${PORTFOLIO_RULES.riskAlert}%；缺少缓冲，遇到系统性回撤时只能被动承受。`,
    });
  } else if (riskWeight >= PORTFOLIO_RULES.riskWarn) {
    checks.push({
      level: "warn",
      title: "风险资产偏满",
      detail: `风险资产合计占 ${pctText(riskWeight)}，高于 ${PORTFOLIO_RULES.riskWarn}%；加仓前先确认防守垫是否足够。`,
    });
  }

  if (defenseWeight < PORTFOLIO_RULES.defenseAlert) {
    checks.push({
      level: "alert",
      title: "防守垫不足",
      detail: `现金、存款理财、债券与可投入现金合计仅占 ${pctText(defenseWeight)}，低于 ${PORTFOLIO_RULES.defenseAlert}%；缺少应对失业、医疗或补仓机会的缓冲。`,
    });
  } else if (defenseWeight < PORTFOLIO_RULES.defenseWarn) {
    checks.push({
      level: "warn",
      title: "防守垫偏低",
      detail: `现金、存款理财、债券与可投入现金合计占 ${pctText(defenseWeight)}，低于 ${PORTFOLIO_RULES.defenseWarn}% 的参考线。`,
    });
  }

  const gold = kinds.find((k) => k.kind === "gold");
  if (gold && gold.weight > PORTFOLIO_RULES.goldWarn) {
    checks.push({
      level: "warn",
      title: "黄金占比偏高",
      detail: `黄金占 ${pctText(gold.weight)}，高于 ${PORTFOLIO_RULES.goldWarn}% 的参考上限；再平衡时优先分批减黄金，而不是先砍成长资产。`,
    });
  }

  const worst = rows
    .filter((r): r is HoldingRow & { pnlPct: number } => r.pnlPct !== null)
    .sort((a, b) => a.pnlPct - b.pnlPct)[0];
  if (worst && worst.pnlPct <= PORTFOLIO_RULES.lossAlert) {
    checks.push({
      level: "alert",
      title: "单笔亏损已超阈值",
      detail: `「${worst.name}」浮亏 ${signedPct(worst.pnlPct)}，低于 ${PORTFOLIO_RULES.lossAlert}%；先复核买入逻辑是否仍成立，避免用摊平成本替代止损纪律。`,
    });
  } else if (worst && worst.pnlPct <= PORTFOLIO_RULES.lossWarn) {
    checks.push({
      level: "warn",
      title: "单笔亏损需复盘",
      detail: `「${worst.name}」浮亏 ${signedPct(worst.pnlPct)}，低于 ${PORTFOLIO_RULES.lossWarn}%；分批摊平只能降低成本，不能修正错误判断。`,
    });
  }

  if (pnlPct !== null && pnlPct <= PORTFOLIO_RULES.totalLossWarn) {
    checks.push({
      level: "warn",
      title: "组合整体浮亏",
      detail: `台账整体浮亏 ${signedPct(pnlPct)}，低于 ${PORTFOLIO_RULES.totalLossWarn}%；先降低加仓频率，检查各类别占比是否已偏离原计划。`,
    });
  }

  const unpriced = rows.filter((r) => !r.priced && !KIND_META[r.kind].amountOnly).length;
  if (unpriced > 0) {
    checks.push({
      level: "info",
      title: "部分持仓缺少现价",
      detail: `${unpriced} 笔持仓未填现价，已按成本计入市值与占比；盈亏结论在这些持仓上失真。`,
    });
  }

  const equityCount = rows.filter((r) => r.kind === "stock" || r.kind === "fund").length;
  if (equityCount >= PORTFOLIO_RULES.tooManyPositions) {
    checks.push({
      level: "info",
      title: "持仓数量较多",
      detail: `股票与基金共 ${equityCount} 笔，单笔研究成本上升；可考虑合并同质化持仓。`,
    });
  }

  const fundsMissingCode = rows.filter((r) => r.kind === "fund" && !FUND_CODE_RE.test(r.code)).length;
  if (fundsMissingCode > 0) {
    checks.push({
      level: "warn",
      title: "基金缺少代码",
      detail: `${fundsMissingCode} 笔基金没有 6 位代码，诊断只能按名称识别；补上代码更可靠。`,
    });
  }

  checks.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  const worstLoss = rows.reduce((m, r) => (r.pnlPct !== null && r.pnlPct < m ? r.pnlPct : m), 0);
  const score = Math.round(
    45 * clamp01(riskWeight / 100) +
      25 * clamp01((topWeight - PORTFOLIO_RULES.singleWarn) / (PORTFOLIO_RULES.singleAlert - PORTFOLIO_RULES.singleWarn)) +
      20 * clamp01(-worstLoss / Math.abs(PORTFOLIO_RULES.lossAlert)) +
      10 * clamp01((PORTFOLIO_RULES.defenseWarn - defenseWeight) / PORTFOLIO_RULES.defenseWarn),
  );
  const band: RiskBand = score < 35 ? "低" : score < 65 ? "中" : "高";

  return {
    count: rows.length,
    totalValue,
    totalCost,
    pnl,
    pnlPct,
    dryPowder: dry,
    totalAssets,
    dryWeight,
    riskValue,
    riskWeight,
    defenseValue,
    defenseWeight,
    topWeight,
    top3Weight,
    rows,
    kinds,
    checks,
    score,
    band,
  };
}

/* ===== 可投入现金的部署候选（启发式排序，不是买卖建议） ===== */

export interface DeploymentCandidate {
  id: string;
  name: string;
  code: string;
  kind: HoldingKind;
  kindLabel: string;
  score: number;
  /** 按三档分批，每档金额 */
  tranche: number;
  reasons: string[];
}

function priceAgeDays(priceAsOf: string | null, todayISO: string): number | null {
  if (!priceAsOf) return null;
  const t = Date.parse(`${priceAsOf}T00:00:00Z`);
  const now = Date.parse(`${todayISO}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - t) / 86400000));
}

/**
 * 用固定规则给「用可投入现金加仓」排性价比：浮亏越深、占比越低、价格越新分越高；
 * 已接近集中度上限、风险资产偏满、黄金超配、手续费过重、价格过旧会扣分。
 * 只是把台账里的结构信息排序，不预测涨跌，也不替代判断。
 */
export function deploymentCandidates(summary: PortfolioSummary, todayISO = new Date().toISOString().slice(0, 10)): DeploymentCandidate[] {
  if (summary.dryPowder <= 0) return [];
  const goldWeight = summary.kinds.find((k) => k.kind === "gold")?.weight ?? 0;
  const tranche = Math.round((summary.dryPowder / 3) * 100) / 100;
  const out: DeploymentCandidate[] = [];

  for (const r of summary.rows) {
    if (!KIND_META[r.kind].risk || !r.priced || r.weight >= PORTFOLIO_RULES.singleWarn) continue;
    let score = 50;
    const reasons: string[] = [];

    if (r.pnlPct !== null) {
      if (r.pnlPct <= -20) {
        score += 30;
        reasons.push(`浮亏 ${signedPct(r.pnlPct)}，价格明显低于含费成本`);
      } else if (r.pnlPct <= -10) {
        score += 20;
        reasons.push(`浮亏 ${signedPct(r.pnlPct)}`);
      } else if (r.pnlPct <= -5) {
        score += 10;
        reasons.push(`浮亏 ${signedPct(r.pnlPct)}`);
      } else if (r.pnlPct >= 20) {
        score -= 10;
        reasons.push(`浮盈 ${signedPct(r.pnlPct)}，继续加仓的性价比偏低`);
      }
    }
    if (r.weight >= 15) {
      score -= 15;
      reasons.push(`已占 ${pctText(r.weight)}，接近 ${PORTFOLIO_RULES.singleWarn}% 观察线`);
    }
    if (summary.riskWeight >= PORTFOLIO_RULES.riskWarn) {
      score -= 15;
      reasons.push(`风险资产合计 ${pctText(summary.riskWeight)}，先补防守垫再谈加仓`);
    }
    if (r.kind === "gold" && goldWeight > PORTFOLIO_RULES.goldWarn) {
      score -= 10;
      reasons.push(`黄金占 ${pctText(goldWeight)}，超过 ${PORTFOLIO_RULES.goldWarn}% 参考上限`);
    }
    if (r.kind === "fund" && !FUND_CODE_RE.test(r.code)) {
      score -= 10;
      reasons.push("缺少 6 位基金代码，AI 只能按名称识别");
    }
    const age = priceAgeDays(r.priceAsOf, todayISO);
    if (age === null) {
      score -= 10;
      reasons.push("未填价格日期，无法判断现价时效");
    } else if (age >= 30) {
      score -= 20;
      reasons.push(`现价已 ${age} 天未更新`);
    } else if (age >= 7) {
      score -= 10;
      reasons.push(`现价 ${age} 天未更新`);
    }
    if (r.costTotal > 0 && r.fee > 0 && r.fee / r.costTotal > 0.01) {
      score -= 5;
      reasons.push(`手续费占成本 ${pctText((r.fee / r.costTotal) * 100)}，摊薄收益`);
    }
    if (!reasons.length) reasons.push(`现价 ${unitMoney(r.unitPrice, r.kind)}/${KIND_META[r.kind].unit}，占 ${pctText(r.weight)}`);

    out.push({
      id: r.id,
      name: r.name,
      code: r.code,
      kind: r.kind,
      kindLabel: KIND_META[r.kind].label,
      score: Math.max(0, Math.min(100, Math.round(score))),
      tranche,
      reasons: reasons.slice(0, 3),
    });
  }

  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN")).slice(0, 3);
}

/* ===== 交给 DeepSeek 的数据包 ===== */

export interface PortfolioMarket {
  vix: { level: number; asOf: string; pct5y: number | null; z: number | null; regime: string | null; quote: number | null } | null;
  index: { label: string; asOf: string | null; rv21: number | null; rv63: number | null; pct5y: number | null; z: number | null } | null;
  macro: {
    riskLabel: string | null;
    summary: string | null;
    ust10y: number | null;
    assets: { label: string; close: number | null; asOf: string | null; vol21: number | null; drawdown1y: number | null }[];
  } | null;
}

const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits));

/** 生成只含本站指标与本机台账的 Markdown 数据包；数值全部来自确定性计算 */
export function buildPortfolioContext(holdings: Holding[], market: PortfolioMarket | null = null, dryPowder = 0): string {
  const summary = summarizePortfolio(holdings, dryPowder);
  const lines: string[] = [`生成日期：${new Date().toISOString().slice(0, 10)}（本机）`];

  if (!holdings.length) {
    lines.push("持仓台账为空。");
    lines.push(`可投入现金：${money(summary.dryPowder)}。`);
    lines.push("口径：数量、成本与现价均由用户手动填写；台账不读取券商账户。");
    return lines.join("\n");
  }

  lines.push(
    `持仓台账：${summary.count} 笔；总成本 ${money(summary.totalCost)}（含用户填写的手续费）；总市值 ${money(summary.totalValue)}；浮动盈亏 ${money(summary.pnl)}（${signedPct(summary.pnlPct)}）。`,
  );
  lines.push(
    `可投入现金（尚未建仓）：${money(summary.dryPowder)}；总资产（持仓市值 + 可投入现金）：${money(summary.totalAssets)}，待投现金占 ${pctText(summary.dryWeight)}。`,
  );
  lines.push(
    `风险资产（黄金/股票/基金/其他）：${money(summary.riskValue)}，占总资产 ${pctText(summary.riskWeight)}；防守资产（现金/存款/债券 + 可投入现金）：${money(summary.defenseValue)}，占 ${pctText(summary.defenseWeight)}（占比分母含待投现金）。`,
  );
  lines.push(`集中度（剔除现金）：最大单一持仓 ${pctText(summary.topWeight)}；前三大合计 ${pctText(summary.top3Weight)}。`);

  lines.push("", "分类汇总（按市值）：");
  for (const k of summary.kinds) {
    lines.push(
      `- ${k.label}：${k.count} 笔，市值 ${money(k.value)}，占 ${pctText(k.weight)}，成本 ${money(k.cost)}，盈亏 ${money(k.pnl)}（${signedPct(k.pnlPct)}）`,
    );
  }

  lines.push("", "持仓明细：");
  summary.rows.forEach((r, i) => {
    const meta = KIND_META[r.kind];
    const code = r.code ? `，代码 ${r.code}` : r.kind === "fund" ? "，代码缺失" : "";
    const note = r.note ? `；备注：${r.note}` : "";
    if (meta.amountOnly) {
      lines.push(`${i + 1}. [${meta.label}] ${r.name}${code}：金额 ${money(r.units)}，占 ${pctText(r.weight)}；按金额计价${note}`);
      return;
    }
    const priceText = r.price === null ? "未填" : `${unitMoney(r.price, r.kind)}/${meta.unit}`;
    const priceDate = r.priceAsOf ? `（${r.priceAsOf}）` : r.price === null ? "（按成本计价）" : "";
    const feeText = r.fee > 0 ? `，手续费 ${money(r.fee)}（含费成本 ${unitMoney(r.breakeven, r.kind)}/${meta.unit}，即保本价）` : "";
    const holdingText =
      r.kind === "fund"
        ? `，持有收益 ${money(r.holdingPnl)}（${signedPct(r.holdingPnlPct)}，App 口径不含手续费${r.holdingPnlManual ? "，用户手填" : "，按填写净值自动计算"}）`
        : "";
    lines.push(
      `${i + 1}. [${meta.label}] ${r.name}${code}：数量 ${num(r.units)} ${meta.unit}，成本单价 ${unitMoney(r.cost, r.kind)}/${meta.unit}${feeText}，现价 ${priceText}${priceDate}，市值 ${money(r.value)}，占 ${pctText(r.weight)}${holdingText}，浮动盈亏（含手续费） ${money(r.pnl)}（${signedPct(r.pnlPct)}）${note}`,
    );
  });

  lines.push("", `本站固定风控规则（阈值固定、非预测；单项持仓 ${PORTFOLIO_RULES.singleWarn}% 观察 / ${PORTFOLIO_RULES.singleAlert}% 上限且不计现金，风险资产 ${PORTFOLIO_RULES.riskWarn}%，防守垫 ${PORTFOLIO_RULES.defenseWarn}%，单笔亏损 ${PORTFOLIO_RULES.lossWarn}%）：`);
  if (!summary.checks.length) {
    lines.push("- 未触发规则。");
  } else {
    for (const c of summary.checks) {
      const tag = c.level === "alert" ? "需处理" : c.level === "warn" ? "留意" : "提示";
      lines.push(`- [${tag}] ${c.title}：${c.detail}`);
    }
  }
  lines.push(`- 本地结构评分：${summary.score ?? "—"}/100（等级 ${summary.band}）。评分越高表示集中度、风险敞口与回撤压力越大，不是收益预测。`);

  const candidates = deploymentCandidates(summary);
  lines.push("", "可投入现金部署候选（本站固定规则的启发式排序，不是买卖建议；每档金额按三档等分）：");
  if (!candidates.length) {
    lines.push(
      summary.dryPowder > 0
        ? "- 暂无可排序的候选：风险持仓都接近 25% 集中度观察线、缺少现价，或台账里还没有风险持仓。"
        : "- 未填写可投入现金，暂不排序。",
    );
  } else {
    for (const c of candidates) {
      lines.push(`- ${c.name}${c.code ? `（${c.code}）` : ""} [${c.kindLabel}]：性价比分 ${c.score}/100，每档约 ${money(c.tranche)}；${c.reasons.join("；")}`);
    }
  }
  if (summary.dryPowder > 0 && summary.defenseWeight < PORTFOLIO_RULES.defenseWarn) {
    lines.push(`- 防守垫只有 ${pctText(summary.defenseWeight)}，低于 ${PORTFOLIO_RULES.defenseWarn}%：第一档应优先补现金/存款，再考虑风险资产。`);
  }
  if (summary.dryPowder > 0 && summary.riskWeight >= PORTFOLIO_RULES.riskWarn) {
    lines.push(`- 风险资产已占 ${pctText(summary.riskWeight)}：可投入现金应优先留作缓冲，而不是继续加风险资产。`);
  }

  if (market?.vix) {
    const v = market.vix;
    lines.push(
      "",
      `市场背景：VIX ${num(v.level)}（${v.asOf}），5 年分位 ${pctText(v.pct5y, 0)}，Z 分数 ${num(v.z)}，本站判定 ${v.regime ?? "—"}${v.quote !== null ? `；CBOE 延迟报价 ${num(v.quote)}（约 15 分钟延迟）` : ""}。`,
    );
  } else {
    lines.push("", "市场背景：VIX 数据当前不可用。");
  }
  if (market?.index) {
    const m = market.index;
    lines.push(
      `- 所选指数 ${m.label}：RV21 ${num(m.rv21)}%，RV63 ${num(m.rv63)}%，波动率 5 年分位 ${pctText(m.pct5y, 0)}，Z 分数 ${num(m.z)}（截至 ${m.asOf ?? "—"}）。`,
    );
  }
  if (market?.macro) {
    const m = market.macro;
    const parts: string[] = [];
    if (m.riskLabel) parts.push(`跨资产风险等级 ${m.riskLabel}`);
    if (m.ust10y !== null) parts.push(`10 年期美债收益率 ${num(m.ust10y)}%`);
    for (const a of m.assets.slice(0, 3)) {
      if (a.close === null) continue;
      parts.push(`${a.label} ${num(a.close)}（${a.asOf ?? "—"}${a.vol21 !== null ? `，21 日波动 ${num(a.vol21)}%` : ""}${a.drawdown1y !== null ? `，近一年回撤 ${num(a.drawdown1y)}%` : ""}）`);
    }
    if (parts.length) lines.push(`- ${parts.join("；")}。`);
    if (m.summary) lines.push(`- 跨资产摘要：${m.summary}`);
  }

  lines.push(
    "",
    "口径与限制：数量、成本、手续费与现价均由用户手动填写，可能已过期；手续费按用户填写的合计金额直接计入成本与盈亏，未拆分佣金、印花税、管理费与赎回费；基金的持有收益与持有收益率按 App 口径不含手续费，可手填或按市值 − 成本自动计算，与含手续费的浮动盈亏不是同一个口径；台账不读取券商账户，不含税费、汇率、杠杆与分红再投资；黄金按用户填写的元/克计价；基金以 6 位代码为唯一标识，价格来自用户填写的最新净值，可能滞后于实际净值；可投入现金只是用户手工填写的备用金，不代表券商可用余额；本地评分、性价比候选与历史分位都只描述当前结构，不代表未来收益。",
  );
  return lines.join("\n");
}
