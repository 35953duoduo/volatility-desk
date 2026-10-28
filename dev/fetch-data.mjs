// 本地数据抓取脚本（不属于发布产物，仅 dev/ 目录使用）
// 抓取美股指数、A 股主要指数、个股观察清单与韩国综合指数的真实日线收盘价，生成函数侧快照数据集。
// 运行： node dev/fetch-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WATCHLIST } from '../functions/data/watchlist.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const BEG_DEFAULT = '20150101';
const END = '20500101';

/** 东方财富国际指数日线：fields2 f51=日期 f53=收盘价 */
async function eastmoneyKline(secid, beg = BEG_DEFAULT) {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' +
    encodeURIComponent(secid) +
    '&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=' +
    beg +
    '&end=' +
    END;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('eastmoney http ' + res.status + ' for ' + secid);
  const json = await res.json();
  const data = json && json.data;
  if (!data || !Array.isArray(data.klines) || data.klines.length === 0) {
    throw new Error('eastmoney empty payload for ' + secid);
  }
  const rows = data.klines
    .map((line) => {
      const p = line.split(',');
      return [p[0], Number(p[2])];
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && Number.isFinite(r[1]) && r[1] > 0);
  return { name: data.name, code: data.code, secid, rows };
}

/** VXN / VIX 隐含波动率的候选上游（本機网络多数不可达，线上运行时可能可用） */
const vxnProbes = [
  {
    id: 'cboe_csv',
    label: 'CBOE VXN_History.csv',
    url: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv',
    kind: 'cboe-csv',
  },
  {
    id: 'yahoo_chart',
    label: 'Yahoo Finance ^VXN',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVXN?range=15y&interval=1d',
    kind: 'yahoo',
  },
];

const vixProbes = [
  {
    id: 'cboe_vix_csv',
    label: 'CBOE VIX_History.csv',
    url: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
    kind: 'cboe-csv',
  },
  {
    id: 'cboe_vix_alt',
    label: 'CBOE VIX（备用域名）',
    url: 'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
    kind: 'cboe-csv',
  },
  {
    id: 'yahoo_vix',
    label: 'Yahoo Finance ^VIX',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=15y&interval=1d',
    kind: 'yahoo',
  },
];

async function probeImplied(source) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,application/json,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ...source, ok: false, note: 'HTTP ' + res.status };
    const text = await res.text();
    if (source.kind === 'cboe-csv') {
      const rows = text
        .split(/\r?\n/)
        .slice(1)
        .map((line) => {
          const p = line.split(',');
          return [p[0], Number(p[2])];
        })
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && Number.isFinite(r[1]));
      if (!rows.length) return { ...source, ok: false, note: '未识别到数据行' };
      return { ...source, ok: true, rows, note: 'rows=' + rows.length };
    }
    const json = JSON.parse(text);
    const r = json?.chart?.result?.[0];
    const ts = r?.timestamp || [];
    const closes = r?.indicators?.quote?.[0]?.close || [];
    const rows = ts
      .map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), Number(closes[i])])
      .filter((x) => Number.isFinite(x[1]));
    if (!rows.length) return { ...source, ok: false, note: '空结果' };
    return { ...source, ok: true, rows, note: 'rows=' + rows.length };
  } catch (err) {
    return { ...source, ok: false, note: String(err && err.message ? err.message : err).slice(0, 120) };
  }
}

const targets = [
  { key: 'NDX100', secid: '100.NDX100', label: '纳斯达克100', beg: '20190101' },
  { key: 'IXIC', secid: '100.NDX', label: '纳斯达克综合指数', beg: '20150101' },
  { key: 'SPX', secid: '100.SPX', label: '标普500', beg: '20150101' },
  { key: 'QQQ', secid: '105.QQQ', label: 'QQQ 纳斯达克100 ETF', beg: '20010101' },
  { key: 'SSE', secid: '1.000001', label: '上证指数', beg: '20150101' },
  { key: 'CSI300', secid: '1.000300', label: '沪深300', beg: '20150101' },
];

const symbols = {};
for (const t of targets) {
  const r = await eastmoneyKline(t.secid, t.beg);
  symbols[t.key] = { label: t.label, name: r.name, secid: t.secid, rows: r.rows };
  console.log(`${t.key.padEnd(7)} ${r.name} rows=${r.rows.length} ${r.rows[0][0]} -> ${r.rows.at(-1)[0]}`);
}

// A 股个股观察清单（functions/data/watchlist.ts），数组顺序即清单顺序
const stocks = [];
for (const w of WATCHLIST) {
  try {
    const r = await eastmoneyKline(w.secid);
    stocks.push({ code: w.code, label: w.name, name: r.name, secid: w.secid, sector: w.sector, rows: r.rows });
    console.log(`stock ${w.code.padEnd(7)} ${r.name} rows=${r.rows.length} ${r.rows[0][0]} -> ${r.rows.at(-1)[0]}`);
  } catch (err) {
    console.log(`stock ${w.code} FAILED: ${String(err && err.message ? err.message : err).slice(0, 120)}`);
  }
}

// 韩国综合指数 KOSPI（个股诊断的“区域联动”信号）
let kospi = null;
try {
  const r = await eastmoneyKline('100.KS11');
  kospi = { label: '韩国综合指数', name: r.name, secid: '100.KS11', rows: r.rows };
  console.log(`KOSPI   ${r.name} rows=${r.rows.length} ${r.rows[0][0]} -> ${r.rows.at(-1)[0]}`);
} catch (err) {
  console.log('KOSPI FAILED: ' + String(err && err.message ? err.message : err).slice(0, 120));
}

const vxnResults = [];
for (const s of vxnProbes) vxnResults.push(await probeImplied(s));
const vxnOk = vxnResults.find((r) => r.ok);
console.log(
  'VXN 上游:',
  vxnResults.map((r) => `${r.id}=${r.ok ? 'OK ' + r.rows.length : 'unreachable (' + r.note + ')'}`).join(' | '),
);

const vixResults = [];
for (const s of vixProbes) vixResults.push(await probeImplied(s));
const vixOk = vixResults.find((r) => r.ok);
console.log(
  'VIX 上游:',
  vixResults.map((r) => `${r.id}=${r.ok ? 'OK ' + r.rows.length : 'unreachable (' + r.note + ')'}`).join(' | '),
);

const dataset = {
  generatedAt: new Date().toISOString(),
  source: '东方财富行情接口（美股指数 + A 股主要指数 + 个股观察清单 + 韩国综合指数日线收盘价快照）',
  window: { from: symbols.NDX100.rows[0][0], to: symbols.NDX100.rows.at(-1)[0] },
  symbols,
  stocks,
  kospi,
  vxn: vxnOk
    ? { id: vxnOk.id, label: vxnOk.label, rows: vxnOk.rows }
    : null,
  vxnProbeNotes: vxnResults.map((r) => ({ id: r.id, ok: r.ok, note: r.note })),
  vix: vixOk
    ? { id: vixOk.id, label: vixOk.label, rows: vixOk.rows }
    : null,
  vixProbeNotes: vixResults.map((r) => ({ id: r.id, ok: r.ok, note: r.note })),
};

const outDir = resolve(root, 'functions', 'data');
mkdirSync(outDir, { recursive: true });
const body = JSON.stringify(dataset, null, 0);
writeFileSync(
  resolve(outDir, 'snapshot.ts'),
  '// 由 dev/fetch-data.mjs 生成的真实行情快照（本地抓取时间 ' + dataset.generatedAt + '）\n' +
    '// 运行时仍会尝试实时上游，失败时回落到本文件。\n' +
    'export const snapshot = ' +
    body +
    ' as unknown as SnapshotData;\n\n' +
    'export interface SnapshotData {\n' +
    '  generatedAt: string;\n' +
    '  source: string;\n' +
    '  window: { from: string; to: string };\n' +
    '  symbols: Record<string, { label: string; name: string; secid: string; rows: [string, number][] }>;\n' +
    '  stocks: { code: string; label: string; name: string; secid: string; sector: string; rows: [string, number][] }[];\n' +
    '  kospi: { label: string; name: string; secid: string; rows: [string, number][] } | null;\n' +
    '  vxn: { id: string; label: string; rows: [string, number][] } | null;\n' +
    '  vxnProbeNotes: { id: string; ok: boolean; note: string }[];\n' +
    '  vix: { id: string; label: string; rows: [string, number][] } | null;\n' +
    '  vixProbeNotes: { id: string; ok: boolean; note: string }[];\n' +
    '}\n',
  'utf8',
);
console.log('written functions/data/snapshot.ts bytes=' + Buffer.byteLength(body));
