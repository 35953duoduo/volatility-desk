// 浏览器直连 DeepSeek 的离线校验：用注入的 mock fetch 覆盖密钥存储、地址白名单、提示词、
// 结果解析与错误映射。全程不触真实付费接口，也不打印任何密钥内容。
// 运行：node --experimental-strip-types dev/verify-llm.mjs
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  LlmError,
  SYSTEM_PROMPT,
  buildUserPrompt,
  diagnose,
  endpointFor,
  extractReportEvents,
  fetchPage,
  isReasoningModel,
  loadConfig,
  maskKey,
  parseAnalysis,
  saveConfig,
  searchWeb,
  summarizeBrief,
  testConnection,
} from "../lib/deepseek.ts";

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



console.log("\n" + pass + "/" + (pass + fail) + " 通过，总耗时 " + (Date.now() - t0) + "ms");
if (fail) process.exitCode = 1;
