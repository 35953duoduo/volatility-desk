import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import PortfolioAi from "@/src/PortfolioAi";
import { Delta, EmptyState, Panel, Stat, Td, Th } from "@/src/ui-kit";
import type { MacroPayload, PanicPayload, SnapshotPayload } from "@/lib/api";
import {
  FUND_CODE_RE,
  FUND_NAMES_KEY,
  HOLDING_KINDS,
  KIND_META,
  PORTFOLIO_CASH_KEY,
  PORTFOLIO_LIMIT,
  PORTFOLIO_RULES,
  PORTFOLIO_STORAGE_KEY,
  deploymentCandidates,
  money,
  pctText,
  readDryPowder,
  readFundOptions,
  readPortfolio,
  rememberFundName,
  sanitizeHolding,
  signedPct,
  summarizePortfolio,
  unitMoney,
  writeDryPowder,
  writePortfolio,
  type CheckLevel,
  type FundOption,
  type Holding,
  type HoldingKind,
  type HoldingRow,
  type PortfolioMarket,
} from "@/lib/portfolio";

const KIND_COLOR: Record<HoldingKind, string> = {
  gold: "var(--d-vxn)",
  stock: "var(--d-rv21)",
  fund: "var(--d-rv63)",
  bond: "var(--d-mint)",
  deposit: "var(--d-price)",
  cash: "var(--muted-foreground)",
  other: "var(--chart-axis)",
};

const NAME_PLACEHOLDER: Record<HoldingKind, string> = {
  gold: "黄金积存 / 金条",
  stock: "贵州茅台",
  fund: "长城全球新能源汽车股票(QDII-LOF)C",
  bond: "国债 / 可转债",
  deposit: "定期存款 / 银行理财",
  cash: "活期现金",
  other: "其他资产",
};

const CHECK_TONE: Record<CheckLevel, { box: string; chip: string }> = {
  alert: { box: "border-[var(--d-red)]/35 bg-[var(--d-red)]/5", chip: "text-[var(--d-red)] border-[var(--d-red)]/40 bg-[var(--d-red)]/10" },
  warn: { box: "border-[var(--d-vxn)]/35 bg-[var(--d-vxn)]/5", chip: "text-[var(--d-vxn)] border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10" },
  info: { box: "border-border/70 bg-secondary/20", chip: "text-muted-foreground border-border bg-secondary/50" },
};

interface Draft {
  kind: HoldingKind;
  name: string;
  code: string;
  units: string;
  cost: string;
  fee: string;
  holdingPnl: string;
  holdingPnlPct: string;
  price: string;
  priceAsOf: string;
  note: string;
}

function emptyDraft(kind: HoldingKind = "gold"): Draft {
  return { kind, name: "", code: "", units: "", cost: "", fee: "", holdingPnl: "", holdingPnlPct: "", price: "", priceAsOf: "", note: "" };
}

const qtyText = (v: number) => v.toLocaleString("zh-CN", { maximumFractionDigits: 4 });

export default function Portfolio({
  panic,
  snapshot,
  macro,
}: {
  panic: PanicPayload | null;
  snapshot: SnapshotPayload | null;
  macro: MacroPayload | null;
}) {
  const [holdings, setHoldings] = useState<Holding[]>(() => readPortfolio());
  const [fundOptions, setFundOptions] = useState<FundOption[]>(() => readFundOptions());
  const [dryPowder, setDryPowder] = useState<number>(() => readDryPowder());
  const [dryDraft, setDryDraft] = useState<string>(() => {
    const v = readDryPowder();
    return v > 0 ? String(v) : "";
  });
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  const summary = useMemo(() => summarizePortfolio(holdings, dryPowder), [holdings, dryPowder]);
  const candidates = useMemo(() => deploymentCandidates(summary), [summary]);
  const fundHolding = useMemo(() => {
    const funds = summary.rows.filter((r) => r.kind === "fund");
    if (!funds.length) return null;
    const pnl = funds.reduce((a, r) => a + r.holdingPnl, 0);
    const cost = funds.reduce((a, r) => a + r.costAmount, 0);
    return { pnl, pct: cost > 0 ? (pnl / cost) * 100 : null, count: funds.length, manual: funds.some((r) => r.holdingPnlManual) };
  }, [summary.rows]);
  const rowById = useMemo(() => new Map(summary.rows.map((r) => [r.id, r])), [summary.rows]);
  const meta = KIND_META[draft.kind];
  const selectedFund = fundOptions.some((o) => o.name === draft.name) ? draft.name : "";
  const latest = panic?.latest ?? null;
  const metrics = snapshot?.metrics ?? null;

  const market = useMemo<PortfolioMarket | null>(() => {
    if (!latest && !metrics && !macro) return null;
    return {
      vix: latest
        ? {
            level: latest.level,
            asOf: latest.asOf,
            pct5y: latest.pct5y,
            z: latest.z,
            regime: latest.regime.label,
            quote: panic?.quote?.level ?? null,
          }
        : null,
      index: metrics
        ? {
            label: snapshot?.meta.symbolLabel ?? "所选标的",
            asOf: metrics.asOf,
            rv21: metrics.realizedVol21,
            rv63: metrics.realizedVol63,
            pct5y: metrics.volPercentile5y,
            z: metrics.volZScore,
          }
        : null,
      macro: macro
        ? {
            riskLabel: macro.risk.levelLabel,
            summary: macro.risk.summary,
            ust10y: macro.yield10y.latest ?? null,
            assets: macro.assets.map((a) => ({ label: a.label, close: a.close, asOf: a.asOf, vol21: a.vol21, drawdown1y: a.drawdown1y })),
          }
        : null,
    };
  }, [latest, metrics, macro, panic, snapshot]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTFOLIO_STORAGE_KEY || e.key === null) setHoldings(readPortfolio());
      if (e.key === PORTFOLIO_CASH_KEY || e.key === null) {
        const v = readDryPowder();
        setDryPowder(v);
        setDryDraft(v > 0 ? String(v) : "");
      }
      if (e.key === FUND_NAMES_KEY || e.key === null) setFundOptions(readFundOptions());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const preview = useMemo(() => {
    const units = Number(draft.units);
    const cost = meta.amountOnly ? 1 : Number(draft.cost);
    const fee = meta.fee && draft.fee.trim() ? Number(draft.fee) : 0;
    const price = meta.amountOnly ? 1 : draft.price.trim() ? Number(draft.price) : cost;
    if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(price) || price < 0) return null;
    if (!Number.isFinite(fee) || fee < 0) return null;
    const value = units * price;
    const costAmount = units * cost;
    const costTotal = costAmount + fee;
    const pnl = value - costTotal;
    const holdingPnl = value - costAmount;
    return {
      value,
      pnl,
      pnlPct: costTotal > 0 ? (pnl / costTotal) * 100 : null,
      holdingPnl,
      holdingPnlPct: costAmount > 0 ? (holdingPnl / costAmount) * 100 : null,
    };
  }, [draft.units, draft.cost, draft.fee, draft.price, meta.amountOnly, meta.fee]);

  function patch(key: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function changeKind(kind: HoldingKind) {
    setDraft((d) => ({ ...d, kind, cost: "", fee: "", holdingPnl: "", holdingPnlPct: "", price: "" }));
  }

  function pickFund(name: string) {
    const option = fundOptions.find((o) => o.name === name);
    if (!option) return;
    setDraft((d) => ({ ...d, name: option.name, code: option.code }));
    setFormError(null);
    setFormNote(null);
  }

  function saveDryPowder(next: string) {
    const parsed = Number(next);
    const clean = writeDryPowder(Number.isFinite(parsed) ? parsed : 0);
    setDryPowder(clean);
    setDryDraft(clean > 0 ? String(clean) : "");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft(draft.kind));
    setFormError(null);
    setFormNote(null);
  }

  function save() {
    setFormNote(null);
    const name = draft.name.trim();
    if (!name) return setFormError("请填写名称，例如：黄金积存、贵州茅台、长城全球新能源汽车股票(QDII-LOF)C。");
    if (name.length > 30) return setFormError("名称最多 30 个字符。");
    if (draft.kind === "fund" && draft.code.trim() && !FUND_CODE_RE.test(draft.code.trim())) {
      return setFormError("基金代码需为 6 位数字；不确定可以先留空，DeepSeek 会按名称识别。");
    }
    const units = Number(draft.units);
    if (!Number.isFinite(units) || units <= 0) return setFormError(`请填写有效的数量（${meta.unit}），必须大于 0。`);
    if (!meta.amountOnly) {
      const cost = Number(draft.cost);
      if (!Number.isFinite(cost) || cost <= 0) return setFormError("请填写有效的成本单价，必须大于 0。");
      if (draft.fee.trim()) {
        const fee = Number(draft.fee);
        if (!Number.isFinite(fee) || fee < 0) return setFormError("手续费需为不小于 0 的数字，可留空。");
      }
      if (draft.price.trim()) {
        const price = Number(draft.price);
        if (!Number.isFinite(price) || price < 0) return setFormError("现价需为不小于 0 的数字，或留空按成本计价。");
      }
      if (draft.kind === "fund") {
        if (draft.holdingPnl.trim() && !Number.isFinite(Number(draft.holdingPnl))) {
          return setFormError("持有收益需为数字（可正可负），或留空自动计算。");
        }
        if (draft.holdingPnlPct.trim() && !Number.isFinite(Number(draft.holdingPnlPct))) {
          return setFormError("持有收益率需为百分数值（可正可负），或留空自动计算。");
        }
      }
    }
    if (draft.priceAsOf.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(draft.priceAsOf.trim())) {
      return setFormError("价格日期格式应为 YYYY-MM-DD。");
    }
    if (!editingId && holdings.length >= PORTFOLIO_LIMIT) return setFormError(`最多记录 ${PORTFOLIO_LIMIT} 笔持仓，请先删除不需要的。`);

    const clean = sanitizeHolding({
      id: editingId ?? undefined,
      kind: draft.kind,
      name,
      code: draft.code,
      units,
      cost: meta.amountOnly ? 1 : Number(draft.cost),
      fee: meta.fee && draft.fee.trim() ? Number(draft.fee) : 0,
      price: meta.amountOnly ? 1 : draft.price.trim() ? Number(draft.price) : null,
      priceAsOf: draft.priceAsOf,
      holdingPnl: draft.kind === "fund" && draft.holdingPnl.trim() ? Number(draft.holdingPnl) : null,
      holdingPnlPct: draft.kind === "fund" && draft.holdingPnlPct.trim() ? Number(draft.holdingPnlPct) : null,
      note: draft.note,
    });
    if (!clean) return setFormError("数据未通过校验：名称、数量、单价与手续费需在合理范围内，备注最多 60 字。");

    setHoldings(writePortfolio(editingId ? holdings.map((h) => (h.id === editingId ? clean : h)) : [...holdings, clean]));
    if (clean.kind === "fund") setFundOptions(rememberFundName(clean.name, clean.code));
    setEditingId(null);
    setDraft(emptyDraft(draft.kind));
    setFormError(null);
    setFormNote(editingId ? `已更新「${clean.name}」，台账已保存到本机浏览器。` : `已添加「${clean.name}」，台账已保存到本机浏览器。`);
  }

  function edit(h: HoldingRow) {
    const raw = holdings.find((x) => x.id === h.id);
    setEditingId(h.id);
    setDraft({
      kind: h.kind,
      name: h.name,
      code: h.code,
      units: String(h.units),
      cost: String(h.cost),
      fee: h.fee > 0 ? String(h.fee) : "",
      price: h.price === null ? "" : String(h.price),
      priceAsOf: h.priceAsOf ?? "",
      holdingPnl: raw?.holdingPnl == null ? "" : String(raw.holdingPnl),
      holdingPnlPct: raw?.holdingPnlPct == null ? "" : String(raw.holdingPnlPct),
      note: h.note,
    });
    setFormError(null);
    setFormNote(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function remove(h: Holding) {
    if (!window.confirm(`删除「${h.name}」？本机台账会同步更新。`)) return;
    setHoldings(writePortfolio(holdings.filter((x) => x.id !== h.id)));
    if (editingId === h.id) cancelEdit();
    setFormNote(`已删除「${h.name}」。`);
  }

  const bandTone =
    summary.band === "高"
      ? "border-[var(--d-red)]/40 bg-[var(--d-red)]/10 text-[var(--d-red)]"
      : summary.band === "中"
        ? "border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10 text-[var(--d-vxn)]"
        : summary.band === "低"
          ? "border-[var(--d-mint)]/40 bg-[var(--d-mint)]/10 text-[var(--d-mint)]"
          : "border-border bg-secondary/40 text-muted-foreground";

  return (
    <div className="space-y-3">
      <Panel
        title="资产配置台账"
        description="记录黄金、股票、基金、债券、存款与现金的实际持仓，页面即时计算市值、盈亏、类别占比与固定阈值风控提示。台账只保存在本机浏览器，现价需要手动更新。"
        action={
          <Badge variant="outline" className={`text-[11px] ${bandTone}`}>
            {summary.band === "无持仓" ? "尚未录入持仓" : `结构评分 ${summary.score}/100 · ${summary.band}风险`}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <Stat
            label="总市值"
            value={money(summary.totalValue, 0)}
            hint={`共 ${summary.count} 笔 · 未填现价按成本计${summary.dryPowder > 0 ? ` · 另有待投 ${money(summary.dryPowder, 0)}` : ""}`}
          />
          <Stat label="总成本" value={money(summary.totalCost, 0)} hint="数量 × 成本单价 + 手续费" />
          <Stat
            label="浮动盈亏（含费）"
            value={money(summary.pnl, 0)}
            tone={summary.pnl > 0 ? "mint" : summary.pnl < 0 ? "red" : "default"}
            hint={
              <span>
                收益率 <Delta value={summary.pnlPct} />
                {fundHolding ? (
                  <span className="block">
                    基金持有收益 {money(fundHolding.pnl, 0)}（{signedPct(fundHolding.pct)}，{fundHolding.manual ? "含手填" : "不含费"}）
                  </span>
                ) : null}
              </span>
            }
          />
          <Stat
            label="最大单一持仓"
            value={pctText(summary.topWeight, 1)}
            tone={summary.topWeight >= PORTFOLIO_RULES.singleAlert ? "red" : summary.topWeight >= PORTFOLIO_RULES.singleWarn ? "amber" : "default"}
            hint={`前三大合计 ${pctText(summary.top3Weight, 1)}（不计现金）`}
          />
          <Stat
            label="风险资产占比"
            value={pctText(summary.riskWeight, 1)}
            tone={summary.riskWeight >= PORTFOLIO_RULES.riskAlert ? "red" : summary.riskWeight >= PORTFOLIO_RULES.riskWarn ? "amber" : "default"}
            hint="黄金 + 股票 + 基金 + 其他（分母含待投现金）"
          />
          <Stat
            label="防守垫"
            value={pctText(summary.defenseWeight, 1)}
            tone={summary.defenseWeight < PORTFOLIO_RULES.defenseAlert ? "red" : summary.defenseWeight < PORTFOLIO_RULES.defenseWarn ? "amber" : "mint"}
            hint="现金 + 存款理财 + 债券 + 可投入现金"
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <p className="text-xs font-medium">资产分布</p>
            {summary.count === 0 ? (
              <div className="mt-2">
                <EmptyState text="台账还是空的。先在下方添加黄金、股票、基金或现金，这里会实时显示类别占比。" />
              </div>
            ) : (
              <>
                <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full border border-border/60 bg-secondary">
                  {summary.kinds.map((k) => (
                    <div
                      key={k.kind}
                      style={{ width: `${k.weight}%`, background: KIND_COLOR[k.kind] }}
                      title={`${k.label} ${pctText(k.weight, 1)}`}
                    />
                  ))}
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {summary.kinds.map((k) => (
                    <div key={k.kind} className="flex items-center gap-1.5 text-[11px]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[k.kind] }} />
                      <span className="font-medium">{k.label}</span>
                      <span className="tnum text-muted-foreground">
                        {pctText(k.weight, 1)} · {money(k.value, 0)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  结构评分 {summary.score}/100：集中度、风险敞口、单笔回撤与防守垫的固定加权，只描述当前结构，不预测涨跌。分布图只含持仓，不含待投现金。
                </p>
              </>
            )}
          </div>

          <div className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <p className="text-xs font-medium">风控提示</p>
            {summary.count === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">录入持仓后，这里按固定阈值检查集中度、风险资产、防守垫与亏损纪律。</p>
            ) : summary.checks.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                未触发风控规则。阈值是纪律线而不是市场预测：单一持仓 {PORTFOLIO_RULES.singleWarn}% 观察 / {PORTFOLIO_RULES.singleAlert}% 上限，风险资产{" "}
                {PORTFOLIO_RULES.riskWarn}%，防守垫 {PORTFOLIO_RULES.defenseWarn}%，单笔亏损 {PORTFOLIO_RULES.lossWarn}%。
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {summary.checks.map((c, i) => (
                  <div key={`${c.title}-${i}`} className={`rounded-md border px-2.5 py-2 ${CHECK_TONE[c.level].box}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={`text-[10px] ${CHECK_TONE[c.level].chip}`}>
                        {c.level === "alert" ? "需处理" : c.level === "warn" ? "留意" : "提示"}
                      </Badge>
                      <span className="text-[11px] font-medium">{c.title}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">{c.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel
        title="可投入现金与配置候选"
        description="记录还没建仓的备用金；页面按固定规则给现有风险持仓排性价比，帮你在加仓、补防守垫与留现金之间权衡。只是启发式排序，不是买卖建议，也不预测涨跌。"
        action={
          <Badge variant="outline" className="border-border/80 bg-secondary/60 text-[11px] font-normal text-muted-foreground">
            总资产 {money(summary.totalAssets, 0)}
          </Badge>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          <div className="rounded-md border border-border/60 bg-background/40 p-3">
            <Label className="text-[11px] text-muted-foreground">可投入现金（元）</Label>
            <Input
              className="mt-1 h-8 text-xs"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={dryDraft}
              onChange={(e) => setDryDraft(e.target.value)}
              onBlur={() => saveDryPowder(dryDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDryPowder(dryDraft);
              }}
              placeholder="例如 50000"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              只记未建仓的备用金，不含台账里的现金持仓；回车或失焦保存，写入本机（键 {PORTFOLIO_CASH_KEY}）。
            </p>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">持仓市值</span>
                <span className="tnum">{money(summary.totalValue, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">可投入现金</span>
                <span className="tnum">{money(summary.dryPowder, 0)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>总资产（含待投）</span>
                <span className="tnum">{money(summary.totalAssets, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">待投占</span>
                <span className="tnum">{pctText(summary.dryWeight, 1)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <p className="text-xs font-medium">部署候选（按性价比分排序，每档为可投入现金的三分之一）</p>
            {summary.dryPowder <= 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                先填写可投入现金，这里会按浮亏、集中度、风险敞口、黄金上限、价格时效与手续费给出候选顺序。
              </p>
            ) : candidates.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                暂无可排序的候选：风险持仓都接近 25% 集中度观察线、缺少现价，或台账里还没有风险持仓。此时现金本身就是合理配置。
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse">
                  <thead>
                    <tr className="border-b border-border/70">
                      <Th>名称</Th>
                      <Th>类别</Th>
                      <Th right>现价</Th>
                      <Th right>浮亏</Th>
                      <Th right>占比</Th>
                      <Th right>性价比</Th>
                      <Th right>每档</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const row = rowById.get(c.id);
                      return (
                        <tr key={c.id} className="border-b border-border/50 last:border-0">
                          <Td mono={false}>
                            <span className="font-medium">{c.name}</span>
                            {c.code ? <span className="tnum ml-1 text-[10px] text-muted-foreground">{c.code}</span> : null}
                            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{c.reasons.join("；")}</p>
                          </Td>
                          <Td>{c.kindLabel}</Td>
                          <Td right>{row ? unitMoney(row.unitPrice, row.kind) : "—"}</Td>
                          <Td right>{row ? signedPct(row.pnlPct) : "—"}</Td>
                          <Td right>{row ? pctText(row.weight, 1) : "—"}</Td>
                          <Td right>
                            <span className={c.score >= 65 ? "text-[var(--d-mint)]" : c.score < 40 ? "text-[var(--d-vxn)]" : ""}>{c.score}</span>
                            <span className="text-[10px] text-muted-foreground">/100</span>
                          </Td>
                          <Td right>{money(c.tranche, 0)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              固定规则只按台账结构打分：浮亏深、占比低、价格新鲜加分；接近 25% 集中度观察线、风险资产偏满、黄金超配、价格过旧与手续费过重扣分。先投一档，不要一次用完。
            </p>
            {summary.dryPowder > 0 && summary.defenseWeight < PORTFOLIO_RULES.defenseWarn ? (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--d-vxn)]">
                防守垫仅 {pctText(summary.defenseWeight, 1)}，低于 {PORTFOLIO_RULES.defenseWarn}%：第一档应优先补现金或存款，再考虑加仓。
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        title="持仓明细与录入"
        description={`手动记录每笔持仓的数量、成本、手续费与现价；基金可从「我的基金」名单选择，代码可选。台账与基金名单（键 ${PORTFOLIO_STORAGE_KEY} / ${FUND_NAMES_KEY}）只写入本机浏览器，最多 ${PORTFOLIO_LIMIT} 笔，站点服务端不保存也不读取。`}
        action={
          <Badge variant="outline" className="border-border/80 bg-secondary/60 text-[11px] font-normal text-muted-foreground">
            当前 {holdings.length} 笔
          </Badge>
        }
      >
        <div ref={formRef} className="rounded-md border border-border/60 bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">{editingId ? "编辑持仓" : "添加持仓"}</p>
            <span className="text-[11px] text-muted-foreground">
              {meta.amountOnly
                ? "现金类只需填写金额（元）"
                : draft.kind === "fund"
                  ? "可从「我的基金」选择或直接输入新名称；份额、成本净值与最新净值从持仓页抄录"
                  : `数量单位：${meta.unit}；成本与现价都按每${meta.unit}填写`}
              {meta.fee ? " · 手续费按合计金额填写，计入成本与盈亏" : ""}
              {preview ? ` · 预计市值 ${money(preview.value)}，含费盈亏 ${money(preview.pnl)}（${signedPct(preview.pnlPct)}）` : ""}
              {preview && draft.kind === "fund"
                ? draft.holdingPnl.trim() || draft.holdingPnlPct.trim()
                  ? "，保存后按手填持有收益展示"
                  : `，持有收益（不含费，自动） ${money(preview.holdingPnl)}（${signedPct(preview.holdingPnlPct)}）`
                : ""}
            </span>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label className="text-[11px] text-muted-foreground">类别</Label>
              <NativeSelect
                value={draft.kind}
                onChange={(e) => changeKind(e.target.value as HoldingKind)}
                className="mt-1 h-8 text-xs"
                aria-label="资产类别"
              >
                {HOLDING_KINDS.map((k) => (
                  <NativeSelectOption key={k} value={k}>
                    {KIND_META[k].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            {draft.kind === "fund" ? (
              <div className="sm:col-span-2">
                <Label className="text-[11px] text-muted-foreground">我的基金（选择后自动填名称与已知代码）</Label>
                <NativeSelect
                  value={selectedFund}
                  onChange={(e) => pickFund(e.target.value)}
                  className="mt-1 h-8 text-xs"
                  aria-label="我的基金"
                >
                  <NativeSelectOption value="">手动输入 / 新基金</NativeSelectOption>
                  {fundOptions.map((o) => (
                    <NativeSelectOption key={o.name} value={o.name}>
                      {o.name}
                      {o.code ? ` · ${o.code}` : " · 代码待补"}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  名单与新增名称都保存在本机（键 {FUND_NAMES_KEY}）；只有已确认的代码才会自动填入。
                </p>
              </div>
            ) : null}
            <div>
              <Label className="text-[11px] text-muted-foreground">{draft.kind === "fund" ? "基金名称（可直接输入新基金）" : "名称"}</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={draft.name}
                onChange={(e) => patch("name", e.target.value.slice(0, 30))}
                maxLength={30}
                placeholder={NAME_PLACEHOLDER[draft.kind]}
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">{draft.kind === "fund" ? "基金代码（6 位，建议填写）" : "代码（可选）"}</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={draft.code}
                onChange={(e) =>
                  patch("code", draft.kind === "fund" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value.slice(0, 16))
                }
                maxLength={draft.kind === "fund" ? 6 : 16}
                inputMode={draft.kind === "fund" ? "numeric" : "text"}
                placeholder={draft.kind === "fund" ? "018036" : "600519 / 110020"}
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">{meta.amountOnly ? "金额（元）" : `数量（${meta.unit}）`}</Label>
              <Input
                className="mt-1 h-8 text-xs"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={draft.units}
                onChange={(e) => patch("units", e.target.value)}
                placeholder={meta.amountOnly ? "50000" : "100"}
              />
            </div>
            {meta.amountOnly ? null : (
              <>
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    {draft.kind === "fund" ? "成本净值（元/份）" : `成本单价（元/${meta.unit}）`}
                  </Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={draft.cost}
                    onChange={(e) => patch("cost", e.target.value)}
                    placeholder={draft.kind === "fund" ? "2.6374" : "480"}
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    {draft.kind === "fund" ? "最新净值（元/份，可留空）" : `现价（元/${meta.unit}，可留空）`}
                  </Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={draft.price}
                    onChange={(e) => patch("price", e.target.value)}
                    placeholder={draft.kind === "fund" ? "2.3897" : "留空按成本计价"}
                  />
                </div>
                {meta.fee ? (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">手续费（元，可选）</Label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={draft.fee}
                      onChange={(e) => patch("fee", e.target.value)}
                      placeholder="0"
                    />
                  </div>
                ) : null}
                {draft.kind === "fund" ? (
                  <>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">持有收益（元，可留空）</Label>
                      <Input
                        className="mt-1 h-8 text-xs"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={draft.holdingPnl}
                        onChange={(e) => patch("holdingPnl", e.target.value)}
                        placeholder="-304.50"
                      />
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">照抄基金持仓页；留空按市值 − 成本自动算</p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">持有收益率（%，可留空）</Label>
                      <Input
                        className="mt-1 h-8 text-xs"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={draft.holdingPnlPct}
                        onChange={(e) => patch("holdingPnlPct", e.target.value)}
                        placeholder="-9.39"
                      />
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">填 -9.39 表示 -9.39%，不是 -0.0939</p>
                    </div>
                  </>
                ) : null}
                <div>
                  <Label className="text-[11px] text-muted-foreground">价格日期</Label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    type="date"
                    value={draft.priceAsOf}
                    onChange={(e) => patch("priceAsOf", e.target.value)}
                  />
                </div>
              </>
            )}
            <div className={meta.amountOnly ? "sm:col-span-2 xl:col-span-2" : "sm:col-span-2 xl:col-span-1"}>
              <Label className="text-[11px] text-muted-foreground">备注（可选）</Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={draft.note}
                onChange={(e) => patch("note", e.target.value.slice(0, 60))}
                maxLength={60}
                placeholder="用途、账户、买入原因…"
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8 text-[11px]" onClick={save}>
              {editingId ? "保存修改" : "添加持仓"}
            </Button>
            {editingId ? (
              <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={cancelEdit}>
                取消编辑
              </Button>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              手动填写的现价可能过期；估值与风控只按填写值计算。
              {draft.kind === "fund"
                ? "基金净值以填写值为准，DeepSeek 优先按代码、没有代码时按名称识别，不代查净值；持有收益与持有收益率照抄持仓页即可，留空按市值 − 成本自动计算（不含手续费），与含费浮动盈亏分开显示。"
                : ""}
            </span>
          </div>
          {formError ? <p className="mt-1.5 text-[11px] text-[var(--d-red)]">{formError}</p> : null}
          {formNote ? <p className="mt-1.5 text-[11px] text-[var(--d-mint)]">{formNote}</p> : null}
        </div>

        {summary.count === 0 ? (
          <div className="mt-3">
            <EmptyState text="还没有持仓。添加第一笔后，页面会自动计算占比、盈亏与风控提示，并可以交给 DeepSeek 做结构诊断。" />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse">
              <thead>
                <tr className="border-b border-border/70">
                  <Th>类别</Th>
                  <Th>名称</Th>
                  <Th right>数量</Th>
                  <Th right>成本单价</Th>
                  <Th right>手续费</Th>
                  <Th right>现价</Th>
                  <Th right>市值</Th>
                  <Th right>持有收益</Th>
                  <Th right>持有收益率</Th>
                  <Th right>浮动盈亏（含费）</Th>
                  <Th right>占比</Th>
                  <Th right>操作</Th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => {
                  const m = KIND_META[r.kind];
                  return (
                    <tr key={r.id} className="border-b border-border/50 last:border-0">
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: KIND_COLOR[r.kind] }} />
                          {m.label}
                        </span>
                      </Td>
                      <Td mono={false}>
                        <span className="font-medium">{r.name}</span>
                        {r.code ? (
                          <span className="tnum ml-1 rounded border border-border/70 bg-secondary/60 px-1 text-[10px] text-muted-foreground">{r.code}</span>
                        ) : r.kind === "fund" ? (
                          <span className="ml-1 text-[10px] text-[var(--d-vxn)]">缺代码</span>
                        ) : null}
                        {r.note ? <p className="mt-0.5 text-[10px] text-muted-foreground">{r.note}</p> : null}
                      </Td>
                      <Td right>{m.amountOnly ? money(r.units) : `${qtyText(r.units)} ${m.unit}`}</Td>
                      <Td right>
                        {m.amountOnly ? "—" : unitMoney(r.cost, r.kind)}
                        {!m.amountOnly && r.fee > 0 ? <p className="text-[10px] text-muted-foreground">含费 {unitMoney(r.breakeven, r.kind)}</p> : null}
                      </Td>
                      <Td right>{m.amountOnly ? "—" : r.fee > 0 ? money(r.fee) : <span className="text-muted-foreground">—</span>}</Td>
                      <Td right>
                        {m.amountOnly ? "—" : r.price === null ? <span className="text-muted-foreground">未填</span> : unitMoney(r.price, r.kind)}
                        {!m.amountOnly && r.priceAsOf ? <p className="text-[10px] text-muted-foreground">{r.priceAsOf}</p> : null}
                      </Td>
                      <Td right>{money(r.value, r.kind === "fund" ? 2 : 0)}</Td>
                      <Td right className={r.kind !== "fund" ? "text-muted-foreground" : r.holdingPnl > 0 ? "text-[var(--d-mint)]" : r.holdingPnl < 0 ? "text-[var(--d-red)]" : ""}>
                        {r.kind === "fund" ? (
                          <>
                            {money(r.holdingPnl)}
                            <p className="text-[10px] opacity-80">{r.holdingPnlManual ? "手填" : "自动（不含费）"}</p>
                          </>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td right className={r.kind !== "fund" ? "text-muted-foreground" : r.holdingPnl < 0 ? "text-[var(--d-red)]" : ""}>
                        {r.kind === "fund" ? signedPct(r.holdingPnlPct) : "—"}
                      </Td>
                      <Td right className={r.pnl > 0 ? "text-[var(--d-mint)]" : r.pnl < 0 ? "text-[var(--d-red)]" : "text-muted-foreground"}>
                        {money(r.pnl)}
                        <p className="text-[10px] opacity-80">{signedPct(r.pnlPct)}</p>
                      </Td>
                      <Td right>{pctText(r.weight, 1)}</Td>
                      <Td right>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => edit(r)}>
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[10px] text-[var(--d-red)] hover:text-[var(--d-red)]"
                            onClick={() => remove(r)}
                          >
                            删除
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="DeepSeek 组合诊断"
        description="把本机台账（含基金代码与手续费）、可投入现金与本站 VIX、所选指数已实现波动率、跨资产指标一起交给 DeepSeek，只检查集中度、防守垫、止损纪律与现金分批部署。密钥只存这台设备的浏览器，站点服务端不代持、不转发。"
      >
        <PortfolioAi holdings={holdings} market={market} dryPowder={dryPowder} />
      </Panel>
    </div>
  );
}
