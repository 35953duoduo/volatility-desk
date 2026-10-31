import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import CycleAi from "@/src/CycleAi";
import { Delta, EmptyState, Panel, Th, Td } from "@/src/ui-kit";
import { fmt, fmtSigned, type CycleIndexKey, type CyclePayload, type CyclePhaseKey, type CyclePhaseRow } from "@/lib/api";

const CYCLE_RANGES = [
  { value: "1", label: "1 年" },
  { value: "3", label: "3 年" },
  { value: "5", label: "5 年" },
  { value: "all", label: "全部" },
];

const INDEX_COLOR: Record<CycleIndexKey, string> = {
  NDX100: "var(--d-rv21)",
  SPX: "var(--d-mint)",
  SSE: "var(--d-vxn)",
};

export const PHASE_COLOR: Record<CyclePhaseKey, string> = {
  prosperity: "var(--d-mint)",
  recession: "var(--d-vxn)",
  depression: "var(--d-red)",
  recovery: "var(--d-rv21)",
};

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

function SourcePill({ source }: { source: { id: string; label: string; mode: string; ok: boolean; note: string } }) {
  const live = source.mode === "live" && source.ok;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/80 bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground"
      title={source.note}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${live ? "bg-[var(--d-mint)]" : source.ok ? "bg-[var(--d-vxn)]" : "bg-[var(--d-red)]"}`} />
      <span className="max-w-56 truncate">{source.label}</span>
      <span className="tnum shrink-0 opacity-70">{live ? "实时" : source.ok ? "快照" : "降级"}</span>
    </span>
  );
}

/** 康波相位示意：纯理论图形，不对应具体年份 */
function WaveSketch() {
  const width = 520;
  const height = 92;
  const mid = 48;
  const amp = 30;
  const points: string[] = [];
  for (let x = 0; x <= width; x += 4) {
    const t = x / width;
    const y = mid - Math.sin(t * Math.PI * 2 - Math.PI / 2) * amp * (0.75 + 0.25 * Math.sin(t * Math.PI));
    points.push(`${x},${y.toFixed(1)}`);
  }
  const segments: { key: CyclePhaseKey; label: string; x: number }[] = [
    { key: "recovery", label: "回升", x: 0.06 },
    { key: "prosperity", label: "繁荣", x: 0.31 },
    { key: "recession", label: "衰退", x: 0.56 },
    { key: "depression", label: "萧条", x: 0.81 },
  ];
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label="康波四阶段相位示意图">
        <line x1="0" y1={mid} x2={width} y2={mid} stroke="var(--chart-axis)" strokeDasharray="3 4" strokeOpacity="0.6" />
        <polyline points={points.join(" ")} fill="none" stroke="var(--d-price)" strokeWidth="1.6" />
        {segments.map((s) => (
          <text key={s.key} x={width * s.x} y={height - 4} fontSize="11" fill={PHASE_COLOR[s.key]}>
            {s.label}
          </text>
        ))}
      </svg>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        示意图仅表达「回升 → 繁荣 → 衰退 → 萧条」的循环概念，横轴不是真实年份；一轮康波通常被认为跨越 40–60 年，阶段划分在研究者之间并不一致。
      </p>
    </div>
  );
}

function PhaseBars({ phase }: { phase: CyclePhaseRow }) {
  return (
    <div className="space-y-1.5">
      {phase.scores.map((s) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{s.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full"
              style={{ width: `${s.score}%`, backgroundColor: PHASE_COLOR[s.key], opacity: s.key === phase.phase ? 1 : 0.45 }}
            />
          </div>
          <span className="tnum w-7 shrink-0 text-right text-[11px]" style={{ color: s.key === phase.phase ? PHASE_COLOR[s.key] : undefined }}>
            {s.score}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Cycle({
  cycle,
  loading,
  error,
  years,
  onYearsChange,
  liveRefresh,
}: {
  cycle: CyclePayload | null;
  loading: boolean;
  error: string | null;
  years: number | null;
  onYearsChange: (years: number | null) => void;
  liveRefresh: boolean;
}) {
  const domain = useMemo<[number, number]>(() => {
    if (!cycle) return [60, 160];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of cycle.chart) {
      for (const v of [p.NDX100, p.SPX, p.SSE]) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) return [60, 160];
    const pad = Math.max(5, (hi - lo) * 0.08);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [cycle]);

  const ratioDomain = useMemo<[number, number]>(() => {
    if (!cycle) return [70, 130];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of cycle.chart) {
      for (const v of [p.ndxSpx, p.ndxSse]) {
        if (v === null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) return [70, 130];
    const pad = Math.max(4, (hi - lo) * 0.08);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [cycle]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-border/80 text-[10px]">
            康波 × 纳指100 · 标普500 · 上证
          </Badge>
          {cycle ? (
            <span className="tnum text-[11px] text-muted-foreground">
              数据截至 {cycle.asOf} · 窗口 {cycle.window.from} → {cycle.window.to}（{cycle.window.days} 个共同交易日）
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
          aria-label="康波对照回溯年数"
        >
          {CYCLE_RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} size="sm" className="h-8 px-2.5 text-xs">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>康波对照接口未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {!cycle && loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px] w-full rounded-lg" />
          ))}
        </div>
      ) : !cycle ? (
        <EmptyState text="尚未取到康波对照数据，请稍后重试。" />
      ) : (
        <>
          <Alert className="border-[var(--d-price)]/30 bg-[var(--d-price)]/5">
            <AlertTitle>康波是理论框架，不是定时器</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              本站不判断「当前处于第几波第几年」。三指数共同交易日自 2019 年 4 月起，约七年多，远短于一轮 40–60 年康波，
              因此这里只做两件事：用真实行情对比三个市场，再把它们的可观测状态映射到四阶段的典型特征。
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cycle.indices.map((m) => {
              const phase = cycle.phases.find((p) => p.index === m.key);
              return (
                <Card key={m.key} className="gap-0 border-border/70 bg-card/60 py-0">
                  <CardContent className="p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: INDEX_COLOR[m.key] }} />
                        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{m.label}</p>
                        <span className="text-[10px] text-muted-foreground">{m.market}</span>
                      </div>
                      <span className="tnum text-[10px] text-muted-foreground">{m.asOf}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
                      <span className="tnum text-2xl leading-none font-semibold" style={{ color: INDEX_COLOR[m.key] }}>
                        {fmt(m.close, 2)}
                      </span>
                      <span className="text-[11px]">
                        <Delta value={m.dayChangePct} />
                      </span>
                      {phase ? (
                        <Badge variant="outline" className="ml-auto text-[10px]" style={{ color: PHASE_COLOR[phase.phase] }}>
                          接近「{phase.phaseLabel}」特征
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
                      {[
                        { label: "3M", value: m.returns.m3 },
                        { label: "YTD", value: m.returns.ytd },
                        { label: "1Y", value: m.returns.y1 },
                        { label: "窗口", value: m.returns.window },
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
                      3 年年化 {fmtSigned(m.cagr3y, 1, "%")} · 21 日波动 {fmt(m.vol21, 1)}% · 距 1 年高点 {fmtSigned(m.drawdown1y, 1, "%")}
                    </p>
                    <p className="tnum mt-1 text-[10px] text-muted-foreground">
                      200 日线距离 {fmtSigned(m.ma200DistancePct, 1, "%")} · 63 日动量 {fmtSigned(m.momentum63, 1, "%")}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Panel
            title="三指数归一化走势"
            description={`以 ${cycle.window.from} 共同交易日收盘 = 100 归一化，直接比较三个市场在同一窗口的相对涨跌；价格为本币计价，不含股息与汇率换算。`}
            action={
              <span className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {cycle.indices.map((m) => (
                  <span key={m.key} className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: INDEX_COLOR[m.key] }} />
                    {m.short}
                  </span>
                ))}
              </span>
            }
          >
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={cycle.chart} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                  <YAxis domain={domain} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" width={44} />
                  <ReferenceLine y={100} stroke="var(--chart-axis)" strokeDasharray="3 4" strokeOpacity={0.6} />
                  <Tooltip {...tooltipStyle()} isAnimationActive={false} formatter={(v: unknown) => Number(v).toFixed(1)} />
                  <Line type="monotone" dataKey="NDX100" name="纳指100（=100）" stroke={INDEX_COLOR.NDX100} strokeWidth={1.6} dot={false} />
                  <Line type="monotone" dataKey="SPX" name="标普500（=100）" stroke={INDEX_COLOR.SPX} strokeWidth={1.6} dot={false} />
                  <Line type="monotone" dataKey="SSE" name="上证（=100）" stroke={INDEX_COLOR.SSE} strokeWidth={1.6} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              图表按{cycle.chartFreq === "1w" ? "周线（每周最后一个共同交易日）" : "日线"}采样，共 {cycle.chart.length} 个点；指标始终基于完整窗口计算。
              当前组合判断：{cycle.resonance.label}。
            </p>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
            <Panel
              title="康波四阶段框架"
              description="教科书式的长波特征描述，属于理论背景而非实时数据；右侧「可观测判据」才是本站真正用于打分的规则。"
              className="min-w-0"
            >
              <WaveSketch />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {cycle.framework.map((info) => {
                  return (
                    <div key={info.key} className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
                      <p className="text-[11px] font-medium" style={{ color: PHASE_COLOR[info.key] }}>
                        {info.label}（{info.english}）
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">
                        增长：{info.growth}；通胀：{info.inflation}；利率：{info.rates}。
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">权益：{info.equity}。</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{info.observable}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel
              title="四阶段匹配度（启发式）"
              description="把趋势、压力、深度回撤与修复四个可观测维度映射到四阶段特征；分数是特征接近程度，不是概率，也不是买卖信号。"
              className="min-w-0"
            >
              <div className="space-y-3">
                {cycle.phases.map((p) => (
                  <div key={p.index} className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: INDEX_COLOR[p.index] }} />
                        {p.label}
                      </span>
                      <Badge variant="outline" className="text-[10px]" style={{ color: PHASE_COLOR[p.phase] }}>
                        {p.phaseLabel}
                      </Badge>
                      <span className="tnum ml-auto text-[10px] text-muted-foreground">区分度 {p.separation}</span>
                    </div>
                    <div className="mt-2">
                      <PhaseBars phase={p} />
                    </div>
                    <p className="tnum mt-2 text-[10px] text-muted-foreground">
                      趋势 {p.drivers.trend} · 压力 {p.drivers.stress} · 深度回撤 {p.drivers.deepDrawdown} · 修复 {p.drivers.repair}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.explanation}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
            <Panel
              title="相对强弱"
              description="比值 = 指数 A 收盘 ÷ 指数 B 收盘，再以窗口首日 = 100 归一化；上升表示 A 相对 B 走强，不含汇率换算。"
              className="min-w-0"
              action={
                <span className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: "var(--d-price)" }} />
                    纳指100 ÷ 标普500
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: "var(--d-rv63)" }} />
                    纳指100 ÷ 上证
                  </span>
                </span>
              }
            >
              <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={cycle.chart} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                    <YAxis domain={ratioDomain} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" width={44} />
                    <ReferenceLine y={100} stroke="var(--chart-axis)" strokeDasharray="3 4" strokeOpacity={0.6} />
                    <Tooltip {...tooltipStyle()} isAnimationActive={false} formatter={(v: unknown) => Number(v).toFixed(1)} />
                    <Line type="monotone" dataKey="ndxSpx" name="纳指100 ÷ 标普500（=100）" stroke="var(--d-price)" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="ndxSse" name="纳指100 ÷ 上证（=100）" stroke="var(--d-rv63)" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border/70">
                      <Th>比值</Th>
                      <Th right>最新</Th>
                      <Th right>窗口变化</Th>
                      <Th right>近一年</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycle.ratios.map((r) => (
                      <tr key={r.pair} className="border-b border-border/50 last:border-0">
                        <Td>{r.label}</Td>
                        <Td right>
                          <span className="tnum">{r.latest.toFixed(4)}</span>
                        </Td>
                        <Td right>
                          <Delta value={r.windowChangePct} />
                        </Td>
                        <Td right>
                          <Delta value={r.y1ChangePct} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="跨市场相关性"
              description="共同交易日日收益率的 Pearson 相关系数；展示矩阵取最近 252 对，挂起查看最近 63 对。相关性不等于因果。"
              className="min-w-0"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[300px] border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-border/70 text-muted-foreground">
                      <th className="px-1.5 py-1.5 text-left font-medium"> </th>
                      {cycle.correlations.labels.map((l) => (
                        <th key={l} className="px-1.5 py-1.5 text-right font-medium">
                          {l}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cycle.correlations.matrix.map((row, i) => (
                      <tr key={cycle.correlations.labels[i]} className="border-b border-border/50 last:border-0">
                        <td className="px-1.5 py-1.5 text-left text-muted-foreground">{cycle.correlations.labels[i]}</td>
                        {row.map((v, j) => {
                          if (v === null)
                            return (
                              <td key={`${i}-${j}`} className="px-1.5 py-1.5 text-right text-muted-foreground">
                                —
                              </td>
                            );
                          const color = v > 0 ? "var(--d-mint)" : "var(--d-red)";
                          const alpha = Math.round(Math.min(1, Math.abs(v)) * 34);
                          return (
                            <td key={`${i}-${j}`} className="px-0.5 py-0.5 text-right">
                              <span
                                className={`tnum inline-block w-full rounded px-1 py-0.5 text-right ${Math.abs(v) >= 0.6 ? "font-semibold" : ""}`}
                                style={{ backgroundColor: `color-mix(in srgb, ${color} ${alpha}%, transparent)` }}
                                title={`最近 63 个交易日：${cycle.corr63.matrix[i]?.[j]?.toFixed(2) ?? "—"}`}
                              >
                                {v.toFixed(2)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                纳指100 与标普500同属美股，相关性天然偏高；它们与上证的相关性明显更低，说明 A 股能提供一定的分散效果，但不代表永远负相关或避险。
              </p>
              <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-2.5">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">窗口结论</p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{cycle.resonance.summary}</p>
              </div>
            </Panel>
          </div>

          <Panel title="数据来源、口径与限制" description="本板块只做真实行情对比与固定规则的阶段映射；不做长波年份判定，也不输出买卖点。">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">数据源</p>
                <ul className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-foreground/85">
                  {cycle.meta.sources.map((s) => (
                    <li key={s.id} className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
                      <span className="font-medium">{s.label}</span>
                      <span className={`ml-1.5 ${s.ok ? "text-[var(--d-mint)]" : "text-[var(--d-red)]"}`}>
                        {s.mode === "live" && s.ok ? "实时" : s.ok ? "快照" : "降级"}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">{s.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">限制</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/85">
                  {cycle.limits.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
            <details className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">指标定义与打分公式</summary>
              <dl className="mt-1.5 space-y-1 text-[11px] leading-relaxed">
                {Object.entries(cycle.definition).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-medium text-foreground/85">{k}：</dt>
                    <dd className="inline text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="mt-2 text-[11px] text-muted-foreground">{cycle.disclaimer}</p>
          </Panel>

          <CycleAi payload={cycle} liveRefresh={liveRefresh} years={years} />
        </>
      )}
    </div>
  );
}
