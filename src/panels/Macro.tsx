import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import MacroAi from "@/src/MacroAi";
import { Delta, EmptyState, Panel, Th, Td } from "@/src/ui-kit";
import {
  fmt,
  fmtSigned,
  type MacroAssetRow,
  type MacroCorrelationRow,
  type MacroPayload,
  type MacroRiskLevel,
  type MacroSourceStatus,
} from "@/lib/api";

const MACRO_RANGES = [
  { value: "1", label: "1 年" },
  { value: "3", label: "3 年" },
  { value: "5", label: "5 年" },
  { value: "10", label: "10 年" },
];

const ASSET_COLOR: Record<string, string> = {
  gold: "var(--d-vxn)",
  oil: "var(--d-rv21)",
  bond: "var(--d-mint)",
  ust10y: "var(--d-price)",
};

function tick(date: string): string {
  return date.slice(0, 7);
}

function shortSource(label: string): string {
  return label
    .replace("Nasdaq GLD / USO / TLT 历史日线", "Nasdaq · GLD / USO / TLT")
    .replace("FRED DGS10 10 年期美债收益率", "FRED · DGS10");
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

const riskTone: Record<MacroRiskLevel, { label: string; text: string; ring: string; bar: string }> = {
  low: { label: "低", text: "text-[var(--d-mint)]", ring: "border-[var(--d-mint)]/40 bg-[var(--d-mint)]/10", bar: "bg-[var(--d-mint)]" },
  medium: { label: "中", text: "text-[var(--d-vxn)]", ring: "border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10", bar: "bg-[var(--d-vxn)]" },
  high: { label: "高", text: "text-[var(--d-red)]", ring: "border-[var(--d-red)]/40 bg-[var(--d-red)]/10", bar: "bg-[var(--d-red)]" },
};

function SourcePill({ source }: { source: MacroSourceStatus }) {
  const live = source.mode === "live" && source.ok;
  const dot = live ? "bg-[var(--d-mint)]" : source.ok ? "bg-[var(--d-vxn)]" : "bg-[var(--d-red)]";
  const text = live ? "实时" : source.ok ? "快照" : "降级";
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground"
      title={source.note}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{shortSource(source.label)}</span>
      <span className="tnum shrink-0 opacity-70">{text}</span>
    </span>
  );
}

function AssetCard({ asset }: { asset: MacroAssetRow }) {
  const color = ASSET_COLOR[asset.key] ?? "var(--foreground)";
  return (
    <Card className="gap-0 border-border/70 bg-card/60 py-0">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{asset.label}</p>
            <span className="tnum text-[10px] text-muted-foreground">{asset.symbol}</span>
          </div>
          <span className="tnum text-[10px] text-muted-foreground">{asset.asOf}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
          <span className="tnum text-2xl leading-none font-semibold" style={{ color }}>
            {fmt(asset.close, 2)}
          </span>
          <span className="text-[10px] text-muted-foreground">{asset.unit}</span>
          <span className="text-[11px]">
            <Delta value={asset.dayChangePct} />
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
          {[
            { label: "1M", value: asset.returns.m1 },
            { label: "3M", value: asset.returns.m3 },
            { label: "YTD", value: asset.returns.ytd },
            { label: "1Y", value: asset.returns.y1 },
          ].map((r) => (
            <div key={r.label}>
              <p className="text-muted-foreground">{r.label}</p>
              <p className="mt-0.5">
                <Delta value={r.value} digits={1} />
              </p>
            </div>
          ))}
        </div>
        <p className="tnum mt-2 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground">
          21 日波动 {fmt(asset.vol21, 1)}% · 距 1 年高点 {fmtSigned(asset.drawdown1y, 1, "%")}
        </p>
      </CardContent>
    </Card>
  );
}

function CorrCell({ value, alt }: { value: number | null; alt: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const color = value > 0 ? "var(--d-mint)" : "var(--d-red)";
  const alpha = Math.round(Math.min(1, Math.abs(value)) * 34);
  const strong = Math.abs(value) >= 0.6;
  return (
    <span
      className={`tnum inline-block w-full rounded px-1 py-0.5 text-right ${strong ? "font-semibold" : ""}`}
      style={{ backgroundColor: `color-mix(in srgb, ${color} ${alpha}%, transparent)` }}
      title={alt === null ? undefined : `最近 63 个交易日：${alt.toFixed(2)}`}
    >
      {value.toFixed(2)}
    </span>
  );
}

function CorrTable({ corr, alt }: { corr: MacroCorrelationRow; alt: MacroCorrelationRow }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px] border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-border/70 text-muted-foreground">
            <th className="px-1.5 py-1.5 text-left font-medium"> </th>
            {corr.labels.map((l) => (
              <th key={l} className="px-1.5 py-1.5 text-right font-medium">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {corr.matrix.map((row, i) => (
            <tr key={corr.labels[i]} className="border-b border-border/50 last:border-0">
              <td className="px-1.5 py-1.5 text-left whitespace-nowrap text-muted-foreground">{corr.labels[i]}</td>
              {row.map((v, j) => (
                <td key={`${i}-${j}`} className="px-0.5 py-0.5 text-right">
                  <CorrCell value={v} alt={alt.matrix[i]?.[j] ?? null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function averageAbs(corr: MacroCorrelationRow): number | null {
  const values: number[] = [];
  for (let i = 0; i < corr.matrix.length; i++) {
    for (let j = i + 1; j < corr.matrix.length; j++) {
      const v = corr.matrix[i][j];
      if (v !== null) values.push(Math.abs(v));
    }
  }
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default function Macro({
  macro,
  loading,
  error,
  years,
  onYearsChange,
  liveRefresh,
}: {
  macro: MacroPayload | null;
  loading: boolean;
  error: string | null;
  years: number;
  onYearsChange: (years: number) => void;
  liveRefresh: boolean;
}) {
  const chartDomain = useMemo<[number, number]>(() => {
    if (!macro) return [80, 120];
    let lo = 100;
    let hi = 100;
    for (const p of macro.chart) {
      for (const v of [p.gold, p.oil, p.bond]) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const pad = Math.max(4, (hi - lo) * 0.08);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [macro]);

  const yieldDomain = useMemo<[number, number]>(() => {
    if (!macro) return [0, 6];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of macro.chart) {
      if (p.ust10y === null) continue;
      lo = Math.min(lo, p.ust10y);
      hi = Math.max(hi, p.ust10y);
    }
    if (!Number.isFinite(lo)) return [0, 6];
    return [Math.max(0, Math.floor((lo - 0.3) * 2) / 2), Math.ceil((hi + 0.3) * 2) / 2];
  }, [macro]);

  const tone = macro ? riskTone[macro.risk.level] : null;
  const avg63 = macro ? averageAbs(macro.corr63) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-border/80 text-[10px]">
            黄金 · 原油 · 美债
          </Badge>
          {macro ? (
            <>
              <span className="tnum text-[11px] text-muted-foreground">
                数据截至 {macro.asOf} · 窗口 {macro.window.from} → {macro.window.to}（{macro.window.days} 个交易日）
              </span>
              {macro.meta.sources.map((s) => (
                <SourcePill key={s.id} source={s} />
              ))}
            </>
          ) : null}
        </div>
        <ToggleGroup
          type="single"
          value={String(years)}
          onValueChange={(v) => v && onYearsChange(Number(v))}
          spacing={2}
          variant="outline"
          size="sm"
          aria-label="跨资产回溯年数"
        >
          {MACRO_RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} size="sm" className="h-8 px-2.5 text-xs">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>跨资产接口未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {!macro && loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px] w-full rounded-lg" />
          ))}
        </div>
      ) : !macro ? (
        <EmptyState text="尚未取到跨资产数据，请稍后重试。" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {macro.assets.map((a) => (
              <AssetCard key={a.key} asset={a} />
            ))}
            <Card className="gap-0 border-border/70 bg-card/60 py-0">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: ASSET_COLOR.ust10y }} />
                    <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">10Y 美债收益率</p>
                  </div>
                  <span className="tnum text-[10px] text-muted-foreground">{macro.yield10y.asOf}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                  <span className="tnum text-2xl leading-none font-semibold" style={{ color: ASSET_COLOR.ust10y }}>
                    {macro.yield10y.latest.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">%</span>
                  <span className="tnum text-[11px] text-muted-foreground">3M {fmtSigned(macro.yield10y.changesBp.m3, 0, "bp")}</span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
                  {[
                    { label: "1M", value: macro.yield10y.changesBp.m1 },
                    { label: "3M", value: macro.yield10y.changesBp.m3 },
                    { label: "YTD", value: macro.yield10y.changesBp.ytd },
                    { label: "1Y", value: macro.yield10y.changesBp.y1 },
                  ].map((r) => (
                    <div key={r.label}>
                      <p className="text-muted-foreground">{r.label}</p>
                      <p className="tnum mt-0.5">{fmtSigned(r.value, 0, "bp")}</p>
                    </div>
                  ))}
                </div>
                <p className="tnum mt-2 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground">
                  5 年分位 {fmt(macro.yield10y.pct5y, 0)}% · 区间 {fmt(macro.yield10y.low5y, 2)}%–{fmt(macro.yield10y.high5y, 2)}%
                </p>
              </CardContent>
            </Card>
          </div>

          <Panel
            title="归一化走势"
            description={`以 ${macro.window.from} 收盘 = 100 归一化，便于横向比较三类资产的相对涨跌；10 年期美债收益率为原始水平（右轴），不是归一化值。`}
            action={
              <span className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {[
                  { label: "黄金 GLD", color: ASSET_COLOR.gold },
                  { label: "原油 USO", color: ASSET_COLOR.oil },
                  { label: "美债 TLT", color: ASSET_COLOR.bond },
                  { label: "10Y 收益率（右轴）", color: ASSET_COLOR.ust10y },
                ].map((l) => (
                  <span key={l.label} className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: l.color }} />
                    {l.label}
                  </span>
                ))}
              </span>
            }
          >
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={macro.chart} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                  <YAxis
                    yAxisId="norm"
                    domain={chartDomain}
                    tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                    stroke="var(--chart-axis)"
                    width={40}
                  />
                  <YAxis
                    yAxisId="yield"
                    orientation="right"
                    domain={yieldDomain}
                    tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                    stroke="var(--chart-axis)"
                    width={44}
                    tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                  />
                  <ReferenceLine yAxisId="norm" y={100} stroke="var(--chart-axis)" strokeDasharray="3 4" strokeOpacity={0.6} />
                  <Tooltip
                    {...tooltipStyle()}
                    isAnimationActive={false}
                    formatter={(value: unknown, name: unknown) => {
                      const n = Number(value);
                      if (!Number.isFinite(n)) return ["—", String(name)];
                      return String(name).includes("收益率") ? [`${n.toFixed(2)}%`, String(name)] : [n.toFixed(1), String(name)];
                    }}
                  />
                  <Line yAxisId="norm" type="monotone" dataKey="gold" name="黄金 GLD（=100）" stroke={ASSET_COLOR.gold} strokeWidth={1.6} dot={false} />
                  <Line yAxisId="norm" type="monotone" dataKey="oil" name="原油 USO（=100）" stroke={ASSET_COLOR.oil} strokeWidth={1.6} dot={false} />
                  <Line yAxisId="norm" type="monotone" dataKey="bond" name="美债 TLT（=100）" stroke={ASSET_COLOR.bond} strokeWidth={1.6} dot={false} />
                  <Line
                    yAxisId="yield"
                    type="monotone"
                    dataKey="ust10y"
                    name="10Y 收益率（右轴）"
                    stroke={ASSET_COLOR.ust10y}
                    strokeWidth={1.1}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              图表按所选窗口采样：{macro.chartFreq === "1w" ? "周线（每周最后一个交易日）" : "日线"}，共 {macro.chart.length} 个点。
              归一化只比较相对涨跌，不改变收益、波动与回撤的计算口径。
            </p>
          </Panel>

          <Panel
            title="跨资产风险状态"
            description="固定权重的启发式压力评分：利率 30% + 美债价格 25% + 原油 25% + 联动性 20%。它不是概率或预测，只用于把当前读数放进统一的风险框架。"
            action={
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-[11px] ${tone?.ring} ${tone?.text}`}>
                  风险 {tone?.label} · {macro.risk.score}/100
                </Badge>
                <Badge variant="outline" className="border-border/80 bg-secondary/60 text-[11px] text-muted-foreground">
                  {macro.risk.regimeLabel}
                </Badge>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="tnum text-3xl leading-none font-semibold">
                <span className={tone?.text}>{macro.risk.score}</span>
                <span className="ml-1 text-sm font-normal text-muted-foreground">/100</span>
              </div>
              <div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-secondary">
                <div className={`h-full ${tone?.bar}`} style={{ width: `${macro.risk.score}%` }} />
              </div>
              <span className="text-[11px] text-muted-foreground">
                分档：&lt;35 低 · 35–64 中 · ≥65 高
              </span>
            </div>
            <p className="text-xs leading-relaxed text-foreground/90">{macro.risk.summary}</p>

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {macro.risk.drivers.map((d) => {
                const t = d.score >= 65 ? riskTone.high : d.score >= 35 ? riskTone.medium : riskTone.low;
                return (
                  <div key={d.key} className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-muted-foreground">{d.label}</p>
                      <span className={`tnum text-[11px] font-semibold ${t.text}`}>{d.score}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                      <div className={`h-full ${t.bar}`} style={{ width: `${d.score}%` }} />
                    </div>
                    <p className="tnum mt-1.5 text-[11px] leading-snug text-foreground/85">{d.reading}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{d.note}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">观察点</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                {macro.risk.watch.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
            <Panel
              title="区间收益对比"
              description="价格收益，不含股息、票息、费用、税收与汇率换算；收益率的变动以 bp 表示，与价格涨跌方向相反。"
              className="min-w-0"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border/70">
                      <Th>资产</Th>
                      <Th right>1W</Th>
                      <Th right>1M</Th>
                      <Th right>3M</Th>
                      <Th right>YTD</Th>
                      <Th right>1Y</Th>
                      <Th right>窗口</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {macro.assets.map((a) => (
                      <tr key={a.key} className="border-b border-border/50 last:border-0">
                        <Td>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: ASSET_COLOR[a.key] }} />
                            {a.label}
                            <span className="text-[10px] text-muted-foreground">{a.symbol}</span>
                          </span>
                        </Td>
                        <Td right>
                          <Delta value={a.returns.w1} />
                        </Td>
                        <Td right>
                          <Delta value={a.returns.m1} />
                        </Td>
                        <Td right>
                          <Delta value={a.returns.m3} />
                        </Td>
                        <Td right>
                          <Delta value={a.returns.ytd} />
                        </Td>
                        <Td right>
                          <Delta value={a.returns.y1} />
                        </Td>
                        <Td right>
                          <Delta value={a.returns.window} />
                        </Td>
                      </tr>
                    ))}
                    <tr className="border-b border-border/50">
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: ASSET_COLOR.ust10y }} />
                          10Y 收益率
                          <span className="text-[10px] text-muted-foreground">DGS10</span>
                        </span>
                      </Td>
                      {[macro.yield10y.changesBp.w1, macro.yield10y.changesBp.m1, macro.yield10y.changesBp.m3, macro.yield10y.changesBp.ytd, macro.yield10y.changesBp.y1, macro.yield10y.changesBp.window].map(
                        (v, i) => (
                          <Td key={i} right>
                            <span className="tnum">{fmtSigned(v, 0, "bp")}</span>
                          </Td>
                        ),
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="tnum mt-2 text-[11px] text-muted-foreground">
                窗口最大回撤：黄金 {fmtSigned(macro.assets[0]?.maxDrawdown, 1, "%")} · 原油 {fmtSigned(macro.assets[1]?.maxDrawdown, 1, "%")} · 美债{" "}
                {fmtSigned(macro.assets[2]?.maxDrawdown, 1, "%")}；21 日年化波动见上方资产卡片。
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                收益窗口：1W=5、1M=21、3M=63、1Y=252 个交易日；YTD 以最近一个上年最后一个交易日为基准。波动为年化已实现波动率（sqrt(252)）。
              </p>
            </Panel>

            <Panel
              title="相关性矩阵"
              description="日收益率（10Y 为日变动 bp）的 Pearson 相关系数。展示矩阵取最近 252 个交易日；挂起查看最近 63 个交易日的系数。相关性不等于因果。"
              className="min-w-0"
              action={
                <span className="tnum text-[11px] text-muted-foreground">
                  63 日平均 |r| {avg63 === null ? "—" : avg63.toFixed(2)}
                </span>
              }
            >
              <CorrTable corr={macro.correlations} alt={macro.corr63} />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span>色阶：</span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded" style={{ backgroundColor: "color-mix(in srgb, var(--d-red) 30%, transparent)" }} />
                  负相关
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded" style={{ backgroundColor: "color-mix(in srgb, var(--d-mint) 30%, transparent)" }} />
                  正相关
                </span>
                <span>· 颜色越深，绝对值越大；|r| ≥ 0.6 加粗。</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                黄金与美债同涨通常对应避险或降息交易；原油与 10Y 收益率同向、与美债价格反向，反映通胀与利率渠道。样本不足 10 对时返回 null。
              </p>
            </Panel>
          </div>

          <Panel title="数据来源、口径与限制" description="跨资产板块不把 ETF 价格当成现货，也不把相关性当成因果关系；运行时刷新失败会保留快照并标注降级。">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">数据源</p>
                <ul className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-foreground/85">
                  {macro.meta.sources.map((s) => (
                    <li key={s.id} className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
                      <span className="font-medium">{shortSource(s.label)}</span>
                      <span className={`ml-1.5 ${s.ok ? "text-[var(--d-mint)]" : "text-[var(--d-red)]"}`}>
                        {s.mode === "live" && s.ok ? "实时" : s.ok ? "快照" : "降级"}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">{s.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  快照生成于 {macro.meta.snapshot.generatedAt.slice(0, 19).replace("T", " ")}；窗口 {macro.meta.snapshot.window.from} →{" "}
                  {macro.meta.snapshot.window.to}。刷新成功时缓存 10 分钟。
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">限制</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                  {macro.limits.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
            <details className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">指标定义</summary>
              <dl className="mt-1.5 space-y-1 text-[11px] leading-relaxed">
                {Object.entries(macro.definition).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-medium text-foreground/85">{k}：</dt>
                    <dd className="inline text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="mt-2 text-[11px] text-muted-foreground">{macro.disclaimer}</p>
          </Panel>

          <MacroAi payload={macro} liveRefresh={liveRefresh} years={years} />
        </>
      )}
    </div>
  );
}
