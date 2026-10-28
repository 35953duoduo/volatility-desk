// 红利策略观察清单：以国企 / 中央国企为主的高分红标的，按用户要求覆盖银行、保险、公用事业、能源、通信与交通运输。
// 这里只维护代码与事实性标签；行情与分红明细由 dev/fetch-dividend-data.mjs 抓取后写入 dividendSnapshot.ts。
// 替换为自己的持仓后重跑 node dev/fetch-dividend-data.mjs 即生效。

export interface DividendWatchItem {
  code: string;
  name: string;
  sector: string;
  secid: string;
  /** 事实性说明，不构成推荐 */
  note: string;
}

export const DIVIDEND_WATCHLIST: DividendWatchItem[] = [
  { code: "601398", name: "工商银行", sector: "银行", secid: "1.601398", note: "国有大型商业银行，长期分红，A/H 两地上市" },
  { code: "601939", name: "建设银行", sector: "银行", secid: "1.601939", note: "国有大型商业银行，分红率长期稳定" },
  { code: "601288", name: "农业银行", sector: "银行", secid: "1.601288", note: "国有大型商业银行，县域金融覆盖广" },
  { code: "601988", name: "中国银行", sector: "银行", secid: "1.601988", note: "国有大型商业银行，国际化程度较高" },
  { code: "600036", name: "招商银行", sector: "银行", secid: "1.600036", note: "招商局集团控股的股份制银行，零售业务见长" },
  { code: "601628", name: "中国人寿", sector: "保险", secid: "1.601628", note: "寿险龙头，中央金融企业" },
  { code: "601601", name: "中国太保", sector: "保险", secid: "1.601601", note: "上海国资背景，寿险与财险综合经营" },
  { code: "601336", name: "新华保险", sector: "保险", secid: "1.601336", note: "中央汇金控股，以寿险为主" },
  { code: "600900", name: "长江电力", sector: "公用事业", secid: "1.600900", note: "三峡集团旗下水电龙头，现金流与分红稳定" },
  { code: "600674", name: "川投能源", sector: "公用事业", secid: "1.600674", note: "四川省属能源投资平台，参股雅砻江水电" },
  { code: "601985", name: "中国核电", sector: "公用事业", secid: "1.601985", note: "中核集团旗下核电运营平台" },
  { code: "601088", name: "中国神华", sector: "能源", secid: "1.601088", note: "国家能源集团旗下煤电一体化龙头" },
  { code: "600938", name: "中国海油", sector: "能源", secid: "1.600938", note: "中国最大的海上原油及天然气生产商" },
  { code: "600941", name: "中国移动", sector: "通信运营", secid: "1.600941", note: "全球用户规模领先的电信运营商，A/H 两地上市" },
  { code: "601006", name: "大秦铁路", sector: "交通运输", secid: "1.601006", note: "国铁集团旗下煤运干线，运价与现金流稳定" },
  { code: "600377", name: "宁沪高速", sector: "交通运输", secid: "1.600377", note: "江苏交控旗下高速公路运营龙头" },
];

export const DIVIDEND_WATCHLIST_NOTE =
  "清单聚焦国企 / 中央国企背景的高分红标的（银行、保险、公用事业、能源、通信、交运），只做长期收息与周线级别的卫星仓高抛低吸，不构成推荐。";
