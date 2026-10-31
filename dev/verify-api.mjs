// 端到端接口回归：对本地 Function 逐一路由做真实请求，校验状态码、响应结构与 JSON 头
const BASE = process.env.BASE ?? "http://127.0.0.1:8000/functions/v1/app";

const cases = [
  {
    path: "/health",
    want: (d) => d.ok === true && Array.isArray(d.sources) && d.sources.length >= 4 && d.dividend.count === 54 && d.dividend.window.from < d.dividend.window.to && d.macro.rows.gold > 2000 && d.macro.proxies.yield.includes("DGS10"),
  },
  {
    path: "/api/symbols",
    want: (d) => d.symbols.length === 6 && d.symbols.every((s) => s.rows > 100) && ["SSE", "CSI300"].every((k) => d.symbols.some((s) => s.key === k)),
  },
  { path: "/api/volatility/history?symbol=NDX100&years=5&freq=1w", want: (d) => d.series.length > 200 && d.series.at(-1).rv21 !== null && d.fields.length >= 10 },
  { path: "/api/volatility/snapshot?symbol=QQQ&years=all", want: (d) => d.metrics.close > 0 && d.annual.length >= 20 && d.distribution.length > 5 },
  { path: "/api/volatility/history?symbol=SSE&years=5", want: (d) => d.meta.symbolLabel.includes("上证") && d.series.length > 200 && d.series.at(-1).rv21 !== null },
  { path: "/api/signals?symbol=CSI300", want: (d) => d.signals.length === 10 && typeof d.composite.score === "number" },
  { path: "/api/diagnosis?symbol=IXIC&years=10", want: (d) => d.regimeStudy.length === 6 && d.volTrendMatrix.length === 8 },
  { path: "/api/ai-context?symbol=NDX100&format=markdown", want: (d) => d.format === "markdown" && d.markdown.includes("核心指标") && d.markdown.length > 1500 },
  {
    path: "/api/ai-context?symbol=SPX&format=json",
    want: (d) => d.format === "json" && d.bundle.indicators && d.bundle.taskForAssistant.requiredOutput.length === 6 && d.bundle.taskForAssistant.guardrails.length === 3,
  },
  {
    path: "/api/ai-context?symbol=CSI300&format=markdown&refresh=0",
    want: (d) => d.markdown.includes("大摩 A 股报告复盘") && d.markdown.includes("摩根士丹利") && d.markdown.includes("上证指数"),
  },
  {
    path: "/api/ai-context?symbol=CSI300&format=json&refresh=0",
    want: (d) =>
      d.bundle.reportStudy.perSymbol.length === 2 &&
      d.bundle.reportStudy.stanceSummary.length === 2 &&
      d.bundle.reportStudy.perSymbol.every((s) => s.rows.length === 7 && s.rows[0].anchorDate >= s.rows[0].eventDate) &&
      d.bundle.taskForAssistant.requiredOutput.length === 7 &&
      d.bundle.taskForAssistant.guardrails.length === 4 &&
      d.bundle.api.events.includes("/api/events") &&
      d.bundle.api.eventsStudy.includes("/api/events/study"),
  },
  {
    path: "/api/events",
    want: (d) =>
      d.broker === "摩根士丹利" &&
      d.events.length === d.meta.count &&
      d.provenance.exhaustive === false &&
      d.events.every((e) => e.sources.length >= 1 && ["看多", "看空"].includes(e.stance) && /^\d{4}-\d{2}-\d{2}$/.test(e.date)),
  },
  {
    path: "/api/events/study?refresh=0",
    want: (d) =>
      d.meta.symbols.join() === "SSE,CSI300" &&
      d.study.length === 2 &&
      d.study.every((s) => s.outcomes.length >= 5 && s.outcomes.every((o) => o.path.some((p) => p.offset === 0 && p.ret === 0))) &&
      d.baseline.every((b) => b.rows.length === d.meta.horizons.length) &&
      d.stanceSummary.every((b) => b.rows.some((r) => r.stance === "看多" && r.rows.length === d.meta.horizons.length && r.rows[0].samples >= 1 && r.rows.every((x) => x.samples <= r.events))) &&
      Object.keys(d.definition).length >= 5,
  },
  { path: "/api/events/study?symbols=SSE&horizons=5,20&refresh=0", want: (d) => d.meta.symbols.join() === "SSE" && d.meta.horizons.join() === "5,20" && d.study[0].outcomes[0].forward.length === 2 },
  {
    path: "/api/volatility/panic?refresh=0",
    want: (d) =>
      typeof d.available === "boolean" &&
      (d.available
        ? d.latest.level > 0 && d.series.length > 100 && ["compressed", "normal", "elevated", "panic"].includes(d.latest.regime.key)
        : Boolean(d.reason) && d.series.length === 0) &&
      Object.keys(d.definition).length >= 5,
  },
  {
    path: "/api/macro/cross-asset?years=3&refresh=0",
    want: (d) =>
      d.window.years === 3 &&
      d.window.days > 700 &&
      d.assets.length === 3 &&
      d.assets.map((a) => a.key).join() === "gold,oil,bond" &&
      d.assets.every(
        (a) =>
          a.close > 0 &&
          typeof a.dayChangePct === "number" &&
          typeof a.returns.m3 === "number" &&
          typeof a.returns.ytd === "number" &&
          a.vol21 > 0 &&
          a.maxDrawdown <= 0 &&
          Object.keys(a.returns).length === 6,
      ) &&
      d.yield10y.latest > 0 &&
      d.yield10y.pct5y >= 0 &&
      d.yield10y.pct5y <= 100 &&
      d.correlations.matrix.length === 4 &&
      d.correlations.matrix.every((r) => r.length === 4) &&
      d.corr63.matrix.length === 4 &&
      d.chart.length > 100 &&
      d.chart.every((p) => p.gold > 0 && p.oil > 0 && p.bond > 0) &&
      ["1d", "1w"].includes(d.chartFreq) &&
      d.risk.score >= 0 &&
      d.risk.score <= 100 &&
      ["low", "medium", "high"].includes(d.risk.level) &&
      d.risk.drivers.length === 4 &&
      d.risk.watch.length >= 3 &&
      Object.keys(d.risk.components).length === 4 &&
      d.limits.length >= 6 &&
      Object.keys(d.definition).length >= 6 &&
      d.meta.sources.length === 2,
  },
  {
    path: "/api/macro/cross-asset?years=10&refresh=0",
    want: (d) => d.window.years === 10 && d.window.days > 2000 && d.chart.length > 400 && d.chartFreq === "1w",
  },
  { path: "/api/macro/cross-asset?years=4&refresh=0", status: 400 },
  {
    path: "/api/macro/ai-context?years=3&format=markdown&refresh=0",
    want: (d) =>
      d.format === "markdown" &&
      d.markdown.includes("跨资产风险上下文") &&
      d.markdown.includes("三资产最新表现") &&
      d.markdown.includes("相关性矩阵") &&
      d.markdown.includes("风险状态") &&
      d.markdown.includes("数据来源与口径") &&
      d.markdown.includes("给 AI 的分析任务") &&
      d.bundle.taskForAssistant.requiredOutput.length === 8 &&
      d.bundle.taskForAssistant.guardrails.length === 4 &&
      d.bundle.limits.length >= 6 &&
      d.bundle.api.crossAsset.includes("/api/macro/cross-asset"),
  },
  {
    path: "/api/macro/ai-context?years=3&format=json&refresh=0",
    want: (d) =>
      d.format === "json" &&
      d.bundle.subject.name.includes("黄金") &&
      d.bundle.subject.proxies.gold.includes("GLD") &&
      d.bundle.assets.length === 3 &&
      d.bundle.correlations.matrix.length === 4 &&
      d.bundle.risk.score >= 0 &&
      d.bundle.taskForAssistant.requiredOutput.length === 8 &&
      d.bundle.taskForAssistant.guardrails.length === 4,
  },
  {
    path: "/api/cycle/kondratiev?years=5&refresh=0",
    want: (d) =>
      d.indices.length === 3 &&
      d.framework.length === 4 &&
      d.framework.map((f) => f.key).join(",") === "prosperity,recession,depression,recovery" &&
      d.phases.length === 3 &&
      d.phases.every((p) => p.scores.length === 4 && typeof p.separation === "number" && p.explanation.length > 20) &&
      d.window.days > 1000 &&
      d.chart.length > 200 &&
      d.correlations.matrix.length === 3 &&
      d.correlations.matrix.every((row) => row.length === 3) &&
      d.ratios.length === 3 &&
      d.indices.every((m) => m.close > 0 && m.vol21 !== null),
  },
  { path: "/api/cycle/kondratiev?years=7&refresh=0", status: 400 },
  {
    path: "/api/cycle/ai-context?years=3&format=markdown&refresh=0",
    want: (d) =>
      d.format === "markdown" &&
      d.markdown.includes("康波周期 × 三大指数对照上下文") &&
      d.markdown.includes("四阶段匹配") &&
      d.markdown.includes("相对强弱") &&
      d.markdown.includes("相关性") &&
      d.bundle.subject.framework.includes("不判定长波年份") &&
      d.bundle.phases.length === 4 &&
      d.bundle.taskForAssistant.requiredOutput.length === 8 &&
      d.bundle.taskForAssistant.guardrails.length === 4 &&
      d.bundle.limits.length >= 5,
  },
  {
    path: "/api/cycle/ai-context?years=3&format=json&refresh=0",
    want: (d) =>
      d.format === "json" &&
      d.bundle.subject.name.includes("纳斯达克100") &&
      d.bundle.indices.length === 3 &&
      d.bundle.phaseMatch.length === 3 &&
      d.bundle.correlations.matrix.length === 3 &&
      d.bundle.api.cycle.includes("/api/cycle/kondratiev"),
  },
  {
    path: "/api/valuation/buffett?years=20&refresh=0",
    want: (d) =>
      d.latest.ratio > 50 &&
      d.latest.percentileAll >= 0 &&
      d.latest.percentileAll <= 100 &&
      d.stats.all.count > 250 &&
      d.stats.recent20y.count === 80 &&
      d.chart.length === 80 &&
      d.chart.at(-1).ratio === d.latest.ratio &&
      d.spx !== null &&
      d.limits.length >= 5 &&
      d.definition.buffettRatio.includes("名义 GDP"),
  },
  { path: "/api/valuation/buffett?years=2&refresh=0", status: 400 },
  {
    path: "/api/valuation/ai-context?years=20&format=markdown&refresh=0",
    want: (d) =>
      d.format === "markdown" &&
      d.markdown.includes("美股巴菲特指数上下文") &&
      d.markdown.includes("最新读数") &&
      d.markdown.includes("历史分布") &&
      d.markdown.includes("与标普500对照") &&
      d.markdown.includes("给 AI 的分析任务") &&
      d.bundle.subject.name.includes("巴菲特指数") &&
      d.bundle.taskForAssistant.requiredOutput.length === 8 &&
      d.bundle.taskForAssistant.guardrails.length === 4 &&
      d.bundle.limits.length >= 6,
  },
  {
    path: "/api/valuation/ai-context?years=20&format=json&refresh=0",
    want: (d) =>
      d.format === "json" &&
      d.bundle.subject.numerator.includes("NCBEILQ027S") &&
      d.bundle.latest.ratio > 50 &&
      d.bundle.stats.all.count > 250 &&
      d.bundle.api.buffett.includes("/api/valuation/buffett"),
  },
  {
    path: "/api/stocks/list?refresh=0",
    want: (d) =>
      d.count === 5 &&
      d.stocks.length === 5 &&
      d.stocks[0].code === "600519" &&
      d.stocks.every((s) => s.close > 0 && typeof s.dayChangePct === "number" && s.sector.length > 0) &&
      d.meta.kospi &&
      d.meta.kospi.rows > 1000,
  },
  {
    path: "/api/stocks/signals?refresh=0",
    want: (d) =>
      d.stocks.length === 5 &&
      d.stocks.every(
        (s) =>
          s.composite &&
          ["buy", "add", "hold", "trim", "reduce"].includes(s.composite.stanceKey) &&
          s.signals.length === 8 &&
          Math.abs(s.signals.reduce((a, x) => a + x.weight, 0) - 100) < 1.5,
      ) &&
      d.stocks[0].rank === 1 &&
      d.kospi.metrics.close > 0 &&
      d.weighting.horizon === 63 &&
      d.weighting.method.includes("信息系数"),
  },
  {
    path: "/api/stocks/history?code=600519&refresh=0",
    want: (d) =>
      d.stock.code === "600519" &&
      d.count > 1000 &&
      d.fields.includes("kospi") &&
      d.series.at(-1).close > 0 &&
      d.series.at(-1).kospi > 0 &&
      d.metrics.close > 0 &&
      d.signals.length === 8 &&
      Boolean(d.composite),
  },
  { path: "/api/stocks/history?code=999999", status: 400 },
  { path: "/api/stocks/list?refresh=0&extra=600519", want: (d) => d.count === 5 && d.stocks.length === 5 && d.stocks.filter((s) => s.code === "600519").length === 1 },
  { path: "/api/stocks/signals?refresh=0&extra=999999", status: 400 },
  {
    path: "/api/stocks/signals?refresh=0&extra=000001,000002,000004,000005,000006,000007,000008",
    status: 400,
  },
  {
    path: "/api/stocks/list?refresh=0&extra=600000",
    want: (d) =>
      d.count === 6 &&
      d.stocks.length === 6 &&
      d.meta.extras.includes("600000") &&
      d.stocks.some((s) => s.code === "600000" && s.name === "浦发银行" && s.sector === "手动添加" && s.close > 0),
  },
  {
    path: "/api/stocks/history?code=600000&refresh=0",
    want: (d) => d.stock.code === "600000" && d.stock.name === "浦发银行" && d.count > 1000 && d.signals.length === 8 && Boolean(d.composite),
  },
  {
    path: "/api/dividend/list?refresh=0",
    want: (d) =>
      d.count === 54 &&
      d.stocks.length === 54 &&
      d.stocks[0].rank === 1 &&
      d.stocks.every((s, i) => (i === 0 || d.stocks[i - 1].score >= s.score)) &&
      d.stocks.every(
        (s) =>
          s.close > 0 &&
          (s.yieldFY === null || s.yieldFY > 0) &&
          s.rows > 100 &&
          Array.isArray(s.groups) &&
          s.groups.length > 0 &&
          ["accumulate", "add", "hold", "trim", "reduce"].includes(s.stanceKey) &&
          typeof s.summary === "string" &&
          typeof s.actionHint === "string",
      ) &&
      d.stocks.filter((s) => s.groups.length > 1).length === 3 &&
      d.stocks.find((s) => s.code === "601088").groups.length === 3 &&
      d.stocks.find((s) => s.code === "600406").groups.length === 2 &&
      d.groups.length === 4 &&
      d.groups.find((g) => g.key === "core").count === 16 &&
      d.groups.find((g) => g.key === "chengtong").count === 13 &&
      d.groups.find((g) => g.key === "chengtong").newCount === 9 &&
      d.groups.find((g) => g.key === "chengtong").increaseCount === 4 &&
      d.groups.find((g) => g.key === "guoxin_invest").count === 10 &&
      d.groups.find((g) => g.key === "guoxin_invest").newCount === 3 &&
      d.groups.find((g) => g.key === "guoxin_invest").increaseCount === 7 &&
      d.groups.find((g) => g.key === "guoxin_hongsheng").count === 19 &&
      d.groups.find((g) => g.key === "guoxin_hongsheng").newCount === 7 &&
      d.groups.find((g) => g.key === "guoxin_hongsheng").increaseCount === 12 &&
      d.watchlistNote.includes("未标注年份") &&
      d.strategy.weights.length === 5 &&
      Math.abs(d.strategy.weights.reduce((a, w) => a + w.weight, 0) - 100) < 1e-6 &&
      d.strategy.position.base.includes("70%") &&
      d.summary.count === 54,
  },
  {
    path: "/api/dividend/history?code=601088&refresh=0",
    want: (d) =>
      d.stock.code === "601088" &&
      d.stock.groups.length === 3 &&
      d.stock.groups.some((g) => g.group === "core" && g.action === null) &&
      d.stock.groups.some((g) => g.group === "guoxin_invest" && g.action === "increase") &&
      d.stock.groups.some((g) => g.group === "guoxin_hongsheng" && g.action === "increase") &&
      d.count > 400 &&
      d.metrics.yieldFY > 0,
  },
  {
    path: "/api/dividend/history?code=601398&refresh=0",
    want: (d) =>
      d.stock.code === "601398" &&
      d.stock.name === "工商银行" &&
      d.count > 400 &&
      d.fields.includes("yieldFY") &&
      d.fields.includes("pricePct3y") &&
      d.series.at(-1).close > 0 &&
      d.metrics.yieldFY > 0 &&
      d.metrics.yieldPct5y >= 0 &&
      d.metrics.yieldPct5y <= 100 &&
      d.metrics.pricePct3y >= 0 &&
      d.metrics.pricePct3y <= 100 &&
      d.metrics.streakYears >= 10 &&
      d.signals.length === 5 &&
      Math.abs(d.signals.reduce((a, s) => a + s.weight, 0) - 100) < 1e-6 &&
      d.dividends.length >= 10 &&
      Boolean(d.composite) &&
      Object.keys(d.definition).length >= 6 &&
      Boolean(d.strategy.definitionLabels.yieldFY),
  },
  { path: "/api/dividend/history?code=999999", status: 400 },
  {
    path: "/api/dividend/list?refresh=0&extra=600000",
    want: (d) =>
      d.count === 55 &&
      d.meta.baseCount === 54 &&
      d.meta.extras.join() === "600000" &&
      d.meta.extraErrors === undefined &&
      d.stocks.some(
        (s) =>
          s.code === "600000" &&
          s.name === "浦发银行" &&
          s.sector === "手动添加" &&
          s.close > 0 &&
          s.rows > 200 &&
          s.yieldFY > 0 &&
          s.groups.length === 0,
      ),
  },
  {
    path: "/api/dividend/history?code=600000&refresh=0",
    want: (d) =>
      d.stock.code === "600000" &&
      d.stock.sector === "手动添加" &&
      d.count > 200 &&
      d.metrics.yieldFY > 0 &&
      d.signals.length === 5 &&
      d.dividends.length > 0 &&
      d.meta.extras.includes("600000"),
  },
  {
    path: "/api/dividend/ai-context?code=600000&format=markdown&refresh=0",
    want: (d) => d.markdown.includes("浦发银行") && d.markdown.includes("手动添加") && d.bundle.subject.code === "600000",
  },
  { path: "/api/dividend/list?refresh=0&extra=999999", status: 400 },
  {
    path: "/api/dividend/list?refresh=0&extra=000001,000002,000004,000005,000006,000007,000008",
    status: 400,
  },
  {
    path: "/api/dividend/ai-context?code=601398&format=markdown&refresh=0",
    want: (d) =>
      d.format === "markdown" &&
      d.markdown.includes("红利策略上下文") &&
      d.markdown.includes("五项规则") &&
      d.markdown.includes("数据来源与口径") &&
      d.markdown.includes("年度股息率（主口径）") &&
      d.markdown.includes("跟踪分组") &&
      d.bundle.subject.groups.length === 1 &&
      d.bundle.taskForAssistant.requiredOutput.length === 7 &&
      d.bundle.taskForAssistant.guardrails.length === 4 &&
      d.bundle.meta.liveRefresh === false,
  },
  {
    path: "/api/dividend/ai-context?code=601398&format=json&refresh=0",
    want: (d) =>
      d.format === "json" &&
      d.bundle.subject.code === "601398" &&
      d.bundle.subject.groups.length === 1 &&
      d.bundle.strategy.weights.length === 5 &&
      d.bundle.metrics.yieldFY > 0 &&
      d.bundle.signals.length === 5 &&
      d.bundle.dividends.length <= 10 &&
      d.bundle.api.aiContext.includes("/api/dividend/ai-context"),
  },
  {
    path: "/docs",
    want: (d) =>
      d.endpoints.length === 22 &&
      d.endpoints.every((e) => e.method === "GET") &&
      Object.keys(d.commonParams).length === 4 &&
      d.basePath.includes("/functions/v1/app") &&
      d.data_quality_notes.length >= 20 &&
      d.endpoints.some((e) => e.path.endsWith("/api/dividend/list")) &&
      d.endpoints.some((e) => e.path.endsWith("/api/macro/cross-asset")) &&
      d.endpoints.some((e) => e.path.endsWith("/api/macro/ai-context")) &&
      d.endpoints.some((e) => e.path.endsWith("/api/cycle/kondratiev")) &&
      d.endpoints.some((e) => e.path.endsWith("/api/cycle/ai-context")) &&
      d.endpoints.some((e) => e.path.endsWith("/api/valuation/buffett")) &&
      d.endpoints.some((e) => e.path.endsWith("/api/valuation/ai-context")),
  },
  { path: "/api/volatility/history?symbol=NDX100&years=3&refresh=0", want: (d) => d.meta.liveRefresh === false },
  { path: "/api/nope", status: 404 },
  { path: "/api/events/study?symbols=BOGUS", status: 400 },
];

let pass = 0;
const t0 = Date.now();
for (const c of cases) {
  const url = BASE + c.path;
  const started = Date.now();
  try {
    const res = await fetch(url);
    const ms = Date.now() - started;
    const type = res.headers.get("content-type") ?? "";
    const isJson = type.startsWith("application/json");
    const body = await res.json().catch(() => null);
    const wantStatus = c.status ?? 200;
    const shape = c.want && body ? c.want(body) : true;
    const ok =
      res.status === wantStatus &&
      isJson &&
      (wantStatus === 200 ? body?.ok === true && shape : body?.ok === false && Boolean(body?.error)) &&
      res.headers.get("access-control-allow-origin") === "*";
    console.log((ok ? "PASS" : "FAIL") + "  " + res.status + "  " + ms + "ms  " + c.path + (ok ? "" : "  <<< " + JSON.stringify(body).slice(0, 200)));
    if (ok) pass++;
  } catch (err) {
    console.log("FAIL  ERR  " + c.path + "  " + String(err).slice(0, 120));
  }
}

// HEAD 与 GET 同状态码且无响应体；非 GET/HEAD/OPTIONS 必须被拒绝
const head = await fetch(BASE + "/api/events", { method: "HEAD" });
const headOk = head.status === 200 && (await head.text()) === "" && (head.headers.get("content-type") ?? "").startsWith("application/json");
console.log((headOk ? "PASS" : "FAIL") + "  " + head.status + "  HEAD /api/events 应镜像 GET 状态且无响应体");
if (headOk) pass++;

const post = await fetch(BASE + "/api/events/study", { method: "POST" });
const postOk = post.status === 405;
console.log((postOk ? "PASS" : "FAIL") + "  " + post.status + "  POST /api/events/study 应返回 405");
if (postOk) pass++;

// 服务端不代持任何模型密钥、不做转发：原先的 AI 分析路由应已下线
const aiStatus = await fetch(BASE + "/api/ai/status");
const aiStatusText = await aiStatus.text();
const aiStatusOk = aiStatus.status === 404 && JSON.parse(aiStatusText).error === "not_found";
console.log((aiStatusOk ? "PASS" : "FAIL") + "  " + aiStatus.status + "  GET /api/ai/status 应已下线为 404" + (aiStatusOk ? "" : "  <<< " + aiStatusText.slice(0, 200)));
if (aiStatusOk) pass++;

const aiAnalyze = await fetch(BASE + "/api/ai/analyze", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ symbol: "NDX100" }),
});
const aiAnalyzeText = await aiAnalyze.text();
const aiAnalyzeOk = aiAnalyze.status === 405 && JSON.parse(aiAnalyzeText).error === "method_not_allowed";
console.log((aiAnalyzeOk ? "PASS" : "FAIL") + "  " + aiAnalyze.status + "  POST /api/ai/analyze 应已下线为 405（不接受任何写操作）" + (aiAnalyzeOk ? "" : "  <<< " + aiAnalyzeText.slice(0, 200)));
if (aiAnalyzeOk) pass++;

const options = await fetch(BASE + "/health", { method: "OPTIONS" });
const allowMethods = options.headers.get("access-control-allow-methods") ?? "";
const optionsOk = options.status === 204 && allowMethods.includes("GET") && !allowMethods.includes("POST");
console.log((optionsOk ? "PASS" : "FAIL") + "  " + options.status + "  OPTIONS /health 预检只放行只读方法（" + allowMethods + "）");
if (optionsOk) pass++;

const total = cases.length + 5;
console.log("\n" + pass + "/" + total + " 通过，总耗时 " + (Date.now() - t0) + "ms");
if (pass !== total) process.exitCode = 1;
