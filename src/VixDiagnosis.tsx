import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LlmConfigDialog from "@/src/LlmConfigDialog";
import { EmptyState } from "@/src/ui-kit";
import { fmt } from "@/lib/api";
import { LlmError, clearConfig, diagnoseVix, loadConfig, maskKey, type DiagnoseResult, type LlmConfig } from "@/lib/deepseek";

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

/** VIX 面板内嵌的买卖诊断：结论针对权益仓位，不把 VIX 当作可直接交易的标的 */
export default function VixDiagnosis({ context, ready }: { context: string; ready: boolean }) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const markdown = context.trim();
  const canRun = ready && markdown.length > 0;

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [context]);

  function forget() {
    clearConfig();
    setCfg(null);
    setResult(null);
    setError(null);
  }

  async function run() {
    if (!cfg || !markdown) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await diagnoseVix(cfg, { markdown, focus }));
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
    <div className="mt-3 rounded-md border border-border/60 bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium">DeepSeek 买卖诊断</p>
        <span className="text-[11px] text-muted-foreground">
          依据上方 VIX 与所选标的的已实现波动率，输出权益仓位的五档观点；VIX 本身不可直接交易
        </span>
        {cfg ? (
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setOpen(true)}>
              修改模型
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={forget}>
              清除密钥
            </Button>
          </div>
        ) : (
          <Button size="sm" className="ml-auto h-7 px-2 text-[11px]" onClick={() => setOpen(true)}>
            添加模型
          </Button>
        )}
      </div>

      {cfg === null ? (
        <div className="mt-2">
          <EmptyState text="尚未添加模型。添加后即可把上方 VIX 与已实现波动率交给 DeepSeek 给出仓位观点。" />
        </div>
      ) : (
        <div className="mt-2 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[10px] text-[var(--d-rv21)]">
              {cfg.model}
            </Badge>
            <span className="tnum text-[11px] text-muted-foreground">密钥 {maskKey(cfg.apiKey)}</span>
            <span className="text-[11px] text-muted-foreground">· 上下文 {markdown.length.toLocaleString()} 字符</span>
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <Label className="text-[11px] text-muted-foreground">分析侧重（可选，留空用默认）</Label>
              <Textarea
                className="mt-1 min-h-14 text-xs"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                maxLength={400}
                placeholder="例如：我仓位偏重，想按波动率分位决定分批加仓的节奏，并在恐慌时保留多少现金。"
              />
            </div>
            <Button size="sm" className="h-8 text-[11px]" onClick={() => void run()} disabled={busy || !canRun}>
              {busy ? "模型推理中…" : !ready ? "等待本站指标" : "调用 DeepSeek 诊断"}
            </Button>
          </div>

          {error ? (
            <Alert className="border-[var(--d-red)]/35 bg-[var(--d-red)]/5">
              <AlertTitle>调用未成功</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
            </Alert>
          ) : null}

          {analysis && stance ? (
            <div className="space-y-2.5 rounded-md border border-border/60 bg-background/40 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-sm leading-none font-semibold tracking-tight">模型结论</p>
                <Badge variant="outline" className={`text-xs ${stance.ring} ${stance.text}`}>
                  {stance.label}（{analysis.stance}）
                </Badge>
                <span className={`tnum text-sm font-medium ${stance.text}`}>置信度 {(analysis.confidence * 100).toFixed(0)}%</span>
                <span className="tnum ml-auto text-[11px] text-muted-foreground">
                  {result?.model} · {result ? new Date(result.generatedAt).toLocaleString("zh-CN", { hour12: false }) : ""} · tokens{" "}
                  {fmt(result?.usage.promptTokens ?? null, 0)} 入 / {fmt(result?.usage.completionTokens ?? null, 0)} 出
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
                <p className="text-[11px] leading-relaxed text-muted-foreground">模型指出仍缺数据：{analysis.dataGaps.join("；")}</p>
              ) : null}
              <p className="text-[11px] text-muted-foreground">{result?.disclaimer}</p>
            </div>
          ) : null}
        </div>
      )}

      <LlmConfigDialog open={open} onOpenChange={setOpen} initial={cfg} onSaved={setCfg} />
    </div>
  );
}
