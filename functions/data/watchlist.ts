// A 股个股观察清单：个股诊断的唯一数据来源。
// 修改后运行 `node dev/fetch-data.mjs` 重新生成快照即可生效（前端无需改动）。
// 当前为脚手架清单（5 只流动性良好的权重股），等待替换为用户实际持仓；secid 规则：沪市 1.xxxxxx、深市 0.xxxxxx。

export interface WatchItem {
  /** 6 位股票代码，如 600519 */
  code: string;
  /** 股票名称，如 贵州茅台 */
  name: string;
  /** 东方财富 secid：沪市 1.代码、深市 0.代码 */
  secid: string;
  /** 行业/板块标签，用于界面展示 */
  sector: string;
}

export const WATCHLIST: WatchItem[] = [
  { code: "600519", name: "贵州茅台", secid: "1.600519", sector: "白酒" },
  { code: "300750", name: "宁德时代", secid: "0.300750", sector: "新能源" },
  { code: "600036", name: "招商银行", secid: "1.600036", sector: "银行" },
  { code: "002594", name: "比亚迪", secid: "0.002594", sector: "汽车" },
  { code: "601318", name: "中国平安", secid: "1.601318", sector: "保险" },
];

export const WATCHLIST_NOTE =
  "清单集中在 functions/data/watchlist.ts，替换为个人持仓后运行 node dev/fetch-data.mjs 重新生成快照。";
