import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ValuationAi from "@/src/ValuationAi";
import { EmptyState, Panel, Th, Td } from "@/src/ui-kit";
import { fmt, fmtSigned, type ValuationPayload, type ValuationStatsRow } from "@/lib/api";

const VALUATION_RANGES = [
  { value: "1", label: "1 年" },
  { value: "3", label: "3 年" },
  { value: "5", label: "5 年" },
  { value: "10", label: "10 年" },
  { value: "20", label: "20 年" },
  { value: "all", label: "全部" },
];

const RATIO_COLOR = "var(--d-price)";
const SPX_COLOR = "var(--d-rv63)";

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

function pctTone(pct: number | null): string {
  if (pct === null) return "var(--muted-foreground)";
  if (pct >= 90) return "var(--d-red)";
  if (pct >= 70) return "var(--d-vxn)";
  if (pct >= 30) return "var(--d-mint)";
  return "var(--d-rv21)";
}

function StatsCells({ row }: { row: ValuationStatsRow }) {
  return (
    <>
      <Td right>
        <span className="tnum">{fmt(row.min, 1)}</span>
      </Td>
      <Td right>
        <span className="tnum">{fmt(row.p25, 1)}</span>
      </Td>
      <Td right>
        <span className="tnum font-medium">{fmt(row.median, 1)}</span>
      </Td>
      <Td right>
        <span className="tnum">{fmt(row.mean, 1)}</span>
      </Td>
      <Td right>
        <span className="tnum">{fmt(row.p75, 1)}</span>
      </Td>
      <Td right>
        <span className="tnum">{fmt(row.max, 1)}</span>
      </Td>
      <Td right>
        <span className="tnum text-muted-foreground">{row.count}</span>
      </Td>
    </>
  );
}

export default function Valuation({
  valuation,
  loading,
  error,
  years,
  onYearsChange,
  liveRefresh,
}: {
  valuation: ValuationPayload | null;
  loading: boolean;
  error: string | null;
  years: number | null;
  onYearsChange: (years: number | null) => void;
  liveRefresh: boolean;
}) {
  const ratioDomain = useMemo<[number, number]>(() => {
    if (!valuation) return [60, 300];
    const values = [...valuation.chart.map((p) => p.ratio), valuation.latest.ratio].filter((v) => Number.isFinite(v));
    if (!values.length) return [60, 300];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(8, (hi - lo) * 0.08);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [valuation]);

  const spxDomain = useMemo<[number, number]>(() => {
    if (!valuation) return [80, 130];
    const values = valuation.chart.map((p) => p.spx).filter((v): v is number => v !== null && Number.isFinite(v));
    if (!values.length) return [80, 130];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(4, (hi - lo) * 0.08);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [valuation]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-border/80 text-[10px]">
            美股巴菲特指数 · Z.1 口径
          </Badge>
          {valuation ? (
            <span className="tnum text-[11px] text-muted-foreground">
              最新季度 {valuation.latest.quarter}（{valuation.latest.date}）· 数据截至 {valuation.asOf}
            </span>
          ) : null}
        </div>
        <ToggleGroup
          type="single"
          value={years === null ? "all" : String(years)}
          onValueChange={(v) => v && onYearsChange(v === "all" ? null : Number(v))}
          spacing={2}
          variant="outline"
          size="sm"
          aria-label="巴菲特指数回溯年数"
        >
          {VALUATION_RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} size="sm" className="h-8 px-2.5 text-xs">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>巴菲特指数接口未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {!valuation && loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[130px] w-full rounded-lg" />
          ))}
        </div>
      ) : !valuation ? (
        <EmptyState text="尚未取到巴菲特指数数据，请稍后重试。" />
      ) : (
        <>
          <Alert className="border-[var(--d-vxn)]/30 bg-[var(--d-vxn)]/5">
            <AlertTitle>口径提醒：这是美联储 Z.1 变体，不是常见的 Wilshire 巴菲特指数</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              分子为 Z.1「非金融企业股权市值」（FRED NCBEILQ027S，含未上市股权，范围比 Wilshire 5000 更宽），分母为美国名义 GDP（FRED
              GDP）。FRED 的 Wilshire 系列已下架，因此不能与 Wilshire/GDP 的绝对水平或 100%、120% 经验阈值对比；分位只描述历史位置，不构成估值高低或买卖结论。
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="gap-0 border-border/70 bg-card/60 py-0 sm:col-span-2">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">最新市值 / GDP</p>
                  <Badge variant="outline" className="text-[10px]" style={{ color: pctTone(valuation.latest.percentileAll) }}>
                    {valuation.latest.positionLabel}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="tnum text-3xl leading-none font-semibold" style={{ color: RATIO_COLOR }}>
                    {fmt(valuation.latest.ratio, 1)}%
                  </span>
                  <span className="tnum text-[11px] text-muted-foreground">
                    环比 {fmtSigned(valuation.latest.qoqChange, 2, " 个百分点")} · 同比 {fmtSigned(valuation.latest.yoyChange, 2, " 个百分点")}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">全历史分位</p>
                    <p className="tnum mt-0.5 text-sm" style={{ color: pctTone(valuation.latest.percentileAll) }}>
                      {fmt(valuation.latest.percentileAll, 1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">近 20 年分位</p>
                    <p className="tnum mt-0.5 text-sm" style={{ color: pctTone(valuation.latest.percentile20y) }}>
                      {fmt(valuation.latest.percentile20y, 1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">全历史中位数</p>
                    <p className="tnum mt-0.5 text-sm">{fmt(valuation.latest.medianAll, 1)}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">相对中位数</p>
                    <p className="tnum mt-0.5 text-sm">{fmtSigned(valuation.latest.deviationFromMedian, 1, "pct")}</p>
                  </div>
                </div>
                <p className="tnum mt-2 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground">
                  股权市值 {fmt(valuation.latest.capTrn, 1)} 万亿美元 · 名义 GDP {fmt(valuation.latest.gdpTrn, 2)} 万亿美元（年化）
                </p>
              </CardContent>
            </Card>

            <Card className="gap-0 border-border/70 bg-card/60 py-0">
              <CardContent className="p-3.5">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">样本范围</p>
                <p className="tnum mt-1 text-lg font-semibold">{valuation.stats.all.count} 个季度</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  全历史自 {valuation.stats.all.count ? valuation.chart[0]?.date ?? "—" : "—"} 起；分母为名义 GDP，季度数据存在发布滞后与修订。
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  「最高分位」只说明当前比值高于自身历史大多数时间，不代表市场必然下跌；反过来的低位也不等于马上上涨。
                </p>
              </CardContent>
            </Card>

            <Card className="gap-0 border-border/70 bg-card/60 py-0">
              <CardContent className="p-3.5">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">与标普500对照</p>
                {valuation.spx ? (
                  <>
                    <p className="tnum mt-1 text-lg font-semibold">{fmt(valuation.spx.close, 2)}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      标普500 最新收盘 {valuation.spx.asOf}，窗口内按季度末归一化到 100，仅作走势对照，不参与估值计算。
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">暂无标普500季度收盘，图表只显示市值/GDP 单线。</p>
                )}
                <p className="tnum mt-2 text-[10px] text-muted-foreground">图表窗口 {valuation.window.quarters} 个季度</p>
              </CardContent>
            </Card>
          </div>

          <Panel
            title="市值 / GDP 与标普500"
            description="左轴为巴菲特指数（%，季度），右轴为标普500季度末收盘（窗口首季 = 100）；两条线只做历史对照，估值比值不预测指数点位。"
            action={
              <span className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: RATIO_COLOR }} />
                  市值 / GDP
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: SPX_COLOR }} />
                  标普500（=100）
                </span>
              </span>
            }
          >
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={valuation.chart} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                  <YAxis
                    yAxisId="ratio"
                    domain={ratioDomain}
                    tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                    stroke="var(--chart-axis)"
                    width={44}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  {valuation.spx ? (
                    <YAxis
                      yAxisId="spx"
                      orientation="right"
                      domain={spxDomain}
                      tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                      stroke="var(--chart-axis)"
                      width={40}
                    />
                  ) : null}
                  <Tooltip
                    {...tooltipStyle()}
                    isAnimationActive={false}
                    formatter={(value: unknown) => fmt(Number(value), 1)}
                  />
                  <Line yAxisId="ratio" type="monotone" dataKey="ratio" name="市值 / GDP（%）" stroke={RATIO_COLOR} strokeWidth={1.7} dot={false} />
                  {valuation.spx ? (
                    <Line yAxisId="spx" type="monotone" dataKey="spx" name="标普500（=100）" stroke={SPX_COLOR} strokeWidth={1.4} dot={false} strokeDasharray="4 3" />
                  ) : null}
                  <ReferenceLine yAxisId="ratio" y={valuation.latest.medianAll ?? 0} stroke="var(--chart-axis)" strokeDasharray="3 4" strokeOpacity={0.7} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              虚线为全历史中位数 {fmt(valuation.latest.medianAll, 1)}%；共 {valuation.chart.length} 个季度，按季度末对齐。季度 GDP
              会在后续发布中被修订，历史点可能随修订小幅变化。
            </p>
          </Panel>

          <Panel title="历史分位与分布" description="同一口径下的样本统计（%）；分位数用于描述当前位置，不是目标价或估值中枢。">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border/70">
                    <Th>样本</Th>
                    <Th right>最小</Th>
                    <Th right>P25</Th>
                    <Th right>中位数</Th>
                    <Th right>均值</Th>
                    <Th right>P75</Th>
                    <Th right>最大</Th>
                    <Th right>季度数</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <Td>全历史</Td>
                    <StatsCells row={valuation.stats.all} />
                  </tr>
                  <tr className="border-b border-border/50">
                    <Td>近 20 年</Td>
                    <StatsCells row={valuation.stats.recent20y} />
                  </tr>
                  <tr>
                    <Td>当前窗口</Td>
                    <StatsCells row={valuation.stats.window} />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">当前比值在窗口内的位置</p>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(1, Math.min(100, valuation.latest.percentileAll ?? 0))}%`,
                    backgroundColor: pctTone(valuation.latest.percentileAll),
                  }}
                />
              </div>
              <p className="tnum mt-1 text-[10px] text-muted-foreground">
                {fmt(valuation.latest.ratio, 1)}% · 全历史分位 {fmt(valuation.latest.percentileAll, 1)}% · 近 20 年分位{" "}
                {fmt(valuation.latest.percentile20y, 1)}%
              </p>
            </div>
          </Panel>

          <Panel title="数据来源、口径与限制" description="本板块只做真实季度数据的统计与展示；不做点位预测，也不提供买卖建议。">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">数据源</p>
                <ul className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-foreground/85">
                  {valuation.sources.map((s) => (
                    <li key={s.id} className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
                      <span className="font-medium">{s.label}</span>
                      <span className={`ml-1.5 ${s.ok ? "text-[var(--d-mint)]" : "text-[var(--d-red)]"}`}>
                        {s.mode === "live" && s.ok ? "实时" : s.ok ? "快照" : "降级"}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">{s.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  快照生成于 {valuation.meta.snapshot.generatedAt.slice(0, 10)}；市值与 GDP 均为季度频率，最新季度通常滞后于当前日期。
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">限制</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                  {valuation.limits.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
            <details className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">指标定义</summary>
              <dl className="mt-1.5 space-y-1 text-[11px] leading-relaxed">
                {Object.entries(valuation.definition).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-medium text-foreground/85">{k}：</dt>
                    <dd className="inline text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="mt-2 text-[11px] text-muted-foreground">{valuation.disclaimer}</p>
          </Panel>

          <ValuationAi payload={valuation} liveRefresh={liveRefresh} years={years} />
        </>
      )}
    </div>
  );
}
