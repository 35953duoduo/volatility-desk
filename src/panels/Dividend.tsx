import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import DividendAi from "@/src/DividendAi";
import { Delta, EmptyState, Panel, Td, Th } from "@/src/ui-kit";
import {
  ApiError,
  BASE,
  EXTRA_DIVIDEND_LIMIT,
  isValidStockCode,
  query,
  requestJson,
  fmtDate,
  type DividendCompositeRow,
  type DividendHistoryPayload,
  type DividendListPayload,
  type DividendListRow,
} from "@/lib/api";

const STANCE_THRESHOLD_TEXT = "≥30 分批低吸 · ≥10 小仓低吸 · -10~10 持有收息 · -30~-10 分批高抛 · ≤-30 显著高抛";

function stanceClass(key: string): string {
  switch (key) {
    case "accumulate":
      return "border-[var(--d-mint)]/60 bg-[var(--d-mint)]/12 text-[var(--d-mint)]";
    case "add":
      return "border-[var(--d-rv21)]/45 bg-[var(--d-rv21)]/10 text-[var(--d-rv21)]";
    case "trim":
      return "border-[var(--d-vxn)]/50 bg-[var(--d-vxn)]/10 text-[var(--d-vxn)]";
    case "reduce":
      return "border-[var(--d-red)]/50 bg-[var(--d-red)]/10 text-[var(--d-red)]";
    default:
      return "border-border/80 bg-secondary/60 text-muted-foreground";
  }
}

function StanceBadge({ composite }: { composite: DividendCompositeRow | Pick<DividendListRow, "stance" | "stanceKey" | "summary"> | null | undefined }) {
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

function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)}%`;
}

function MetricCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/20 px-2.5 py-2">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="tnum mt-0.5 text-sm font-semibold">{children}</p>
    </div>
  );
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

/** 数据来源：与 README 及 /docs 保持一致，必须明确非实时边界 */
function DataSources({ list }: { list: DividendListPayload }) {
  const meta = list.meta;
  return (
    <Panel
      title="数据来源与更新频率"
      description="这一板块只使用公开行情与公开分红明细；所有数值都可以在页脚、/docs 与 README 中核对口径。"
    >
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <p className="text-[11px] font-semibold">周线行情（价格）</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            东方财富公开不复权日线接口（fqt=0），按每周最后一个交易日重采样为周线；抓取失败时由脚本回退腾讯不复权日线。包含除息缺口。
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <p className="text-[11px] font-semibold">分红明细</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            东方财富数据中心分红送配（RPT_SHAREBONUS_DET）的税前每 10 股派息，换算为每股税前分红；按除息日进入股息率计算。
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <p className="text-[11px] font-semibold">手动添加的个股</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            清单上方输入 6 位代码后，服务端按需抓取 2015 起的不复权日线与分红明细，东方财富优先、失败回退腾讯，内存缓存 10 分钟；只存在本机浏览器，不写入快照。
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <p className="text-[11px] font-semibold">本周最新价</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            开启「实时上游」时，用东方财富批量行情覆盖本周最新一根周线；盘中价格会变动，本周 K 线在周末收盘前不是最终值。
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <p className="text-[11px] font-semibold">快照与更新</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            周线与分红快照生成于 {fmtDate(meta.snapshot.generatedAt)}，覆盖 {fmtDate(meta.snapshot.window.from)} 至{" "}
            {fmtDate(meta.snapshot.window.to)}；每次请求都会用最新快照重算指标，但底层行情不是逐笔实时。
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          接口版本 <span className="tnum">{meta.version}</span>
        </span>
        <span>
          来源模式 <span className="tnum">{meta.liveRefresh ? "实时上游增量 + 本地快照" : "本地快照"}</span>
        </span>
        {meta.sources.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5" title={s.note}>
            <span className={`inline-block size-1.5 rounded-full ${s.ok ? (s.mode === "live" ? "bg-[var(--d-mint)]" : "bg-[var(--d-vxn)]") : "bg-[var(--d-red)]"}`} />
            {s.label}
            <span className="tnum opacity-70">{s.ok ? (s.mode === "live" ? "实时" : "快照") : "降级"}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        其余面板的数据来源：指数 / ETF / 个股日线来自东方财富（快照生成于页面数据源标签所示日期），VIX / VXN 以
        CBOE / Yahoo 上游为准且不可达时显式降级；DeepSeek 由浏览器直连官方接口，本站服务端不代持密钥、不转发请求。
      </p>
    </Panel>
  );
}

function DividendDetail({
  payload,
  loading,
  error,
}: {
  payload: DividendHistoryPayload | null;
  loading: boolean;
  error: string | null;
}) {
  const [span, setSpan] = useState(260);
  const m = payload?.metrics ?? null;
  const composite = payload?.composite ?? null;
  const rows = useMemo(() => {
    const all = payload?.series ?? [];
    return span > 0 ? all.slice(-span) : all;
  }, [payload, span]);
  const dividends = useMemo(() => (payload?.dividends ?? []).slice(-10).reverse(), [payload]);

  if (loading && !payload) {
    return (
      <Panel title="红利股详情" description="正在读取周线、分红与规则明细…">
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-[240px] w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="红利股详情">
        <Alert variant="destructive">
          <AlertTitle>红利股详情未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      </Panel>
    );
  }
  if (!payload || !m) {
    return (
      <Panel title="红利股详情">
        <EmptyState text="点击上方排行表中的标的以加载周线详情。" />
      </Panel>
    );
  }

  return (
    <Panel
      title={`${payload.stock.name}（${payload.stock.code}）· 周线红利详情`}
      description={
        <span>
          {payload.stock.sector} · {payload.stock.note} · 数据截至 {fmtDate(m.asOf)} · 不复权周线 {payload.count} 条
          {m.weekPartial ? " · 本周 K 线未收盘" : ""}
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
        <MetricCell label="不复权收盘">
          {m.close.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
          <span className="ml-1.5 text-[11px] font-normal">
            <Delta value={m.weekChangePct} digits={2} />
          </span>
        </MetricCell>
        <MetricCell label={`年度股息率 FY${m.fy ?? "—"}`}>
          {pct(m.yieldFY, 2)}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">每股 {m.dpsFY === null ? "—" : m.dpsFY.toFixed(4)}</span>
        </MetricCell>
        <MetricCell label="近 12 个月现金口径">
          {pct(m.yieldTTM, 2)}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">仅参考</span>
        </MetricCell>
        <MetricCell label="股息率 5 年分位">
          {m.yieldPct5y === null ? "—" : `${m.yieldPct5y.toFixed(0)}%`}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">全样本 {m.yieldPctAll === null ? "—" : `${m.yieldPctAll.toFixed(0)}%`}</span>
        </MetricCell>
        <MetricCell label="3 年价格分位">
          {m.pricePct3y === null ? "—" : `${m.pricePct3y.toFixed(0)}%`}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">距高点 {pct(m.drawdown3y, 1)}</span>
        </MetricCell>
        <MetricCell label="周线 RSI(14)">{m.rsi14w === null ? "—" : m.rsi14w.toFixed(1)}</MetricCell>
        <MetricCell label="偏离 60 周均线">
          <Delta value={m.distMa60w} digits={1} />
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">MA60w {m.ma60w === null ? "—" : m.ma60w.toFixed(2)}</span>
        </MetricCell>
        <MetricCell label="连续分红">
          {m.streakYears} 年
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">{m.dividendCount} 条明细</span>
        </MetricCell>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-[var(--d-price)]" />
            不复权收盘（左轴）
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-[var(--d-rv21)]" />
            MA20w
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-[var(--d-vxn)]" />
            MA60w
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {[
            { v: 52, l: "1 年" },
            { v: 156, l: "3 年" },
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
            <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
            <YAxis
              domain={[(min: number) => Math.floor(min * 0.92), (max: number) => Math.ceil(max * 1.06)]}
              tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              width={52}
            />
            <Tooltip
              {...tooltipStyle()}
              isAnimationActive={false}
              formatter={(value: unknown, name: unknown) => {
                const n = Number(value);
                return Number.isFinite(n) ? [n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }), String(name)] : ["—", String(name)];
              }}
            />
            <Line type="monotone" dataKey="close" name="不复权收盘" stroke="var(--d-price)" strokeWidth={1.4} dot={false} />
            <Line type="monotone" dataKey="ma20w" name="MA20w" stroke="var(--d-rv21)" strokeWidth={1.1} dot={false} connectNulls />
            <Line type="monotone" dataKey="ma60w" name="MA60w" stroke="var(--d-vxn)" strokeWidth={1.1} strokeDasharray="5 4" dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-1.5 rounded-full bg-[var(--d-mint)]" />
          年度股息率（左轴）
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-1.5 rounded-full bg-[var(--d-vxn)]" />
          近 12 个月现金口径（左轴）
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-1.5 rounded-full bg-[var(--d-price)]" />
          股息率 5 年分位（右轴 0–100）
        </span>
      </div>
      <div className="grid-canvas mt-1.5 rounded-md border border-border/60 bg-secondary/20 p-2">
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--d-grid)" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tick} minTickGap={48} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" />
            <YAxis yAxisId="yield" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} stroke="var(--chart-axis)" width={46} tickFormatter={(v) => `${v}%`} />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: "var(--chart-tick)", fontSize: 11 }}
              stroke="var(--chart-axis)"
              width={38}
              tickFormatter={(v) => `${v}`}
            />
            <ReferenceLine yAxisId="pct" y={70} stroke="var(--d-red)" strokeDasharray="3 4" strokeOpacity={0.5} />
            <ReferenceLine yAxisId="pct" y={30} stroke="var(--d-mint)" strokeDasharray="3 4" strokeOpacity={0.5} />
            <Tooltip
              {...tooltipStyle()}
              isAnimationActive={false}
              formatter={(value: unknown, name: unknown) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return ["—", String(name)];
                return String(name).includes("分位") ? [`${n.toFixed(0)}`, String(name)] : [`${n.toFixed(2)}%`, String(name)];
              }}
            />
            <Area
              yAxisId="yield"
              type="monotone"
              dataKey="yieldFY"
              name="年度股息率"
              stroke="var(--d-mint)"
              strokeWidth={1.4}
              fill="var(--d-mint)"
              fillOpacity={0.08}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="yield"
              type="monotone"
              dataKey="yieldTTM"
              name="近 12 个月现金口径"
              stroke="var(--d-vxn)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="yieldPct5y"
              name="股息率 5 年分位"
              stroke="var(--d-price)"
              strokeWidth={1}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {composite ? (
        <div className="mt-3 rounded-md border border-border/60 bg-secondary/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">量化倾向</span>
            <StanceBadge composite={composite} />
            <span className={`tnum text-xs font-medium ${composite.score > 0 ? "text-[var(--d-mint)]" : composite.score < 0 ? "text-[var(--d-red)]" : "text-muted-foreground"}`}>
              综合得分 {scoreText(composite.score)} / -100~+100
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/85">{composite.summary}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">执行提示：{composite.actionHint}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-[var(--d-mint)]/25 bg-[var(--d-mint)]/5 p-2.5">
              <p className="text-[11px] font-medium text-[var(--d-mint)]">底仓（长期收息）</p>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{composite.basePosition}</p>
            </div>
            <div className="rounded-md border border-[var(--d-rv21)]/25 bg-[var(--d-rv21)]/5 p-2.5">
              <p className="text-[11px] font-medium text-[var(--d-rv21)]">卫星仓（周线波段）</p>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{composite.satellite}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-border/70">
              <Th>规则</Th>
              <Th>读数</Th>
              <Th>状态</Th>
              <Th right>得分</Th>
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
                </Td>
                <Td>{s.display}</Td>
                <Td>
                  <span className={`text-[11px] font-medium ${s.score > 0 ? "text-[var(--d-mint)]" : s.score < 0 ? "text-[var(--d-red)]" : "text-muted-foreground"}`}>
                    {s.state}
                  </span>
                </Td>
                <Td right>{scoreText(s.score)}</Td>
                <Td right>{s.weight}%</Td>
                <Td className="max-w-[420px] text-[11px] leading-snug text-muted-foreground">{s.rationale}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">最近 10 条分红（税前）</p>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-border/70">
                  <Th>除息日</Th>
                  <Th right>每股（元）</Th>
                  <Th>方案</Th>
                  <Th>报告期</Th>
                </tr>
              </thead>
              <tbody>
                {dividends.map((d) => (
                  <tr key={`${d.exDate}-${d.dps}`} className="border-b border-border/50 last:border-0">
                    <Td>{d.exDate}</Td>
                    <Td right>{d.dps.toFixed(4)}</Td>
                    <Td className="max-w-[220px] text-[11px] text-muted-foreground">{d.plan || "—"}</Td>
                    <Td>{d.reportDate || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">口径与限制</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            {Object.entries(payload.definition).map(([k, v]) => (
              <li key={k}>
                <span className="text-foreground/80">{payload.strategy.definitionLabels[k] ?? k}：</span>
                {v}
              </li>
            ))}
            <li>
              <span className="text-foreground/80">固定权重：</span>
              {payload.strategy.method}
            </li>
          </ul>
        </div>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{payload.disclaimer}</p>
    </Panel>
  );
}

export default function Dividend({
  list,
  loading,
  error,
  extraCodes,
  onExtraCodesChange,
}: {
  list: DividendListPayload | null;
  loading: boolean;
  error: string | null;
  extraCodes: string[];
  onExtraCodesChange: (codes: string[]) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DividendHistoryPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);
  const didInit = useRef(false);

  const stocks = list?.stocks ?? [];
  const extraErrors = list?.meta.extraErrors;
  const baseCodes = useMemo(
    () => new Set(stocks.filter((s) => !extraCodes.includes(s.code)).map((s) => s.code)),
    [stocks, extraCodes],
  );

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
      setFormError("该股票已在红利基础观察清单中。");
      return;
    }
    if (extraCodes.includes(code)) {
      setFormError("该股票已手动添加。");
      return;
    }
    if (extraCodes.length >= EXTRA_DIVIDEND_LIMIT) {
      setFormError(`最多手动添加 ${EXTRA_DIVIDEND_LIMIT} 只，请先移除不需要的。`);
      return;
    }
    setFormError(null);
    setCodeInput("");
    setFormNote(`已添加 ${code}，正在按需抓取不复权周线与分红明细并计算红利信号…`);
    setSelected(code);
    onExtraCodesChange([...extraCodes, code]);
  }

  function removeCode(code: string) {
    setFormError(null);
    setFormNote(null);
    onExtraCodesChange(extraCodes.filter((c) => c !== code));
    if (selected === code) setSelected(null);
  }

  // 首次拿到清单后默认选中排名第一的股票；之后允许用户点击收起详情，不再强制重选
  useEffect(() => {
    if (didInit.current || !stocks.length) return;
    didInit.current = true;
    setSelected(stocks[0]?.code ?? null);
  }, [stocks]);

  // 手动添加的代码加载完成（成功或失败）后收起进度提示
  useEffect(() => {
    if (!formNote || !extraCodes.length) return;
    const pending = extraCodes.filter((c) => !stocks.some((s) => s.code === c) && !extraErrors?.[c]);
    if (!pending.length) setFormNote(null);
  }, [stocks, extraCodes, extraErrors, formNote]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setDetailLoading(true);
    setDetailError(null);
    const refresh = list?.meta.liveRefresh ? 1 : 0;
    void requestJson<DividendHistoryPayload>(`${BASE}/api/dividend/history${query({ code: selected, refresh })}`, controller.signal)
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
  }, [selected, list?.meta.liveRefresh, list?.meta.asOf]);

  const avgYield = list?.summary.avgYield ?? null;

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>红利策略接口未返回</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1.55fr_1fr]">
        <Panel
          title="策略框架：长期收息为底，卫星仓做周线高抛低吸"
          description="面向国企 / 中央国企背景的高分红标的（银行、保险、公用事业、能源、通信、交运）。默认底仓长期持有吃股息，只用两到三成卫星仓执行周线级别的低吸与高抛。"
        >
          {list ? (
            <div className="space-y-2.5">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-md border border-[var(--d-mint)]/25 bg-[var(--d-mint)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-mint)]">底仓 70%–80%</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{list.strategy.position.base}</p>
                </div>
                <div className="rounded-md border border-[var(--d-rv21)]/25 bg-[var(--d-rv21)]/5 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--d-rv21)]">卫星仓 20%–30%</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{list.strategy.position.satellite}</p>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">五项固定权重（合计 100%，不做动态 IC）</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {list.strategy.weights.map((w) => (
                    <span key={w.id} className="rounded-sm border border-border/70 bg-secondary/40 px-1.5 py-0.5 text-[10px]">
                      {w.name} <span className="tnum font-semibold">{w.weight}%</span>
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{list.strategy.method}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                五档阈值：{STANCE_THRESHOLD_TEXT}。得分越正越偏「便宜 / 低吸」，越负越偏「贵 / 高抛」；高分红的底仓不因波段信号清仓。
              </p>
            </div>
          ) : loading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <EmptyState text="策略说明尚未加载。" />
          )}
        </Panel>

        <Panel
          title="当前清单概览"
          description={`按综合得分排序后的分布；基础 ${list?.meta.baseCount ?? 16} 只国企红利样本${
            list?.meta.extras?.length ? ` + ${list.meta.extras.length} 只手动添加` : ""
          }，不代表全市场红利指数。`}
        >
          <div className="grid grid-cols-2 gap-2">
            <MetricCell label="平均年度股息率">{avgYield === null ? "—" : `${avgYield.toFixed(2)}%`}</MetricCell>
            <MetricCell label="数据截至">{list ? fmtDate(list.meta.asOf) : "—"}</MetricCell>
            <MetricCell label="低吸档">
              <span className="text-[var(--d-mint)]">{list ? list.summary.lowBuy : "—"}</span>
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">只</span>
            </MetricCell>
            <MetricCell label="高抛档">
              <span className="text-[var(--d-red)]">{list ? list.summary.highSell : "—"}</span>
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">只</span>
            </MetricCell>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {list
              ? `共 ${list.summary.count} 只：分红稳定但价格处于高位的银行 / 煤炭 / 高速偏「高抛」，股息率与价格处于低位的保险 / 铁路偏「低吸」；中间 ${list.summary.neutral} 只维持持有收息。`
              : "正在计算红利信号…"}
          </p>
          {list?.meta.extras?.length ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              手动添加的个股不一定属于国企红利样本，只按公开行情与分红数据计算，不构成对其分红持续性的判断。
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            股息率为税前、按最近一个已实施完整年度计算；不含红利税与交易成本，历史分红不保证未来继续。
          </p>
        </Panel>
      </div>

      {list ? <DataSources list={list} /> : null}

      <Panel
        title="国企红利股 · 周线高抛低吸清单"
        description={
          loading && !list
            ? "正在读取周线快照并计算股息率、价格分位与周线信号…"
            : "点击任意行查看周线价格、股息率历史、五项规则与分红记录。得分为正偏低吸、为负偏高抛；结论只作用于卫星仓。可手动添加任意沪深 A 股（最多 6 只）。"
        }
        action={list ? <span className="tnum text-[11px] text-muted-foreground">{list.count} 只 · 截至 {fmtDate(list.meta.asOf)}</span> : null}
      >
        {list ? (
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
                placeholder="6 位代码，如 600000"
                inputMode="numeric"
                autoComplete="off"
                className="h-8 w-40 text-xs"
                aria-label="手动添加红利股代码"
              />
              <Button size="sm" className="h-8 px-2.5 text-[11px]" onClick={addCode} disabled={!codeInput.trim() || loading}>
                添加
              </Button>
              <span className="text-[10px] text-muted-foreground">
                支持沪市 60 / 68、深市 00 / 30 开头；不复权周线与分红按需抓取，自选列表只保存在本机浏览器，站点不保存、不写入快照。
              </span>
            </div>
            {formError ? <p className="mt-1.5 text-[11px] text-[var(--d-red)]">{formError}</p> : null}
            {formNote ? <p className="mt-1.5 text-[11px] text-[var(--d-mint)]">{formNote}</p> : null}
            {extraCodes.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">已添加：</span>
                {extraCodes.map((code) => {
                  const row = stocks.find((s) => s.code === code);
                  const err = extraErrors?.[code];
                  return (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1 rounded-sm border border-border/70 bg-background/50 px-1.5 py-0.5 text-[10px]"
                      title={err ?? row?.note ?? undefined}
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
            {extraErrors && Object.keys(extraErrors).length ? (
              <p className="mt-1.5 break-words text-[11px] text-[var(--d-red)]">
                抓取失败：{Object.entries(extraErrors).map(([code, msg]) => `${code}（${msg}）`).join("；")}
              </p>
            ) : null}
          </div>
        ) : null}

        {loading && !list ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <EmptyState text="红利观察清单为空：可在上方手动添加股票，或运行 node dev/fetch-dividend-data.mjs 重新生成周线与分红快照。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse">
              <thead>
                <tr className="border-b border-border/70">
                  <Th right>#</Th>
                  <Th>代码 / 名称</Th>
                  <Th>行业</Th>
                  <Th right>现价</Th>
                  <Th right>本周</Th>
                  <Th right>年度股息率</Th>
                  <Th right>5 年分位</Th>
                  <Th right>3 年价格分位</Th>
                  <Th right>周 RSI</Th>
                  <Th right>偏离 60 周</Th>
                  <Th right>连续分红</Th>
                  <Th right>得分</Th>
                  <Th>建议</Th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => {
                  const active = selected === s.code;
                  return (
                    <tr
                      key={s.code}
                      onClick={() => setSelected(active ? null : s.code)}
                      className={`cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-secondary/40 ${active ? "bg-secondary/60" : ""}`}
                      title={s.summary}
                    >
                      <Td right className="text-muted-foreground">{s.rank}</Td>
                      <Td>
                        <span className="font-medium">{s.name}</span>
                        <span className="tnum ml-1.5 text-[11px] text-muted-foreground">{s.code}</span>
                      </Td>
                      <Td><span className="text-[11px] text-muted-foreground">{s.sector}</span></Td>
                      <Td right>{s.close === null ? "—" : s.close.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</Td>
                      <Td right><Delta value={s.weekChangePct} digits={2} /></Td>
                      <Td right>{pct(s.yieldFY, 2)}</Td>
                      <Td right>{s.yieldPct5y === null ? "—" : `${s.yieldPct5y.toFixed(0)}%`}</Td>
                      <Td right>{s.pricePct3y === null ? "—" : `${s.pricePct3y.toFixed(0)}%`}</Td>
                      <Td right>{s.rsi14w === null ? "—" : s.rsi14w.toFixed(1)}</Td>
                      <Td right><Delta value={s.distMa60w} digits={1} /></Td>
                      <Td right>{s.streakYears} 年</Td>
                      <Td right>
                        <span className={`font-semibold ${s.score > 0 ? "text-[var(--d-mint)]" : s.score < 0 ? "text-[var(--d-red)]" : "text-muted-foreground"}`}>
                          {scoreText(s.score)}
                        </span>
                      </Td>
                      <Td><StanceBadge composite={s} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          手动添加的个股只保存在本机浏览器（键 vol-desk-extra-dividends），最多 6 只，可随时移除；服务端不保存自选列表，也不写入周线快照。单个代码抓取失败只影响该行，并在上方显示原因。
        </p>
      </Panel>

      {selected ? <DividendDetail payload={detail} loading={detailLoading} error={detailError} /> : null}
      {detail ? <DividendAi code={detail.stock.code} name={detail.stock.name} liveRefresh={detail.meta.liveRefresh} /> : null}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {list?.disclaimer ??
          "红利策略输出为量化规则与历史统计，不构成投资建议、收益承诺或个性化推荐。底仓/卫星仓比例是通用框架，不是针对任何人的资产配置。"}
      </p>
    </div>
  );
}
