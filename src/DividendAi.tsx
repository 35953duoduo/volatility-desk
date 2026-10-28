import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LlmConfigDialog from "@/src/LlmConfigDialog";
import { EmptyState, Panel } from "@/src/ui-kit";
import { ApiError, BASE, fmt, query, requestJson, type DividendAiContextPayload } from "@/lib/api";
import {
  clearConfig,
  diagnoseDividend,
  LlmError,
  loadConfig,
  maskKey,
  type DividendDiagnoseResult,
  type DividendStanceAi,
  type LlmConfig,
} from "@/lib/deepseek";

const stanceText: Record<DividendStanceAi, { label: string; ring: string; text: string; bar: string }> = {
  accumulate: {
    label: "分批低吸",
    ring: "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10",
    text: "text-[var(--d-mint)]",
    bar: "bg-[var(--d-mint)]",
  },
  add: { label: "小仓低吸", ring: "border-[var(--d-rv21)]/45 bg-[var(--d-rv21)]/10", text: "text-[var(--d-rv21)]", bar: "bg-[var(--d-rv21)]" },
  hold: { label: "持有收息", ring: "border-border bg-secondary/60", text: "text-foreground", bar: "bg-foreground/60" },
  trim: { label: "分批高抛", ring: "border-[var(--d-vxn)]/45 bg-[var(--d-vxn)]/10", text: "text-[var(--d-vxn)]", bar: "bg-[var(--d-vxn)]" },
  reduce: { label: "显著高抛", ring: "border-[var(--d-red)]/45 bg-[var(--d-red)]/10", text: "text-[var(--d-red)]", bar: "bg-[var(--d-red)]" },
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
 * 红利策略的 DeepSeek 辅助诊断：浏览器取本站数据包 → 浏览器直连 DeepSeek 官方接口。
 * 密钥只存本机，与「买卖诊断」共用同一份配置；站点服务端不代持、不转发。
 */
export default function DividendAi({ code, name, liveRefresh }: { code: string; name: string; liveRefresh: boolean }) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DividendDiagnoseResult | null>(null);
  const [contextChars, setContextChars] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setContextChars(null);
  }, [code]);

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
      const ctx = await requestJson<DividendAiContextPayload>(
        `${BASE}/api/dividend/ai-context${query({ code, format: "markdown", refresh: liveRefresh ? 1 : 0 })}`,
      );
      const markdown = ctx.markdown;
      if (!markdown) throw new ApiError("红利数据包为空，请稍后重试。", 0, "bad_payload");
      setContextChars(markdown.length);
      setResult(await diagnoseDividend(cfg, { markdown, focus }));
    } catch (err) {
      setResult(null);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const analysis = result?.analysis ?? null;
  const stance = analysis ? stanceText[analysis.stance] ?? stanceText.hold : null;

  return (
    <Panel
      title="DeepSeek 红利诊断"
      description="把当前标的的红利数据包（股息率、分位、周线 RSI、分红记录与口径）交给 DeepSeek，让它只针对卫星仓给出分批计划，并把底仓长期收息作为默认框架。与「买卖诊断」共用本机密钥，站点不代持、不转发。"
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
        <EmptyState text="尚未添加模型。添加后即可把本站红利数据包交给 DeepSeek 做底仓与卫星仓的辅助判断。" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[10px] text-[var(--d-rv21)]">
              {cfg.model}
            </Badge>
            <span className="tnum text-[11px] text-muted-foreground">密钥 {maskKey(cfg.apiKey)}</span>
            <span className="tnum text-[11px] text-muted-foreground">· {cfg.baseUrl}</span>
            <span className="text-[11px] text-muted-foreground">· {name} 的数据包在点击诊断时实时生成</span>
            {contextChars !== null ? <span className="tnum text-[11px] text-muted-foreground">· 上次上下文 {contextChars.toLocaleString()} 字符</span> : null}
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <Label className="text-[11px] text-muted-foreground">分析侧重（可选，留空用默认）</Label>
              <Textarea
                className="mt-1 min-h-16 text-xs"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                maxLength={400}
                placeholder="例如：我已持有底仓多年，更关心股息是否可持续、卫星仓在什么价位分批高抛。"
              />
            </div>
            <Button onClick={run} disabled={busy}>
              {busy ? "模型推理中…" : "调用 DeepSeek 诊断"}
            </Button>
          </div>

          {error ? (
            <Alert className="border-[var(--d-red)]/35 bg-[var(--d-red)]/5">
              <AlertTitle>调用未成功</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
            </Alert>
          ) : null}

          {analysis && stance ? (
            <div className="space-y-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-base leading-none font-semibold tracking-tight">模型结论</p>
                <Badge variant="outline" className={`text-xs ${stance.ring} ${stance.text}`}>
                  {stance.label}（{analysis.stance}）
                </Badge>
                <span className={`tnum text-sm font-medium ${stance.text}`}>置信度 {(analysis.confidence * 100).toFixed(0)}%</span>
                <span className="text-[10px] text-muted-foreground">仅针对卫星仓</span>
                <span className="tnum ml-auto text-[11px] text-muted-foreground">
                  {result?.model} · {result ? new Date(result.generatedAt).toLocaleString("zh-CN", { hour12: false }) : ""} · tokens{" "}
                  {fmt(result?.usage.promptTokens ?? null, 0)} 入 / {fmt(result?.usage.completionTokens ?? null, 0)} 出 / 共{" "}
                  {fmt(result?.usage.totalTokens ?? null, 0)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className={`h-full ${stance.bar}`} style={{ width: `${Math.round(analysis.confidence * 100)}%` }} />
              </div>
              <p className="text-xs leading-relaxed text-foreground/90">{analysis.summary}</p>

              <div className="grid gap-2.5 md:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">底仓（长期收息）</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.basePosition}</p>
                </div>
                <div className="rounded-md border border-[var(--d-rv21)]/25 bg-[var(--d-rv21)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-rv21)]">卫星仓计划</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.satellitePlan}</p>
                </div>
              </div>

              {analysis.tranches.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-border/70 text-muted-foreground">
                        <th className="px-2 py-1.5 text-left font-medium">档位</th>
                        <th className="px-2 py-1.5 text-left font-medium">触发条件</th>
                        <th className="px-2 py-1.5 text-left font-medium">动作</th>
                        <th className="px-2 py-1.5 text-right font-medium">比例</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.tranches.map((t, i) => (
                        <tr key={`${t.trigger}-${i}`} className="border-b border-border/50 last:border-0">
                          <td className="tnum px-2 py-1.5">{i + 1}</td>
                          <td className="px-2 py-1.5">{t.trigger}</td>
                          <td className="px-2 py-1.5">{t.action}</td>
                          <td className="tnum px-2 py-1.5 text-right">{t.ratio}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="grid gap-2.5 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">依据</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">风险</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="rounded-md border border-[var(--d-mint)]/25 bg-[var(--d-mint)]/5 p-2.5">
                <p className="text-[11px] font-medium text-[var(--d-mint)]">股息视角</p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.dividendView}</p>
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
