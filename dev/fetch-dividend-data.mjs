// 本地数据抓取脚本（不属于发布产物，仅 dev/ 目录使用）
// 抓取国企红利股的不复权日线与分红明细，按周重采样后生成函数侧快照。
// 运行： node dev/fetch-dividend-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIVIDEND_WATCHLIST } from '../functions/data/dividendWatchlist.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BEG = '20150101';
const END = '20500101';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dateMinusOneDay(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 周一作为周键，保留每周最后一个交易日的日期与收盘价 */
function weekKey(date) {
  const d = new Date(date + 'T00:00:00Z');
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function toWeekly(rows) {
  const map = new Map();
  for (const [date, close] of rows) {
    const key = weekKey(date);
    const prev = map.get(key);
    if (!prev || date > prev[0]) map.set(key, [date, close]);
  }
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function tencentSymbol(code) {
  return (code.startsWith('6') ? 'sh' : 'sz') + code;
}

/** 东方财富不复权日线（fqt=0），两次尝试 */
async function fetchEastmoneyDaily(secid, retries = 2) {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' +
    encodeURIComponent(secid) +
    '&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=' +
    BEG +
    '&end=' +
    END;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const data = json && json.data;
      const klines = data && data.klines;
      if (!Array.isArray(klines) || !klines.length) throw new Error('空响应');
      const rows = klines
        .map((line) => {
          const p = line.split(',');
          return [p[0], Number(p[2])];
        })
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && Number.isFinite(r[1]) && r[1] > 0);
      if (rows.length < 30) throw new Error('样本不足');
      return { name: data.name || '', rows, source: 'eastmoney' };
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) await sleep(1200);
    }
  }
  throw new Error(String(lastErr && lastErr.message ? lastErr.message : lastErr).slice(0, 100));
}

/** 腾讯不复权日线（单页上限 640 条，按最早日期向前翻页补全 2015 起） */
async function fetchTencentDaily(code) {
  const symbol = tencentSymbol(code);
  const byDate = new Map();
  let name = '';
  let end = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  for (let page = 0; page < 5; page++) {
    const url =
      'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=' +
      encodeURIComponent(`${symbol},day,2015-01-01,${end},640`);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('腾讯行情 HTTP ' + res.status);
    const json = await res.json();
    const block = json.data && json.data[symbol];
    const list = block && block.day;
    if (!name) {
      const qt = block && block.qt && block.qt[symbol] && block.qt[symbol][1];
      if (typeof qt === 'string' && qt.trim()) name = qt.trim();
    }
    if (!Array.isArray(list) || !list.length) {
      if (page === 0) throw new Error('该代码没有日线数据');
      break;
    }
    let earliest = '';
    for (const p of list) {
      const date = String(p && p[0]);
      const close = Number(p && p[2]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) {
        byDate.set(date, close);
        if (!earliest || date < earliest) earliest = date;
      }
    }
    if (!earliest || earliest <= '2015-01-05') break;
    const next = dateMinusOneDay(earliest);
    if (next >= end) break;
    end = next;
    await sleep(300);
  }
  const rows = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (rows.length < 30) throw new Error('样本不足');
  return { name, rows, source: 'tencent' };
}

async function fetchDaily(item) {
  try {
    return await fetchEastmoneyDaily(item.secid);
  } catch (primary) {
    const fallback = await fetchTencentDaily(item.code).catch((err) => {
      throw new Error(
        `东方财富：${String(primary && primary.message ? primary.message : primary).slice(0, 80)}；腾讯：${String(
          err && err.message ? err.message : err,
        ).slice(0, 80)}`,
      );
    });
    return { ...fallback, note: '东方财富不可达，已回退腾讯' };
  }
}

/** 东方财富分红明细（税前每 10 股派息），返回按除息日升序 */
async function fetchDividends(code) {
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=ALL&filter=' +
    encodeURIComponent(`(SECURITY_CODE="${code}")`) +
    '&pageNumber=1&pageSize=200&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1&source=WEB&client=WEB';
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const list = json && json.result && json.result.data;
      if (!Array.isArray(list)) throw new Error('空响应');
      return list
        .map((r) => {
          const exDate = String(r.EX_DIVIDEND_DATE || '').slice(0, 10);
          const dps = Number(r.PRETAX_BONUS_RMB) / 10;
          return {
            exDate,
            dps: Math.round(dps * 10000) / 10000,
            plan: String(r.IMPL_PLAN_PROFILE || ''),
            reportDate: String(r.REPORT_DATE || '').slice(0, 10),
            progress: String(r.ASSIGN_PROGRESS || ''),
          };
        })
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.exDate) && Number.isFinite(r.dps) && r.dps > 0)
        .sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(1500);
    }
  }
  throw new Error(String(lastErr && lastErr.message ? lastErr.message : lastErr).slice(0, 100));
}

const stocks = [];
const sources = { eastmoney: 0, tencent: 0 };
for (const item of DIVIDEND_WATCHLIST) {
  try {
    const daily = await fetchDaily(item);
    sources[daily.source] = (sources[daily.source] || 0) + 1;
    const weekly = toWeekly(daily.rows);
    const dividends = await fetchDividends(item.code);
    stocks.push({
      code: item.code,
      name: daily.name || item.name,
      sector: item.sector,
      secid: item.secid,
      note: item.note,
      weekly,
      dividends,
    });
    console.log(
      `${item.code} ${daily.name || item.name} 日线=${daily.rows.length} 周线=${weekly.length} 分红=${dividends.length} 源=${daily.source} 区间=${weekly[0][0]} -> ${weekly.at(-1)[0]}`,
    );
  } catch (err) {
    console.log(`${item.code} ${item.name} FAILED: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
  }
}

const minStocks = Math.max(10, Math.ceil(DIVIDEND_WATCHLIST.length * 0.9));
if (stocks.length < minStocks) {
  console.error(
    `有效标的仅 ${stocks.length}/${DIVIDEND_WATCHLIST.length} 只（低于 ${minStocks} 只），疑似上游大面积失败，未写入快照。请稍后重试。`,
  );
  process.exitCode = 1;
} else {
  const dataset = {
    generatedAt: new Date().toISOString(),
    source:
      `红利股不复权周线（本次抓取：东方财富 ${sources.eastmoney || 0} 只，腾讯回退 ${sources.tencent || 0} 只）+ 分红明细（东方财富 RPT_SHAREBONUS_DET，税前每 10 股派息）`,
    window: {
      from: stocks.map((s) => s.weekly[0][0]).sort()[0],
      to: stocks.map((s) => s.weekly.at(-1)[0]).sort().at(-1),
    },
    stocks,
  };
  const outDir = resolve(root, 'functions', 'data');
  mkdirSync(outDir, { recursive: true });
  const body = JSON.stringify(dataset, null, 0);
  const header =
    '// 由 dev/fetch-dividend-data.mjs 生成的真实红利股周线与分红快照（本地抓取时间 ' +
    dataset.generatedAt +
    '）\n' +
    '// 行情为不复权收盘价；分红为税前每 10 股派息换算的每股金额。运行时仍会尝试实时报价覆盖最新一周。\n' +
    'export const dividendSnapshot = ' +
    body +
    ' as unknown as DividendSnapshotData;\n\n' +
    'export interface DividendRecordData {\n' +
    '  exDate: string;\n' +
    '  dps: number;\n' +
    '  plan: string;\n' +
    '  reportDate: string;\n' +
    '  progress: string;\n' +
    '}\n\n' +
    'export interface DividendStockData {\n' +
    '  code: string;\n' +
    '  name: string;\n' +
    '  sector: string;\n' +
    '  secid: string;\n' +
    '  note: string;\n' +
    '  weekly: [string, number][];\n' +
    '  dividends: DividendRecordData[];\n' +
    '}\n\n' +
    'export interface DividendSnapshotData {\n' +
    '  generatedAt: string;\n' +
    '  source: string;\n' +
    '  window: { from: string; to: string };\n' +
    '  stocks: DividendStockData[];\n' +
    '}\n';
  writeFileSync(resolve(outDir, 'dividendSnapshot.ts'), header, 'utf8');
  console.log(
    `\n写入 functions/data/dividendSnapshot.ts：${stocks.length} 只，周线合计 ${stocks.reduce(
      (n, s) => n + s.weekly.length,
      0,
    )} 条，${Buffer.byteLength(body)} 字节；行情来源 东方财富=${sources.eastmoney || 0} 腾讯=${sources.tencent || 0}`,
  );
}
