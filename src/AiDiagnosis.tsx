import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LlmConfigDialog from "@/src/LlmConfigDialog";
import { EmptyState, Panel } from "@/src/ui-kit";
import { fmt, type AiContextPayload } from "@/lib/api";
import { LlmError, clearConfig, diagnose, loadConfig, maskKey, type DiagnoseResult, type LlmConfig } from "@/lib/deepseek";

const stanceText: Record<string, { label: string; ring: string; text: string; bar: string }> = {
  buy: { label: "分批买入", ring: "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10", text: "text-[var(--d-mint)]", bar: "bg-[var(--d-mint)]" },
  add: { label: "倾向加仓", ring: "border-[var(--d-rv21)]/45 bg-[var(--d-rv21)]/10", text: "text-[var(--d-rv21)]", bar: "bg-[var(--d-rv21)]" },
  hold: { label: "持有观望", ring: "border-border bg-secondary/60", text: "text-foreground", bar: "bg-foreground/60" },
  trim: { label: "倾向减仓", ring: "border-[var(--d-vxn)]/45 bg-[var(--d-vxn)]/10", text: "text-[var(--d-vxn)]", bar: "bg-[var(--d-vxn)]" },
  reduce: { label: "显著减仓", ring: "border-[var(--d-red)]/45 bg-[var(--d-red)]/10", text: "text-[var(--d-red)]", bar: "bg-[var(--d-red)]" },
};

function message(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "请求超时，未自动重试。";
    return err.message;
  }
  return String(err);
}

export default function AiDiagnosis({ ai, symbolLabel }: { ai: AiContextPayload | null; symbolLabel: string }) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [symbolLabel]);

  function forget() {
    clearConfig();
    setCfg(null);
    setResult(null);
    setError(null);
  }

  async function run() {
    if (!cfg || !ai?.markdown) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await diagnose(cfg, { markdown: ai.markdown, focus }));
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
      title="DeepSeek 辅助诊断"
      description="和「添加模型」一样的用法：填你自己的 DeepSeek 官方 API Key，浏览器直接调用官方接口，消耗你账户里的 token。密钥只存在这台设备的浏览器里，站点服务端不代持、也不转发。"
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
        <EmptyState text="尚未添加模型。添加后即可把上方的数据包交给 DeepSeek 做买卖诊断。" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[10px] text-[var(--d-rv21)]">
              {cfg.model}
            </Badge>
            <span className="tnum text-[11px] text-muted-foreground">密钥 {maskKey(cfg.apiKey)}</span>
            <span className="tnum text-[11px] text-muted-foreground">· {cfg.baseUrl}</span>
            <span className="text-[11px] text-muted-foreground">· 上下文 {ai?.markdown.length ? ai.markdown.length.toLocaleString() : "—"} 字符</span>
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <Label className="text-[11px] text-muted-foreground">分析侧重（可选，留空用默认）</Label>
              <Textarea
                className="mt-1 min-h-16 text-xs"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                maxLength={400}
                placeholder="例如：我仓位偏重，更关心要不要在波动率低位前先把风险敞口降下来。"
              />
            </div>
            <Button onClick={run} disabled={busy || !ai?.markdown}>
              {busy ? "模型推理中…" : "调用 DeepSeek 诊断"}
            </Button>
          </div>
          {ai === null ? <p className="text-[11px] text-muted-foreground">尚未取到数据包，请先在上方完成一次计算。</p> : null}

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
              <div className="grid gap-2.5 md:grid-cols-2">
                <div className="rounded-md border border-[var(--d-rv21)]/25 bg-[var(--d-rv21)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-rv21)]">若波动率上行</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.scenarios.volUp}</p>
                </div>
                <div className="rounded-md border border-[var(--d-mint)]/25 bg-[var(--d-mint)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-mint)]">若波动率回落</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.scenarios.volDown}</p>
                </div>
              </div>
              {analysis.dataGaps.length ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  模型指出仍缺数据：{analysis.dataGaps.join("；")}
                </p>
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
