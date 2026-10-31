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
import { Delta, EmptyState, Panel, Stat, numText, pctText, regimeTone } from "@/src/ui-kit";
import PanicStrip from "@/src/panels/Panic";
import { type HistoryPayload, type PanicPayload, type SnapshotPayload, type VolPointRow, fmt } from "@/lib/api";

function tick(date: string): string {
  return date.slice(0, 7);
}

function volTooltip(unitFor: (name: unknown) => string) {
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
    formatter: (value: unknown, name: unknown) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return ["—", String(name)];
      const unit = unitFor(name);
      return [unit === "%" ? `${n.toFixed(2)}%` : n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + unit, String(name)];
    },
  };
}

export default function Overview({
  history,
  snapshot,
  panic,
  loading,
}: {
  history: HistoryPayload | null;
  snapshot: SnapshotPayload | null;
  panic: PanicPayload | null;
  loading: boolean;
}) {
  const series = history?.series ?? [];
  const metrics = snapshot?.metrics ?? null;
  const hasVxn = useMemo(() => series.some((p) => p.vxn !== null), [series]);
  const hasMa = useMemo(() => series.some((p) => p.ma200 !== null), [series]);
  const extremes = useMemo(() => {
    const rows = series.filter((p) => p.rv21 !== null);
    const picked: VolPointRow[] = [];
    for (const p of rows) {
      if (picked.length < 6 || (p.rv21 as number) > Math.min(...picked.map((x) => x.rv21 as number))) {
        picked.push(p);
        picked.sort((a, b) => (b.rv21 as number) - (a.rv21 as number));
        if (picked.length > 6) picked.pop();
      }
    }
    return picked;
  }, [series]);

  const tone = regimeTone(metrics?.volRegimeKey);
  const pct5 = metrics?.volPercentile5y ?? null;
  const volTop = useMemo(() => {
    let m = 40;
    for (const p of series) {
      m = Math.max(m, p.rv21 ?? 0, p.rv63 ?? 0, p.vxn ?? 0);
    }
    return Math.ceil((m + 8) / 10) * 10;
  }, [series]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="21 日已实现波动率"
          value={numText(metrics?.realizedVol21)}
          unit="%"
          tone="cyan"
          loading={loading && !metrics}
          hint={metrics ? `63 日 ${numText(metrics.realizedVol63)}% · 年化，由真实收盘价计算` : ""}
        />
        <Stat
          label="波动率 5 年分位"
          value={pct5 === null ? "—" : pct5.toFixed(0)}
          unit="%"
          tone={pct5 === null ? "default" : pct5 >= 80 ? "red" : pct5 <= 20 ? "amber" : "default"}
          loading={loading && !metrics}
          hint={metrics ? `全样本分位 ${pctText(metrics.volPercentileAll)}` : ""}
        />
        <Stat
          label="波动率 Z 分数"
          value={metrics ? (metrics.volZScore === null ? "—" : (metrics.volZScore > 0 ? "+" : "") + metrics.volZScore.toFixed(2)) : "—"}
          tone="default"
          loading={loading && !metrics}
          hint="相对自身 252 日均值的标准差"
        />
        <Stat
          label="VXN 隐含波动率"
          value={hasVxn ? numText(metrics?.impliedVol) : "不可达"}
          unit={hasVxn ? "%" : ""}
          tone={hasVxn ? "amber" : "muted"}
          loading={loading && !metrics}
          hint={
            hasVxn
              ? `保险成本 隐含−已实现 ${fmt(metrics?.impliedPremium ?? null)}`
              : "CBOE / FRED 上游在本环境不可达，隐含波动率暂缺，已回落为已实现波动率"
          }
        />
        <Stat
          label={history?.meta.symbolLabel ?? "指数收盘"}
          value={metrics ? metrics.close.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—"}
          loading={loading && !metrics}
          hint={metrics ? <span>当日 <Delta value={metrics.dayChangePct} /> · 距 52 周高点 {pctText(metrics.drawdown52w)}</span> : ""}
        />
        <Stat
          label="波动状态"
          value={metrics ? tone.label : "—"}
          tone={metrics?.volRegimeKey === "panic" ? "red" : metrics?.volRegimeKey === "compressed" ? "amber" : "mint"}
          loading={loading && !metrics}
          hint={metrics ? metrics.volRegime : "<15 压缩 · 15–22 中性 · 22–30 偏高 · ≥30 恐慌"}
        />
      </div>

      <PanicStrip
        panic={panic}
        loading={loading}
        metrics={metrics}
        symbolLabel={history?.meta.symbolLabel ?? snapshot?.meta.symbolLabel ?? "所选标的"}
      />

      <Panel
        title="波动率与指数走势"
        description={
          history ? (
            <span>
              左轴：波动率（%）；右轴：{history.meta.symbolLabel} 收盘。阴影带标记恐慌区（≥30）与偏高区（22–30）。
              数据截至 {history.meta.asOf}，共 {history.count} 个采样点。
            </span>
          ) : (
            "正在读取波动率序列…"
          )
        }
        action={
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge variant="outline" className="border-[var(--d-rv21)]/40 bg-[var(--d-rv21)]/10 text-[11px] text-[var(--d-rv21)]">
              RV21
            </Badge>
            <Badge variant="outline" className="border-[var(--d-rv63)]/40 bg-[var(--d-rv63)]/10 text-[11px] text-[var(--d-rv63)]">
              RV63
            </Badge>
            {hasVxn ? (
              <Badge variant="outline" className="border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10 text-[11px] text-[var(--d-vxn)]">
                VXN
              </Badge>
            ) : null}
            <Badge variant="outline" className="border-[var(--d-price)]/40 bg-[var(--d-price)]/10 text-[11px] text-[var(--d-price)]">
              收盘价
            </Badge>
          </div>
        }
      >
        {series.length < 30 ? (
          <EmptyState text="该标的在当前时间窗内样本不足，请缩短回溯年数或改用更长历史的标的（如 QQQ）。" />
        ) : (
          <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
            <ResponsiveContainer width="100%" height={344}>
              <ComposedChart data={series} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="gRv21" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--d-rv21)" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="var(--d-rv21)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                <XAxis dataKey="date" tickFormatter={tick} minTickGap={44} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                <YAxis
                  yAxisId="vol"
                  domain={[0, volTop]}
                  tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                  stroke="var(--chart-axis)"
                  width={38}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  domain={[0, (max: number) => Math.ceil(max * 1.18)]}
                  tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
                  stroke="var(--chart-axis)"
                  width={54}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                />
                <ReferenceArea yAxisId="vol" y1={30} y2={volTop} fill="var(--d-red)" fillOpacity={0.05} />
                <ReferenceArea yAxisId="vol" y1={22} y2={30} fill="var(--d-vxn)" fillOpacity={0.05} />
                <ReferenceLine yAxisId="vol" y={22} stroke="var(--d-vxn)" strokeOpacity={0.35} strokeDasharray="3 4" />
                <ReferenceLine yAxisId="vol" y={30} stroke="var(--d-red)" strokeOpacity={0.4} strokeDasharray="3 4" />
                <Tooltip {...volTooltip((name) => (String(name).includes("收盘") ? "" : "%"))} isAnimationActive={false} />
                <Area
                  yAxisId="vol"
                  type="monotone"
                  dataKey="rv21"
                  name="21 日已实现波动率"
                  stroke="var(--d-rv21)"
                  strokeWidth={1.7}
                  fill="url(#gRv21)"
                  dot={false}
                  activeDot={{ r: 3 }}
                />
                <Line
                  yAxisId="vol"
                  type="monotone"
                  dataKey="rv63"
                  name="63 日已实现波动率"
                  stroke="var(--d-rv63)"
                  strokeWidth={1.1}
                  strokeDasharray="5 4"
                  dot={false}
                />
                {hasVxn ? (
                  <Line yAxisId="vol" type="monotone" dataKey="vxn" name="VXN 隐含波动率" stroke="var(--d-vxn)" strokeWidth={1.5} dot={false} />
                ) : null}
                <Line yAxisId="price" type="monotone" dataKey="close" name={`${history?.meta.symbolLabel ?? ""}收盘`} stroke="var(--d-price)" strokeWidth={1.3} strokeOpacity={0.85} dot={false} />
                {hasMa ? (
                  <Line yAxisId="price" type="monotone" dataKey="ma200" name="200 日均线" stroke="var(--d-mint)" strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.65} dot={false} />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr]">
        <Panel title="波动率历史分位（滚动 5 年）" description="分位越高，恐慌溢价越厚；接近 100 时历史上多为中期布局窗口，接近 0 时往往代表自满。">
          {series.length < 30 ? (
            <EmptyState text="暂无分位序列。" />
          ) : (
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={170}>
                <ComposedChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gPct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--d-vxn)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--d-vxn)" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={tick} minTickGap={44} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                  <YAxis domain={[0, 100]} ticks={[0, 20, 50, 80, 100]} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" width={34} />
                  <ReferenceArea yAxisId="left" y1={80} y2={100} fill="var(--d-red)" fillOpacity={0.07} />
                  <ReferenceArea yAxisId="left" y1={0} y2={20} fill="var(--d-vxn)" fillOpacity={0.07} />
                  <Tooltip {...volTooltip(() => "%")} isAnimationActive={false} />
                  <Area type="monotone" dataKey="pct5y" name="5 年分位" stroke="var(--d-vxn)" strokeWidth={1.4} fill="url(#gPct)" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="窗口内波动率峰值" description="按 21 日已实现波动率排序，用于定位恐慌尖峰与当时的价格位置。">
          {extremes.length === 0 ? (
            <EmptyState text="窗口内没有可用样本。" />
          ) : (
            <table className="w-full">
              <tbody>
                {extremes.map((p) => (
                  <tr key={p.date} className="border-b border-border/50 last:border-0">
                    <td className="tnum py-1.5 pr-2 text-xs text-muted-foreground">{p.date}</td>
                    <td className="tnum py-1.5 pr-2 text-xs font-semibold text-[var(--d-rv21)]">{fmt(p.rv21)}%</td>
                    <td className="tnum py-1.5 pr-2 text-right text-xs text-muted-foreground">
                      分位 {p.pct5y === null ? "—" : p.pct5y.toFixed(0)}%
                    </td>
                    <td className="tnum py-1.5 text-right text-xs">
                      <Delta value={p.drawdown} digits={1} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
