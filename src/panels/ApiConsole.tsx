import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, Panel } from "@/src/ui-kit";
import { BASE, query, requestJson, type DocsPayload } from "@/lib/api";

interface Probe {
  url: string;
  status: number;
  ms: number;
  bytes: number;
  body: string;
  error?: string;
}

const SNIPPETS: { title: string; lang: string; code: string }[] = [
  {
    title: "浏览器 / AI 前端",
    lang: "js",
    code: `const res = await fetch('/functions/v1/app/api/diagnosis?symbol=NDX100&years=5');
const data = await res.json();
console.log(data.composite.stance, data.regimeStudy);`,
  },
  {
    title: "命令行",
    lang: "bash",
    code: `curl -s "https://<你的站点域名>/functions/v1/app/api/ai-context?symbol=QQQ&years=10&format=markdown" \\
  | jq -r '.markdown'`,
  },
  {
    title: "Python（接入研究或 Agent）",
    lang: "python",
    code: `import requests

base = "https://<你的站点域名>/functions/v1/app"
signals = requests.get(f"{base}/api/signals", params={"symbol": "NDX100"}).json()
context = requests.get(f"{base}/api/ai-context", params={"symbol": "NDX100", "format": "json"}).json()["bundle"]
print(signals["composite"], context["indicators"]["volPercentile5y"])`,
  },
  {
    title: "大摩报告复盘（事件研究）",
    lang: "bash",
    code: `# 事件表（含来源链接）
curl -s "https://<你的站点域名>/functions/v1/app/api/events" | jq '.events[] | {date, stance, title}'

# 报告后 1/5/20/60/120 个交易日的表现与无条件基准
curl -s "https://<你的站点域名>/functions/v1/app/api/events/study?symbols=SSE,CSI300&horizons=20,60" \\
  | jq '.study[] | {label, outcomes: [.outcomes[] | {eventDate, anchorDate, forward}]}'`,
  },
  {
    title: "DeepSeek 辅助诊断（自带密钥直连）",
    lang: "bash",
    code: `# 1) 从本站取数据包：公开只读、免费
CTX=$(curl -s "https://<你的站点域名>/functions/v1/app/api/ai-context?symbol=NDX100&years=10&format=markdown" | jq -r '.markdown')

# 2) 用你自己的 DeepSeek 密钥直连官方接口，token 消耗记在你自己账上
jq -n --arg ctx "$CTX" '{
  model: "deepseek-flash", max_tokens: 1200, temperature: 0.2,
  messages: [
    { role: "system", content: "只输出 JSON：stance/confidence/summary/reasons/risks/scenarios/dataGaps" },
    { role: "user", content: "分析侧重：当前是否适合分批加仓\\n\\n" + $ctx }
  ]
}' | curl -s https://api.deepseek.com/chat/completions \\
      -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" -d @- \\
  | jq -r '.choices[0].message.content'`,
  },
];

export default function ApiConsole({ symbol, years, freq }: { symbol: string; years: number | null; freq: string }) {
  const [docs, setDocs] = useState<DocsPayload | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("/functions/v1/app/api/diagnosis");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    symbol,
    years: String(years ?? 10),
    freq,
    format: "json",
    refresh: "1",
    symbols: "SSE,CSI300",
    horizons: "1,5,20,60,120",
  });

  const kind = endpoint.endsWith("/api/events") ? "events" : endpoint.endsWith("/api/events/study") ? "study" : "common";
  // 在线试调用只开放只读 GET 接口；POST 分析接口需要服务端网关令牌，不放进浏览器。
  const browserEndpoints = (docs?.endpoints ?? []).filter((e) => e.method === "GET");

  useEffect(() => {
    requestJson<DocsPayload>(`${BASE}/docs`)
      .then(setDocs)
      .catch((e) => setDocsError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    setForm((f) => ({ ...f, symbol, freq, years: String(years ?? 10) }));
  }, [symbol, years, freq]);

  async function run() {
    const params: Record<string, string | number | null> =
      kind === "events"
        ? {}
        : kind === "study"
          ? { symbols: form.symbols.toUpperCase(), horizons: form.horizons, refresh: form.refresh }
          : {
              symbol: form.symbol,
              years: form.years === "all" ? null : Number(form.years),
              freq: form.freq,
              refresh: form.refresh,
            };
    if (endpoint.includes("ai-context")) params.format = form.format;
    const url = `${endpoint}${query(params)}`;
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* 保留原始文本 */
      }
      setProbe({
        url,
        status: res.status,
        ms: Math.round(performance.now() - t0),
        bytes: text.length,
        body: pretty.length > 30000 ? pretty.slice(0, 30000) + "\n…（已截断）" : pretty,
      });
    } catch (err) {
      setProbe({ url, status: 0, ms: Math.round(performance.now() - t0), bytes: 0, body: "", error: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Panel
        title="接口契约"
        description={
          docs
            ? `${docs.description} 鉴权：${docs.auth}`
            : docsError
              ? `文档接口读取失败：${docsError}`
              : "正在读取 /docs…"
        }
      >
        {docs === null ? (
          <EmptyState text={docsError ?? "加载中…"} />
        ) : (
          <div className="space-y-2">
            {docs.endpoints.map((e) => {
              const openToBrowser = e.method === "GET";
              return (
                <div key={e.path} className="rounded-md border border-border/60 bg-secondary/25 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        openToBrowser
                          ? "border-[var(--d-mint)]/40 bg-[var(--d-mint)]/10 text-[10px] text-[var(--d-mint)]"
                          : "border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10 text-[10px] text-[var(--d-vxn)]"
                      }
                    >
                      {e.method}
                    </Badge>
                    {openToBrowser ? (
                      <button
                        type="button"
                        className="tnum cursor-pointer text-xs text-foreground hover:text-[var(--d-rv21)] hover:underline"
                        onClick={() => setEndpoint(e.path)}
                      >
                        {e.path}
                      </button>
                    ) : (
                      <span className="tnum text-xs text-foreground/85">{e.path}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{e.purpose}</span>
                    {openToBrowser ? null : (
                      <span className="text-[11px] text-[var(--d-vxn)]">服务端专用，本页不可试调用</span>
                    )}
                  </div>
                  <p className="tnum mt-1 text-[11px] break-all text-muted-foreground/85">→ {e.returns}</p>
                  {e.params ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      额外参数：
                      {Object.entries(e.params)
                        .map(([k, v]) => ` ${k}=${v}`)
                        .join("；")}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="rounded-md border border-border/60 bg-secondary/20 p-3">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">公共参数</p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                {Object.entries(docs.commonParams).map(([k, v]) => (
                  <li key={k}>
                    <span className="tnum text-foreground/85">{k}</span> · {v}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">口径与局限</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                {docs.data_quality_notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="模型接入方式" description="本站不代持任何大模型密钥，也不提供模型转发接口。">
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            诊断流程只有两步：用<span className="tnum text-foreground/85"> /api/ai-context </span>
            取一份带数据截至日期的公开数据包，再带着你自己的 DeepSeek 官方 API Key 调用
            <span className="tnum text-foreground/85"> https://api.deepseek.com/chat/completions</span>，token 消耗记在你的 DeepSeek 账户上。
          </li>
          <li>「买卖诊断」页内置了这套流程：在浏览器里填一次密钥（只存本机），点一下即可出结论，不需要任何服务端配置。</li>
          <li>服务端接口全部只读（GET / HEAD），不接收写操作，因此任何人都无法通过本站消耗别人的额度。</li>
        </ul>
      </Panel>

      <Panel title="在线试调用" description="直接请求当前站点的 Function，返回真实 JSON。只列出可公开的只读 GET 接口，选中上方任一接口即可切换目标。">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Label className="text-[11px] text-muted-foreground">endpoint</Label>
            <NativeSelect value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="mt-1">
              {(browserEndpoints.length ? browserEndpoints : [{ path: endpoint }]).map((e) => (
                <NativeSelectOption key={e.path} value={e.path}>
                  {e.path.replace("/functions/v1/app", "")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {kind === "study" ? (
            <>
              <div>
                <Label className="text-[11px] text-muted-foreground">symbols</Label>
                <Input
                  className="mt-1"
                  value={form.symbols}
                  onChange={(e) => setForm({ ...form, symbols: e.target.value.toUpperCase() })}
                  placeholder="SSE,CSI300"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">horizons</Label>
                <Input className="mt-1" value={form.horizons} onChange={(e) => setForm({ ...form, horizons: e.target.value })} placeholder="1,5,20,60,120" />
              </div>
            </>
          ) : null}
          {kind === "common" ? (
            <>
              <div>
                <Label className="text-[11px] text-muted-foreground">symbol</Label>
                <Input className="mt-1" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">years</Label>
                <NativeSelect className="mt-1" value={form.years} onChange={(e) => setForm({ ...form, years: e.target.value })}>
                  {["1", "3", "5", "10", "20", "all"].map((v) => (
                    <NativeSelectOption key={v} value={v}>
                      {v}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </>
          ) : null}
          {kind === "events" ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="mt-4 text-[11px] leading-snug text-muted-foreground">该接口无需参数，直接返回全部已收录的大摩 A 股报告事件与来源。</p>
            </div>
          ) : (
            <div>
              <Label className="text-[11px] text-muted-foreground">refresh</Label>
              <NativeSelect className="mt-1" value={form.refresh} onChange={(e) => setForm({ ...form, refresh: e.target.value })}>
                <NativeSelectOption value="1">1 · 尝试实时上游</NativeSelectOption>
                <NativeSelectOption value="0">0 · 仅快照</NativeSelectOption>
              </NativeSelect>
            </div>
          )}
          <div className="flex items-end">
            <Button onClick={run} disabled={busy} className="w-full">
              {busy ? "请求中…" : "发送请求"}
            </Button>
          </div>
        </div>

        {probe ? (
          <div className="mt-3">
            <div className="tnum flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className={probe.status >= 200 && probe.status < 300 ? "text-[var(--d-mint)]" : "text-[var(--d-red)]"}>
                HTTP {probe.status || "ERR"}
              </span>
              <span>{probe.ms} ms</span>
              <span>{probe.bytes.toLocaleString()} 字节</span>
              <span className="break-all">{probe.url}</span>
            </div>
            <ScrollArea className="mt-2 h-72 rounded-md border border-border/60 bg-secondary/25">
              <pre className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                {probe.error ? `请求失败：${probe.error}` : probe.body}
              </pre>
            </ScrollArea>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">尚未发起请求。</p>
        )}
      </Panel>

      <Panel title="接入示例" description="把接口交给自己的脚本、notebook 或 Agent 工具。域名换成站点正式地址即可。">
        <div className="grid gap-2.5 lg:grid-cols-3">
          {SNIPPETS.map((s) => (
            <div key={s.title} className="min-w-0 overflow-hidden rounded-md border border-border/60 bg-secondary/25 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">{s.title}</p>
                <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
                  {s.lang}
                </Badge>
              </div>
              <ScrollArea className="mt-2 h-40">
                <pre className="tnum text-[10.5px] leading-relaxed whitespace-pre text-foreground/80">{s.code}</pre>
              </ScrollArea>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const origin = window.location.origin.startsWith("http") ? window.location.origin : "";
                    void navigator.clipboard.writeText(s.code.replace("<你的站点域名>", origin.replace(/^https?:\/\//, "")));
                  }}
                >
                  复制
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
