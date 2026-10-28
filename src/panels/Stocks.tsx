import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import AiBrief from "@/src/AiBrief";
import { EmptyState, Panel, Td, Th, Delta, regimeTone } from "@/src/ui-kit";
import {
  ApiError,
  BASE,
  EXTRA_STOCK_LIMIT,
  isValidStockCode,
  query,
  requestJson,
  fmt,
  fmtDate,
  type StockAnalysisRow,
  type StockCompositeRow,
  type StockHistoryPayload,
  type StocksListPayload,
  type StocksSignalsPayload,
} from "@/lib/api";

function stanceClass(key: string): string {
  switch (key) {
    case "buy":
      return "border-[var(--d-mint)]/60 bg-[var(--d-mint)]/12 text-[var(--d-mint)]";
    case "add":
      return "border-[var(--d-mint)]/40 bg-[var(--d-mint)]/8 text-[var(--d-mint)]";
    case "trim":
      return "border-[var(--d-vxn)]/50 bg-[var(--d-vxn)]/10 text-[var(--d-vxn)]";
    case "reduce":
      return "border-[var(--d-red)]/50 bg-[var(--d-red)]/10 text-[var(--d-red)]";
    default:
      return "border-border/80 bg-secondary/60 text-muted-foreground";
  }
}

function StanceBadge({ composite }: { composite: StockCompositeRow | null | undefined }) {
  if (!composite) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={`text-[11px] ${stanceClass(composite.stanceKey)}`} title={composite.summary}>
      {composite.stance}
    </Badge>
  );
}

function scoreText(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return `${score > 0 ? "+" : ""}${score}`;
}

function MetricCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="tnum mt-0.5 text-sm font-semibold">{children}</p>
    </div>
  );
}

function stateClass(state: string): string {
  if (state === "看多倾向") return "text-[var(--d-mint)]";
  if (state === "看空倾向") return "text-[var(--d-red)]";
  if (state === "中性") return "text-muted-foreground";
  return "text-muted-foreground/70";
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

function tick(date: string): string {
  return date.slice(0, 7);
}

function StockDetail({ payload, loading, error }: { payload: StockHistoryPayload | null; loading: boolean; error: string | null }) {
  const [span, setSpan] = useState(750);
  const m = payload?.metrics ?? null;
  const composite = payload?.composite ?? null;
  const rows = useMemo(() => {
    const all = payload?.series ?? [];
    return span > 0 ? all.slice(-span) : all;
  }, [payload, span]);
  const volTop = useMemo(() => {
    let top = 30;
    for (const p of rows) top = Math.max(top, p.rv21 ?? 0, p.rv63 ?? 0);
    return Math.ceil((top + 6) / 10) * 10;
  }, [rows]);

  if (loading && !payload) {
    return (
      <Panel title="个股详情" description="正在读取个股序列与规则明细…">
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-[220px] w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="个股详情">
        <Alert variant="destructive">
          <AlertTitle>个股序列未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      </Panel>
    );
  }
  if (!payload || !m) {
    return (
      <Panel title="个股详情">
        <EmptyState text="点击上方排名表中的个股以加载详情。" />
      </Panel>
    );
  }

  return (
    <Panel
      title={`${payload.stock.name}（${payload.stock.code}）个股详情`}
      description={
        <span>
          {payload.stock.sector} · 数据截至 {fmtDate(m.asOf)} · 前复权日线 {payload.count} 条 · 规则权重为全历史信息系数动态取值（合计 100%），随每次请求重新估计。
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="tnum border-border/80 bg-secondary/60 text-[11px] text-muted-foreground">
            得分 {scoreText(composite?.score)}
          </Badge>
          <StanceBadge composite={composite} />
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <MetricCell label="收盘价">
          {m.close.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
          <Delta value={m.dayChangePct} digits={2} />
        </MetricCell>
        <MetricCell label="21 日波动率">
          {m.rv21 === null ? "—" : `${m.rv21.toFixed(1)}%`}
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">63 日 {m.rv63 === null ? "—" : `${m.rv63.toFixed(1)}%`}</span>
        </MetricCell>
        <MetricCell label="5 年分位">{m.volPercentile5y === null ? "—" : `${m.volPercentile5y.toFixed(0)}%`}</MetricCell>
        <MetricCell label="波动 Z 分数">{m.volZScore === null ? "—" : `${m.volZScore > 0 ? "+" : ""}${m.volZScore.toFixed(2)}`}</MetricCell>
        <MetricCell label="63 日动量">
          <Delta value={m.momentum63} digits={1} />
        </MetricCell>
        <MetricCell label="距 52 周高点">
          <Delta value={m.drawdown52w} digits={1} />
        </MetricCell>
        <MetricCell label="KOSPI 63 日 Beta">{m.betaKospi63 === null ? "—" : m.betaKospi63.toFixed(2)}</MetricCell>
        <MetricCell label="均线位置">
          <span className="text-[12px]">
            50 日 {m.aboveMa50 === null ? "—" : m.aboveMa50 ? "上方" : "下方"} · 200 日 {m.aboveMa200 === null ? "—" : m.aboveMa200 ? "上方" : "下方"}
          </span>
        </MetricCell>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-[var(--d-rv21)]" />RV21（左轴）</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-[var(--d-rv63)]" />RV63</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-[var(--d-price)]" />收盘价（右轴）</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-[var(--d-vxn)]" />韩国综合指数（右轴）</span>
        </div>
        <div className="flex items-center gap-1.5">
          {[
            { v: 250, l: "1 年" },
            { v: 750, l: "3 年" },
            { v: 0, l: "全部" },
          ].map((o) => (
            <Button
              key={o.v}
              size="sm"
              variant={span === o.v ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => setSpan(o.v)}
            >
              {o.l}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid-canvas mt-1.5 rounded-md border border-border/60 bg-secondary/20 p-2">
        <ResponsiveContainer width="100%" height={248}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gStockRv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--d-rv21)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--d-rv21)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
            <YAxis yAxisId="vol" domain={[0, volTop]} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" width={38} tickFormatter={(v) => `${v}%`} />
            <YAxis
              yAxisId="price"
              orientation="right"
              domain={[0, (max: number) => Math.ceil(max * 1.15)]}
              tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              width={52}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
            />
            <Tooltip
              {...tooltipStyle()}
              isAnimationActive={false}
              formatter={(value: unknown, name: unknown) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return ["—", String(name)];
                return String(name).includes("波动") ? [`${n.toFixed(2)}%`, String(name)] : [n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }), String(name)];
              }}
            />
            <Area yAxisId="vol" type="monotone" dataKey="rv21" name="21 日已实现波动率" stroke="var(--d-rv21)" strokeWidth={1.5} fill="url(#gStockRv)" dot={false} activeDot={{ r: 3 }} />
            <Line yAxisId="vol" type="monotone" dataKey="rv63" name="63 日已实现波动率" stroke="var(--d-rv63)" strokeWidth={1.1} strokeDasharray="5 4" dot={false} />
            <Line yAxisId="price" type="monotone" dataKey="close" name="收盘价" stroke="var(--d-price)" strokeWidth={1.3} dot={false} />
            <Line yAxisId="price" type="monotone" dataKey="kospi" name="韩国综合指数" stroke="var(--d-vxn)" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.75} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-border/70">
              <Th>规则</Th>
              <Th>读数</Th>
              <Th>状态</Th>
              <Th right>得分</Th>
              <Th right>IC（前向 {payload.weighting.horizon} 日）</Th>
              <Th right>权重</Th>
              <Th>说明</Th>
            </tr>
          </thead>
          <tbody>
            {payload.signals.map((s) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0">
                <Td>
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{s.id}</span>
                  <span className="ml-1.5 rounded-sm border border-border/70 px-1 py-px text-[10px] text-muted-foreground">{s.group}</span>
                </Td>
                <Td>{s.display}</Td>
                <Td><span className={`text-[11px] font-medium ${stateClass(s.state)}`}>{s.state}</span></Td>
                <Td right>{scoreText(s.score)}</Td>
                <Td right>{s.ic === null ? "样本不足" : `${s.ic > 0 ? "+" : ""}${s.ic.toFixed(2)}`}</Td>
                <Td right>{s.weight > 0 ? `${s.weight.toFixed(1)}%` : "—"}</Td>
                <Td className="max-w-[420px] text-[11px] leading-snug text-muted-foreground">{s.rationale}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{payload.disclaimer}</p>
    </Panel>
  );
}

export default function Stocks({
  list,
  signals,
  loading,
  error,
  extraCodes,
  onExtraCodesChange,
}: {
  list: StocksListPayload | null;
  signals: StocksSignalsPayload | null;
  loading: boolean;
  error: string | null;
  extraCodes: string[];
  onExtraCodesChange: (codes: string[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StockHistoryPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);
  const didInit = useRef(false);

  const stocks = signals?.stocks ?? [];
  const kospi = signals?.kospi ?? null;
  const kospiTone = kospi?.regime ? regimeTone(kospi.regime.key) : null;
  const watchlistNote = list?.meta.watchlistNote ?? "";
  const baseCodes = useMemo(() => new Set((list?.stocks ?? []).map((s) => s.code)), [list]);

  function addCode() {
    const code = codeInput.trim();
    setFormNote(null);
    if (!/^\d{6}$/.test(code)) {
      setFormError("请输入 6 位数字股票代码。");
      return;
    }
    if (!isValidStockCode(code)) {
      setFormError("暂只支持沪市 60 / 68 与深市 00 / 30 开头的 A 股代码。");
      return;
    }
    if (baseCodes.has(code)) {
      setFormError("该股票已在基础观察清单中。");
      return;
    }
    if (extraCodes.includes(code)) {
      setFormError("该股票已手动添加。");
      return;
    }
    if (extraCodes.length >= EXTRA_STOCK_LIMIT) {
      setFormError(`最多手动添加 ${EXTRA_STOCK_LIMIT} 只，请先移除不需要的。`);
      return;
    }
    setFormError(null);
    setCodeInput("");
    setFormNote(`已添加 ${code}，正在按需抓取日线并计算信号…`);
    setSelected(code);
    onExtraCodesChange([...extraCodes, code]);
  }

  function removeCode(code: string) {
    setFormError(null);
    setFormNote(null);
    onExtraCodesChange(extraCodes.filter((c) => c !== code));
    if (selected === code) setSelected(null);
  }

  // 交给 AI 补充的背景数据：只放本站真实指标，任何数值都不允许模型改写
  const kospiBriefContext = useMemo(() => {
    const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : v.toFixed(digits));
    const m = kospi?.metrics ?? null;
    const lines: string[] = [];
    if (m) {
      lines.push(
        `KOSPI 本站指标（数据截至 ${m.asOf}）：最新点位 ${m.close.toFixed(2)}；当日涨跌 ${num(m.dayChangePct)}%；63 日动量 ${num(m.momentum63, 1)}%；21 日已实现波动率 ${num(m.rv21, 1)}%（5 年分位 ${num(m.volPercentile5y, 0)}%，Z 分数 ${num(m.volZScore)}）；本站波动状态判定：${kospi?.regime?.label ?? "—"}；样本 ${kospi?.samples ?? 0} 个交易日。`,
      );
    } else {
      lines.push("KOSPI 本站指标尚未取到。");
    }
    if (stocks.length) {
      lines.push(
        `与 KOSPI 联动的 A 股个股五档建议（按动态权重综合得分排序）：${stocks
          .slice(0, 5)
          .map((s) => (s.composite ? `${s.name}${s.composite.stance}（得分 ${s.composite.score}）` : `${s.name}无建议`))
          .join("；")}。`,
      );
    }
    if (signals?.weighting) lines.push(`动态权重方法：${signals.weighting.method}`);
    lines.push("说明：KOSPI 仅作为 A 股个股诊断中的区域联动信号，不单独给出买卖建议；AI 只做背景补充，不得改动以上数值。");
    return lines.join("\n");
  }, [kospi, stocks, signals]);

  // 首次拿到信号后默认选中排名第一的个股
  useEffect(() => {
    if (didInit.current || !signals) return;
    didInit.current = true;
    setSelected(signals.stocks[0]?.code ?? null);
  }, [signals]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setDetailLoading(true);
    setDetailError(null);
    const refresh = signals?.meta.liveRefresh ? 1 : 0;
    void requestJson<StockHistoryPayload>(`${BASE}/api/stocks/history${query({ code: selected, refresh })}`, controller.signal)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((err) => {
        if (!alive || (err as Error)?.name === "AbortError") return;
        setDetailError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [selected, signals?.meta.liveRefresh]);

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>个股诊断接口未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1.05fr_1.35fr]">
        <Panel
          title="韩国综合指数（区域联动）"
          description="KOSPI 只作为个股诊断中的区域联动信号：衡量亚太风险偏好与 A 股个股的联动方向，不单独提供买卖建议。"
          action={kospiTone ? <Badge variant="outline" className={`text-[11px] ${kospiTone.className}`}>{kospiTone.label}</Badge> : null}
        >
          {!kospi?.metrics ? (
            loading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <EmptyState text="韩国综合指数数据缺失：请运行 node dev/fetch-data.mjs 重新抓取快照。" />
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricCell label="最新点位">
                  {kospi.metrics.close.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
                </MetricCell>
                <MetricCell label="当日涨跌">
                  <Delta value={kospi.metrics.dayChangePct} digits={2} />
                </MetricCell>
                <MetricCell label="21 日波动率">
                  {kospi.metrics.rv21 === null ? "—" : `${kospi.metrics.rv21.toFixed(1)}%`}
                </MetricCell>
                <MetricCell label="5 年分位">{kospi.metrics.volPercentile5y === null ? "—" : `${kospi.metrics.volPercentile5y.toFixed(0)}%`}</MetricCell>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                63 日动量 <Delta value={kospi.metrics.momentum63} digits={1} />
                <span className="mx-1.5 text-border">|</span>
                样本 {kospi.samples} 个交易日
                <span className="mx-1.5 text-border">|</span>
                个股「区域联动」规则同时参考 KOSPI 自身的趋势与波动状态、以及个股对 KOSPI 的 63 日 beta。
              </p>
            </>
          )}
          <AiBrief
            topic="KOSPI"
            query="韩国综合指数 KOSPI 最新走势 影响因素 亚太市场"
            context={kospiBriefContext}
          />
        </Panel>

        <Panel title="建议权重如何科学取值" description="建议是动态的：每次请求都按最新全历史重新估计信息系数并归一化，不写死任何主观权重。">
          {signals ? (
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>{signals.weighting.method}</p>
              <div className="grid grid-cols-3 gap-2">
                <MetricCell label="估计窗口">{signals.weighting.horizon} 个交易日</MetricCell>
                <MetricCell label="IC 截断区间">[{signals.weighting.floor}, {signals.weighting.cap}]</MetricCell>
                <MetricCell label="权重合计">100%</MetricCell>
              </div>
              <p className="text-[11px]">
                信息系数（IC）＝ 规则看多状态下的未来收益均值 − 看空状态下的未来收益均值；两侧样本均需 ≥5 次才参与估计，样本不足的规则按底限参与、权重接近均匀。
              </p>
            </div>
          ) : loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <EmptyState text="权重说明尚未加载。" />
          )}
        </Panel>
      </div>

      <Panel
        title="A 股个股买卖建议（五档）"
        description={
          loading && !signals
            ? "正在计算个股信号与动态权重…"
            : "按综合得分排序：≥30 买入 · ≥10 加仓 · -10~10 持有 · ≤-10 减仓 · ≤-30 卖出。点击行查看个股详情与规则明细；可手动添加任意沪深 A 股（最多 6 只）。"
        }
        action={
          signals ? (
            <span className="tnum text-[11px] text-muted-foreground">
              {stocks.length} 只 · 截至 {fmtDate(signals.stocks.find((s) => s.metrics)?.metrics?.asOf ?? list?.stocks[0]?.asOf ?? null)}
            </span>
          ) : null
        }
      >
        <div className="mb-3 rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium">手动添加个股</span>
            <Input
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value.replace(/[^\d]/g, "").slice(0, 6));
                setFormError(null);
                setFormNote(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) addCode();
              }}
              placeholder="6 位代码，如 000001"
              inputMode="numeric"
              autoComplete="off"
              className="h-8 w-40 text-xs"
              aria-label="手动添加个股代码"
            />
            <Button size="sm" className="h-8 px-2.5 text-[11px]" onClick={addCode} disabled={!codeInput.trim() || loading}>
              添加
            </Button>
            <span className="text-[10px] text-muted-foreground">
              支持沪市 60 / 68、深市 00 / 30 开头；自选列表只保存在本机浏览器，站点不保存、不写入任何账户。
            </span>
          </div>
          {formError ? <p className="mt-1.5 text-[11px] text-[var(--d-red)]">{formError}</p> : null}
          {formNote ? <p className="mt-1.5 text-[11px] text-[var(--d-mint)]">{formNote}</p> : null}
          {extraCodes.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">已添加：</span>
              {extraCodes.map((code) => {
                const row = stocks.find((s) => s.code === code);
                return (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-sm border border-border/70 bg-background/50 px-1.5 py-0.5 text-[10px]"
                    title={row?.error ?? undefined}
                  >
                    {row?.name && row.name !== code ? `${row.name} ` : ""}
                    <span className="tnum">{code}</span>
                    <button
                      type="button"
                      onClick={() => removeCode(code)}
                      className="text-muted-foreground transition-colors hover:text-[var(--d-red)]"
                      aria-label={`移除 ${code}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>

        {loading && !signals ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : stocks.length === 0 ? (
          <EmptyState
            text={`观察清单为空：可在上方手动添加股票，或在 functions/data/watchlist.ts 中填入持仓个股后运行 node dev/fetch-data.mjs。${watchlistNote ? `（${watchlistNote}）` : ""}`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="border-b border-border/70">
                  <Th right>#</Th>
                  <Th>代码 / 名称</Th>
                  <Th>行业</Th>
                  <Th right>现价</Th>
                  <Th right>当日</Th>
                  <Th right>RV21</Th>
                  <Th right>5 年分位</Th>
                  <Th right>距 52 周高点</Th>
                  <Th right>得分</Th>
                  <Th>建议</Th>
                  <Th right>详情</Th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s: StockAnalysisRow) => {
                  const m = s.metrics;
                  const active = selected === s.code;
                  const custom = extraCodes.includes(s.code);
                  const failed = Boolean(s.error) && !m;
                  return (
                    <tr
                      key={s.code}
                      onClick={() => {
                        if (!failed) setSelected(active ? null : s.code);
                      }}
                      className={`border-b border-border/50 transition-colors last:border-0 ${
                        failed ? "" : "cursor-pointer hover:bg-secondary/40"
                      } ${active ? "bg-secondary/60" : ""}`}
                      title={failed ? s.error ?? "加载失败" : s.composite?.summary ?? "点击查看个股详情"}
                    >
                      <Td right className="text-muted-foreground">{s.rank}</Td>
                      <Td>
                        <span className="font-medium">{s.name}</span>
                        <span className="tnum ml-1.5 text-[11px] text-muted-foreground">{s.code}</span>
                        {custom ? (
                          <span className="ml-1.5 rounded-sm border border-[var(--d-price)]/40 bg-[var(--d-price)]/10 px-1 py-px text-[9px] text-[var(--d-price)]">自选</span>
                        ) : null}
                        {failed ? <span className="ml-1.5 text-[10px] text-[var(--d-red)]">加载失败</span> : null}
                      </Td>
                      <Td><span className="text-[11px] text-muted-foreground">{s.sector}</span></Td>
                      <Td right>{m ? m.close.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—"}</Td>
                      <Td right>{m ? <Delta value={m.dayChangePct} digits={2} /> : "—"}</Td>
                      <Td right>{m && m.rv21 !== null ? `${m.rv21.toFixed(1)}%` : "—"}</Td>
                      <Td right>{m && m.volPercentile5y !== null ? `${m.volPercentile5y.toFixed(0)}%` : "—"}</Td>
                      <Td right>{m ? <Delta value={m.drawdown52w} digits={1} /> : "—"}</Td>
                      <Td right>
                        <span className={`font-semibold ${(s.composite?.score ?? 0) > 0 ? "text-[var(--d-mint)]" : (s.composite?.score ?? 0) < 0 ? "text-[var(--d-red)]" : "text-muted-foreground"}`}>
                          {scoreText(s.composite?.score)}
                        </span>
                      </Td>
                      <Td><StanceBadge composite={s.composite} /></Td>
                      <Td right>
                        <span className="inline-flex items-center justify-end gap-2">
                          {custom ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeCode(s.code);
                              }}
                              className="text-[11px] text-muted-foreground transition-colors hover:text-[var(--d-red)]"
                            >
                              移除
                            </button>
                          ) : null}
                          <span className={`text-[11px] ${failed ? "text-muted-foreground/60" : active ? "text-foreground" : "text-muted-foreground"}`}>
                            {failed ? "—" : active ? "收起" : "查看 ›"}
                          </span>
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected ? <StockDetail payload={detail} loading={detailLoading} error={detailError} /> : null}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {signals?.disclaimer ?? "个股诊断为量化规则与历史统计输出，不构成投资建议。"}
        基础观察清单在 functions/data/watchlist.ts 中维护；手动添加的个股只保存在本机浏览器（键 vol-desk-extra-stocks），最多 6 只，可随时移除，站点服务端不保存任何自选列表。
      </p>
    </div>
  );
}
