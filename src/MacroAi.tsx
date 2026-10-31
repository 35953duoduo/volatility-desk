import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LlmConfigDialog from "@/src/LlmConfigDialog";
import { EmptyState, Panel } from "@/src/ui-kit";
import { ApiError, BASE, fmt, query, requestJson, type MacroAiContextPayload, type MacroPayload } from "@/lib/api";
import {
  clearConfig,
  diagnoseMacro,
  LlmError,
  loadConfig,
  maskKey,
  type LlmConfig,
  type MacroDiagnoseResult,
  type MacroRiskAi,
} from "@/lib/deepseek";

const riskTone: Record<MacroRiskAi, { label: string; ring: string; text: string; bar: string }> = {
  low: { label: "低风险", ring: "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10", text: "text-[var(--d-mint)]", bar: "bg-[var(--d-mint)]" },
  medium: { label: "中等风险", ring: "border-[var(--d-vxn)]/45 bg-[var(--d-vxn)]/10", text: "text-[var(--d-vxn)]", bar: "bg-[var(--d-vxn)]" },
  high: { label: "高风险", ring: "border-[var(--d-red)]/45 bg-[var(--d-red)]/10", text: "text-[var(--d-red)]", bar: "bg-[var(--d-red)]" },
};

function message(err: unknown): string {
  if (err instanceof ApiError || err instanceof LlmError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "请求超时，未自动重试。";
    return err.message;
  }
  return String(err);
}

/**
 * 跨资产板块的 DeepSeek 风险分析：浏览器取本站数据包 → 浏览器直连 DeepSeek 官方接口。
 * 密钥只存本机，与买卖诊断、红利诊断共用同一份配置；站点服务端不代持、不转发。
 */
export default function MacroAi({
  payload,
  liveRefresh,
  years,
}: {
  payload: MacroPayload | null;
  liveRefresh: boolean;
  years: number;
}) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MacroDiagnoseResult | null>(null);
  const [contextChars, setContextChars] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setContextChars(null);
  }, [years]);

  function forget() {
    clearConfig();
    setCfg(null);
    setResult(null);
    setError(null);
  }

  async function run() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      const ctx = await requestJson<MacroAiContextPayload>(
        `${BASE}/api/macro/ai-context${query({ years, format: "markdown", refresh: liveRefresh ? 1 : 0 })}`,
      );
      const markdown = ctx.markdown;
      if (!markdown) throw new ApiError("跨资产数据包为空，请稍后重试。", 0, "bad_payload");
      setContextChars(markdown.length);
      setResult(await diagnoseMacro(cfg, { markdown, focus }));
    } catch (err) {
      setResult(null);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const analysis = result?.analysis ?? null;
  const tone = analysis ? riskTone[analysis.riskLevel] ?? riskTone.medium : null;
  const heuristic = payload?.risk ?? null;

  return (
    <Panel
      title="DeepSeek 跨资产风险分析"
      description="把本站黄金 / 原油 / 美债的真实数据包（区间收益、波动、回撤、相关矩阵、10Y 收益率与启发式压力评分）交给 DeepSeek，让它解释利率与通胀的传导链条、情景与失效条件。只做风险解释，不给买卖点位或仓位建议；站点不代持、不转发密钥。"
      action={
        cfg ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              修改模型
            </Button>
            <Button size="sm" variant="ghost" onClick={forget}>
              清除密钥
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setOpen(true)}>
            添加模型
          </Button>
        )
      }
    >
      {cfg === null ? (
        <EmptyState text="尚未添加模型。添加后即可把本站跨资产数据包交给 DeepSeek 做风险与传导分析。" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[10px] text-[var(--d-rv21)]">
              {cfg.model}
            </Badge>
            <span className="tnum text-[11px] text-muted-foreground">密钥 {maskKey(cfg.apiKey)}</span>
            <span className="tnum text-[11px] text-muted-foreground">· {cfg.baseUrl}</span>
            <span className="text-[11px] text-muted-foreground">· 点击诊断时实时生成 {years} 年窗口的数据包</span>
            {contextChars !== null ? <span className="tnum text-[11px] text-muted-foreground">· 上次上下文 {contextChars.toLocaleString()} 字符</span> : null}
            {heuristic ? (
              <span className="tnum ml-auto text-[11px] text-muted-foreground">
                本站启发式：{heuristic.score}/100（{heuristic.levelLabel}）· {heuristic.regimeLabel}
              </span>
            ) : null}
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <Label className="text-[11px] text-muted-foreground">分析侧重（可选，留空用默认）</Label>
              <Textarea
                className="mt-1 min-h-16 text-xs"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                maxLength={400}
                placeholder="例如：我更关心 10Y 收益率上行对长久期美债的冲击，以及黄金和原油的再通胀交易是否已经过热。"
              />
            </div>
            <Button onClick={run} disabled={busy || !payload}>
              {busy ? "模型推理中…" : payload ? "调用 DeepSeek 分析风险" : "等待数据加载"}
            </Button>
          </div>

          {error ? (
            <Alert className="border-[var(--d-red)]/35 bg-[var(--d-red)]/5">
              <AlertTitle>调用未成功</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
            </Alert>
          ) : null}

          {analysis && tone ? (
            <div className="space-y-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-base leading-none font-semibold tracking-tight">模型结论</p>
                <Badge variant="outline" className={`text-xs ${tone.ring} ${tone.text}`}>
                  {tone.label}（{analysis.riskLevel}）
                </Badge>
                <span className={`tnum text-sm font-medium ${tone.text}`}>置信度 {(analysis.confidence * 100).toFixed(0)}%</span>
                <span className="tnum ml-auto text-[11px] text-muted-foreground">
                  {result?.model} · {result ? new Date(result.generatedAt).toLocaleString("zh-CN", { hour12: false }) : ""} · tokens{" "}
                  {fmt(result?.usage.promptTokens ?? null, 0)} 入 / {fmt(result?.usage.completionTokens ?? null, 0)} 出 / 共{" "}
                  {fmt(result?.usage.totalTokens ?? null, 0)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className={`h-full ${tone.bar}`} style={{ width: `${Math.round(analysis.confidence * 100)}%` }} />
              </div>
              <p className="text-xs leading-relaxed text-foreground/90">{analysis.summary}</p>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">驱动因素</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.drivers.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">观察清单</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.watch.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">利率传导</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.transmission}</p>
                </div>
                <div className="rounded-md border border-[var(--d-price)]/25 bg-[var(--d-price)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-price)]">相关性解读</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.crossAsset}</p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">情景分析</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { key: "tightening", label: "利率冲击", text: analysis.scenarios.tightening },
                    { key: "reflation", label: "再通胀", text: analysis.scenarios.reflation },
                    { key: "riskoff", label: "避险", text: analysis.scenarios.riskoff },
                    { key: "easing", label: "宽松交易", text: analysis.scenarios.easing },
                  ].map((s) => (
                    <div key={s.key} className="rounded-md border border-border/60 bg-background/40 p-2.5">
                      <p className="text-[10px] font-medium text-muted-foreground">{s.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{s.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-[var(--d-mint)]/25 bg-[var(--d-mint)]/5 p-2.5">
                <p className="text-[11px] font-medium text-[var(--d-mint)]">结论边界</p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.boundary}</p>
              </div>

              {analysis.dataGaps.length ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">模型指出仍缺数据：{analysis.dataGaps.join("；")}</p>
              ) : null}
              <p className="text-[11px] text-muted-foreground">{result?.disclaimer}</p>
            </div>
          ) : null}
        </div>
      )}

      <LlmConfigDialog open={open} onOpenChange={setOpen} initial={cfg} onSaved={setCfg} />
    </Panel>
  );
}
