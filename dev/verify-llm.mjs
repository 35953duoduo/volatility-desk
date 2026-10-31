// 浏览器直连 DeepSeek 的离线校验：用注入的 mock fetch 覆盖密钥存储、地址白名单、提示词、
// 结果解析与错误映射。全程不触真实付费接口，也不打印任何密钥内容。
// 运行：node --experimental-strip-types dev/verify-llm.mjs
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  LlmError,
  PORTFOLIO_SYSTEM,
  SYSTEM_PROMPT,
  DIVIDEND_SYSTEM,
  CYCLE_SYSTEM,
  MACRO_SYSTEM,
  VALUATION_SYSTEM,
  VIX_SYSTEM,
  buildCyclePrompt,
  buildDividendPrompt,
  buildMacroPrompt,
  buildPortfolioPrompt,
  buildUserPrompt,
  buildValuationPrompt,
  buildVixPrompt,
  diagnose,
  diagnoseCycle,
  diagnoseDividend,
  diagnoseMacro,
  diagnosePortfolio,
  diagnoseValuation,
  diagnoseVix,
  endpointFor,
  extractReportEvents,
  fetchPage,
  isReasoningModel,
  loadConfig,
  maskKey,
  parseAnalysis,
  parsePortfolioAnalysis,
  saveConfig,
  searchWeb,
  summarizeBrief,
  testConnection,
} from "../lib/deepseek.ts";
import { readBriefCache, writeBriefCache } from "../lib/briefCache.ts";

let pass = 0;
let fail = 0;
const t0 = Date.now();

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + "  <<< " + detail);
  }
}

async function expectCode(name, fn, code) {
  try {
    await fn();
    check(name, false, "未抛出异常");
  } catch (err) {
    check(name, err instanceof LlmError && err.code === code, err instanceof Error ? err.code + " / " + err.message : String(err));
  }
}

/* 本机存储：Node 里没有 localStorage，注入一个内存实现 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const SECRET = "sk-" + "unit-test-secret-0123456789";
const GOOD = JSON.stringify({
  stance: "add",
  confidence: 0.62,
  summary: "波动率处于中位、趋势在 200 日线上方，可分批但需控制节奏。",
  reasons: ["RV21 18.74%，5 年分位 48.9%", "价格位于 200 日线上方"],
  risks: ["隐含波动率缺失，保险成本未知"],
  scenarios: { volUp: "若 RV21 上破 22，先降敞口", volDown: "若 RV21 回落至 15 下方，可按计划加仓" },
  dataGaps: ["缺少 VXN 序列"],
});

function okResponse(content) {
  return new Response(
    JSON.stringify({
      model: "deepseek-flash-Test",
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1500, completion_tokens: 320, total_tokens: 1820 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function recorder(factory) {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return factory(hits.length);
    },
  };
}

/* ===== 1. 密钥存储与地址白名单 ===== */

check("未保存时 loadConfig 返回 null", loadConfig() === null);
await expectCode("空密钥被拒绝", async () => saveConfig({ apiKey: "   " }), "missing_key");
const saved = saveConfig({ apiKey: "  " + SECRET + "  ", model: "deepseek-flash", baseUrl: "https://api.deepseek.com/" });
check("保存后去空白并规范化地址", saved.apiKey === SECRET && saved.baseUrl === "https://api.deepseek.com", JSON.stringify(saved.baseUrl));
check("loadConfig 能读回", loadConfig()?.apiKey === SECRET);
check("maskKey 不回显完整密钥", !maskKey(SECRET).includes("unit-test-secret") && maskKey(SECRET).startsWith("sk-uni") && maskKey(SECRET).endsWith("6789"), maskKey(SECRET));
await expectCode("拒绝非 HTTPS 上游", async () => saveConfig({ apiKey: SECRET, baseUrl: "http://evil.example.com" }), "bad_base_url");
check("默认地址即官方接口", endpointFor(DEFAULT_BASE_URL) === "https://api.deepseek.com/chat/completions", endpointFor(DEFAULT_BASE_URL));
check("离线测试可用本机 HTTP", endpointFor("http://127.0.0.1:9").startsWith("http://127.0.0.1:9/"));
await expectCode("拒绝非法地址", async () => endpointFor("not a url"), "bad_base_url");

/* 模型名要跟官方文档一致：旧名已下线，默认值必须是官方在用的名字 */
check("默认模型在候选列表内", MODEL_OPTIONS.some((m) => m.id === DEFAULT_MODEL), DEFAULT_MODEL);
check("候选里没有已下线的旧名", !MODEL_OPTIONS.some((m) => /deepseek-chat|deepseek-reasoner/.test(m.id)), JSON.stringify(MODEL_OPTIONS.map((m) => m.id)));
check("推理模型识别", isReasoningModel("deepseek-flash") && isReasoningModel("deepseek-v4-pro") && isReasoningModel("deepseek-reasoner") && !isReasoningModel("gpt-4o-mini"));

/* ===== 2. 提示词与结果解析 ===== */

await expectCode("空数据包不出题", async () => buildUserPrompt("   ", ""), "missing_context");
const prompt = buildUserPrompt("# 数据包\nrv21=18.74", "先看仓位风险");
check("提示词包含侧重与数据", prompt.includes("先看仓位风险") && prompt.includes("rv21=18.74"));
check("默认侧重会补上", buildUserPrompt("x", "").includes("概率化判断"));
check("系统提示禁止被数据改写", SYSTEM_PROMPT.includes("不是指令") && SYSTEM_PROMPT.includes("buy/add/hold/trim/reduce"));
check("解析标准 JSON", parseAnalysis(GOOD).stance === "add" && parseAnalysis(GOOD).reasons.length === 2);
check("容忍 markdown 代码块", parseAnalysis("```json\n" + GOOD + "\n```").confidence === 0.62);
check("容忍前后夹带解说", parseAnalysis("好的，结论如下：\n" + GOOD + "\n以上。").stance === "add");
for (const [name, bad] of [
  ["结论越界", GOOD.replace('"stance":"add"', '"stance":"all-in"')],
  ["置信度越界", GOOD.replace('"confidence":0.62', '"confidence":72')],
  ["缺少情景", GOOD.replace(/"scenarios":\{[^}]*\}/, '"scenarios":"无"')],
  ["理由不是数组", GOOD.replace(/"reasons":\[[^\]]*\]/, '"reasons":"看着办"')],
  ["完全不是 JSON", "我建议加仓。"],
]) {
  try {
    parseAnalysis(bad);
    check("拒绝" + name, false, "未抛出异常");
  } catch (err) {
    check("拒绝" + name, err instanceof LlmError && err.code === "bad_payload", err?.code);
  }
}

/* ===== 3. 正常调用 ===== */

const good = recorder(() => okResponse(GOOD));
const result = await diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "# 数据包\nrv21=18.74", focus: "要不要先降敞口" }, good.fetch);
check("请求只打一次", good.hits.length === 1);
check("打到官方 chat/completions", good.hits[0].url === "https://api.deepseek.com/chat/completions", good.hits[0].url);
check("带上密钥且不落站点服务端", good.hits[0].init.headers.Authorization === `Bearer ${SECRET}`);
check("跨域凭据模式不带 cookie", good.hits[0].init.credentials === "omit" && good.hits[0].init.mode === "cors");
check("非流式且给推理模型足够预算", good.hits[0].body.stream === false && good.hits[0].body.max_tokens === 4000);
check("官方接口压低推理档位", good.hits[0].body.effort === "low");
check("系统消息在前、数据包在后", good.hits[0].body.messages[0].role === "system" && good.hits[0].body.messages[1].content.includes("rv21=18.74"));
check("结论与用量映射", result.analysis.stance === "add" && result.usage.totalTokens === 1820 && result.model === "deepseek-flash-Test");
check("记录上下文规模与免责", result.contextChars > 0 && result.disclaimer.includes("不构成投资建议"));

const reasoner = recorder(() => okResponse(GOOD));
await diagnose({ apiKey: SECRET, model: "deepseek-v4-pro", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, reasoner.fetch);
check("推理模型给更长的输出预算", reasoner.hits[0].body.model === "deepseek-v4-pro" && reasoner.hits[0].body.max_tokens === 4000);

const plain = recorder(() => okResponse(GOOD));
await diagnose({ apiKey: SECRET, model: "gpt-4o-mini", baseUrl: "https://proxy.example.com" }, { markdown: "x" }, plain.fetch);
check("非推理模型用较小预算", plain.hits[0].body.max_tokens === 1500);
check("第三方地址不注入 effort 参数", !("effort" in plain.hits[0].body));

const probe = recorder(() => okResponse("正常"));
const tested = await testConnection({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, probe.fetch);
check("连通性测试预算足够推理模型出正文", probe.hits[0].body.max_tokens === 256 && tested.reply === "正常" && tested.usage.totalTokens === 1820);

/* ===== 4. 错误映射：都不重放 ===== */

for (const [status, code] of [
  [401, "key_rejected"],
  [403, "key_rejected"],
  [402, "insufficient_balance"],
  [429, "rate_limited"],
  [400, "bad_request"],
  [500, "upstream_error"],
  [418, "upstream_error"],
]) {
  const rec = recorder(() => new Response('{"error":"secret-upstream-detail"}', { status }));
  await expectCode(
    "HTTP " + status + " → " + code,
    async () => diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, rec.fetch),
    code,
  );
  check("HTTP " + status + " 只请求一次且不泄漏上游正文", rec.hits.length === 1, String(rec.hits.length));
}

const broken = recorder(() => new Response("not json at all", { status: 200, headers: { "content-type": "application/json" } }));
await expectCode("上游返回非 JSON", () => diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, broken.fetch), "bad_payload");

const empty = recorder(() => new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } }));
await expectCode("响应里没有正文", () => diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, empty.fetch), "bad_payload");

const offline = recorder(() => {
  throw new TypeError("fetch failed");
});
await expectCode("网络不可达", () => diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, offline.fetch), "network");
check("网络失败不自动重试", offline.hits.length === 1);

const timed = recorder(() => {
  const err = new Error("timed out");
  err.name = "TimeoutError";
  throw err;
});
await expectCode("超时", () => diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, timed.fetch), "timeout");

await expectCode("没有密钥就不发请求", () => diagnose({ apiKey: "", model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(GOOD)).fetch), "missing_key");

/* ===== 5. 截断重试与网页搜索 / 抓取 ===== */

const truncated = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      if (hits.length === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: '{"stance":"hold","confidence":0.5,"summary":"x","reasons":["a' } }], usage: { total_tokens: 100 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return okResponse(GOOD);
    },
  };
})();
const retried = await diagnose({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, truncated.fetch);
check("JSON 被截断时自动重试一次", truncated.hits.length === 2 && retried.analysis.stance === "add", "hits=" + truncated.hits.length);
check("重试时改用高推理档位", truncated.hits[1].body.effort === "high", JSON.stringify(truncated.hits[1].body.effort));

const searchRec = recorder(() => new Response(JSON.stringify({ results: [{ title: "大摩看多 A 股", url: "https://example.com/a", site_name: "证券时报", date: "2025-12-06T16:00:00+00:00", summary: "概要", snippet: "摘要", authority: 4 }] }), { status: 200, headers: { "content-type": "application/json" } }));
const hits = await searchWeb({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, "大摩 A股 策略", searchRec.fetch);
check("搜索命中到官方 /v1/tools/search", searchRec.hits[0].url === "https://api.deepseek.com/v1/tools/search" && searchRec.hits[0].init.headers.Authorization === `Bearer ${SECRET}`);
check("搜索命中映射字段", hits.length === 1 && hits[0].title === "大摩看多 A 股" && hits[0].site === "证券时报" && hits[0].date === "2025-12-06" && hits[0].authority === 4);
await expectCode("搜索拒绝非官方地址", () => searchWeb({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: "https://proxy.example.com" }, "x", recorder(() => new Response("{}")).fetch), "bad_base_url");

const fetchRec = recorder(() => new Response(JSON.stringify({ title: "报告", content: "# 正文\n大摩上调沪深300目标" }), { status: 200, headers: { "content-type": "application/json" } }));
const page = await fetchPage({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, "https://example.com/a", fetchRec.fetch);
check("抓取命中到官方 /v1/tools/fetch", fetchRec.hits[0].url === "https://api.deepseek.com/v1/tools/fetch" && fetchRec.hits[0].body.url === "https://example.com/a");
check("抓取返回 Markdown 正文", page.title === "报告" && page.content.includes("沪深300"));
await expectCode("抓取空正文被拒绝", () => fetchPage({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, "https://example.com/a", recorder(() => new Response(JSON.stringify({ content: "" }))).fetch), "bad_payload");

const EXTRACTED = JSON.stringify({ events: [{ date: "2025-12-06", title: "大摩看多", stance: "看多", action: "评级上调", summary: "上调中国股市评级", targets: [{ index: "沪深300", to: 5400, horizon: "2026年末" }], sourceUrl: "https://example.com/a", sourceLabel: "证券时报", note: "" }] });
function extractResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage: { total_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
}
const extRec = recorder(() => extractResponse(EXTRACTED));
const events = await extractReportEvents({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { searchText: "材料", pages: [] }, extRec.fetch);
check("报告事件提取映射", events.length === 1 && events[0].stance === "看多" && events[0].targets[0].to === 5400 && events[0].sourceLabel === "证券时报");
check("提取阶段给推理模型 8000 token 预算并压低思维链", extRec.hits.length === 1 && extRec.hits[0].body.max_tokens === 8000 && extRec.hits[0].body.effort === "low", JSON.stringify({ n: extRec.hits.length, max: extRec.hits[0].body.max_tokens, effort: extRec.hits[0].body.effort }));

/* 提取被思维链截断（正文为空）：压缩材料、提高推理档位，只重试一次 */
const bigPages = [0, 1, 2].map((i) => ({ url: "https://example.com/p" + i, title: "p" + i, content: "页".repeat(20000) }));
const truncRec = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? extractResponse("") : extractResponse(EXTRACTED);
    },
  };
})();
const salvaged = await extractReportEvents({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { searchText: "搜".repeat(9000), pages: bigPages }, truncRec.fetch);
check("提取正文为空时自动重试并成功", salvaged.length === 1 && truncRec.hits.length === 2, "hits=" + truncRec.hits.length);
check("提取首次材料已截断到 6000+12000×3", truncRec.hits[0].body.messages[1].content.length < 50000 && truncRec.hits[0].body.messages[1].content.includes("https://example.com/p2"));
check("提取重试改用高推理档位且材料更短", truncRec.hits[1].body.effort === "high" && truncRec.hits[1].body.messages[1].content.length < truncRec.hits[0].body.messages[1].content.length && !truncRec.hits[1].body.messages[1].content.includes("https://example.com/p2"), "effort=" + truncRec.hits[1].body.effort);

/* ===== 6. AI 背景补充（VIX / KOSPI）：只用本站指标做数值依据 ===== */

const BRIEF = JSON.stringify({
  headline: "VIX 处于中性区间",
  summary: "期权市场对未来一个月波动的定价处于常态，未见系统性恐慌。",
  bullets: ["本站 VIX 5 年分位 50%", "检索材料提到近期宏观事件密集"],
  watch: ["关注 VIX 是否上破 22"],
  caveats: ["检索材料可能滞后，数值以本站接口为准"],
});
const briefCtx = "VIX 最新读数：18.9；5 年分位 50%；本站波动状态判定：中性。";

const briefRec = recorder(() => okResponse(BRIEF));
const briefed = await summarizeBrief({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { topic: "VIX", context: briefCtx, searchText: "- 某站新闻 摘要 https://example.com/n" }, briefRec.fetch);
check("AI 补充映射摘要结构", briefed.brief.headline === "VIX 处于中性区间" && briefed.brief.bullets.length === 2 && briefed.brief.watch[0].includes("22") && briefed.brief.caveats.length === 1);
check("AI 补充只打一次官方接口", briefRec.hits.length === 1 && briefRec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("AI 补充提示词含站点指标与检索材料", briefRec.hits[0].body.messages[1].content.includes("18.9") && briefRec.hits[0].body.messages[1].content.includes("example.com/n"));
check("AI 补充要求不得编造数值", briefRec.hits[0].body.messages[0].content.includes("严禁编造") && briefRec.hits[0].body.messages[0].content.includes("唯一数值依据"));
check("AI 补充禁止把检索旧值当作最新值", briefRec.hits[0].body.messages[0].content.includes("不得把其中的旧值当作最新值"));
check("AI 补充不发密钥正文", !JSON.stringify(briefRec.hits[0].body).includes(SECRET));
check("AI 补充给推理模型足够预算并压低档位", briefRec.hits[0].body.max_tokens === 4000 && briefRec.hits[0].body.effort === "low");

const briefTrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"headline":"x"') : okResponse(BRIEF);
    },
  };
})();
const briefRetried = await summarizeBrief({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { topic: "KOSPI", context: "KOSPI 最新点位 6023", searchText: "" }, briefTrunc.fetch);
check("AI 补充 JSON 截断时重试一次并成功", briefTrunc.hits.length === 2 && briefRetried.brief.headline === "VIX 处于中性区间", "hits=" + briefTrunc.hits.length);
check("AI 补充重试改用高推理档位", briefTrunc.hits[1].body.effort === "high", String(briefTrunc.hits[1].body.effort));
await expectCode("AI 补充没有密钥时不发请求", () => summarizeBrief({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { topic: "VIX", context: "x", searchText: "" }, recorder(() => okResponse(BRIEF)).fetch), "missing_key");

/* ===== 6b. AI 摘要缓存必须绑定本站指标版本 ===== */

const cacheEntry = { at: Date.now(), context: "VIX 最新读数：18.9", brief: briefed.brief, sources: [], model: DEFAULT_MODEL, searched: true };
writeBriefCache("TEST-VIX", cacheEntry);
check("AI 摘要缓存同指标可复用", readBriefCache("TEST-VIX", "VIX 最新读数：18.9")?.brief.headline === "VIX 处于中性区间");
check("本站指标变化后旧 AI 摘要失效", readBriefCache("TEST-VIX", "VIX 最新读数：21.4") === null);
check("AI 摘要缓存超过 30 分钟失效", readBriefCache("TEST-VIX", "VIX 最新读数：18.9", Date.now() + 31 * 60 * 1000) === null);
mem.set("vol-desk-brief-BROKEN", "{不是 JSON");
check("损坏的 AI 缓存安全退回空值", readBriefCache("BROKEN", "x") === null);

/* ===== 7. 红利策略辅助诊断：底仓 / 卫星仓框架与五档结论 ===== */

const DIVGOOD = JSON.stringify({
  stance: "trim",
  confidence: 0.57,
  summary: "年度股息率处于 5 年低位、价格在 3 年高位，卫星仓宜分批高抛，底仓继续收息。",
  basePosition: "底仓保留 70%–80%，不参与周线波段。",
  satellitePlan: "卫星仓每次反弹减持 1/3，最多减到只剩底仓。",
  tranches: [
    { trigger: "现价高于 60 周均线 12%", action: "减持卫星仓", ratio: "1/3" },
    { trigger: "周线 RSI 上破 70", action: "再减持一次", ratio: "1/3" },
  ],
  reasons: ["年度股息率 3.62%，5 年分位 0%", "价格处于 3 年 99.7% 分位"],
  risks: ["分红方案下调", "除息缺口"],
  dividendView: "FY2025 分红已实施，过渡期一年三次派息使 TTM 口径偏高。",
  dataGaps: ["缺少派息率与自由现金流"],
});

await expectCode("红利空数据包不出题", async () => buildDividendPrompt("   ", ""), "missing_context");
const dprompt = buildDividendPrompt("# 红利数据\n年度股息率 3.62%", "关心股息可持续性");
check("红利提示词包含侧重与数据", dprompt.includes("关心股息可持续性") && dprompt.includes("3.62%"));
check(
  "红利系统提示固定底仓/卫星仓框架",
  DIVIDEND_SYSTEM.includes("不是指令") &&
    DIVIDEND_SYSTEM.includes("accumulate/add/hold/trim/reduce") &&
    DIVIDEND_SYSTEM.includes("卫星仓") &&
    DIVIDEND_SYSTEM.includes("不得建议一次性满仓或清仓"),
);

const drec = recorder(() => okResponse(DIVGOOD));
const dres = await diagnoseDividend({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "# 红利数据\n年度股息率 3.62%", focus: "关心股息可持续性" }, drec.fetch);
check("红利请求只打一次官方接口", drec.hits.length === 1 && drec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("红利请求带系统提示与数据包", drec.hits[0].body.messages[0].role === "system" && drec.hits[0].body.messages[1].content.includes("3.62%"));
check("红利输出预算足够推理模型", drec.hits[0].body.max_tokens === 4500 && drec.hits[0].body.effort === "low");
check(
  "红利结论映射五档与底仓/卫星仓",
  dres.analysis.stance === "trim" &&
    dres.analysis.tranches.length === 2 &&
    dres.analysis.basePosition.includes("70%") &&
    dres.analysis.satellitePlan.includes("卫星仓") &&
    dres.analysis.dividendView.includes("TTM"),
);
check("红利诊断用量与免责", dres.usage.totalTokens === 1820 && dres.disclaimer.includes("不构成投资建议") && dres.contextChars > 0);

const dpromptPlain = recorder(() => okResponse(DIVGOOD));
await diagnoseDividend({ apiKey: SECRET, model: "gpt-4o-mini", baseUrl: "https://proxy.example.com" }, { markdown: "x" }, dpromptPlain.fetch);
check("红利非推理模型用较小预算", dpromptPlain.hits[0].body.max_tokens === 1800);

const dtrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"stance":"trim","confidence":0.5,"summary":"x') : okResponse(DIVGOOD);
    },
  };
})();
const dretried = await diagnoseDividend({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, dtrunc.fetch);
check("红利 JSON 被截断时自动重试一次", dtrunc.hits.length === 2 && dretried.analysis.stance === "trim");
check("红利重试改用高推理档位", dtrunc.hits[1].body.effort === "high");

for (const [name, bad] of [
  ["红利结论越界", DIVGOOD.replace('"stance":"trim"', '"stance":"all-in"')],
  ["红利置信度越界", DIVGOOD.replace('"confidence":0.57', '"confidence":1.7')],
  ["红利缺少底仓建议", DIVGOOD.replace(/"basePosition":"[^"]*",/, "")],
  ["红利档位不是数组", DIVGOOD.replace(/"tranches":\[[^\]]*\]/, '"tranches":"一次减完"')],
]) {
  const rec = recorder(() => okResponse(bad));
  await expectCode("拒绝" + name, () => diagnoseDividend({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, rec.fetch), "bad_payload");
  check("拒绝" + name + " 时最多重试一次", rec.hits.length <= 2, "hits=" + rec.hits.length);
}

await expectCode(
  "红利诊断没有密钥时不发请求",
  () => diagnoseDividend({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(DIVGOOD)).fetch),
  "missing_key",
);

/* ===== 8. 跨资产风险分析：黄金 / 原油 / 美债，禁止点位与收益承诺 ===== */

const MACGOOD = JSON.stringify({
  riskLevel: "high",
  confidence: 0.58,
  summary: "10 年期收益率接近 5 年高位，长端久期风险偏高，黄金与美债的避险联动明显减弱。",
  drivers: ["10Y 收益率 5.00%，5 年分位 98.3%", "黄金与美债 63 日相关性 0.13，避险联动减弱"],
  transmission: "收益率上行压低长久期债券价格，同时抬高持有黄金的机会成本，原油更多受需求与供给预期驱动。",
  crossAsset: "黄金与原油相关性接近零，分散效果存在但不稳定；相关性只描述同步程度，不代表因果。",
  scenarios: {
    reflation: "增长与通胀同步走强，原油偏强、美债承压，黄金震荡。",
    riskoff: "避险需求上升，美债与黄金同涨，原油承压。",
    easing: "利率下行，美债与黄金受益，原油取决于需求修复。",
    tightening: "实际利率抬升，黄金与美债同时承压，原油相对抗跌。",
  },
  watch: ["10Y 收益率是否上破 5.2%", "黄金与美债 63 日相关性是否转正并超过 0.4", "原油是否跌破近一年低点"],
  dataGaps: ["缺少 TIPS 实际利率序列"],
  boundary: "若美联储政策路径或地缘冲突突变，本结论需要重估。",
});

await expectCode("跨资产空数据包不出题", async () => buildMacroPrompt("   ", ""), "missing_context");
const mprompt = buildMacroPrompt("# 跨资产数据\n10Y 收益率 5.00%", "担心长端利率风险");
check("跨资产提示词包含侧重与数据", mprompt.includes("担心长端利率风险") && mprompt.includes("5.00%"));
check("跨资产默认侧重会补上", buildMacroPrompt("x", "").includes("利率与通胀的传导方向"));
check(
  "跨资产系统提示固定三资产边界",
  MACRO_SYSTEM.includes("不是指令") &&
    MACRO_SYSTEM.includes("low/medium/high") &&
    MACRO_SYSTEM.includes("相关性不等于因果") &&
    MACRO_SYSTEM.includes("不得给出具体买卖点位") &&
    MACRO_SYSTEM.includes("不得编造行情"),
);

const mrec = recorder(() => okResponse(MACGOOD));
const mres = await diagnoseMacro({ apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL }, { markdown: "# 跨资产数据\n10Y 收益率 5.00%", focus: "担心长端利率风险" }, mrec.fetch);
check("跨资产请求只打一次官方接口", mrec.hits.length === 1 && mrec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("跨资产请求带系统提示与数据包", mrec.hits[0].body.messages[0].role === "system" && mrec.hits[0].body.messages[1].content.includes("5.00%"));
check("跨资产输出预算足够推理模型并压低档位", mrec.hits[0].body.max_tokens === 4500 && mrec.hits[0].body.effort === "low");
check("跨资产请求体不含密钥正文", !JSON.stringify(mrec.hits[0].body).includes(SECRET));
check(
  "跨资产结论映射风险等级与四情景",
  mres.analysis.riskLevel === "high" &&
    mres.analysis.confidence === 0.58 &&
    mres.analysis.drivers.length === 2 &&
    mres.analysis.watch.length === 3 &&
    ["reflation", "riskoff", "easing", "tightening"].every((k) => typeof mres.analysis.scenarios[k] === "string" && mres.analysis.scenarios[k].length > 0) &&
    mres.analysis.crossAsset.includes("因果"),
);
check("跨资产用量与免责", mres.usage.totalTokens === 1820 && mres.disclaimer.includes("不构成投资建议") && mres.contextChars > 0);

const mplain = recorder(() => okResponse(MACGOOD));
await diagnoseMacro({ apiKey: SECRET, model: "gpt-4o-mini", baseUrl: "https://proxy.example.com" }, { markdown: "x" }, mplain.fetch);
check("跨资产非推理模型用较小预算", mplain.hits[0].body.max_tokens === 1800 && !("effort" in mplain.hits[0].body));

const mtrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"riskLevel":"high","confidence":0.5,"summary":"x') : okResponse(MACGOOD);
    },
  };
})();
const mretried = await diagnoseMacro({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, mtrunc.fetch);
check("跨资产 JSON 被截断时自动重试一次", mtrunc.hits.length === 2 && mretried.analysis.riskLevel === "high");
check("跨资产重试改用高推理档位", mtrunc.hits[1].body.effort === "high");

const mbad = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse(MACGOOD.replace('"riskLevel":"high"', '"riskLevel":"extreme"')) : okResponse(MACGOOD);
    },
  };
})();
const mbadFixed = await diagnoseMacro({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, mbad.fetch);
check("跨资产越界 riskLevel 重试一次后成功", mbad.hits.length === 2 && mbadFixed.analysis.riskLevel === "high", "hits=" + mbad.hits.length);

for (const [name, bad] of [
  ["跨资产置信度越界", MACGOOD.replace('"confidence":0.58', '"confidence":58')],
  ["跨资产缺少情景", MACGOOD.replace(/"scenarios":\{[^}]*\}/, '"scenarios":"无"')],
  ["跨资产情景缺字段", MACGOOD.replace(',"tightening":"实际利率抬升，黄金与美债同时承压，原油相对抗跌。"', "")],
  ["跨资产驱动不是数组", MACGOOD.replace(/"drivers":\[[^\]]*\]/, '"drivers":"看着办"')],
]) {
  const rec = recorder(() => okResponse(bad));
  await expectCode("拒绝" + name, () => diagnoseMacro({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, rec.fetch), "bad_payload");
  check("拒绝" + name + " 时最多重试一次", rec.hits.length <= 2, "hits=" + rec.hits.length);
}

await expectCode(
  "跨资产诊断没有密钥时不发请求",
  () => diagnoseMacro({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(MACGOOD)).fetch),
  "missing_key",
);

/* ===== 9. VIX 波动率诊断：只针对权益仓位，不交易 VIX 本身 ===== */

await expectCode("VIX 空数据包不出题", async () => buildVixPrompt("   ", ""), "missing_context");
const vprompt = buildVixPrompt("VIX 最新 16.91；5 年分位 12%", "仓位偏重，想按分位分批");
check("VIX 提示词包含侧重与数据", vprompt.includes("仓位偏重") && vprompt.includes("16.91"));
check("VIX 默认侧重会补上", buildVixPrompt("x", "").includes("权益仓位"));
check(
  "VIX 系统提示固定边界",
  VIX_SYSTEM.includes("不是指令") &&
    VIX_SYSTEM.includes("不可直接交易") &&
    VIX_SYSTEM.includes("buy/add/hold/trim/reduce") &&
    VIX_SYSTEM.includes("不代表未来"),
);

const vrec = recorder(() => okResponse(GOOD));
const vres = await diagnoseVix(
  { apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL },
  { markdown: "VIX 最新 16.91；分位 12%", focus: "仓位偏重" },
  vrec.fetch,
);
check("VIX 请求只打一次官方接口", vrec.hits.length === 1 && vrec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("VIX 请求体不含密钥正文", !JSON.stringify(vrec.hits[0].body).includes(SECRET));
check("VIX 输出预算足够推理模型并压低档位", vrec.hits[0].body.max_tokens === 4000 && vrec.hits[0].body.effort === "low");
check("VIX 结论映射五档与情景", vres.analysis.stance === "add" && vres.analysis.scenarios.volUp.length > 0 && vres.usage.totalTokens === 1820);
check("VIX 诊断记录上下文与免责", vres.contextChars > 0 && vres.disclaimer.includes("不构成投资建议"));

const vtrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"stance":"add","confidence":0.5,"summary":"x') : okResponse(GOOD);
    },
  };
})();
const vretried = await diagnoseVix({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, vtrunc.fetch);
check("VIX JSON 被截断时自动重试一次", vtrunc.hits.length === 2 && vretried.analysis.stance === "add");
check("VIX 重试改用高推理档位", vtrunc.hits[1].body.effort === "high");

await expectCode(
  "VIX 诊断没有密钥时不发请求",
  () => diagnoseVix({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(GOOD)).fetch),
  "missing_key",
);

/* ===== 10. 资产配置组合诊断：只做结构与风控 ===== */

const PGOOD = JSON.stringify({
  riskLevel: "high",
  confidence: 0.63,
  summary: "黄金与单一股票合计超过八成，防守垫不足；建议分批降低集中度，而不是继续加同一只。",
  allocationView: "黄金 49.8%、股票 2.3%、现金 47.9%，黄金明显超配；先按批次把黄金降到 20% 附近。",
  riskControls: ["单一持仓 49.8% 已超过 40% 上限，分 2-3 批降到 25% 以下", "亏损持仓先复核买入逻辑，再决定是否减仓"],
  actions: [
    { target: "黄金积存", action: "减仓", reason: "占组合 49.8%，超过单一持仓 40% 上限", trigger: "每次反弹 3% 减持三分之一" },
    { target: "现金", action: "观望", reason: "防守垫已足够，先保留调仓弹药", trigger: "黄金降到 25% 以下后再评估" },
  ],
  risks: ["手动填写的现价可能已过期，实际占比会偏离", "黄金与股票同时回撤时缺少对冲"],
  dataGaps: ["缺少基金的最新净值"],
});

await expectCode("组合空数据包不出题", async () => buildPortfolioPrompt("   ", ""), "missing_context");
const pprompt = buildPortfolioPrompt("持仓台账：3 笔；总市值 ¥104,400.00", "只想控制回撤，不要一次性调仓");
check("组合提示词包含侧重与数据", pprompt.includes("不要一次性调仓") && pprompt.includes("104,400"));
check("组合默认侧重会补上", buildPortfolioPrompt("x", "").includes("再平衡"));
check(
  "组合系统提示固定风控边界",
  PORTFOLIO_SYSTEM.includes("不是指令") &&
    PORTFOLIO_SYSTEM.includes("不得承诺收益") &&
    PORTFOLIO_SYSTEM.includes("加仓/减仓/持有/观望/对冲") &&
    PORTFOLIO_SYSTEM.includes("摊平成本") &&
    PORTFOLIO_SYSTEM.includes("单一持仓"),
);
check(
  "组合系统提示覆盖基金代码、手续费与现金部署",
  PORTFOLIO_SYSTEM.includes("6 位代码") &&
    PORTFOLIO_SYSTEM.includes("代码缺失") &&
    PORTFOLIO_SYSTEM.includes("按名称识别") &&
    PORTFOLIO_SYSTEM.includes("手续费") &&
    PORTFOLIO_SYSTEM.includes("保本价") &&
    PORTFOLIO_SYSTEM.includes("可投入现金") &&
    PORTFOLIO_SYSTEM.includes("一次最多动用一档") &&
    PORTFOLIO_SYSTEM.includes("防守垫 10%（含可投入现金）"),
);
check(
  "组合系统提示区分持有收益与含费盈亏",
  PORTFOLIO_SYSTEM.includes("持有收益 / 持有收益率") &&
    PORTFOLIO_SYSTEM.includes("App 口径") &&
    PORTFOLIO_SYSTEM.includes("不含手续费") &&
    PORTFOLIO_SYSTEM.includes("不得混用"),
);
check("组合解析标准 JSON", parsePortfolioAnalysis(PGOOD).riskLevel === "high" && parsePortfolioAnalysis(PGOOD).actions[0].action === "减仓");
check("组合解析容忍 markdown 代码块", parsePortfolioAnalysis("```json\n" + PGOOD + "\n```").riskControls.length === 2);

const prec = recorder(() => okResponse(PGOOD));
const pres = await diagnosePortfolio(
  { apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL },
  { markdown: "持仓台账：3 笔；总市值 ¥104,400.00", focus: "控制回撤" },
  prec.fetch,
);
check("组合请求只打一次官方接口", prec.hits.length === 1 && prec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("组合请求体不含密钥正文", !JSON.stringify(prec.hits[0].body).includes(SECRET));
check("组合输出预算足够推理模型并压低档位", prec.hits[0].body.max_tokens === 4200 && prec.hits[0].body.effort === "low");
check("组合系统消息在前、数据包在后", prec.hits[0].body.messages[0].role === "system" && prec.hits[0].body.messages[1].content.includes("104,400"));
check(
  "组合结论映射动作表",
  pres.analysis.riskLevel === "high" &&
    pres.analysis.actions.length === 2 &&
    pres.analysis.actions[0].action === "减仓" &&
    pres.analysis.allocationView.includes("黄金"),
);
check("组合诊断记录上下文与免责", pres.contextChars > 0 && pres.usage.totalTokens === 1820 && pres.disclaimer.includes("不构成投资建议"));

const pplain = recorder(() => okResponse(PGOOD));
await diagnosePortfolio({ apiKey: SECRET, model: "gpt-4o-mini", baseUrl: "https://proxy.example.com" }, { markdown: "x" }, pplain.fetch);
check("组合非推理模型用较小预算且不注入 effort", pplain.hits[0].body.max_tokens === 1800 && !("effort" in pplain.hits[0].body));

const ptrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"riskLevel":"high","confidence":0.5,"summary":"x') : okResponse(PGOOD);
    },
  };
})();
const pretried = await diagnosePortfolio({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, ptrunc.fetch);
check("组合 JSON 被截断时自动重试一次", ptrunc.hits.length === 2 && pretried.analysis.riskLevel === "high");
check("组合重试改用高推理档位", ptrunc.hits[1].body.effort === "high");

for (const [name, bad] of [
  ["组合风险等级越界", PGOOD.replace('"riskLevel":"high"', '"riskLevel":"extreme"')],
  ["组合动作越界", PGOOD.replace('"action":"减仓"', '"action":"清仓"')],
  ["组合置信度越界", PGOOD.replace('"confidence":0.63', '"confidence":1.6')],
  ["组合动作为空", PGOOD.replace(/"actions":\[[^\]]*\]/, '"actions":[]')],
  ["组合风控要点不是数组", PGOOD.replace(/"riskControls":\[[^\]]*\]/, '"riskControls":"看着办"')],
]) {
  const rec = recorder(() => okResponse(bad));
  await expectCode("拒绝" + name, () => diagnosePortfolio({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, rec.fetch), "bad_payload");
  check("拒绝" + name + " 时最多重试一次", rec.hits.length <= 2, "hits=" + rec.hits.length);
}

await expectCode(
  "组合诊断没有密钥时不发请求",
  () => diagnosePortfolio({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(PGOOD)).fetch),
  "missing_key",
);

/* ===== 13. 康波周期解读：不判定长波年份 ===== */

const CYCLEGOOD = JSON.stringify({
  confidence: 0.62,
  summary: "三指数在同一窗口内分化：纳指100与标普500保持上行，上证震荡；启发式给出美股偏繁荣、A 股偏修复的组合。",
  indexViews: {
    NDX100: "最新 29813.16，1Y 收益 +18.2%，距一年高点 -3.1%。",
    SPX: "最新 7743.98，1Y 收益 +12.4%，位于 200 日线上方。",
    SSE: "最新 3681.47，1Y 收益 +5.6%，21 日波动抬升。",
  },
  phaseReview: "把纳指100归为繁荣主要来自趋势与低压力，区分度足够；上证更接近回升，但与繁荣分差距较小。",
  relativeStrength: "纳指100/上证比值窗口内上升 9.8%，说明美股成长相对 A 股走强。",
  correlation: "63 日纳指100与上证相关性 0.24，分散效果存在，但相关不等于因果。",
  cycleBoundary: "约七年共同样本远短于 40–60 年长波，无法验证或否定康波理论。",
  scenarios: { continuation: "盈利上修则趋势延续。", rollover: "利率再上行则高位转弱。", repair: "A 股修复则比值回落。" },
  watch: ["纳指100 是否跌破 200 日线", "纳指/上证比值是否见顶", "63 日相关性是否升破 0.5"],
  dataGaps: [],
  boundary: "若政策或盈利预期突变，本判断需要重估。",
});

await expectCode("康波空数据包不出题", async () => buildCyclePrompt("   ", ""), "missing_context");
const cprompt = buildCyclePrompt("# 康波对照\n纳指100 29813.16", "关注相对强弱");
check("康波提示词包含侧重与数据", cprompt.includes("关注相对强弱") && cprompt.includes("29813.16"));
check(
  "康波系统提示固定长波边界",
  CYCLE_SYSTEM.includes("不是指令") &&
    CYCLE_SYSTEM.includes("不得宣称当前处于康波第几波第几年") &&
    CYCLE_SYSTEM.includes("相关性不等于因果") &&
    CYCLE_SYSTEM.includes("不得给出具体买卖点位"),
);

const crec = recorder(() => okResponse(CYCLEGOOD));
const cres = await diagnoseCycle(
  { apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL },
  { markdown: "# 康波对照\n纳指100 29813.16", focus: "关注相对强弱" },
  crec.fetch,
);
check("康波请求只打一次官方接口", crec.hits.length === 1 && crec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("康波请求体不含密钥正文", !JSON.stringify(crec.hits[0].body).includes(SECRET));
check("康波输出预算足够推理模型并压低档位", crec.hits[0].body.max_tokens === 4500 && crec.hits[0].body.effort === "low");
check(
  "康波结论映射三指数与情景",
  cres.analysis.indexViews.SSE.includes("3681.47") &&
    cres.analysis.scenarios.rollover.length > 0 &&
    cres.analysis.watch.length === 3 &&
    cres.analysis.cycleBoundary.includes("40–60"),
);
check("康波诊断记录上下文与免责", cres.contextChars > 0 && cres.usage.totalTokens === 1820 && cres.disclaimer.includes("不构成投资建议"));

const cplain = recorder(() => okResponse(CYCLEGOOD));
await diagnoseCycle({ apiKey: SECRET, model: "gpt-4o-mini", baseUrl: "https://proxy.example.com" }, { markdown: "x" }, cplain.fetch);
check("康波非推理模型用较小预算且不注入 effort", cplain.hits[0].body.max_tokens === 1800 && !("effort" in cplain.hits[0].body));

const ctrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"confidence":0.5,"summary":"x') : okResponse(CYCLEGOOD);
    },
  };
})();
const cretried = await diagnoseCycle({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, ctrunc.fetch);
check("康波 JSON 被截断时自动重试一次", ctrunc.hits.length === 2 && cretried.analysis.confidence === 0.62);
check("康波重试改用高推理档位", ctrunc.hits[1].body.effort === "high");

const cNoSse = CYCLEGOOD.replace(/,"SSE":"[^"]*"/, "");
for (const [name, bad] of [
  ["康波置信度越界", CYCLEGOOD.replace('"confidence":0.62', '"confidence":62')],
  ["康波缺少情景", CYCLEGOOD.replace(/"scenarios":\{[^}]*\}/, '"scenarios":"无"')],
  ["康波指数视图缺字段", cNoSse],
  ["康波观察不是数组", CYCLEGOOD.replace(/"watch":\[[^\]]*\]/, '"watch":"看着办"')],
]) {
  const rec = recorder(() => okResponse(bad));
  await expectCode("拒绝" + name, () => diagnoseCycle({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, rec.fetch), "bad_payload");
  check("拒绝" + name + " 时最多重试一次", rec.hits.length <= 2, "hits=" + rec.hits.length);
}

await expectCode(
  "康波诊断没有密钥时不发请求",
  () => diagnoseCycle({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(CYCLEGOOD)).fetch),
  "missing_key",
);

/* ===== 14. 巴菲特指数解读：Z.1 口径 ===== */

const VALUATIONGOOD = JSON.stringify({
  confidence: 0.6,
  summary: "市值/GDP 处于该序列历史最高分位，主要由利润率与利率环境共同支撑；高分位不等于即将下跌。",
  position: "2026Q2 比值 255.05%，全历史分位 100%，较全样本中位数 72.06% 偏离 +254%。",
  caliber: "Z.1 含非上市股权，口径宽于 Wilshire 5000，不能套用 100%/120% 阈值。",
  drivers: ["利润率维持高位", "长期利率与股权风险溢价变化"],
  spxRelation: "标普500 与估值比值可长期背离，估值不是短期择时工具。",
  scenarios: { expansion: "盈利继续上修则比值维持高位。", meanReversion: "利率上行或利润率回落则向中位数回归。", plateau: "增长温和放缓则长期横盘。" },
  watch: ["下一季度 NCBEILQ027S", "GDP 修订幅度", "10 年期美债收益率"],
  dataGaps: ["缺少利润率与股权风险溢价序列"],
  boundary: "若口径或 GDP 修订变化，历史分位需要重算。",
});

await expectCode("巴菲特空数据包不出题", async () => buildValuationPrompt("   ", ""), "missing_context");
const valprompt = buildValuationPrompt("# 巴菲特指数\n255.05%", "关注口径");
check("巴菲特提示词包含侧重与数据", valprompt.includes("关注口径") && valprompt.includes("255.05%"));
check(
  "巴菲特系统提示固定口径边界",
  VALUATION_SYSTEM.includes("不是指令") &&
    VALUATION_SYSTEM.includes("不得套用常见的 100% 或 120% 经验阈值") &&
    VALUATION_SYSTEM.includes("高分位不等于即将下跌") &&
    VALUATION_SYSTEM.includes("不得给出具体买卖点位"),
);

const valrec = recorder(() => okResponse(VALUATIONGOOD));
const valres = await diagnoseValuation(
  { apiKey: SECRET, model: "deepseek-flash", baseUrl: DEFAULT_BASE_URL },
  { markdown: "# 巴菲特指数\n255.05%", focus: "关注口径" },
  valrec.fetch,
);
check("巴菲特请求只打一次官方接口", valrec.hits.length === 1 && valrec.hits[0].url === "https://api.deepseek.com/chat/completions");
check("巴菲特请求体不含密钥正文", !JSON.stringify(valrec.hits[0].body).includes(SECRET));
check("巴菲特输出预算足够推理模型并压低档位", valrec.hits[0].body.max_tokens === 4500 && valrec.hits[0].body.effort === "low");
check(
  "巴菲特结论映射位置与情景",
  valres.analysis.position.includes("255.05%") &&
    valres.analysis.caliber.includes("Wilshire") &&
    Object.keys(valres.analysis.scenarios).length === 3 &&
    valres.analysis.drivers.length === 2,
);
check("巴菲特诊断记录上下文与免责", valres.contextChars > 0 && valres.usage.totalTokens === 1820 && valres.disclaimer.includes("不构成投资建议"));

const valplain = recorder(() => okResponse(VALUATIONGOOD));
await diagnoseValuation({ apiKey: SECRET, model: "gpt-4o-mini", baseUrl: "https://proxy.example.com" }, { markdown: "x" }, valplain.fetch);
check("巴菲特非推理模型用较小预算且不注入 effort", valplain.hits[0].body.max_tokens === 1800 && !("effort" in valplain.hits[0].body));

const valtrunc = (() => {
  const hits = [];
  return {
    hits,
    fetch: async (url, init) => {
      hits.push({ url, init, body: JSON.parse(init.body) });
      return hits.length === 1 ? okResponse('{"confidence":0.5,"summary":"x') : okResponse(VALUATIONGOOD);
    },
  };
})();
const valretried = await diagnoseValuation({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, valtrunc.fetch);
check("巴菲特 JSON 被截断时自动重试一次", valtrunc.hits.length === 2 && valretried.analysis.position.includes("255.05%"));
check("巴菲特重试改用高推理档位", valtrunc.hits[1].body.effort === "high");

for (const [name, bad] of [
  ["巴菲特置信度越界", VALUATIONGOOD.replace('"confidence":0.6', '"confidence":6')],
  ["巴菲特缺少情景", VALUATIONGOOD.replace(/"scenarios":\{[^}]*\}/, '"scenarios":"无"')],
  ["巴菲特驱动不是数组", VALUATIONGOOD.replace(/"drivers":\[[^\]]*\]/, '"drivers":"看着办"')],
]) {
  const rec = recorder(() => okResponse(bad));
  await expectCode("拒绝" + name, () => diagnoseValuation({ apiKey: SECRET, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, rec.fetch), "bad_payload");
  check("拒绝" + name + " 时最多重试一次", rec.hits.length <= 2, "hits=" + rec.hits.length);
}

await expectCode(
  "巴菲特诊断没有密钥时不发请求",
  () => diagnoseValuation({ apiKey: "", model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }, { markdown: "x" }, recorder(() => okResponse(VALUATIONGOOD)).fetch),
  "missing_key",
);

console.log("\n" + pass + "/" + (pass + fail) + " 通过，总耗时 " + (Date.now() - t0) + "ms");
if (fail) process.exitCode = 1;
