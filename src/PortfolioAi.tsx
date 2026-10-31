import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import LlmConfigDialog from "@/src/LlmConfigDialog";
import { EmptyState } from "@/src/ui-kit";
import { fmt } from "@/lib/api";
import { buildPortfolioContext, type Holding, type PortfolioMarket } from "@/lib/portfolio";
import {
  clearConfig,
  diagnosePortfolio,
  LlmError,
  loadConfig,
  maskKey,
  type LlmConfig,
  type PortfolioActionKind,
  type PortfolioDiagnoseResult,
  type PortfolioRiskLevel,
} from "@/lib/deepseek";

const riskText: Record<PortfolioRiskLevel, { label: string; ring: string; text: string; bar: string }> = {
  low: { label: "低风险", ring: "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10", text: "text-[var(--d-mint)]", bar: "bg-[var(--d-mint)]" },
  medium: { label: "中等风险", ring: "border-[var(--d-vxn)]/45 bg-[var(--d-vxn)]/10", text: "text-[var(--d-vxn)]", bar: "bg-[var(--d-vxn)]" },
  high: { label: "高风险", ring: "border-[var(--d-red)]/45 bg-[var(--d-red)]/10", text: "text-[var(--d-red)]", bar: "bg-[var(--d-red)]" },
};

const actionTone: Record<PortfolioActionKind, string> = {
  加仓: "text-[var(--d-mint)] border-[var(--d-mint)]/40 bg-[var(--d-mint)]/10",
  减仓: "text-[var(--d-vxn)] border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10",
  持有: "text-foreground border-border bg-secondary/60",
  观望: "text-muted-foreground border-border bg-secondary/40",
  对冲: "text-[var(--d-rv21)] border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10",
};

function message(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return "请求超时，未自动重试。";
    return err.message;
  }
  return String(err);
}

/**
 * 资产配置的组合诊断：台账与市场指标在本机构成数据包，浏览器直连 DeepSeek 官方接口。
 * 结论只谈结构、再平衡与风控纪律，不预测收益、不推荐具体基金或个股。
 */
export default function PortfolioAi({
  holdings,
  market,
  dryPowder,
}: {
  holdings: Holding[];
  market: PortfolioMarket | null;
  dryPowder: number;
}) {
  const [cfg, setCfg] = useState<LlmConfig | null>(() => loadConfig());
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PortfolioDiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const markdown = useMemo(() => buildPortfolioContext(holdings, market, dryPowder), [holdings, market, dryPowder]);
  const hasHoldings = holdings.length > 0;

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [markdown]);

  function forget() {
    clearConfig();
    setCfg(null);
    setResult(null);
    setError(null);
  }

  async function run() {
    if (!cfg || !hasHoldings) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await diagnosePortfolio(cfg, { markdown, focus }));
    } catch (err) {
      setResult(null);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const analysis = result?.analysis ?? null;
  const risk = analysis ? riskText[analysis.riskLevel] ?? riskText.medium : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {cfg ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setOpen(true)}>
              修改模型
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={forget}>
              清除密钥
            </Button>
          </div>
        ) : (
          <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => setOpen(true)}>
            添加模型
          </Button>
        )}
      </div>

      {cfg === null ? (
        <div className="mt-2">
          <EmptyState text="尚未添加模型。添加后即可把本机台账（含手续费、基金代码与可投入现金）交给 DeepSeek 做结构与风控诊断；密钥只存这台设备的浏览器。" />
        </div>
      ) : (
        <div className="mt-2 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[10px] text-[var(--d-rv21)]">
              {cfg.model}
            </Badge>
            <span className="tnum text-[11px] text-muted-foreground">密钥 {maskKey(cfg.apiKey)}</span>
            <span className="text-[11px] text-muted-foreground">· 上下文 {markdown.length.toLocaleString()} 字符</span>
            <span className="text-[11px] text-muted-foreground">
              · 可投入现金 {dryPowder > 0 ? `¥${dryPowder.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "未填写"}
            </span>
            <span className="text-[11px] text-muted-foreground">· 台账变化会自动作废旧结论</span>
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <Label className="text-[11px] text-muted-foreground">分析侧重（可选，留空用默认）</Label>
              <Textarea
                className="mt-1 min-h-14 text-xs"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                maxLength={400}
                placeholder="例如：我 3 年内不动用这笔钱，更关心回撤控制；018036 这只基金要不要补仓，剩下的现金优先补给谁，不想一次性调仓。"
              />
            </div>
            <Button size="sm" className="h-8 text-[11px]" onClick={() => void run()} disabled={busy || !hasHoldings}>
              {busy ? "模型推理中…" : hasHoldings ? "调用 DeepSeek 诊断" : "先添加持仓"}
            </Button>
          </div>

          {error ? (
            <Alert className="border-[var(--d-red)]/35 bg-[var(--d-red)]/5">
              <AlertTitle>调用未成功</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
            </Alert>
          ) : null}

          {analysis && risk ? (
            <div className="space-y-2.5 rounded-md border border-border/60 bg-background/40 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <p className="text-sm leading-none font-semibold tracking-tight">模型结论</p>
                <Badge variant="outline" className={`text-xs ${risk.ring} ${risk.text}`}>
                  {risk.label}（{analysis.riskLevel}）
                </Badge>
                <span className={`tnum text-sm font-medium ${risk.text}`}>置信度 {(analysis.confidence * 100).toFixed(0)}%</span>
                <span className="tnum ml-auto text-[11px] text-muted-foreground">
                  {result?.model} · {result ? new Date(result.generatedAt).toLocaleString("zh-CN", { hour12: false }) : ""} · tokens{" "}
                  {fmt(result?.usage.promptTokens ?? null, 0)} 入 / {fmt(result?.usage.completionTokens ?? null, 0)} 出
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className={`h-full ${risk.bar}`} style={{ width: `${Math.round(analysis.confidence * 100)}%` }} />
              </div>
              <p className="text-xs leading-relaxed text-foreground/90">{analysis.summary}</p>

              <div className="rounded-md border border-border/60 bg-secondary/30 p-2.5">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">配置结构总评</p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{analysis.allocationView}</p>
              </div>

              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">风控要点</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                  {analysis.riskControls.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>

              {analysis.actions.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-border/70 text-muted-foreground">
                        <th className="px-2 py-1.5 text-left font-medium">对象</th>
                        <th className="px-2 py-1.5 text-left font-medium">动作</th>
                        <th className="px-2 py-1.5 text-left font-medium">理由</th>
                        <th className="px-2 py-1.5 text-left font-medium">触发条件</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.actions.map((a, i) => (
                        <tr key={`${a.target}-${i}`} className="border-b border-border/50 last:border-0">
                          <td className="px-2 py-1.5">{a.target}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant="outline" className={`text-[10px] ${actionTone[a.action] ?? ""}`}>
                              {a.action}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5">{a.reason}</td>
                          <td className="px-2 py-1.5">{a.trigger}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="grid gap-2.5 md:grid-cols-2">
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">风险</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                    {analysis.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">仍缺数据</p>
                  {analysis.dataGaps.length ? (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                      {analysis.dataGaps.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">模型未指出额外缺口；现价、净值与手续费仍以手动填写为准。</p>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{result?.disclaimer}</p>
            </div>
          ) : null}
        </div>
      )}

      <LlmConfigDialog open={open} onOpenChange={setOpen} initial={cfg} onSaved={setCfg} />
    </div>
  );
}
