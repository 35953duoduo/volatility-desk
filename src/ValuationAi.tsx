import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LlmConfigDialog from "@/src/LlmConfigDialog";
import { EmptyState, Panel } from "@/src/ui-kit";
import { ApiError, BASE, fmt, query, requestJson, type ValuationAiContextPayload, type ValuationPayload } from "@/lib/api";
import { clearConfig, diagnoseValuation, LlmError, loadConfig, maskKey, type LlmConfig, type ValuationDiagnoseResult } from "@/lib/deepseek";

function message(err: unknown): string {
  if (err instanceof ApiError || err instanceof LlmError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "请求超时，未自动重试。";
    return err.message;
  }
  return String(err);
}

/**
 * 巴菲特指数的 DeepSeek 解读：浏览器取本站数据包 → 浏览器直连 DeepSeek 官方接口。
 * 密钥只存本机，与其它诊断共用配置；站点不代持、不转发。
 */
export default function ValuationAi({
  payload,
  liveRefresh,
  years,
}: {
  payload: ValuationPayload | null;
  liveRefresh: boolean;
  years: number | null;
}) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValuationDiagnoseResult | null>(null);
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
      const ctx = await requestJson<ValuationAiContextPayload>(
        `${BASE}/api/valuation/ai-context${query({ years: years ?? "all", format: "markdown", refresh: liveRefresh ? 1 : 0 })}`,
      );
      const markdown = ctx.markdown;
      if (!markdown) throw new ApiError("巴菲特指数数据包为空，请稍后重试。", 0, "bad_payload");
      setContextChars(markdown.length);
      setResult(await diagnoseValuation(cfg, { markdown, focus }));
    } catch (err) {
      setResult(null);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const analysis = result?.analysis ?? null;

  return (
    <Panel
      title="DeepSeek 估值解读"
      description="把本站 Z.1 口径市值/GDP、历史分位、分布统计与标普500对照交给 DeepSeek，让它解释当前历史位置、口径陷阱、情景与失效条件。模型必须说明 Z.1 与 Wilshire 的差异，不得套用 100%/120% 经验阈值，也不给买卖点位；站点不代持、不转发密钥。"
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
        <EmptyState text="尚未添加模型。添加后即可把本站巴菲特指数数据包交给 DeepSeek 做口径与历史位置解读。" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[10px] text-[var(--d-rv21)]">
              {cfg.model}
            </Badge>
            <span className="tnum text-[11px] text-muted-foreground">密钥 {maskKey(cfg.apiKey)}</span>
            <span className="tnum text-[11px] text-muted-foreground">· {cfg.baseUrl}</span>
            <span className="text-[11px] text-muted-foreground">· 点击诊断时实时生成{years === null ? "全部" : ` ${years} 年`}窗口的数据包</span>
            {contextChars !== null ? <span className="tnum text-[11px] text-muted-foreground">· 上次上下文 {contextChars.toLocaleString()} 字符</span> : null}
            {payload ? (
              <span className="tnum ml-auto text-[11px] text-muted-foreground">
                本站读数：{fmt(payload.latest.ratio, 1)}%（{payload.latest.quarter}）· 全历史分位 {fmt(payload.latest.percentileAll, 1)}%
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
                placeholder="例如：我更关心高利率环境下这个比值为何还能创新高，以及它和标普500走势背离意味着什么。"
              />
            </div>
            <Button onClick={run} disabled={busy || !payload}>
              {busy ? "模型推理中…" : payload ? "调用 DeepSeek 解读估值" : "等待数据加载"}
            </Button>
          </div>

          {error ? (
            <Alert className="border-[var(--d-red)]/35 bg-[var(--d-red)]/5">
              <AlertTitle>调用未成功</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
            </Alert>
          ) : null}

          {analysis ? (
            <div className="space-y-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-base leading-none font-semibold tracking-tight">模型结论</p>
                <span className="tnum text-sm font-medium text-[var(--d-rv21)]">置信度 {(analysis.confidence * 100).toFixed(0)}%</span>
                <span className="tnum ml-auto text-[11px] text-muted-foreground">
                  {result?.model} · {result ? new Date(result.generatedAt).toLocaleString("zh-CN", { hour12: false }) : ""} · tokens{" "}
                  {fmt(result?.usage.promptTokens ?? null, 0)} 入 / {fmt(result?.usage.completionTokens ?? null, 0)} 出 / 共{" "}
                  {fmt(result?.usage.totalTokens ?? null, 0)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-[var(--d-rv21)]" style={{ width: `${Math.round(analysis.confidence * 100)}%` }} />
              </div>
              <p className="text-xs leading-relaxed text-foreground/90">{analysis.summary}</p>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">估值位置</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.position}</p>
                </div>
                <div className="rounded-md border border-[var(--d-vxn)]/25 bg-[var(--d-vxn)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-vxn)]">口径提醒</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.caliber}</p>
                </div>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">驱动因素</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.drivers.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">与标普500的关系</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.spxRelation}</p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">情景分析</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {[
                    { key: "expansion", label: "扩张延续", text: analysis.scenarios.expansion },
                    { key: "meanReversion", label: "均值回归", text: analysis.scenarios.meanReversion },
                    { key: "plateau", label: "高位平台", text: analysis.scenarios.plateau },
                  ].map((s) => (
                    <div key={s.key} className="rounded-md border border-border/60 bg-background/40 p-2.5">
                      <p className="text-[10px] font-medium text-muted-foreground">{s.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{s.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">观察清单</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.watch.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">结论边界</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.boundary}</p>
                  {analysis.dataGaps.length ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">模型指出仍缺数据：{analysis.dataGaps.join("；")}</p>
                  ) : null}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{result?.disclaimer}</p>
            </div>
          ) : null}
        </div>
      )}

      <LlmConfigDialog open={open} onOpenChange={setOpen} initial={cfg} onSaved={setCfg} />
    </Panel>
  );
}
