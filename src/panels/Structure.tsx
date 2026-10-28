import { Bar, BarChart, CartesianGrid, Cell, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Panel, Th, Td } from "@/src/ui-kit";
import { fmt, type DiagnosisPayload, type SnapshotPayload } from "@/lib/api";

const tooltipBase = {
  contentStyle: {
    background: "var(--tooltip-bg)",
    border: "1px solid var(--tooltip-border)",
    borderRadius: 10,
    fontSize: 12,
    padding: "6px 10px",
    boxShadow: "var(--tooltip-shadow)",
  },
  labelStyle: { color: "var(--tooltip-label)", fontSize: 11 },
  itemStyle: { color: "var(--tooltip-item)", padding: 0 },
};

/** 图表气泡里的数值一律带单位，避免把百分比读成点数 */
function tooltipStyle(format: (value: number) => string) {
  return {
    ...tooltipBase,
    formatter: (value: unknown, name: unknown) => {
      const n = Number(value);
      return [Number.isFinite(n) ? format(n) : "—", String(name)] as [string, string];
    },
  };
}

function heat(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-muted-foreground";
  if (value >= 6) return "text-[var(--d-mint)] font-semibold";
  if (value >= 2) return "text-[var(--d-mint)]";
  if (value > 0) return "text-foreground/80";
  return "text-[var(--d-red)]";
}

export default function Structure({
  snapshot,
  diagnosis,
}: {
  snapshot: SnapshotPayload | null;
  diagnosis: DiagnosisPayload | null;
}) {
  const annual = (snapshot?.annual ?? []).filter((a) => a.avgRv21 !== null);
  const dist = snapshot?.distribution ?? [];
  const regime = diagnosis?.regimeStudy ?? [];
  const matrix = diagnosis?.volTrendMatrix ?? [];
  const hasVxnAnnual = annual.some((a) => a.avgVxn !== null);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="年度波动与收益"
          description={
            <span>
              柱：当年平均 21 日已实现波动率；虚线：当年最高波动；折线：当年涨跌幅。
              {hasVxnAnnual ? " 橙线：当年平均 VXN。" : " （VXN 上游不可达，故无橙线）"}
            </span>
          }
        >
          {annual.length === 0 ? (
            <EmptyState text="暂无年度统计。" />
          ) : (
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={244}>
                <BarChart data={annual} margin={{ top: 8, right: 10, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                  <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" tickFormatter={(v) => `${v}%`} />
                  <Tooltip {...tooltipStyle((n) => n.toFixed(2) + "%")} cursor={{ fill: "var(--cursor-cool)" }} isAnimationActive={false} />
                  <Bar dataKey="avgRv21" name="平均 RV21" fill="var(--d-rv21)" fillOpacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={26} />
                  <Line type="monotone" dataKey="maxRv21" name="最高 RV21" stroke="var(--d-red)" strokeWidth={1.2} strokeDasharray="4 3" dot={false} />
                  <Line type="monotone" dataKey="changePct" name="当年涨跌幅" stroke="var(--d-mint)" strokeWidth={1.6} dot={{ r: 2 }} />
                  {hasVxnAnnual ? (
                    <Line type="monotone" dataKey="avgVxn" name="平均 VXN" stroke="var(--d-vxn)" strokeWidth={1.2} dot={false} />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="波动率分布" description="全部可得样本的 21 日已实现波动率直方图，用于观察中枢与尾部。">
          {dist.length === 0 ? (
            <EmptyState text="暂无分布数据。" />
          ) : (
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={244}>
                <BarChart data={dist} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} stroke="var(--chart-axis)" interval={1} />
                  <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
                  <Tooltip {...tooltipStyle((n) => `${n.toLocaleString("zh-CN")} 个交易日`)} cursor={{ fill: "var(--cursor-warm)" }} isAnimationActive={false} />
                  <Bar dataKey="count" name="交易日数" radius={[2, 2, 0, 0]} maxBarSize={30}>
                    {dist.map((d) => (
                      <Cell
                        key={d.label}
                        fill={d.from >= 30 ? "var(--d-red)" : d.from >= 22 ? "var(--d-vxn)" : d.from >= 15 ? "var(--d-rv21)" : "var(--d-rv63)"}
                        fillOpacity={0.7}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="波动率分位 → 未来 63 个交易日表现"
        description="按当前波动率所处 5 年分位分桶，统计其后约 3 个月的真实涨跌分布。这是买卖诊断的历史校准，不代表未来结果。"
      >
        {regime.length === 0 ? (
          <EmptyState text="正在计算历史分位表现…" />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <Th>波动率分位区间</Th>
                  <Th right>样本数</Th>
                  <Th right>平均 63 日</Th>
                  <Th right>中位 63 日</Th>
                  <Th right>正收益概率</Th>
                  <Th right>最差</Th>
                  <Th right>最好</Th>
                  <Th right>平均 126 日</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regime.map((r) => (
                  <TableRow key={r.bucket} className="border-border/50">
                    <TableCell className="px-2.5 py-2 text-xs">{r.bucket}</TableCell>
                    <Td right>{r.samples}</Td>
                    <Td right className={heat(r.avg63)}>{r.avg63 === null ? "—" : `${r.avg63 > 0 ? "+" : ""}${r.avg63.toFixed(2)}%`}</Td>
                    <Td right>{r.median63 === null ? "—" : `${r.median63 > 0 ? "+" : ""}${r.median63.toFixed(2)}%`}</Td>
                    <Td right>{r.winRate63 === null ? "—" : `${r.winRate63.toFixed(0)}%`}</Td>
                    <Td right>{r.worst63 === null ? "—" : `${r.worst63.toFixed(2)}%`}</Td>
                    <Td right>{r.best63 === null ? "—" : `+${r.best63.toFixed(2)}%`}</Td>
                    <Td right>{r.avg126 === null ? "—" : `${r.avg126 > 0 ? "+" : ""}${r.avg126.toFixed(2)}%`}</Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          读法示例：若「极端恐慌」桶的平均 63 日收益明显高于「极度压缩」桶，说明高波动时加仓在历史上更占优；反之则应更重视趋势确认。
        </p>
      </Panel>

      <Panel title="波动率状态 × 长期趋势" description="同样的高波动，在 200 日线上/下方含义完全不同：矩阵用于区分「恐慌买点」与「下跌中继」。">
        {matrix.length === 0 ? (
          <EmptyState text="正在计算矩阵…" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {["低波动 <15", "中性 15–22", "偏高 22–30", "恐慌 ≥30"].map((volLabel) => {
              const cells = matrix.filter((c) => c.vol === volLabel);
              return (
                <div key={volLabel} className="rounded-md border border-border/60 bg-secondary/30 p-3">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{volLabel}</p>
                  <div className="mt-2 space-y-2">
                    {cells.map((c) => (
                      <div key={c.trend} className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">{c.trend}</span>
                        <span className={`tnum text-sm ${heat(c.avg63)}`}>{c.avg63 === null ? "—" : `${c.avg63 > 0 ? "+" : ""}${fmt(c.avg63)}%`}</span>
                        <span className="tnum text-[11px] text-muted-foreground">{c.winRate63 === null ? "" : `${c.winRate63.toFixed(0)}%`}</span>
                      </div>
                    ))}
                    <p className="tnum pt-1 text-[10px] text-muted-foreground/80">样本 {cells.reduce((a, c) => a + c.samples, 0)} 个交易日</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
