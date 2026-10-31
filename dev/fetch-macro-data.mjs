// 本地数据抓取脚本（不属于发布产物，仅 dev/ 目录使用）
// 抓取黄金 / 原油 / 美债三只 ETF 的十年日线（Nasdaq）与 10 年期美债收益率（FRED DGS10），
// 生成函数侧快照 functions/data/macroSnapshot.ts。
// 运行： node dev/fetch-macro-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSETS = [
  {
    key: 'gold',
    symbol: 'GLD',
    label: '黄金',
    name: 'SPDR Gold Shares',
    unit: '美元',
    note: '以 GLD 收盘价作为黄金现货的可交易代理；ETF 存在管理费与跟踪误差，不是伦敦金定盘价。',
  },
  {
    key: 'oil',
    symbol: 'USO',
    label: '原油',
    name: 'United States Oil Fund',
    unit: '美元',
    note: '以 USO 收盘价作为 WTI 原油期货的可交易代理；期货换月、展期成本与基金规则会造成偏离。',
  },
  {
    key: 'bond',
    symbol: 'TLT',
    label: '美债',
    name: 'iShares 20+ Year Treasury Bond ETF',
    unit: '美元',
    note: '以 TLT 收盘价代表 20 年以上久期美债价格；价格与收益率反向，久期越长对利率越敏感。',
  },
];

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function parseUsDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

function numeric(value) {
  const n = Number(String(value ?? '').replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Nasdaq 官方公开历史行情（ETF 模式），最多返回最近约十年、按日期倒序；超出十年边界的 fromdate 会被拒绝 */
async function fetchNasdaqEtf(symbol) {
  const url =
    'https://api.nasdaq.com/api/quote/' +
    encodeURIComponent(symbol) +
    '/historical?assetclass=etf&fromdate=' +
    isoDaysAgo(3600) +
    '&limit=9999';
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nasdaq.com/' },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const rowsRaw = json?.data?.tradesTable?.rows;
      if (!Array.isArray(rowsRaw) || rowsRaw.length < 1000) throw new Error('历史行数不足：' + (rowsRaw?.length ?? 0));
      const byDate = new Map();
      for (const r of rowsRaw) {
        const date = parseUsDate(r?.date);
        const close = numeric(r?.close);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && close !== null && close > 0) byDate.set(date, close);
      }
      const rows = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (rows.length < 1000) throw new Error('有效收盘价不足：' + rows.length);
      return { rows, reported: json?.data?.totalRecords ?? rowsRaw.length };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(1500);
    }
  }
  throw new Error(String(lastErr?.message ?? lastErr).slice(0, 160));
}

/** FRED DGS10：10 年期美国国债恒定到期收益率（%，日频，含 '.' 缺失值） */
async function fetchFred10y() {
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=' + isoDaysAgo(3653);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const lines = text.trim().split(/\r?\n/);
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const [date, raw] = lines[i].split(',');
        const value = Number(raw);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) rows.push([date, value]);
      }
      if (rows.length < 1000) throw new Error('有效收益率不足：' + rows.length);
      return rows;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(1500);
    }
  }
  throw new Error(String(lastErr?.message ?? lastErr).slice(0, 160));
}

const assets = {};
for (const item of ASSETS) {
  const { rows, reported } = await fetchNasdaqEtf(item.symbol);
  assets[item.key] = { ...item, rows };
  console.log(
    `${item.symbol} ${item.label} 日线=${rows.length}/${reported} 区间=${rows[0][0]} -> ${rows.at(-1)[0]} 最新=${rows.at(-1)[1]}`,
  );
}

const ust10y = await fetchFred10y();
console.log(`DGS10 10 年期美债收益率=${ust10y.length} 区间=${ust10y[0][0]} -> ${ust10y.at(-1)[0]} 最新=${ust10y.at(-1)[1]}%`);

if (Object.keys(assets).length !== ASSETS.length || ust10y.length < 1000) {
  console.error('跨资产数据不完整，未写入快照。');
  process.exitCode = 1;
} else {
  const dataset = {
    generatedAt: new Date().toISOString(),
    source:
      '黄金 / 原油 / 美债 ETF 日线（Nasdaq 官方历史行情 GLD / USO / TLT）+ 10 年期美债收益率（FRED DGS10）',
    window: {
      from: [assets.gold.rows[0][0], assets.oil.rows[0][0], assets.bond.rows[0][0], ust10y[0][0]].sort()[0],
      to: [assets.gold.rows.at(-1)[0], assets.oil.rows.at(-1)[0], assets.bond.rows.at(-1)[0], ust10y.at(-1)[0]].sort().at(-1),
    },
    assets,
    ust10y: {
      key: 'ust10y',
      label: '10 年期美债收益率',
      unit: '%',
      note: 'FRED DGS10，恒定到期收益率；收益率上行代表美债价格下跌。',
      rows: ust10y,
    },
    sources: [
      {
        id: 'nasdaq_etf',
        label: 'Nasdaq GLD / USO / TLT 历史日线',
        url: 'https://api.nasdaq.com/api/quote/{symbol}/historical?assetclass=etf',
        fetchedAt: new Date().toISOString(),
        rows: Object.fromEntries(Object.entries(assets).map(([k, a]) => [k, a.rows.length])),
      },
      {
        id: 'fred_dgs10',
        label: 'FRED DGS10 10 年期美债收益率',
        url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10',
        fetchedAt: new Date().toISOString(),
        rows: ust10y.length,
      },
    ],
  };
  const outDir = resolve(root, 'functions', 'data');
  mkdirSync(outDir, { recursive: true });
  const body = JSON.stringify(dataset, null, 0);
  const header =
    '// 由 dev/fetch-macro-data.mjs 生成的真实跨资产日线快照（本地抓取时间 ' +
    dataset.generatedAt +
    '）\n' +
    '// 黄金 / 原油 / 美债分别使用 GLD / USO / TLT 收盘价；10 年期美债收益率来自 FRED DGS10。\n' +
    '// 快照只用于展示与计算，运行时仍会尝试从同一公开上游增量刷新。\n';
  writeFileSync(resolve(outDir, 'macroSnapshot.ts'), header + 'export const macroSnapshot = ' + body + ' as const;\n');
  console.log(`已写入 functions/data/macroSnapshot.ts（${(body.length / 1024).toFixed(1)} KB）`);
}
