// 本地数据抓取脚本（不属于发布产物，仅 dev/ 目录使用）
// 抓取美联储 Z.1 非金融企业股权市值（FRED NCBEILQ027S，季度）与美国名义 GDP（FRED GDP，季度），
// 生成函数侧快照 functions/data/valuationSnapshot.ts，用于「巴菲特指数（市值/GDP）」板块。
// 注意：FRED 的 Wilshire 5000 全市场系列已下架（请求返回 404），因此本板块使用 Z.1 口径，不能与 Wilshire 口径拼接。
// 运行： node dev/fetch-valuation-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** FRED fredgraph.csv：无需密钥的公开季度序列，'.' 为缺失值 */
async function fetchFred(id) {
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const lines = text.trim().split(/\r?\n/);
      if (!/^observation_date,/.test(lines[0])) throw new Error('返回结构异常：' + lines[0].slice(0, 60));
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const [date, raw] = lines[i].split(',');
        const value = Number(raw);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) rows.push([date, value]);
      }
      if (rows.length < 40) throw new Error('有效季度不足：' + rows.length);
      return rows;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(1500);
    }
  }
  throw new Error(String(lastErr?.message ?? lastErr).slice(0, 160));
}

const cap = await fetchFred('NCBEILQ027S');
console.log(`NCBEILQ027S 非金融企业股权市值=${cap.length} 季度 ${cap[0][0]} -> ${cap.at(-1)[0]} 最新=${cap.at(-1)[1]} 百万美元`);
const gdp = await fetchFred('GDP');
console.log(`GDP 名义国内生产总值=${gdp.length} 季度 ${gdp[0][0]} -> ${gdp.at(-1)[0]} 最新=${gdp.at(-1)[1]} 十亿美元`);

const gdpMap = new Map(gdp);
const joined = cap.filter(([d]) => gdpMap.has(d));
if (joined.length < 40) {
  console.error('市值与 GDP 的共同季度不足，未写入快照。');
  process.exitCode = 1;
} else {
  const [d, v] = joined.at(-1);
  console.log(`可比季度=${joined.length}，最新共同季度 ${d}：市值/GDP=${((v / 1000 / gdpMap.get(d)) * 100).toFixed(1)}%`);
  const dataset = {
    generatedAt: new Date().toISOString(),
    source: '美联储 Z.1 非金融企业股权市值（FRED NCBEILQ027S，季度，百万美元）÷ 美国名义 GDP（FRED GDP，季度，十亿美元，年化）',
    window: { from: joined[0][0], to: joined.at(-1)[0] },
    cap: {
      id: 'NCBEILQ027S',
      label: '非金融企业股权市值',
      unit: '百万美元',
      note: '美联储 Z.1 金融账户：Nonfinancial Corporate Business; Corporate Equities; Liability, Level。季末水平值，含非上市股权，口径宽于 Wilshire 5000 全市场指数。',
      rows: cap,
    },
    gdp: {
      id: 'GDP',
      label: '美国名义 GDP',
      unit: '十亿美元（年化）',
      note: 'FRED GDP：名义国内生产总值，季度值已年化，发布滞后且会被修订。',
      rows: gdp,
    },
    sources: [
      {
        id: 'fred_market_cap',
        label: 'FRED NCBEILQ027S 非金融企业股权市值',
        url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=NCBEILQ027S',
        fetchedAt: new Date().toISOString(),
        rows: cap.length,
      },
      {
        id: 'fred_gdp',
        label: 'FRED GDP 美国名义 GDP',
        url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP',
        fetchedAt: new Date().toISOString(),
        rows: gdp.length,
      },
    ],
  };
  const outDir = resolve(root, 'functions', 'data');
  mkdirSync(outDir, { recursive: true });
  const body = JSON.stringify(dataset, null, 0);
  const header =
    '// 由 dev/fetch-valuation-data.mjs 生成的真实估值快照（本地抓取时间 ' +
    dataset.generatedAt +
    '）\n' +
    '// 巴菲特指数采用 Z.1 口径：非金融企业股权市值 ÷ 名义 GDP；不是 Wilshire 5000/GDP，两者水平不可直接比较。\n' +
    '// 快照只用于展示与计算，运行时仍会尝试从同一公开上游增量刷新。\n';
  writeFileSync(resolve(outDir, 'valuationSnapshot.ts'), header + 'export const valuationSnapshot = ' + body + ' as const;\n');
  console.log(`已写入 functions/data/valuationSnapshot.ts（${(body.length / 1024).toFixed(1)} KB）`);
}
