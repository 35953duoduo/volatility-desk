// 资产台账的离线校验：不触网、不读真实浏览器存储，覆盖输入校验、本机持久化、
// 组合汇总、固定阈值风控规则与 DeepSeek 数据包。全程不调用任何付费接口。
// 运行：node --experimental-strip-types dev/verify-portfolio.mjs
import {
  FUND_CODE_RE,
  FUND_NAMES_KEY,
  FUND_NAME_LIMIT,
  FUND_PRESETS,
  PORTFOLIO_CASH_KEY,
  PORTFOLIO_LIMIT,
  PORTFOLIO_RULES,
  PORTFOLIO_STORAGE_KEY,
  buildPortfolioContext,
  deploymentCandidates,
  money,
  normalizeDryPowder,
  pctText,
  readDryPowder,
  readFundOptions,
  readPortfolio,
  rememberFundName,
  sanitizeHolding,
  signedPct,
  summarizePortfolio,
  unitMoney,
  writeDryPowder,
  writePortfolio,
} from "../lib/portfolio.ts";

let pass = 0;
let fail = 0;
const t0 = Date.now();

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error("✗ " + name + (detail ? " — " + detail : ""));
}

/* ===== 本机存储替身（Node 没有浏览器 localStorage） ===== */
const mem = new Map();
const fakeStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
Object.defineProperty(globalThis, "localStorage", { value: fakeStorage, configurable: true, writable: true });

/* ===== 1. 输入校验 ===== */
const gold = sanitizeHolding({
  id: "h-gold-001",
  kind: "gold",
  name: "  黄金积存  ",
  code: "",
  units: 100,
  cost: 480,
  price: 520,
  priceAsOf: "2026-10-28",
  note: "定投",
});
check("合法黄金持仓被保留并去空白", gold !== null && gold.name === "黄金积存" && gold.units === 100 && gold.priceAsOf === "2026-10-28");

check("拒绝未知类别", sanitizeHolding({ kind: "crypto", name: "x", units: 1, cost: 1 }) === null);
check("拒绝空名称", sanitizeHolding({ kind: "cash", name: "   ", units: 1 }) === null);
check("拒绝超长名称", sanitizeHolding({ kind: "cash", name: "现".repeat(31), units: 1 }) === null);
check("拒绝 0 数量", sanitizeHolding({ kind: "stock", name: "x", units: 0, cost: 1 }) === null);
check("拒绝负数量", sanitizeHolding({ kind: "stock", name: "x", units: -3, cost: 1 }) === null);
check("拒绝 0 成本", sanitizeHolding({ kind: "stock", name: "x", units: 1, cost: 0 }) === null);
check("拒绝负现价", sanitizeHolding({ kind: "stock", name: "x", units: 1, cost: 1, price: -1 }) === null);
check("拒绝 NaN", sanitizeHolding({ kind: "stock", name: "x", units: Number.NaN, cost: 1 }) === null);
check("拒绝超长备注", sanitizeHolding({ kind: "cash", name: "现金", units: 1, note: "备".repeat(61) }) === null);

const cash = sanitizeHolding({ kind: "cash", name: "活期现金", units: 50000, cost: 999, price: null });
check("现金类按金额计价并忽略成本/现价", cash !== null && cash.cost === 1 && cash.price === 1 && cash.units === 50000);

const stock = sanitizeHolding({ kind: "stock", name: "测试股", units: 200, cost: 10, price: null });
check("现价可以留空（按成本计价）", stock !== null && stock.price === null);

const stockPriced = sanitizeHolding({ kind: "stock", name: "测试股", units: 200, cost: 10, price: 12 });

const noId = sanitizeHolding({ kind: "cash", name: "现金", units: 1 });
check("非法 id 会被重写为安全 id", noId !== null && /^h-[A-Za-z0-9_-]{6,}$/.test(noId.id), noId?.id);
const badDate = sanitizeHolding({ kind: "stock", name: "x", units: 1, cost: 1, priceAsOf: "2026/10/28" });
check("不合法的价格日期被忽略", badDate !== null && badDate.priceAsOf === null);

/* ===== 1b. 手续费与基金代码 ===== */
const goldFee = sanitizeHolding({ kind: "gold", name: "金条", units: 100, cost: 480, fee: 48, price: 520, priceAsOf: "2026-10-28" });
check("手续费按合计金额保留", goldFee !== null && goldFee.fee === 48 && goldFee.cost === 480, JSON.stringify(goldFee));
const legacy = sanitizeHolding({ kind: "stock", name: "旧数据", units: 1, cost: 1 });
check("旧数据缺少 fee 字段按 0 处理", legacy !== null && legacy.fee === 0);
check("拒绝负手续费", sanitizeHolding({ kind: "stock", name: "x", units: 1, cost: 1, fee: -1 }) === null);
check("拒绝非数字手续费", sanitizeHolding({ kind: "stock", name: "x", units: 1, cost: 1, fee: "5" }) === null);
check("空字符串手续费按 0 处理", sanitizeHolding({ kind: "stock", name: "x", units: 1, cost: 1, fee: "" })?.fee === 0);
const cashFee = sanitizeHolding({ kind: "cash", name: "现金", units: 1, fee: 500 });
check("现金类忽略手续费", cashFee !== null && cashFee.fee === 0);

check(
  "基金代码只接受 6 位数字",
  FUND_CODE_RE.test("018036") && !FUND_CODE_RE.test("18036") && !FUND_CODE_RE.test("01803a") && !FUND_CODE_RE.test(""),
  String(FUND_CODE_RE),
);

/* ===== 1c. 可投入现金 ===== */
check("可投入现金默认 0", readDryPowder() === 0);
check("可投入现金写入并四舍五入到分", writeDryPowder(50000.456) === 50000.46 && readDryPowder() === 50000.46);
check("负数、NaN 与字符串归零", normalizeDryPowder(-1) === 0 && normalizeDryPowder(Number.NaN) === 0 && normalizeDryPowder("500") === 0);
check("可投入现金上限截断", normalizeDryPowder(1e13) === 1e12);
check("可投入现金使用独立存储键", mem.has(PORTFOLIO_CASH_KEY) && PORTFOLIO_CASH_KEY !== PORTFOLIO_STORAGE_KEY);

/* ===== 1d. 我的基金下拉与长期保存 ===== */
const initialFunds = readFundOptions();
check(
  "内置名单覆盖持仓页上的基金",
  initialFunds.length === FUND_PRESETS.length &&
    initialFunds.every((o) => o.preset) &&
    initialFunds.some((o) => o.name === "国富全球科技互联混合（QDII）人民币C") &&
    initialFunds.some((o) => o.name === "华宝纳斯达克精选股票(QDII)C"),
  String(initialFunds.length),
);
check(
  "只预填已确认的 018036",
  initialFunds.find((o) => o.name.startsWith("长城全球"))?.code === "018036" && initialFunds.filter((o) => o.code).length === 1,
  JSON.stringify(initialFunds.filter((o) => o.code)),
);
check("未确认代码的基金不猜代码", initialFunds.find((o) => o.name === "浦银全球智能科技股票(QDII)C")?.code === "");

const afterAdd = rememberFundName("华泰柏瑞中证韩交所中韩半导体ETF联接", "");
check(
  "新增基金名称写入本机名单",
  afterAdd.some((o) => o.name === "华泰柏瑞中证韩交所中韩半导体ETF联接" && !o.preset) && mem.has(FUND_NAMES_KEY),
);
check(
  "同名基金重复保存不会重复出现",
  rememberFundName("华泰柏瑞中证韩交所中韩半导体ETF联接", "").filter((o) => o.name === "华泰柏瑞中证韩交所中韩半导体ETF联接").length === 1,
);
check("名称与用户填的代码一起记住", rememberFundName("测试新基金", "123456").find((o) => o.name === "测试新基金")?.code === "123456");
check(
  "非法代码按未填处理",
  rememberFundName("测试新基金", "12ab").find((o) => o.name === "测试新基金")?.code === "",
);
check(
  "给内置基金补代码会覆盖下拉里的空代码",
  rememberFundName("浦银全球智能科技股票(QDII)C", "000000").find((o) => o.name === "浦银全球智能科技股票(QDII)C")?.code === "000000",
);
const beforeInvalid = readFundOptions().length;
check("空白或超长名称不会写进名单", rememberFundName("   ", "123456").length === beforeInvalid && rememberFundName("x".repeat(31), "").length === beforeInvalid);

for (let i = 0; i < FUND_NAME_LIMIT + 10; i += 1) rememberFundName("批量基金" + i, "");
const cappedFunds = readFundOptions();
check(
  "自定义名单有上限",
  cappedFunds.filter((o) => !o.preset).length === FUND_NAME_LIMIT && cappedFunds.length === FUND_PRESETS.length + FUND_NAME_LIMIT,
  cappedFunds.length + "/" + cappedFunds.filter((o) => !o.preset).length,
);

mem.set(FUND_NAMES_KEY, "{不是 JSON");
check("基金名单损坏时安全退回内置名单", readFundOptions().length === FUND_PRESETS.length);
check("基金名单使用独立存储键", FUND_NAMES_KEY !== PORTFOLIO_STORAGE_KEY && FUND_NAMES_KEY !== PORTFOLIO_CASH_KEY);

/* ===== 2. 本机持久化 ===== */
const saved = writePortfolio([gold, cash, stock]);
check("台账写入本机存储", mem.has(PORTFOLIO_STORAGE_KEY) && saved.length === 3);
const read = readPortfolio();
check("读回的台账与写入一致", read.length === 3 && read[1].name === "活期现金" && read[2].units === 200);

mem.set(PORTFOLIO_STORAGE_KEY, "{不是 JSON");
check("损坏的台账安全退回空列表", readPortfolio().length === 0);

mem.set(PORTFOLIO_STORAGE_KEY, JSON.stringify([gold, gold]));
check("重复 id 自动去重", readPortfolio().length === 1);

const many = Array.from({ length: PORTFOLIO_LIMIT + 5 }, (_, i) => ({
  kind: "cash",
  id: "h-test-" + String(i).padStart(4, "0"),
  name: "现金" + i,
  units: 1,
}));
check("超过上限时截断到 " + PORTFOLIO_LIMIT + " 笔", writePortfolio(many).length === PORTFOLIO_LIMIT);

/* ===== 3. 组合汇总 ===== */
const summary = summarizePortfolio([gold, cash, stockPriced]);
check("总市值 = 100×520 + 50000 + 200×10", summary.totalValue === 104400, String(summary.totalValue));
check("总成本 = 100×480 + 50000 + 200×10", summary.totalCost === 100000, String(summary.totalCost));
check("浮动盈亏与收益率", summary.pnl === 4400 && Math.abs(summary.pnlPct - 4.4) < 1e-9, String(summary.pnlPct));
check("风险资产与防守垫拆分", summary.riskValue === 54400 && summary.defenseValue === 50000, summary.riskValue + "/" + summary.defenseValue);
check("最大单一持仓占比", Math.abs(summary.topWeight - 49.8084) < 0.01, String(summary.topWeight));
check("分类按市值排序", summary.kinds[0].kind === "gold" && summary.kinds.at(-1).kind === "stock");
check("结构评分与等级", summary.score === 48 && summary.band === "中", summary.score + "/" + summary.band);
check(
  "集中度规则命中需处理",
  summary.checks.some((c) => c.level === "alert" && c.title === "单一持仓过于集中"),
  JSON.stringify(summary.checks.map((c) => c.title)),
);
check("黄金占比规则命中留意", summary.checks.some((c) => c.level === "warn" && c.title === "黄金占比偏高"));

const cashHeavy = summarizePortfolio([
  sanitizeHolding({ kind: "gold", name: "金条", units: 100, cost: 480, price: 520 }),
  sanitizeHolding({ kind: "stock", name: "股票", units: 10, cost: 1500, price: 1450 }),
  sanitizeHolding({ kind: "cash", name: "现金", units: 200000 }),
]);
check(
  "现金不计入集中度，高现金组合不误报",
  Math.abs(cashHeavy.topWeight - 19.5122) < 0.01 && !cashHeavy.checks.some((c) => c.title === "单一持仓过于集中" || c.title === "单一持仓偏高"),
  String(cashHeavy.topWeight),
);
check("前三大合计同样剔除现金", Math.abs(cashHeavy.top3Weight - 24.9531) < 0.01, String(cashHeavy.top3Weight));

const empty = summarizePortfolio([]);
check("空台账不评分、不报警", empty.band === "无持仓" && empty.score === null && empty.checks.length === 0 && empty.totalValue === 0);

const lossy = summarizePortfolio([
  sanitizeHolding({ kind: "stock", name: "亏损股", units: 100, cost: 100, price: 60 }),
]);
check("单笔亏损 40% 触发需处理", lossy.checks.some((c) => c.level === "alert" && c.title === "单笔亏损已超阈值"), JSON.stringify(lossy.checks));

const lean = summarizePortfolio([
  sanitizeHolding({ kind: "stock", name: "满仓股", units: 950, cost: 10, price: 10 }),
  sanitizeHolding({ kind: "cash", name: "现金", units: 500 }),
]);
check("防守垫 5% 触发偏低提醒", lean.checks.some((c) => c.level === "warn" && c.title === "防守垫偏低"), JSON.stringify(lean.checks.map((c) => c.title)));

const noPrice = summarizePortfolio([sanitizeHolding({ kind: "fund", name: "没现价基金", units: 1000, cost: 1.5, price: null })]);
check("缺现价按成本计价并给出提示", noPrice.rows[0].value === 1500 && noPrice.checks.some((c) => c.level === "info" && c.title === "部分持仓缺少现价"));

check("阈值常量可被页面与提示词共用", PORTFOLIO_RULES.singleWarn === 25 && PORTFOLIO_RULES.singleAlert === 40 && PORTFOLIO_RULES.defenseWarn === 10);

/* ===== 3b. 手续费计入成本、盈亏与保本价 ===== */
const feeGoldSummary = summarizePortfolio([goldFee]);
check("手续费计入总成本", feeGoldSummary.totalCost === 48048 && feeGoldSummary.rows[0].costTotal === 48048, String(feeGoldSummary.totalCost));
check(
  "含费盈亏与保本价",
  feeGoldSummary.rows[0].pnl === 3952 &&
    Math.abs(feeGoldSummary.rows[0].pnlPct - 8.2251) < 0.01 &&
    Math.abs(feeGoldSummary.rows[0].breakeven - 480.48) < 1e-9,
  feeGoldSummary.rows[0].pnlPct + "/" + feeGoldSummary.rows[0].breakeven,
);
const withoutFee = summarizePortfolio([sanitizeHolding({ kind: "gold", name: "金条", units: 100, cost: 480, price: 520 })]);
check("不填手续费时盈亏更高", withoutFee.pnl === 4000 && feeGoldSummary.pnl === 3952);

/* ===== 3c. 可投入现金、总资产与防守垫 ===== */
const withDry = summarizePortfolio([goldFee, cash], 50000);
check("总资产 = 持仓市值 + 可投入现金", withDry.totalAssets === 152000 && withDry.dryPowder === 50000, String(withDry.totalAssets));
check("待投占比按总资产计算", Math.abs(withDry.dryWeight - 32.8947) < 0.01, String(withDry.dryWeight));
check(
  "可投入现金计入防守垫",
  Math.abs(withDry.riskWeight - 34.2105) < 0.01 && Math.abs(withDry.defenseWeight - 65.7895) < 0.01,
  withDry.riskWeight + "/" + withDry.defenseWeight,
);
check("集中度不受可投入现金影响", Math.abs(withDry.topWeight - 50.9804) < 0.01, String(withDry.topWeight));

const dryBuffer = summarizePortfolio([sanitizeHolding({ kind: "stock", name: "小仓", units: 100, cost: 10, price: 10 })], 90000);
check(
  "大量可投入现金时不再误报防守垫不足",
  dryBuffer.defenseWeight > 90 && !dryBuffer.checks.some((c) => c.title.includes("防守垫")),
  dryBuffer.defenseWeight + "/" + JSON.stringify(dryBuffer.checks.map((c) => c.title)),
);

/* ===== 3d. 基金缺少代码 ===== */
const fundNoCodeSummary = summarizePortfolio([sanitizeHolding({ kind: "fund", name: "无代码基金", units: 1000, cost: 1, price: 1 })]);
check(
  "基金缺少 6 位代码时给出留意提示",
  fundNoCodeSummary.checks.some((c) => c.level === "warn" && c.title === "基金缺少代码"),
  JSON.stringify(fundNoCodeSummary.checks.map((c) => c.title)),
);
const fundCodedSummary = summarizePortfolio([sanitizeHolding({ kind: "fund", name: "有代码基金", code: "018036", units: 1000, cost: 1, price: 1 })]);
check("基金代码合法时不提示", !fundCodedSummary.checks.some((c) => c.title === "基金缺少代码"));

/* ===== 3e. 可投入现金的部署候选 ===== */
const fundScreenshot = sanitizeHolding({
  kind: "fund",
  name: "长城全球新能源汽车股票(QDII-LOF)C",
  code: "018036",
  units: 1229.36,
  cost: 2.6374,
  fee: 2.98,
  price: 2.3897,
  priceAsOf: "2026-10-27",
});
check(
  "截图基金按填写值估值（含手续费）",
  fundScreenshot !== null &&
    Math.abs(fundScreenshot.units * fundScreenshot.price - 2937.8) < 0.01 &&
    Math.abs((fundScreenshot.units * fundScreenshot.cost + fundScreenshot.fee) - 3245.29) < 0.01,
);

const candidateHoldings = [
  fundScreenshot,
  sanitizeHolding({ kind: "gold", name: "黄金积存", units: 100, cost: 480, price: 520, priceAsOf: "2026-10-20" }),
  sanitizeHolding({ kind: "cash", name: "活期现金", units: 30000 }),
];
const candidateSummary = summarizePortfolio(candidateHoldings, 50000);
const candidateList = deploymentCandidates(candidateSummary, "2026-10-29");
check(
  "候选只保留风险资产、有现价且未接近集中度上限的持仓",
  candidateList.length === 1 && candidateList[0].code === "018036",
  JSON.stringify(candidateList.map((c) => c.code || c.name)),
);
check("每档金额为可投入现金的三分之一", candidateList[0]?.tranche === 16666.67, String(candidateList[0]?.tranche));
check(
  "浮亏基金获得性价比加分",
  candidateList[0]?.score === 60 && candidateList[0]?.reasons.some((r) => r.includes("浮亏")),
  candidateList[0]?.score + "/" + JSON.stringify(candidateList[0]?.reasons),
);
check("没有可投入现金时不排候选", deploymentCandidates(summarizePortfolio(candidateHoldings), "2026-10-29").length === 0);

const deepLoss = sanitizeHolding({ kind: "stock", name: "深亏股", units: 100, cost: 100, price: 70, priceAsOf: "2026-10-29" });
const ranked = deploymentCandidates(summarizePortfolio([...candidateHoldings, deepLoss], 50000), "2026-10-29");
check("浮亏更深的持仓排在前面", ranked.length === 2 && ranked[0].name === "深亏股" && ranked[0].score === 80, JSON.stringify(ranked.map((c) => [c.name, c.score])));

const excluded = summarizePortfolio(
  [
    sanitizeHolding({ kind: "stock", name: "未填现价", units: 100, cost: 10, price: null }),
    sanitizeHolding({ kind: "stock", name: "重仓股", units: 900, cost: 10, price: 10, priceAsOf: "2026-10-29" }),
    sanitizeHolding({ kind: "cash", name: "现金", units: 1000 }),
  ],
  3000,
);
check("缺现价、超过 25% 与现金都不进入候选", deploymentCandidates(excluded, "2026-10-29").length === 0);

const stale = summarizePortfolio(
  [
    sanitizeHolding({ kind: "stock", name: "旧价股", units: 10, cost: 100, price: 100, priceAsOf: "2026-09-01" }),
    sanitizeHolding({ kind: "cash", name: "现金", units: 99000 }),
  ],
  3000,
);
const staleList = deploymentCandidates(stale, "2026-10-29");
check(
  "现价超过 30 天未更新大幅扣分",
  staleList.length === 1 && staleList[0].score === 30 && staleList[0].reasons.some((r) => r.includes("未更新")),
  staleList[0]?.score + "/" + JSON.stringify(staleList[0]?.reasons),
);

const feeDrag = summarizePortfolio(
  [
    sanitizeHolding({ kind: "stock", name: "费重股", units: 10, cost: 100, fee: 20, price: 100, priceAsOf: "2026-10-29" }),
    sanitizeHolding({ kind: "cash", name: "现金", units: 99000 }),
  ],
  3000,
);
const feeDragList = deploymentCandidates(feeDrag, "2026-10-29");
check(
  "手续费超过成本 1% 扣分",
  feeDragList.length === 1 && feeDragList[0].score === 45 && feeDragList[0].reasons.some((r) => r.includes("手续费")),
  feeDragList[0]?.score + "/" + JSON.stringify(feeDragList[0]?.reasons),
);

const noCodeFund = summarizePortfolio(
  [
    sanitizeHolding({ kind: "fund", name: "无代码基金", units: 1000, cost: 1, price: 1, priceAsOf: "2026-10-29" }),
    sanitizeHolding({ kind: "cash", name: "现金", units: 99000 }),
  ],
  3000,
);
const noCodeList = deploymentCandidates(noCodeFund, "2026-10-29");
check(
  "基金缺代码在候选中扣分并说明",
  noCodeList.length === 1 && noCodeList[0].score === 40 && noCodeList[0].reasons.some((r) => r.includes("代码")),
  noCodeList[0]?.score + "/" + JSON.stringify(noCodeList[0]?.reasons),
);

const fiveStocks = Array.from({ length: 5 }, (_, i) =>
  sanitizeHolding({ kind: "stock", name: "股票" + i, units: 180, cost: 10, price: 10, priceAsOf: "2026-10-29" }),
);
const fullRisk = summarizePortfolio([...fiveStocks, sanitizeHolding({ kind: "cash", name: "现金", units: 1000 })], 1000);
const fullRiskList = deploymentCandidates(fullRisk, "2026-10-29");
check(
  "风险资产偏满时所有候选扣分",
  fullRiskList.length === 3 && fullRiskList.every((c) => c.score === 20 && c.reasons.some((r) => r.includes("风险资产"))),
  JSON.stringify(fullRiskList.map((c) => c.score)),
);

/* ===== 3f. 基金持有收益与持有收益率（App 口径，不含手续费） ===== */
const fundAuto = summarizePortfolio([fundScreenshot]);
check(
  "留空时按市值 − 成本自动算持有收益",
  Math.abs(fundAuto.rows[0].holdingPnl - -304.514064) < 0.01,
  String(fundAuto.rows[0].holdingPnl),
);
check(
  "自动持有收益率与 App 一致（-9.39%）",
  Math.abs(fundAuto.rows[0].holdingPnlPct - -9.391794) < 0.01 && Math.abs(fundAuto.rows[0].pnl - -307.494064) < 0.01,
  fundAuto.rows[0].holdingPnlPct + "/" + fundAuto.rows[0].pnl,
);
check("自动计算不算手填", fundAuto.rows[0].holdingPnlManual === false);

const fundManual = sanitizeHolding({
  kind: "fund",
  name: "长城全球新能源汽车股票(QDII-LOF)C",
  code: "018036",
  units: 1229.36,
  cost: 2.6374,
  fee: 2.98,
  price: 2.3897,
  priceAsOf: "2026-10-27",
  holdingPnl: -304.5,
  holdingPnlPct: -9.39,
});
check(
  "手填持有收益与收益率被保留",
  fundManual !== null && fundManual.holdingPnl === -304.5 && fundManual.holdingPnlPct === -9.39,
  JSON.stringify(fundManual),
);
const fundManualRow = summarizePortfolio([fundManual]).rows[0];
check(
  "手填值优先于自动计算，并标记为手填",
  fundManualRow.holdingPnl === -304.5 && fundManualRow.holdingPnlPct === -9.39 && fundManualRow.holdingPnlManual === true,
);
check(
  "手填持有收益不影响含费浮动盈亏",
  fundManualRow.holdingPnl === -304.5 && Math.abs(fundManualRow.pnl - -307.492472) < 1e-6 && Math.abs(fundManualRow.pnl - fundManualRow.holdingPnl + 2.992472) < 1e-6,
  fundManualRow.pnl + "/" + fundManualRow.holdingPnl,
);

check("只填持有收益率时持有收益仍自动算", sanitizeHolding({
  kind: "fund", name: "基金", code: "018036", units: 1000, cost: 1, price: 1.2, holdingPnlPct: 20,
})?.holdingPnlPct === 20);
check(
  "非基金类别忽略持有收益字段",
  sanitizeHolding({ kind: "stock", name: "股票", units: 1, cost: 1, price: 2, holdingPnl: 100, holdingPnlPct: 100 })?.holdingPnl === null,
);
check(
  "持有收益拒绝非数字与越界值",
  sanitizeHolding({ kind: "fund", name: "基金", units: 1, cost: 1, holdingPnl: "-304.5" }) === null &&
    sanitizeHolding({ kind: "fund", name: "基金", units: 1, cost: 1, holdingPnl: 1e10 }) === null &&
    sanitizeHolding({ kind: "fund", name: "基金", units: 1, cost: 1, holdingPnlPct: Number.NaN }) === null,
);
check(
  "持有收益可留空（空串按未填）",
  sanitizeHolding({ kind: "fund", name: "基金", units: 1, cost: 1, holdingPnl: "", holdingPnlPct: "" })?.holdingPnl === null,
);
const fundRoundtrip = writePortfolio([fundManual]);
check(
  "持有收益随台账往返本机存储",
  readPortfolio()[0]?.holdingPnl === -304.5 && readPortfolio()[0]?.holdingPnlPct === -9.39 && fundRoundtrip.length === 1,
);

/* ===== 4. 展示格式 ===== */
check("金额格式带币种与千分位", money(104400) === "¥104,400.00", money(104400));
check("负金额前置负号", money(-4400) === "-¥4,400.00", money(-4400));
check("百分比保留一位", pctText(49.8084, 1) === "49.8%", pctText(49.8084, 1));
check("带符号百分比", signedPct(-3.33) === "-3.33%" && signedPct(4.4) === "+4.40%");
check("基金净值按 4 位小数展示，其余按 2 位", unitMoney(2.6374, "fund") === "¥2.6374" && unitMoney(480, "gold") === "¥480.00", unitMoney(2.6374, "fund"));

/* ===== 5. AI 数据包 ===== */
const ctx = buildPortfolioContext([gold, stockPriced, cash], {
  vix: { level: 16.91, asOf: "2026-10-28", pct5y: 12, z: -0.8, regime: "中性", quote: 17.17 },
  index: { label: "纳斯达克100", asOf: "2026-10-28", rv21: 18.2, rv63: 20.1, pct5y: 40, z: -0.3 },
  macro: {
    riskLabel: "中风险",
    summary: "收益率上行压制长久期资产。",
    ust10y: 4.1,
    assets: [{ label: "黄金（GLD 代理）", close: 380.5, asOf: "2026-10-28", vol21: 14.2, drawdown1y: -6.1 }],
  },
});
check("数据包含台账标题与总额", ctx.includes("持仓台账：3 笔") && ctx.includes("¥104,400.00"));
check("数据包含风险/防守拆分", ctx.includes("风险资产") && ctx.includes("52.11%") && ctx.includes("47.89%"));
check("数据包含分类与明细", ctx.includes("黄金：1 笔") && ctx.includes("黄金积存") && ctx.includes("活期现金"));
check("数据包含固定阈值", ctx.includes("25%") && ctx.includes("40%") && ctx.includes("防守垫"));
check("数据包含市场背景", ctx.includes("VIX 16.91") && ctx.includes("纳斯达克100") && ctx.includes("4.10%") && ctx.includes("中风险"));
check("数据包说明手动填写的限制", ctx.includes("手动填写") && ctx.includes("不代表未来"));
check("空台账数据包明确为空", buildPortfolioContext([]).includes("持仓台账为空"));
check("无市场数据时明确标注 VIX 不可用", buildPortfolioContext([gold]).includes("VIX 数据当前不可用"));

const candCtx = buildPortfolioContext(candidateHoldings, null, 50000);
check("数据包包含可投入现金与待投占比", candCtx.includes("可投入现金（尚未建仓）：¥50,000.00") && candCtx.includes("待投现金占"));
check("数据包包含基金代码", candCtx.includes("代码 018036"));
check("数据包包含手续费与保本价", candCtx.includes("手续费 ¥2.98") && candCtx.includes("含费成本") && candCtx.includes("即保本价"));
check(
  "数据包包含部署候选与免责说明",
  candCtx.includes("可投入现金部署候选") && candCtx.includes("性价比分 60/100") && candCtx.includes("（018036）") && candCtx.includes("不是买卖建议"),
  candCtx.slice(candCtx.indexOf("部署候选"), candCtx.indexOf("部署候选") + 300),
);
check(
  "数据包写明基金持有收益与 App 口径",
  candCtx.includes("持有收益 -¥304.51（-9.39%") && candCtx.includes("App 口径不含手续费") && candCtx.includes("按填写净值自动计算"),
  candCtx.slice(candCtx.indexOf("持有收益"), candCtx.indexOf("持有收益") + 80),
);
check(
  "数据包区分手填与自动计算的持有收益",
  buildPortfolioContext([fundManual]).includes("用户手填") && buildPortfolioContext([fundManual]).includes("持有收益 -¥304.50（-9.39%"),
);
check("数据包说明手续费未拆分", candCtx.includes("未拆分佣金"));
check("数据包说明两种盈亏口径不是同一件事", candCtx.includes("不是同一个口径"));
check("数据包说明可投入现金不是券商余额", candCtx.includes("不代表券商可用余额"));
check("空台账仍显示可投入现金", buildPortfolioContext([], null, 20000).includes("可投入现金：¥20,000.00"));
check(
  "数据包标出基金代码缺失",
  buildPortfolioContext([sanitizeHolding({ kind: "fund", name: "无代码基金", units: 1000, cost: 1, price: 1 })]).includes("代码缺失"),
);

console.log("\n" + pass + "/" + (pass + fail) + " 通过，总耗时 " + (Date.now() - t0) + "ms");
if (fail) process.exitCode = 1;
