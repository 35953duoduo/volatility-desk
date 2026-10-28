import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Panel, Th, Td, regimeTone } from "@/src/ui-kit";
import AiDiagnosis from "@/src/AiDiagnosis";
import { fmt, type AiContextPayload, type DiagnosisPayload, type SignalRow } from "@/lib/api";

const stanceStyle: Record<string, { text: string; ring: string; bar: string }> = {
  buy: { text: "text-[var(--d-mint)]", ring: "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10", bar: "bg-[var(--d-mint)]" },
  add: { text: "text-[var(--d-rv21)]", ring: "border-[var(--d-rv21)]/45 bg-[var(--d-rv21)]/10", bar: "bg-[var(--d-rv21)]" },
  hold: { text: "text-foreground", ring: "border-border bg-secondary/50", bar: "bg-foreground/60" },
  trim: { text: "text-[var(--d-vxn)]", ring: "border-[var(--d-vxn)]/45 bg-[var(--d-vxn)]/10", bar: "bg-[var(--d-vxn)]" },
  reduce: { text: "text-[var(--d-red)]", ring: "border-[var(--d-red)]/45 bg-[var(--d-red)]/10", bar: "bg-[var(--d-red)]" },
};

function scoreColor(score: number): string {
  if (score >= 1) return "text-[var(--d-mint)]";
  if (score > 0.4) return "text-[var(--d-rv21)]";
  if (score <= -1) return "text-[var(--d-red)]";
  if (score < -0.4) return "text-[var(--d-vxn)]";
  return "text-muted-foreground";
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "已复制" : label}
    </Button>
  );
}

export default function Diagnosis({
  diagnosis,
  ai,
  loading,
}: {
  diagnosis: DiagnosisPayload | null;
  ai: AiContextPayload | null;
  loading: boolean;
}) {
  const comp = diagnosis?.composite ?? null;
  const metrics = diagnosis?.metrics ?? null;
  const groupOrder: Record<string, number> = { 波动率: 0, 价格结构: 1, 趋势: 2, 情绪: 3 };
  const signals = [...(diagnosis?.signals ?? [])].sort(
    (a, b) => (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9) || Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight),
  );
  const style = stanceStyle[comp?.stanceKey ?? "hold"];
  const markerPct = comp ? ((comp.score + 100) / 200) * 100 : 50;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_1.35fr]">
        <Panel title="量化倾向评分" description="由 10 条固定权重规则合成，-100（显著减仓）到 +100（分批买入）。">
          {comp === null ? (
            <EmptyState text={loading ? "正在计算诊断信号…" : "暂无诊断结果。"} />
          ) : (
            <div>
              <div className="flex items-end gap-3">
                <p className={`tnum text-5xl leading-none font-semibold ${style.text}`}>
                  {comp.score > 0 ? "+" : ""}
                  {comp.score}
                </p>
                <Badge variant="outline" className={`mb-1 border ${style.ring} px-2 py-0.5 text-xs`}>
                  {comp.stance}
                </Badge>
              </div>
              <div className="relative mt-4 h-2 rounded-full bg-secondary">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className={`absolute -top-1 size-4 rounded-full border-2 border-background ${style.bar} shadow`}
                  style={{ left: `calc(${markerPct.toFixed(1)}% - 8px)` }}
                />
              </div>
              <div className="tnum mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span>-100 减仓</span>
                <span>0 观望</span>
                <span>+100 买入</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{comp.summary}</p>
              {metrics ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  当前状态：{regimeTone(metrics.volRegimeKey).label}（RV21 {fmt(metrics.realizedVol21)}%／5 年分位{" "}
                  {metrics.volPercentile5y === null ? "—" : metrics.volPercentile5y.toFixed(0)}%）·{" "}
                  {metrics.aboveMa200 === null ? "趋势样本不足" : metrics.aboveMa200 ? "200 日线上方" : "200 日线下方"}
                </p>
              ) : null}
            </div>
          )}
        </Panel>

        <Panel title="AI 辅助诊断上下文包" description="把结构化指标、规则信号与历史规律打包，可直接粘给大模型，或作为工具返回值喂给 Agent。">
          {ai?.markdown ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={ai.markdown} label="复制 Markdown 上下文" />
                <CopyButton
                  label="复制接口地址"
                  text={`GET ${window.location.origin}/functions/v1/app/api/ai-context?symbol=${diagnosis?.meta.symbol ?? "NDX100"}&years=10`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob([ai.markdown], { type: "text/markdown;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `纳斯达克波动率诊断_${diagnosis?.meta.symbol ?? ""}_${ai.meta.asOf ?? ""}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  下载 .md
                </Button>
                <span className="tnum ml-auto text-[11px] text-muted-foreground">{ai.markdown.length.toLocaleString()} 字符</span>
              </div>
              <ScrollArea className="mt-3 h-64 rounded-md border border-border/60 bg-secondary/25">
                <pre className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">{ai.markdown}</pre>
              </ScrollArea>
            </div>
          ) : (
            <EmptyState text="上下文包尚未就绪。" />
          )}
        </Panel>
      </div>

      <Panel title="规则信号明细" description="每条信号都给出数值、状态、得分与理由，AI 或人工可逐项复核。">
        {signals.length === 0 ? (
          <EmptyState text={loading ? "正在计算…" : "没有可用信号。"} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <Th>分组</Th>
                  <Th>信号</Th>
                  <Th right>当前值</Th>
                  <Th>状态</Th>
                  <Th right>得分 × 权重</Th>
                  <Th>规则解释</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((s) => (
                  <SignalRowView key={s.id} s={s} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <AiDiagnosis ai={ai} symbolLabel={diagnosis?.meta.symbolLabel ?? ""} />

      <Alert className="border-[var(--d-vxn)]/35 bg-[var(--d-vxn)]/5">
        <AlertTitle>这不是投资建议</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          评分与历史规律来自真实收盘价的可复现规则计算，未纳入估值、盈利、利率、汇率、流动性与你的持仓成本。
          历史分位表现不保证未来结果。任何买入、卖出或仓位调整请结合个人风险承受能力独立判断，必要时咨询持牌顾问。
        </AlertDescription>
      </Alert>
    </div>
  );
}

function SignalRowView({ s }: { s: SignalRow }) {
  return (
    <TableRow className="border-border/50">
      <Td mono={false} className="text-[11px] text-muted-foreground">
        {s.group}
      </Td>
      <Td mono={false}>
        <span className="font-medium">{s.name}</span>
        <span className="tnum ml-1.5 text-[10px] text-muted-foreground">{s.id}</span>
      </Td>
      <Td right>{s.display}</Td>
      <Td mono={false}>
        <span className={`text-[11px] ${scoreColor(s.score)}`}>{s.state}</span>
      </Td>
      <Td right>
        <span className={scoreColor(s.score)}>
          {s.score > 0 ? "+" : ""}
          {s.score.toFixed(1)}
        </span>
        <span className="text-muted-foreground"> × {s.weight}</span>
      </Td>
      <Td mono={false} className="max-w-[420px] text-[11px] leading-snug text-muted-foreground">
        {s.rationale}
      </Td>
    </TableRow>
  );
}
