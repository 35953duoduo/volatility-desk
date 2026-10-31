import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BASE,
  ApiError,
  EXTRA_DIVIDEND_LIMIT,
  EXTRA_DIVIDEND_STORAGE_KEY,
  EXTRA_STOCK_LIMIT,
  EXTRA_STOCK_STORAGE_KEY,
  isValidStockCode,
  query,
  requestJson,
  type AiContextPayload,
  type CyclePayload,
  type DiagnosisPayload,
  type DividendListPayload,
  type EventsPayload,
  type EventStudyPayload,
  type HealthPayload,
  type HistoryPayload,
  type MacroPayload,
  type PanicPayload,
  type SignalsPayload,
  type SnapshotPayload,
  type StocksListPayload,
  type StocksSignalsPayload,
  type ValuationPayload,
} from "@/lib/api";

export interface Controls {
  symbol: string;
  years: number | null;
  freq: "1d" | "1w" | "1m";
  refresh: boolean;
}

export interface DashboardState {
  loading: boolean;
  error: string | null;
  health: HealthPayload | null;
  history: HistoryPayload | null;
  snapshot: SnapshotPayload | null;
  signals: SignalsPayload | null;
  diagnosis: DiagnosisPayload | null;
  aiMarkdown: AiContextPayload | null;
  panic: PanicPayload | null;
  events: EventsPayload | null;
  eventsStudy: EventStudyPayload | null;
  studyError: string | null;
  studyLoading: boolean;
  stocksList: StocksListPayload | null;
  stocksSignals: StocksSignalsPayload | null;
  stocksError: string | null;
  stocksLoading: boolean;
  dividendList: DividendListPayload | null;
  dividendError: string | null;
  dividendLoading: boolean;
  macro: MacroPayload | null;
  macroError: string | null;
  macroLoading: boolean;
  macroYears: number;
  setMacroYears: (years: number) => void;
  cycle: CyclePayload | null;
  cycleError: string | null;
  cycleLoading: boolean;
  cycleYears: number | null;
  setCycleYears: (years: number | null) => void;
  valuation: ValuationPayload | null;
  valuationError: string | null;
  valuationLoading: boolean;
  valuationYears: number | null;
  setValuationYears: (years: number | null) => void;
  /** 手动添加的个股代码，只保存在本机浏览器 */
  extraStockCodes: string[];
  setExtraStockCodes: (codes: string[]) => void;
  /** 红利策略手动添加的个股代码，与个股诊断分开保存 */
  dividendExtraCodes: string[];
  setDividendExtraCodes: (codes: string[]) => void;
  fetchedAt: number | null;
  reload: () => void;
}

/** 读取本机手动添加的个股（无痕模式或损坏数据时退回空列表） */
export function readExtraStockCodes(): string[] {
  try {
    const raw = localStorage.getItem(EXTRA_STOCK_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && isValidStockCode(x)))].slice(0, EXTRA_STOCK_LIMIT);
  } catch {
    return [];
  }
}

/** 读取本机手动添加的红利股（键与个股诊断分开） */
function readDividendExtraCodes(): string[] {
  try {
    const raw = localStorage.getItem(EXTRA_DIVIDEND_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && isValidStockCode(x)))].slice(0, EXTRA_DIVIDEND_LIMIT);
  } catch {
    return [];
  }
}

/** 一次并行拉取全部接口，任一失败都会显式呈现而不是静默降级 */
export function useDashboardData(controls: Controls): DashboardState {
  const [token, setToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [signals, setSignals] = useState<SignalsPayload | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisPayload | null>(null);
  const [aiMarkdown, setAiMarkdown] = useState<AiContextPayload | null>(null);
  const [panic, setPanic] = useState<PanicPayload | null>(null);
  const [events, setEvents] = useState<EventsPayload | null>(null);
  const [eventsStudy, setEventsStudy] = useState<EventStudyPayload | null>(null);
  const [studyLoading, setStudyLoading] = useState(true);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [stocksList, setStocksList] = useState<StocksListPayload | null>(null);
  const [stocksSignals, setStocksSignals] = useState<StocksSignalsPayload | null>(null);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [stocksError, setStocksError] = useState<string | null>(null);
  const [dividendList, setDividendList] = useState<DividendListPayload | null>(null);
  const [dividendLoading, setDividendLoading] = useState(true);
  const [dividendError, setDividendError] = useState<string | null>(null);
  const [macro, setMacro] = useState<MacroPayload | null>(null);
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState<string | null>(null);
  const [macroYears, setMacroYears] = useState(3);
  const [cycle, setCycle] = useState<CyclePayload | null>(null);
  const [cycleLoading, setCycleLoading] = useState(true);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [cycleYears, setCycleYears] = useState<number | null>(5);
  const [valuation, setValuation] = useState<ValuationPayload | null>(null);
  const [valuationLoading, setValuationLoading] = useState(true);
  const [valuationError, setValuationError] = useState<string | null>(null);
  const [valuationYears, setValuationYears] = useState<number | null>(20);
  const [extraStockCodes, setExtraStockCodesState] = useState<string[]>(readExtraStockCodes);
  const [dividendExtraCodes, setDividendExtraCodesState] = useState<string[]>(readDividendExtraCodes);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // 另一个标签页增删自选股时同步过来，避免旧列表覆盖新列表
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === EXTRA_STOCK_STORAGE_KEY) setExtraStockCodesState(readExtraStockCodes());
      if (event.key === EXTRA_DIVIDEND_STORAGE_KEY) setDividendExtraCodesState(readDividendExtraCodes());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setExtraStockCodes = useCallback((codes: string[]) => {
    const clean = [...new Set(codes.filter(isValidStockCode))].slice(0, EXTRA_STOCK_LIMIT);
    setExtraStockCodesState(clean);
    try {
      localStorage.setItem(EXTRA_STOCK_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      /* 无痕模式下存不下，仅当前会话有效 */
    }
  }, []);

  const setDividendExtraCodes = useCallback((codes: string[]) => {
    const clean = [...new Set(codes.filter(isValidStockCode))].slice(0, EXTRA_DIVIDEND_LIMIT);
    setDividendExtraCodesState(clean);
    try {
      localStorage.setItem(EXTRA_DIVIDEND_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      /* 无痕模式下存不下，仅当前会话有效 */
    }
  }, []);

  const qs = useMemo(
    () =>
      query({
        symbol: controls.symbol,
        years: controls.years ?? "all",
        freq: controls.freq,
        refresh: controls.refresh ? 1 : 0,
      }),
    [controls.symbol, controls.years, controls.freq, controls.refresh],
  );

  const reload = useCallback(() => setToken((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);

    const paths: [keyof DashboardState, string][] = [
      ["history", `${BASE}/api/volatility/history${qs}`],
      ["snapshot", `${BASE}/api/volatility/snapshot${qs}`],
      ["signals", `${BASE}/api/signals${qs}`],
      ["diagnosis", `${BASE}/api/diagnosis${qs}`],
      ["aiMarkdown", `${BASE}/api/ai-context${qs}&format=markdown`],
      ["panic", `${BASE}/api/volatility/panic${query({ refresh: controls.refresh ? 1 : 0 })}`],
    ];

    void Promise.allSettled(paths.map(([, url]) => requestJson(url, controller.signal))).then((results) => {
      if (!alive) return;
      const setters = [setHistory, setSnapshot, setSignals, setDiagnosis, setAiMarkdown, setPanic];
      const failures: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") setters[i](r.value as never);
        else {
          const err = r.reason;
          if ((err as Error)?.name === "AbortError") return;
          failures.push(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
        }
      });
      if (failures.length) setError(failures.join("；").slice(0, 400));
      setFetchedAt(Date.now());
      setLoading(false);
    });

    // 健康检查只在首次与手动刷新时执行（会触发上游实时探测）
    requestJson<HealthPayload>(`${BASE}/health${query({ refresh: controls.refresh ? 1 : 0 })}`, controller.signal)
      .then((h) => {
        if (alive) setHealth(h);
      })
      .catch(() => {
        /* 健康状态缺失不阻塞主视图 */
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [qs, token]);

  // 大摩报告事件与复盘：与所选标的/窗口无关，只在首屏、手动刷新或实时开关变化时重算
  const studyQs = useMemo(() => query({ refresh: controls.refresh ? 1 : 0 }), [controls.refresh]);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setStudyLoading(true);
    setStudyError(null);

    void Promise.allSettled([
      requestJson<EventsPayload>(`${BASE}/api/events`, controller.signal),
      requestJson<EventStudyPayload>(`${BASE}/api/events/study${studyQs}`, controller.signal),
    ]).then(([ev, st]) => {
      if (!alive) return;
      const failures: string[] = [];
      if (ev.status === "fulfilled") setEvents(ev.value);
      else if ((ev.reason as Error)?.name !== "AbortError") {
        failures.push(ev.reason instanceof ApiError ? `${ev.reason.code}: ${ev.reason.message}` : String(ev.reason));
      }
      if (st.status === "fulfilled") setEventsStudy(st.value);
      else if ((st.reason as Error)?.name !== "AbortError") {
        failures.push(st.reason instanceof ApiError ? `${st.reason.code}: ${st.reason.message}` : String(st.reason));
      }
      setStudyError(failures.length ? failures.join("；").slice(0, 400) : null);
      setStudyLoading(false);
    });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [studyQs, token]);

  // 个股诊断：基础清单 + 本机手动添加的代码，独立于所选指数标的
  const stocksQs = useMemo(
    () => `${studyQs}${extraStockCodes.length ? `&extra=${encodeURIComponent(extraStockCodes.join(","))}` : ""}`,
    [studyQs, extraStockCodes],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setStocksLoading(true);
    setStocksError(null);

    void Promise.allSettled([
      requestJson<StocksListPayload>(`${BASE}/api/stocks/list${stocksQs}`, controller.signal),
      requestJson<StocksSignalsPayload>(`${BASE}/api/stocks/signals${stocksQs}`, controller.signal),
    ]).then(([ls, sg]) => {
      if (!alive) return;
      const failures: string[] = [];
      if (ls.status === "fulfilled") setStocksList(ls.value);
      else if ((ls.reason as Error)?.name !== "AbortError") {
        failures.push(ls.reason instanceof ApiError ? `${ls.reason.code}: ${ls.reason.message}` : String(ls.reason));
      }
      if (sg.status === "fulfilled") setStocksSignals(sg.value);
      else if ((sg.reason as Error)?.name !== "AbortError") {
        failures.push(sg.reason instanceof ApiError ? `${sg.reason.code}: ${sg.reason.message}` : String(sg.reason));
      }
      setStocksError(failures.length ? failures.join("；").slice(0, 400) : null);
      setStocksLoading(false);
    });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [stocksQs, token]);

  // 红利策略清单：基础清单 + 本机手动添加的代码，与所选指数无关
  const dividendQs = useMemo(
    () => `${studyQs}${dividendExtraCodes.length ? `&extra=${encodeURIComponent(dividendExtraCodes.join(","))}` : ""}`,
    [studyQs, dividendExtraCodes],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setDividendLoading(true);
    setDividendError(null);
    requestJson<DividendListPayload>(`${BASE}/api/dividend/list${dividendQs}`, controller.signal)
      .then((d) => {
        if (alive) setDividendList(d);
      })
      .catch((err) => {
        if (!alive || (err as Error)?.name === "AbortError") return;
        setDividendError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      })
      .finally(() => {
        if (alive) setDividendLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [dividendQs, token]);

  // 跨资产（黄金 / 原油 / 美债）：窗口独立于指数标的，与实时开关联动
  const macroQs = useMemo(
    () => query({ years: macroYears, refresh: controls.refresh ? 1 : 0 }),
    [macroYears, controls.refresh],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setMacroLoading(true);
    setMacroError(null);
    requestJson<MacroPayload>(`${BASE}/api/macro/cross-asset${macroQs}`, controller.signal)
      .then((d) => {
        if (alive) setMacro(d);
      })
      .catch((err) => {
        if (!alive || (err as Error)?.name === "AbortError") return;
        setMacroError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      })
      .finally(() => {
        if (alive) setMacroLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [macroQs, token]);

  // 康波对照：三指数共同交易日窗口，独立于顶部所选标的
  const cycleQs = useMemo(
    () => query({ years: cycleYears ?? "all", refresh: controls.refresh ? 1 : 0 }),
    [cycleYears, controls.refresh],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setCycleLoading(true);
    setCycleError(null);
    requestJson<CyclePayload>(`${BASE}/api/cycle/kondratiev${cycleQs}`, controller.signal)
      .then((d) => {
        if (alive) setCycle(d);
      })
      .catch((err) => {
        if (!alive || (err as Error)?.name === "AbortError") return;
        setCycleError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      })
      .finally(() => {
        if (alive) setCycleLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [cycleQs, token]);

  // 巴菲特指数：季度数据，窗口默认 20 年
  const valuationQs = useMemo(
    () => query({ years: valuationYears ?? "all", refresh: controls.refresh ? 1 : 0 }),
    [valuationYears, controls.refresh],
  );

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setValuationLoading(true);
    setValuationError(null);
    requestJson<ValuationPayload>(`${BASE}/api/valuation/buffett${valuationQs}`, controller.signal)
      .then((d) => {
        if (alive) setValuation(d);
      })
      .catch((err) => {
        if (!alive || (err as Error)?.name === "AbortError") return;
        setValuationError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
      })
      .finally(() => {
        if (alive) setValuationLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [valuationQs, token]);

  return {
    loading,
    error,
    health,
    history,
    snapshot,
    signals,
    diagnosis,
    aiMarkdown,
    panic,
    events,
    eventsStudy,
    studyError,
    studyLoading,
    stocksList,
    stocksSignals,
    stocksError,
    stocksLoading,
    dividendList,
    dividendError,
    dividendLoading,
    macro,
    macroError,
    macroLoading,
    macroYears,
    setMacroYears,
    cycle,
    cycleError,
    cycleLoading,
    cycleYears,
    setCycleYears,
    valuation,
    valuationError,
    valuationLoading,
    valuationYears,
    setValuationYears,
    extraStockCodes,
    setExtraStockCodes,
    dividendExtraCodes,
    setDividendExtraCodes,
    fetchedAt,
    reload,
  };
}
