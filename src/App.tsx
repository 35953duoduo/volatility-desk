import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import ApiConsole from "@/src/panels/ApiConsole";
import Cycle from "@/src/panels/Cycle";
import Diagnosis from "@/src/panels/Diagnosis";
import Dividend from "@/src/panels/Dividend";
import Macro from "@/src/panels/Macro";
import Overview from "@/src/panels/Overview";
import Portfolio from "@/src/panels/Portfolio";
import ReportStudy from "@/src/panels/ReportStudy";
import Stocks from "@/src/panels/Stocks";
import Structure from "@/src/panels/Structure";
import Valuation from "@/src/panels/Valuation";
import ThemeToggle from "@/src/ThemeToggle";
import { SourceChip } from "@/src/ui-kit";
import { fmtDate, type SymbolInfo } from "@/lib/api";
import { useDashboardData } from "@/src/useDashboardData";

const FALLBACK_SYMBOLS: SymbolInfo[] = [
  { key: "NDX100", label: "纳斯达克100", secid: "100.NDX100", from: "2019-04-08", to: "", rows: 0 },
  { key: "QQQ", label: "QQQ 纳斯达克100 ETF", secid: "105.QQQ", from: "2001-01-02", to: "", rows: 0 },
  { key: "IXIC", label: "纳斯达克综合指数", secid: "100.NDX", from: "2015-01-02", to: "", rows: 0 },
  { key: "SPX", label: "标普500（对照）", secid: "100.SPX", from: "2015-01-02", to: "", rows: 0 },
  { key: "SSE", label: "上证指数", secid: "1.000001", from: "2015-01-05", to: "", rows: 0 },
  { key: "CSI300", label: "沪深300", secid: "1.000300", from: "2015-01-05", to: "", rows: 0 },
];

const AUTO_REFRESH_MS = 5 * 60 * 1000;

function clock(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

const RANGE_OPTIONS: { value: string; label: string; years: number | null }[] = [
  { value: "1", label: "1 年", years: 1 },
  { value: "3", label: "3 年", years: 3 },
  { value: "5", label: "5 年", years: 5 },
  { value: "10", label: "10 年", years: 10 },
  { value: "all", label: "全部", years: null },
];

export default function App() {
  const [symbol, setSymbol] = useState("NDX100");
  const [range, setRange] = useState("10");
  const [freq, setFreq] = useState<"1d" | "1w" | "1m">("1w");
  const [live, setLive] = useState(true);

  const years = useMemo(() => RANGE_OPTIONS.find((r) => r.value === range)?.years ?? null, [range]);
  const controls = useMemo(() => ({ symbol, years, freq, refresh: live }), [symbol, years, freq, live]);
  const data = useDashboardData(controls);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) data.reload();
    }, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.hidden) return;
      if (!data.fetchedAt || Date.now() - data.fetchedAt >= AUTO_REFRESH_MS) data.reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, data.reload, data.fetchedAt]);

  const symbols = data.health?.symbols?.length ? data.health.symbols : FALLBACK_SYMBOLS;
  const activeSymbol = symbols.find((s) => s.key === symbol);
  const asOf = data.history?.meta.asOf ?? data.snapshot?.meta.asOf ?? null;
  const sources = data.health?.sources ?? data.history?.meta.sources ?? [];
  const implied = sources.find((s) => s.kind === "implied_vol");
  const priceLiveCount = sources.filter((s) => s.kind === "price" && s.mode === "live" && s.ok).length;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-4 pt-3.5 pb-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="flex items-baseline gap-2 text-[17px] leading-none font-semibold tracking-tight">
                波动率观测台
                <span className="text-[11px] font-normal text-muted-foreground">Nasdaq + A-Share Volatility Desk</span>
              </h1>
              <p className="mt-1.5 text-xs text-muted-foreground">
                纳斯达克与 A 股主要指数的波动率多年走势、VIX 恐慌指数、历史规律与量化买卖诊断，A 股个股五档建议（含韩国综合指数联动与动态权重），另设国企红利股周线高抛低吸、黄金 / 原油 / 美债跨资产风险、康波四阶段与纳指 / 标普 / 上证的对照、美股巴菲特指数（Z.1 口径）、本机资产配置台账（黄金 / 股票 / 基金 / 现金）与大摩 A 股报告复盘，并对外提供只读 API。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {sources.length === 0 ? (
                  <Skeleton className="h-5 w-40 rounded-full" />
                ) : (
                  sources
                    .filter((s) => s.kind === "implied_vol" || (s.mode === "live" && s.ok))
                    .slice(0, 4)
                    .map((s) => <SourceChip key={s.id} source={s} />)
                )}
                {implied && !implied.ok ? (
                  <span className="text-[11px] text-muted-foreground" title={implied.note}>
                    VXN 上游不可达时，诊断以真实收盘价计算的已实现波动率为准
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="tnum flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>数据截至 {fmtDate(asOf)}</span>
                <span className="text-border">|</span>
                <span>{priceLiveCount > 0 ? "实时行情增量已合并" : "使用本地真实行情快照"}</span>
                <span className="tnum" title="最近一次页面数据请求完成的时间；上游行情与按需抓取自身有 5–10 分钟缓存">
                  最近刷新 {clock(data.fetchedAt)}
                </span>
                <span className="tnum">{live ? "自动 5 分钟" : "自动刷新已关"}</span>
                <Button size="sm" variant="outline" onClick={data.reload} disabled={data.loading}>
                  {data.loading ? "刷新中" : "重新计算"}
                </Button>
                <ThemeToggle />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <NativeSelect
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="h-8 w-[168px] text-xs"
                  aria-label="选择标的"
                >
                  {symbols.map((s) => (
                    <NativeSelectOption key={s.key} value={s.key}>
                      {s.label}（{s.from.slice(0, 4)} 起）
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <ToggleGroup
                  type="single"
                  value={range}
                  onValueChange={(v) => v && setRange(v)}
                  spacing={2}
                  variant="outline"
                  size="sm"
                  aria-label="回溯区间"
                >
                  {RANGE_OPTIONS.map((r) => (
                    <ToggleGroupItem key={r.value} value={r.value} size="sm" className="h-8 px-2.5 text-xs">
                      {r.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <ToggleGroup
                  type="single"
                  value={freq}
                  onValueChange={(v) => v && setFreq(v as "1d" | "1w" | "1m")}
                  spacing={2}
                  variant="outline"
                  size="sm"
                  aria-label="采样频率"
                >
                  {[
                    { v: "1d", l: "日" },
                    { v: "1w", l: "周" },
                    { v: "1m", l: "月" },
                  ].map((f) => (
                    <ToggleGroupItem key={f.v} value={f.v} size="sm" className="h-8 px-2.5 text-xs">
                      {f.l}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Switch size="sm" checked={live} onCheckedChange={(v) => setLive(Boolean(v))} />
                  实时上游
                </label>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-4">
        {data.error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTitle>部分接口未返回</AlertTitle>
            <AlertDescription className="text-xs">
              {data.error}
              <Button size="sm" variant="outline" className="mt-2" onClick={data.reload}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="border-border/80 text-[10px]">
            {activeSymbol?.label ?? symbol}
          </Badge>
          <span>
            窗口：{range === "all" ? "全部可得历史" : `近 ${range} 年`} · 采样：{freq === "1d" ? "日线" : freq === "1w" ? "周线" : "月线"}
          </span>
          <span className="tnum">
            指标基于全部历史计算，图表按所选窗口裁剪，因此分位与 Z 分数不受缩放影响。
          </span>
        </div>

        <Tabs defaultValue="overview" className="gap-3">
          <TabsList variant="line" className="h-9 max-w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border/60 bg-transparent px-0">
            <TabsTrigger value="overview" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              波动率总览
            </TabsTrigger>
            <TabsTrigger value="structure" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              历史规律
            </TabsTrigger>
            <TabsTrigger value="diagnosis" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              买卖诊断
            </TabsTrigger>
            <TabsTrigger value="stocks" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              个股诊断
            </TabsTrigger>
            <TabsTrigger value="dividend" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              红利策略
            </TabsTrigger>
            <TabsTrigger value="macro" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              跨资产
            </TabsTrigger>
            <TabsTrigger value="cycle" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              康波周期
            </TabsTrigger>
            <TabsTrigger value="valuation" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              美股估值
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              资产配置
            </TabsTrigger>
            <TabsTrigger value="report" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              大摩报告复盘
            </TabsTrigger>
            <TabsTrigger value="api" className="rounded-t-md px-3 text-sm data-[state=active]:bg-secondary/60">
              API 接口
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-1">
            <Overview history={data.history} snapshot={data.snapshot} panic={data.panic} loading={data.loading} />
          </TabsContent>
          <TabsContent value="structure" className="mt-1">
            <Structure snapshot={data.snapshot} diagnosis={data.diagnosis} />
          </TabsContent>
          <TabsContent value="diagnosis" className="mt-1">
            <Diagnosis diagnosis={data.diagnosis} ai={data.aiMarkdown} loading={data.loading} />
          </TabsContent>
          <TabsContent value="stocks" className="mt-1">
            <Stocks
              list={data.stocksList}
              signals={data.stocksSignals}
              loading={data.stocksLoading}
              error={data.stocksError}
              extraCodes={data.extraStockCodes}
              onExtraCodesChange={data.setExtraStockCodes}
            />
          </TabsContent>
          <TabsContent value="dividend" className="mt-1">
            <Dividend
              list={data.dividendList}
              loading={data.dividendLoading}
              error={data.dividendError}
              extraCodes={data.dividendExtraCodes}
              onExtraCodesChange={data.setDividendExtraCodes}
            />
          </TabsContent>
          <TabsContent value="macro" className="mt-1">
            <Macro
              macro={data.macro}
              loading={data.macroLoading}
              error={data.macroError}
              years={data.macroYears}
              onYearsChange={data.setMacroYears}
              liveRefresh={live}
            />
          </TabsContent>
          <TabsContent value="cycle" className="mt-1">
            <Cycle
              cycle={data.cycle}
              loading={data.cycleLoading}
              error={data.cycleError}
              years={data.cycleYears}
              onYearsChange={data.setCycleYears}
              liveRefresh={live}
            />
          </TabsContent>
          <TabsContent value="valuation" className="mt-1">
            <Valuation
              valuation={data.valuation}
              loading={data.valuationLoading}
              error={data.valuationError}
              years={data.valuationYears}
              onYearsChange={data.setValuationYears}
              liveRefresh={live}
            />
          </TabsContent>
          <TabsContent value="portfolio" className="mt-1">
            <Portfolio panic={data.panic} snapshot={data.snapshot} macro={data.macro} />
          </TabsContent>
          <TabsContent value="report" className="mt-1">
            <ReportStudy study={data.eventsStudy} loading={data.studyLoading} error={data.studyError} activeSymbol={symbol} />
          </TabsContent>
          <TabsContent value="api" className="mt-1">
            <ApiConsole symbol={symbol} years={years} freq={freq} />
          </TabsContent>
        </Tabs>

        <footer className="mt-6 border-t border-border/60 pt-3 pb-8 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            数据口径：指数、ETF 与 A 股个股的日线收盘价来自东方财富公开行情接口（快照生成于 {fmtDate(data.history?.meta.snapshot.generatedAt)}），
            运行时尝试增量刷新；国企红利股的周线为东方财富不复权日线（失败回退腾讯），分红来自东方财富分红送配明细（税前），
            周线快照生成于 {fmtDate(data.dividendList?.meta.snapshot.generatedAt)}，运行时用东方财富批量报价覆盖本周最新价。VXN / VIX
            隐含波动率取自 CBOE 官方日线收盘（失败回退 FRED 镜像与 Yahoo），CBOE 延迟报价只作盘中参考；不可达时接口与页面都会显式标注，改用真实收盘价计算 21 / 63 日年化已实现波动率（sqrt(252)）。
            个股建议的规则权重按历史信息系数动态取值，韩国综合指数仅作为个股诊断的区域联动信号；红利策略使用固定权重，详见该页「数据来源与更新频率」。
            跨资产板块的黄金 / 原油 / 美债价格分别以 GLD / USO / TLT 收盘价代理（Nasdaq 官方历史行情），10 年期美债收益率来自 FRED DGS10，
            运行时尝试逐只增量刷新，失败时保留本地快照并显式标注降级；ETF 代理、期货展期与相关性口径详见该页说明。
            康波周期板块只把纳指100 / 标普500 / 上证的真实共同交易日状态映射到四阶段教科书特征，不判定长波年份、不是概率或交易信号；
            美股巴菲特指数采用美联储 Z.1 非金融企业股权市值（FRED NCBEILQ027S）÷ 美国名义 GDP（FRED GDP），因 Wilshire 系列已下架，
            不能与常见的 Wilshire/GDP 绝对水平或 100%、120% 阈值直接比较，季度数据存在发布滞后与修订。
            资产配置台账的数量、成本、手续费、现价与可投入现金全部由用户手动填写，只保存在本机浏览器（不写入站点服务端、不读取券商账户），
            占比、含费盈亏与风控提示按填写值确定性计算，现价过期时结论会失真；基金优先按 6 位代码、没有代码时按名称识别，不代查净值，
            持有收益 / 持有收益率可照抄持仓页，留空按市值 − 成本自动计算（不含手续费），与含费浮动盈亏分开显示；基金名单与台账一并保存在本机。
          </p>
          <p className="mt-1.5">
            所有内容仅为量化统计与信息展示，用于研究与自我决策，不构成投资建议、收益承诺或个性化推荐。
            接口版本 {data.history?.meta.version ?? "1.0.0"}。
          </p>
        </footer>
      </main>
    </div>
  );
}
