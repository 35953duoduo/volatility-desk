import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, Panel, Td, Th } from "@/src/ui-kit";
import { fmt, type EventOutcomeRow, type EventStudyPayload, type ReportEventRow } from "@/lib/api";
import LiveReports from "@/src/LiveReports";

const tooltipStyle = {
  contentStyle: {
    background: "var(--tooltip-bg)",
    border: "1px solid var(--tooltip-border)",
    borderRadius: 10,
    fontSize: 12,
    padding: "6px 10px",
  },
  labelStyle: { color: "var(--tooltip-label)", fontSize: 11 },
  itemStyle: { color: "var(--tooltip-item)", padding: 0 },
};

const PALETTE = ["var(--d-rv21)", "var(--d-vxn)", "var(--d-rv63)", "var(--d-price)"];
const STANCE_COLOR: Record<string, string> = { 看多: "var(--d-mint)", 看空: "var(--d-red)" };
const DEFINITION_LABEL: Record<string, string> = {
  anchorDate: "锚点日",
  ret: "累计收益",
  peak60: "60 日峰值",
  trough60: "60 日回撤",
  baseline: "无条件基准",
  path: "反应路径",
};

function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function retClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-muted-foreground";
  return value > 0 ? "text-[var(--d-mint)]" : value < 0 ? "text-[var(--d-red)]" : "text-foreground/80";
}

function StanceBadge({ stance }: { stance: string }) {
  const bull = stance === "看多";
  return (
    <Badge
      variant="outline"
      className={`px-1.5 py-0 text-[10px] font-normal ${
        bull ? "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10 text-[var(--d-mint)]" : "border-[var(--d-red)]/45 bg-[var(--d-red)]/10 text-[var(--d-red)]"
      }`}
    >
      {stance}
    </Badge>
  );
}

/** 把同一偏移量的多条路径按事件立场求平均，得到「平均反应路径」 */
function averagePath(rows: { stance: string; outcome: EventOutcomeRow }[]) {
  const buckets = new Map<string, { offset: number; date: string; 看多: number[]; 看空: number[] }>();
  for (const { stance, outcome } of rows) {
    for (const p of outcome.path) {
      const key = `${p.offset}`;
      const cell = buckets.get(key) ?? { offset: p.offset, date: p.date, 看多: [], 看空: [] };
      (cell[stance as "看多" | "看空"] ?? []).push(p.ret);
      buckets.set(key, cell);
    }
  }
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  return [...buckets.values()]
    .sort((a, b) => a.offset - b.offset)
    .map((c) => ({ offset: c.offset, 看多: mean(c.看多), 看空: mean(c.看空) }));
}

export default function ReportStudy({
  study,
  loading,
  error,
  activeSymbol,
}: {
  study: EventStudyPayload | null;
  loading: boolean;
  error: string | null;
  activeSymbol: string;
}) {
  const events = study?.events ?? [];
  const horizons = study?.meta.horizons ?? [];
  const [selectedId, setSelectedId] = useState<string>("");
  const [focus, setFocus] = useState<string>("");

  const symbol = useMemo(() => {
    const keys = (study?.study ?? []).map((s) => s.symbol);
    if (keys.includes(focus)) return focus;
    if (keys.includes(activeSymbol)) return activeSymbol;
    return keys.includes("CSI300") ? "CSI300" : keys[0] ?? "";
  }, [focus, study, activeSymbol]);

  const outcomeOf = (sym: string, eventId: string) => study?.study.find((s) => s.symbol === sym)?.outcomes.find((o) => o.eventId === eventId);
  const selected = useMemo(() => {
    const id = selectedId && events.some((e) => e.id === selectedId) ? selectedId : events[events.length - 1]?.id;
    return events.find((e) => e.id === id) ?? null;
  }, [events, selectedId]);

  if (loading && !study) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (!study || study.study.length === 0) {
    return (
      <Panel title="大摩 A 股报告复盘" description="未能取得复盘数据。">
        {error ? <p className="text-xs text-[var(--d-red)]">{error}</p> : null}
        <EmptyState text="接口 /api/events/study 未返回可用样本，可在「API 接口」标签页重试该请求。" />
      </Panel>
    );
  }

  const studiedSymbols = study.study;
  const chartRows = selected
    ? (() => {
        const perSymbol = studiedSymbols.map((s) => ({ symbol: s.symbol, outcome: outcomeOf(s.symbol, selected.id) }));
        const offsets = new Set<number>();
        for (const p of perSymbol) p.outcome?.path.forEach((x) => offsets.add(x.offset));
        return [...offsets]
          .sort((a, b) => a - b)
          .map((offset) => {
            const row: Record<string, number | string | null> = { offset, label: `T${offset > 0 ? "+" : ""}${offset}` };
            for (const p of perSymbol) {
              const hit = p.outcome?.path.find((x) => x.offset === offset);
              row[p.symbol] = hit ? hit.ret : null;
            }
            return row;
          });
      })()
    : [];

  const focusStudy = studiedSymbols.find((s) => s.symbol === symbol) ?? studiedSymbols[0];
  const pathRows = selected ? chartRows : [];
  const avgSource = focusStudy
    ? focusStudy.outcomes
        .map((o) => ({ stance: events.find((e) => e.id === o.eventId)?.stance ?? "", outcome: o }))
        .filter((r) => r.stance === "看多" || r.stance === "看空")
    : [];
  const avgRows = averagePath(avgSource);
  const bullCount = avgSource.filter((r) => r.stance === "看多").length;
  const bearCount = avgSource.filter((r) => r.stance === "看空").length;

  const baselineRows = study.baseline.find((b) => b.symbol === focusStudy.symbol)?.rows ?? [];
  const stanceRows = study.stanceSummary.find((b) => b.symbol === focusStudy.symbol)?.rows ?? [];

  return (
    <div className="space-y-3">
      <LiveReports />

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="border-border/80 text-[10px]">
          {study.provenance.broker}
        </Badge>
        <Badge variant="outline" className="border-border/80 text-[10px]">
          {events.length} 份报告
        </Badge>
        <Badge variant="outline" className="border-border/80 text-[10px]">
          {studiedSymbols.map((s) => s.label).join(" / ")}
        </Badge>
        <span>
          事件表为 {study.provenance.curatedBy}；
          {studiedSymbols.map((s) => `${s.label} ${s.window.from} → ${s.window.to}（${s.bars} 根日线）`).join("；")}。
        </span>
        {study.skipped.length ? <span className="text-[var(--d-vxn)]">未覆盖标的：{study.skipped.join("、")}</span> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="报告时间线" description="点击任一报告，下方的反应路径、目标位调整与逐事件明细随之切换。">
          {events.length === 0 ? (
            <EmptyState text="暂无事件记录。" />
          ) : (
            <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
              {events.map((e) => {
                const isActive = selected?.id === e.id;
                const covered = studiedSymbols.some((s) => s.outcomes.some((o) => o.eventId === e.id));
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                      isActive ? "border-[var(--d-rv21)]/55 bg-[var(--d-rv21)]/10" : "border-border/60 bg-secondary/25 hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="tnum text-[11px] text-muted-foreground">{e.date}</span>
                      <StanceBadge stance={e.stance} />
                    </div>
                    <p className="mt-1 text-xs leading-snug font-medium">{e.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {e.action}
                      {covered ? "" : " · 尚无足够行情样本"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{study.provenance.caveat}</p>
        </Panel>

        <Panel
          title={selected ? `${selected.date} · ${selected.title}` : "报告前后累计收益"}
          description={
            <span>
              纵轴：相对锚点（报告记载日当日或其后的首个交易日）收盘价的累计涨跌幅；横轴为交易日偏移，T0 即锚点当日，T−20 用于观察报告发布前市场是否已经抢跑。
            </span>
          }
        >
          {pathRows.length === 0 ? (
            <EmptyState text="该报告日期晚于可得行情末尾，暂无路径。" />
          ) : (
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={pathRows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" />
                  <XAxis dataKey="offset" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} stroke="var(--chart-axis)" interval={4} tickFormatter={(v) => `T${v > 0 ? "+" : ""}${v}`} />
                  <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    {...tooltipStyle}
                    isAnimationActive={false}
                    labelFormatter={(v) => `第 ${Number(v) > 0 ? "+" : ""}${v} 个交易日`}
                    formatter={(value: unknown, name: unknown) => [signed(Number(value)), String(name)]}
                  />
                  <ReferenceLine y={0} stroke="var(--zero-line)" />
                  <ReferenceLine x={0} stroke="var(--d-price)" strokeDasharray="4 3" label={{ value: "报告", fill: "var(--d-price)", fontSize: 10, position: "insideTopRight" }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--tooltip-label)" }} iconSize={8} />
                  {studiedSymbols.map((s, i) => (
                    <Line
                      key={s.symbol}
                      type="monotone"
                      dataKey={s.symbol}
                      name={s.label}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={1.8}
                      dot={{ r: 1.6 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {selected ? <EventDetail event={selected} study={study} /> : null}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="平均反应路径：看多 vs 看空"
          description={
            <span>
              按同一立场的若干报告，对每个交易日偏移取累计收益均值（{focusStudy?.label ?? ""}：看多 {bullCount} 次 / 看空 {bearCount} 次）。样本极少，只能作为观察，不能当作规律。
            </span>
          }
          action={
            <ToggleGroup type="single" value={symbol} onValueChange={(v) => v && setFocus(v)} spacing={2} variant="outline" size="sm" aria-label="选择指数">
              {studiedSymbols.map((s) => (
                <ToggleGroupItem key={s.symbol} value={s.symbol} size="sm" className="h-7 px-2 text-[11px]">
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        >
          {avgRows.length === 0 ? (
            <EmptyState text="该指数暂无可对齐的事件路径。" />
          ) : (
            <div className="grid-canvas rounded-md border border-border/60 bg-secondary/20 p-2">
              <ResponsiveContainer width="100%" height={236}>
                <LineChart data={avgRows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" />
                  <XAxis dataKey="offset" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} stroke="var(--chart-axis)" interval={5} tickFormatter={(v) => `T${v > 0 ? "+" : ""}${v}`} />
                  <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    {...tooltipStyle}
                    isAnimationActive={false}
                    labelFormatter={(v) => `第 ${Number(v) > 0 ? "+" : ""}${v} 个交易日`}
                    formatter={(value: unknown, name: unknown) => [signed(Number(value)), String(name)]}
                  />
                  <ReferenceLine y={0} stroke="var(--zero-line)" />
                  <ReferenceLine x={0} stroke="var(--d-price)" strokeDasharray="4 3" />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--tooltip-label)" }} iconSize={8} />
                  {["看多", "看空"].map((stance) => (
                    <Line
                      key={stance}
                      type="monotone"
                      dataKey={stance}
                      name={`${stance}报告均值`}
                      stroke={STANCE_COLOR[stance]}
                      strokeWidth={1.8}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="立场汇总 vs 无条件基准" description={`同一指数在任意交易日持有 h 日的平均收益与正收益概率，作为「不看报告」的参照系（${focusStudy?.label ?? ""}）。`}>
          {stanceRows.length === 0 && baselineRows.length === 0 ? (
            <EmptyState text="样本不足，无法汇总。" />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <Th>分组</Th>
                    {horizons.map((h) => (
                      <Th key={h} right>
                        {h} 日均值（胜率）
                      </Th>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ...stanceRows.map((r) => ({ name: `${r.stance}报告后`, note: `${r.events} 次`, rows: r.rows, tone: STANCE_COLOR[r.stance] })),
                    { name: "全部交易日基准", note: "无条件", rows: baselineRows.map((b) => ({ days: b.days, samples: b.samples, avg: b.avg, winRate: b.winRate })), tone: "" },
                  ].map((row) => (
                    <TableRow key={row.name} className="border-border/50">
                      <TableCell className="px-2.5 py-2 text-xs">
                        <span className={row.tone ? "" : "text-muted-foreground"} style={{ color: row.tone || undefined }}>
                          {row.name}
                        </span>
                        <span className="tnum ml-1.5 text-[10px] text-muted-foreground">{row.note}</span>
                      </TableCell>
                      {horizons.map((h) => {
                        const cell = row.rows.find((x) => x.days === h);
                        return (
                          <Td key={h} right className={retClass(cell?.avg)}>
                            {signed(cell?.avg ?? null)}
                            <span className="ml-1 text-[10px] text-muted-foreground">{cell?.winRate === null || cell?.winRate === undefined ? "" : `${cell.winRate.toFixed(0)}%`}</span>
                          </Td>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            单元格右侧小字为正收益概率。若某组均值低于基准，说明按该信号操作在历史上并未跑赢随机时点。
          </p>
        </Panel>
      </div>

      <Panel title="逐事件明细" description={`${focusStudy?.label ?? ""}：锚点为报告日后的首个交易日，peak / trough 为其后 60 个交易日内的最大涨幅与最大回撤；RV21 为 21 日年化已实现波动率。`}>
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <Th>报告日</Th>
                <Th>立场 / 动作</Th>
                <Th>锚点日</Th>
                {horizons.map((h) => (
                  <Th key={h} right>
                    +{h} 日
                  </Th>
                ))}
                <Th right>峰值 60</Th>
                <Th right>回撤 60</Th>
                <Th right>RV21 前→后</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => {
                const o = outcomeOf(focusStudy.symbol, e.id);
                return (
                  <TableRow key={e.id} className={`border-border/50 ${selected?.id === e.id ? "bg-[var(--d-rv21)]/[0.06]" : ""}`}>
                    <TableCell className="px-2.5 py-2 text-xs">
                      <button type="button" className="tnum hover:underline" onClick={() => setSelectedId(e.id)}>
                        {e.date}
                      </button>
                      <p className="mt-0.5 max-w-[240px] text-[11px] leading-snug text-muted-foreground">{e.title}</p>
                    </TableCell>
                    <TableCell className="px-2.5 py-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <StanceBadge stance={e.stance} />
                        <span className="text-[11px] text-muted-foreground">{e.action}</span>
                      </div>
                    </TableCell>
                    <Td>{o ? `${o.anchorDate}${o.shiftDays > 0 ? `（+${o.shiftDays}d）` : ""}` : "—"}</Td>
                    {horizons.map((h) => {
                      const f = o?.forward.find((x) => x.days === h);
                      return (
                        <Td key={h} right className={retClass(f?.ret ?? null)}>
                          {signed(f?.ret ?? null)}
                        </Td>
                      );
                    })}
                    <Td right className={retClass(o?.peak60 ?? null)}>{signed(o?.peak60 ?? null)}</Td>
                    <Td right className={retClass(o?.trough60 ?? null)}>{signed(o?.trough60 ?? null)}</Td>
                    <Td right>
                      {o ? (
                        <span className="text-[11px]">
                          {fmt(o.rv21At, 1)} → {fmt(o.rv21After, 1)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {Object.entries(study.definition).map(([k, v]) => (
            <span key={k}>
              <span className="text-foreground/80">{DEFINITION_LABEL[k] ?? k}</span>：{v}
            </span>
          ))}
        </div>
      </Panel>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        复盘样本仅 {events.length} 次，且事件日期取自公开报道记载日，与报告实际送达客户的时点可能相差数个交易日；指数目标位变动只作为叙事背景，不参与统计。
        所有结果为历史统计，存在明显的样本外风险，不构成投资建议。
      </p>
    </div>
  );
}

function EventDetail({ event, study }: { event: ReportEventRow; study: EventStudyPayload }) {
  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <StanceBadge stance={event.stance} />
        <Badge variant="outline" className="border-border/70 text-[10px] text-muted-foreground">
          {event.action}
        </Badge>
        <Badge variant="outline" className={`border-border/70 text-[10px] ${event.confidence === "多源交叉" ? "text-[var(--d-mint)]" : "text-[var(--d-vxn)]"}`}>
          来源可信度：{event.confidence}
        </Badge>
        {event.team ? <Badge variant="outline" className="border-border/70 text-[10px] text-muted-foreground">{event.team}</Badge> : null}
      </div>
      <p className="text-xs leading-relaxed">{event.summary}</p>
      {event.dateNote ? <p className="text-[11px] text-[var(--d-vxn)]">日期说明：{event.dateNote}</p> : null}
      {event.targets.length ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <Th>指数目标位</Th>
                <Th right>原</Th>
                <Th right>新</Th>
                <Th right>调整幅度</Th>
                <Th>期限</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {event.targets.map((t) => {
                const delta = t.from === null || t.from === 0 ? null : ((t.to - t.from) / t.from) * 100;
                return (
                  <TableRow key={`${t.index}-${t.horizon}`} className="border-border/50">
                    <TableCell className="px-2.5 py-1.5 text-xs">{t.index}</TableCell>
                    <Td right>{t.from === null ? "—" : fmt(t.from, 0)}</Td>
                    <Td right>{fmt(t.to, 0)}</Td>
                    <Td right className={retClass(delta)}>{signed(delta, 1)}</Td>
                    <Td mono={false} className="text-[11px] text-muted-foreground">{t.horizon}</Td>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {event.sources.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/40 px-2 py-0.5 text-muted-foreground hover:text-foreground"
          >
            来源：{s.label}
          </a>
        ))}
        <span className="text-muted-foreground/70">复盘口径可在 API 中核对：/api/events · /api/events/study（版本 {study.meta.version}）</span>
      </div>
    </div>
  );
}
