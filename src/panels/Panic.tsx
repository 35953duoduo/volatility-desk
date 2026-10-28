import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import AiBrief from "@/src/AiBrief";
import { Panel, regimeTone } from "@/src/ui-kit";
import { type PanicPayload, fmt } from "@/lib/api";

function tick(date: string): string {
  return date.slice(0, 7);
}

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--tooltip-bg)",
      border: "1px solid var(--tooltip-border)",
      borderRadius: 10,
      fontSize: 12,
      padding: "8px 10px",
      boxShadow: "var(--tooltip-shadow)",
    },
    labelStyle: { color: "var(--tooltip-label)", marginBottom: 4, fontSize: 11 },
    itemStyle: { color: "var(--tooltip-item)", padding: 0 },
  };
}

/** 交给 AI 补充的背景数据：只放本站真实指标，任何数值都不允许模型改写 */
function briefContext(panic: PanicPayload | null): string {
  const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : v.toFixed(digits));
  if (!panic) return "VIX 接口尚未返回数据。";
  const lines = [
    `VIX 接口状态：${panic.available ? "可用" : "上游不可达"}；数据截至 ${panic.meta.asOf ?? "—"}；来源模式 ${panic.source?.mode ?? "未知"}（${panic.source?.ok ? "正常" : "降级"}）。`,
  ];
  if (panic.latest) {
    lines.push(
      `VIX 最新读数：${num(panic.latest.level)}（截至 ${panic.latest.asOf}）；5 年分位 ${num(panic.latest.pct5y, 0)}%；全样本分位 ${num(panic.latest.pctAll, 0)}%；Z 分数 ${num(panic.latest.z)}；本站波动状态判定：${panic.latest.regime.label}。`,
    );
  } else if (panic.reason) {
    lines.push(`上游不可达原因：${panic.reason}`);
  }
  lines.push("站点定义：VIX 是 CBOE 标普500 30 天隐含波动率，反映期权市场对未来一个月波动的定价水平；本站数值直接取自 CBOE / Yahoo 上游或本地快照。");
  return lines.join("\n");
}

/** VIX 恐慌指数：独于所选指数标的，始终展示标普500 隐含波动率水平与分位 */
export default function PanicStrip({ panic, loading }: { panic: PanicPayload | null; loading: boolean }) {
  const rows = useMemo(() => (panic?.series ?? []).slice(-1600), [panic]);
  const latest = panic?.latest ?? null;
  const tone = latest ? regimeTone(latest.regime.key) : null;
  const levelTop = useMemo(() => {
    let m = 25;
    for (const p of rows) m = Math.max(m, p.level);
    return Math.ceil((m + 5) / 5) * 5;
  }, [rows]);
  const modeChip = panic?.source
    ? panic.source.mode === "live" && panic.source.ok
      ? "实时上游"
      : panic.source.ok
        ? "本地快照"
        : "上游降级"
    : "";

  return (
    <Panel
      title="VIX 恐慌指数"
      description="CBOE 标普500 30 天隐含波动率。读数越高，市场对未来一个月标普500 波动的定价越贵；阴影带为偏高区（22–30）与恐慌区（≥30），与 VXN（纳斯达克100）走势高度同步但水平不同。"
      action={
        panic?.source ? (
          <Badge variant="outline" className="border-border/80 bg-secondary/60 text-[11px] font-normal text-muted-foreground" title={panic.source.note}>
            <span
              className={`mr-1.5 inline-block size-1.5 rounded-full ${
                panic.available && panic.source.mode === "live" ? "bg-[var(--d-mint)]" : panic.available ? "bg-[var(--d-vxn)]" : "bg-[var(--d-red)]"
              }`}
            />
            {modeChip}
          </Badge>
        ) : null
      }
    >
      {!panic && loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-[170px] w-full" />
        </div>
      ) : !panic || !panic.available || !latest ? (
        <div className="rounded-md border border-dashed border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/5 px-4 py-6 text-center">
          <p className="text-sm font-medium text-[var(--d-vxn)]">VIX 上游在当前环境不可达</p>
          <p className="mx-auto mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {panic?.reason ?? "接口未返回原因。"}
            <br />
            此时以真实收盘价计算的已实现波动率（RV21 / RV63）、其 5 年分位与 Z 分数替代恐慌度量；接口上线到可访问 CBOE / Yahoo
            的环境后，本面板会自动切换为实时读数。
          </p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-end gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>
              最新
              <span className="tnum ml-1.5 text-xl leading-none font-semibold text-[var(--d-vxn)]">{fmt(latest.level, 2)}</span>
            </span>
            <span>
              5 年分位
              <span className="tnum ml-1 text-sm font-semibold text-foreground">
                {latest.pct5y === null ? "—" : `${latest.pct5y.toFixed(0)}%`}
              </span>
            </span>
            <span>
              全样本分位
              <span className="tnum ml-1 text-sm font-semibold text-foreground">
                {latest.pctAll === null ? "—" : `${latest.pctAll.toFixed(0)}%`}
              </span>
            </span>
            <span>
              Z 分数
              <span className="tnum ml-1 text-sm font-semibold text-foreground">
                {latest.z === null ? "—" : `${latest.z > 0 ? "+" : ""}${latest.z.toFixed(2)}`}
              </span>
            </span>
            {tone ? (
              <Badge variant="outline" className={`text-[11px] ${tone.className}`}>
                {latest.regime.label}
              </Badge>
            ) : null}
            <span className="tnum ml-auto">数据截至 {latest.asOf} · 共 {panic.count} 个交易日</span>
          </div>
          <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
            <ResponsiveContainer width="100%" height={188}>
              <ComposedChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gVix" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--d-vxn)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--d-vxn)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={tick} minTickGap={46} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                <YAxis
                  yAxisId="vix"
                  domain={[0, levelTop]}
                  tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                  stroke="var(--chart-axis)"
                  width={34}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  domain={[0, 100]}
                  ticks={[0, 50, 100]}
                  tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                  stroke="var(--chart-axis)"
                  width={38}
                  tickFormatter={(v) => `${v}%`}
                />
                <ReferenceArea yAxisId="vix" y1={30} y2={levelTop} fill="var(--d-red)" fillOpacity={0.05} />
                <ReferenceArea yAxisId="vix" y1={22} y2={30} fill="var(--d-vxn)" fillOpacity={0.05} />
                <ReferenceLine yAxisId="vix" y={22} stroke="var(--d-vxn)" strokeOpacity={0.35} strokeDasharray="3 4" />
                <ReferenceLine yAxisId="vix" y={30} stroke="var(--d-red)" strokeOpacity={0.4} strokeDasharray="3 4" />
                <Tooltip
                  {...tooltipStyle()}
                  isAnimationActive={false}
                  formatter={(value: unknown, name: unknown) => {
                    const n = Number(value);
                    if (!Number.isFinite(n)) return ["—", String(name)];
                    return String(name).includes("分位") ? [`${n.toFixed(0)}%`, String(name)] : [n.toFixed(2), String(name)];
                  }}
                />
                <Area yAxisId="vix" type="monotone" dataKey="level" name="VIX" stroke="var(--d-vxn)" strokeWidth={1.6} fill="url(#gVix)" dot={false} activeDot={{ r: 3 }} />
                <Line yAxisId="pct" type="monotone" dataKey="pct5y" name="5 年分位（右轴）" stroke="var(--d-price)" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.7} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      <AiBrief topic="VIX" query="VIX 恐慌指数 最新走势 市场波动 解读" context={briefContext(panic)} />
    </Panel>
  );
}
