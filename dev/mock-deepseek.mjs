// 本地 mock 的 DeepSeek 兼容接口，只用于离线验证「AI 辅助诊断」的前端渲染与错误处理。
// 运行：node dev/mock-deepseek.mjs  （默认 127.0.0.1:8123）
// 在站点的「添加模型 → 接口地址」里填 http://127.0.0.1:8123 即可，不会触达真实付费接口。
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8123);

const ANALYSIS = {
  stance: "add",
  confidence: 0.58,
  summary:
    "已实现波动率处于自身中位（RV21 18.74%，5 年分位 48.9%），指数仍在 200 日线上方但跌破 50 日线，属于「趋势未破、波动未定价风险」的状态：可以分批建仓，但要把加仓节奏与波动率上破 22 的止损条件写死。",
  reasons: [
    "RV21 18.74% 与 RV63 18.92% 接近，波动率期限结构平坦，没有恐慌溢价",
    "波动率 5 年分位 48.9%，既不是恐慌底也非自满顶，历史胜率优势有限",
    "Z 分数 -0.12 说明当前波动率与自身均值一致，均值回归信号缺席",
    "价格位于 200 日线上方且 63 日动量 +5.44%，趋势过滤器仍偏多",
  ],
  risks: [
    "VXN 隐含波动率上游不可达，保险成本与市场预期无法交叉验证，置信度因此下调",
    "价格已跌破 50 日线，短周期趋势与长周期趋势不一致，加仓容易被中途回撤打断",
    "样本仅 395 个周线点，历史分位表现不构成对未来收益的预测",
  ],
  scenarios: {
    volUp: "若 RV21 上破 22 且分位越过 70%，先把新增仓位停在原计划的一半，保留现金等待恐慌尖峰。",
    volDown: "若 RV21 回落到 15 以下且价格重新站上 50 日线，可按原节奏继续分批，并把止损放到 200 日线下方。",
  },
  dataGaps: ["隐含波动率序列（VXN）", "估值与盈利增速", "利率与美元流动性"],
};

const server = createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (req.url !== "/chat/completions") {
      res.writeHead(404, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      return;
    }
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      res.writeHead(401, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ error: { message: "missing key" } }));
      return;
    }
    const body = JSON.parse(raw || "{}");
    const content = body.messages?.[1]?.content?.includes("只回复两个字") ? "正常" : JSON.stringify(ANALYSIS);
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "deepseek-mock",
        choices: [{ message: { role: "assistant", content } }],
        usage: { prompt_tokens: 1512, completion_tokens: 486, total_tokens: 1998 },
      }),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => console.log("mock deepseek: http://127.0.0.1:" + PORT + "/chat/completions"));
