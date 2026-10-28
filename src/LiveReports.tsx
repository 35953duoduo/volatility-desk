import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Panel, Td, Th } from "@/src/ui-kit";
import { BASE, query, requestJson, type HistoryPayload } from "@/lib/api";
import { LlmError, extractReportEvents, fetchPage, loadConfig, searchWeb, type FetchedReportEvent } from "@/lib/deepseek";

const STORAGE_KEY = "vol-desk-reports";
const QUERIES = ["摩根士丹利 中国 A股 股市 策略 报告 展望", "摩根士丹利 上调 沪深300 恒生指数 目标 中国股市"];
const HORIZONS = [1, 5, 20, 60];
const SYMBOLS = ["SSE", "CSI300"];

const STANCE_TONE: Record<string, string> = {
  看多: "border-[var(--d-mint)]/45 bg-[var(--d-mint)]/10 text-[var(--d-mint)]",
  看空: "border-[var(--d-red)]/45 bg-[var(--d-red)]/10 text-[var(--d-red)]",
  中性: "border-border bg-secondary/60 text-foreground",
};

function signed(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function retClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "text-muted-foreground";
  return v > 0 ? "text-[var(--d-mint)]" : v < 0 ? "text-[var(--d-red)]" : "text-foreground/80";
}

function loadPersisted(): { events: FetchedReportEvent[]; fetchedAt: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { events: [], fetchedAt: null };
    const p = JSON.parse(raw) as { events?: FetchedReportEvent[]; fetchedAt?: string };
    return { events: Array.isArray(p.events) ? p.events : [], fetchedAt: typeof p.fetchedAt === "string" ? p.fetchedAt : null };
  } catch {
    return { events: [], fetchedAt: null };
  }
}

/** 用真实日线收盘价，为抓取到的报告计算「报告后 1/5/20/60 日」前向收益 */
async function computeForward(events: FetchedReportEvent[]): Promise<Record<string, { anchor: string; [sym: string]: string | (number | null)[] }>> {
  const map: Record<string, { anchor: string; [sym: string]: string | (number | null)[] }> = {};
  if (!events.length) return map;
  const series: Record<string, { date: string; close: number }[]> = {};
  for (const s of SYMBOLS) {
    try {
      const p = await requestJson<HistoryPayload>(BASE + "/api/volatility/history" + query({ symbol: s, years: "all", freq: "1d" }));
      series[s] = (p.series ?? []).map((r) => ({ date: r.date, close: r.close }));
    } catch {
      series[s] = [];
    }
  }
  events.forEach((e, i) => {
    const row: { anchor: string; [sym: string]: string | (number | null)[] } = { anchor: e.date };
    for (const s of SYMBOLS) {
      const rows = series[s] ?? [];
      const idx = e.date ? rows.findIndex((r) => r.date >= e.date) : -1;
      if (idx < 0 || idx >= rows.length) {
        row[s] = HORIZONS.map(() => null);
        continue;
      }
      const base = rows[idx].close;
      row[s] = HORIZONS.map((h) => (idx + h < rows.length ? ((rows[idx + h].close / base - 1) * 100) : null));
    }
    map[String(i)] = row;
  });
  return map;
}

export default function LiveReports() {
  const persisted = useMemo(loadPersisted, []);
  const [events, setEvents] = useState<FetchedReportEvent[]>(persisted.events);
  const [fetchedAt, setFetchedAt] = useState<string | null>(persisted.fetchedAt);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forward, setForward] = useState<Record<string, { anchor: string; [sym: string]: string | (number | null)[] }>>({});

  useEffect(() => {
    let alive = true;
    setForward({});
    if (!events.length) return;
    computeForward(events).then((m) => {
      if (alive) setForward(m);
    });
    return () => {
      alive = false;
    };
  }, [events]);

  async function run() {
    setError(null);
    const cfg = loadConfig();
    if (!cfg) {
      setError("还没有配置 DeepSeek 密钥：请先到「买卖诊断」标签添加模型并保存 API Key，再回来抓取。");
      return;
    }
    setBusy(true);
    try {
      setStep("搜索最新报道…");
      const hits = (await Promise.all(QUERIES.map((q) => searchWeb(cfg, q).catch(() => [])))).flat();
      const uniq = [...new Map(hits.map((h) => [h.url, h])).values()];
      const searchText = uniq
        .slice(0, 12)
        .map((h) => `- [${h.date ?? "?"}] ${h.title}（${h.site}）${h.url}\n  ${h.summary || h.snippet}`)
        .join("\n");
      if (!uniq.length) {
        setError("没有搜到相关报道，可稍后再试或检查网络。");
        return;
      }
      setStep("抓取正文…");
      const pages = (
        await Promise.all(
          uniq.slice(0, 3).map((h) => fetchPage(cfg, h.url).catch(() => null)),
        )
      ).filter((p): p is NonNullable<typeof p> => p !== null);
      setStep("提取结构化事件…");
      const evts = await extractReportEvents(cfg, { searchText, pages });
      setEvents(evts);
      const at = new Date().toISOString();
      setFetchedAt(at);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: evts, fetchedAt: at }));
      } catch {
        /* 无痕模式存不下，忽略 */
      }
      if (!evts.length) setError("已搜索并抓取正文，但没有提取出可结构化的大摩报告事件，可稍后重试。");
    } catch (err) {
      setError(err instanceof LlmError ? err.message : String(err));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  function clear() {
    setEvents([]);
    setFetchedAt(null);
    setForward({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  const label = SYMBOLS.map((s) => (s === "SSE" ? "上证" : "沪深300"));

  return (
    <Panel
      title="实时抓取大摩最新报告"
      description="用 DeepSeek 官方网页搜索与抓取接口，检索并提取大摩（摩根士丹利）关于中国 / A 股的最新策略报告，再按报告日后真实行情计算前向收益。消耗你账户里的 token；抓取结果只存在本机浏览器，未经人工核对。"
      action={
        <div className="flex gap-1.5">
          {events.length ? (
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              清除
            </Button>
          ) : null}
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? (step || "抓取中…") : "抓取最新报告"}
          </Button>
        </div>
      }
    >
      {error ? (
        <Alert className="border-[var(--d-vxn)]/35 bg-[var(--d-vxn)]/5">
          <AlertTitle>抓取未完成</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
        </Alert>
      ) : null}

      {events.length === 0 ? (
        <EmptyState text={busy ? "正在用 DeepSeek 检索与提取…" : "点击「抓取最新报告」用 DeepSeek 检索大摩最新策略观点；需要先在「买卖诊断」里配置密钥。"} />
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="border-[var(--d-vxn)]/40 bg-[var(--d-vxn)]/10 text-[10px] text-[var(--d-vxn)]">
              AI 抓取 · 未经人工核对
            </Badge>
            {fetchedAt ? <span className="tnum">抓取于 {new Date(fetchedAt).toLocaleString("zh-CN", { hour12: false })}</span> : null}
          </div>

          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <Th>报告 / 报道</Th>
                  <Th>立场</Th>
                  <Th>目标位</Th>
                  <Th right>上证 1/5/20/60 日</Th>
                  <Th right>沪深300 1/5/20/60 日</Th>
                  <Th>来源</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e, i) => {
                  const fw = forward[String(i)];
                  return (
                    <TableRow key={i} className="border-border/50 align-top">
                      <TableCell className="px-2.5 py-2">
                        <p className="text-xs font-medium leading-snug">{e.title || "（无标题）"}</p>
                        <p className="tnum mt-0.5 text-[11px] text-muted-foreground">{e.date || "日期不详"} · {e.action}</p>
                        {e.summary ? <p className="mt-1 max-w-[340px] text-[11px] leading-snug text-muted-foreground">{e.summary}</p> : null}
                        {e.note ? <p className="mt-0.5 text-[11px] text-[var(--d-vxn)]">{e.note}</p> : null}
                      </TableCell>
                      <TableCell className="px-2.5 py-2">
                        <Badge variant="outline" className={`px-1.5 py-0 text-[10px] font-normal ${STANCE_TONE[e.stance] ?? STANCE_TONE.中性}`}>
                          {e.stance}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-2.5 py-2 text-[11px]">
                        {e.targets.length
                          ? e.targets.map((t) => (
                              <div key={`${t.index}-${t.horizon}`} className="whitespace-nowrap">
                                {t.index || "指数"} → {t.to === null ? "—" : t.to}
                                {t.horizon ? <span className="text-muted-foreground">（{t.horizon}）</span> : null}
                              </div>
                            ))
                          : "—"}
                      </TableCell>
                      {SYMBOLS.map((s) => {
                        const vals = fw?.[s];
                        const arr = Array.isArray(vals) ? (vals as (number | null)[]) : [];
                        return (
                          <Td key={s} right>
                            {arr.length ? (
                              <span className="tnum text-[11px]">{arr.map((v, j) => `${j === 0 ? "" : "/"}${signed(v)}`).join("")}</span>
                            ) : (
                              <span className="text-muted-foreground">{fw?.[s] === null ? "—" : "计算中…"}</span>
                            )}
                          </Td>
                        );
                      })}
                      <TableCell className="px-2.5 py-2">
                        {e.sourceUrl ? (
                          <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-[11px] text-[var(--d-rv21)] hover:underline">
                            {e.sourceLabel || "来源"}
                          </a>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            前向收益按「报告日后首个交易日」为锚点、用真实收盘价计算（非年化）；日期缺失或晚于行情末尾的记作 —。抓取与提取由 DeepSeek 完成，标题、日期、立场与目标位可能存在偏差，重要结论请点来源核实。
          </p>
        </div>
      )}
    </Panel>
  );
}
