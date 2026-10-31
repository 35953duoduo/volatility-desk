// 红利策略观察清单：16 只国企 / 中央国企高分红底仓样本 + 38 只国有资本运营公司三季度持仓变动跟踪标的。
// 底仓按用户要求覆盖银行、保险、公用事业、能源、通信与交通运输；跟踪标的按用户提供的截图分为中国诚通 / 国新投资 / 国新宏盛。
// 这里只维护代码、行业、事实性说明与分组标签；行情与分红明细由 dev/fetch-dividend-data.mjs 抓取后写入 dividendSnapshot.ts。
// 替换为自己的持仓后重跑 node dev/fetch-dividend-data.mjs 即生效。

export type DividendGroupKey = "core" | "chengtong" | "guoxin_invest" | "guoxin_hongsheng";
export type DividendChangeAction = "new" | "increase";

export interface DividendGroupTag {
  group: DividendGroupKey;
  /** 底仓样本没有新进 / 增持语义，固定为 null */
  action: DividendChangeAction | null;
}

export interface DividendGroupInfo {
  key: DividendGroupKey;
  label: string;
  short: string;
  description: string;
  source: string;
}

export interface DividendWatchItem {
  code: string;
  name: string;
  sector: string;
  secid: string;
  /** 事实性说明，不构成推荐 */
  note: string;
  groups: DividendGroupTag[];
}

const CORE: DividendGroupTag[] = [{ group: "core", action: null }];

export const DIVIDEND_GROUPS: DividendGroupInfo[] = [
  {
    key: "core",
    label: "红利底仓",
    short: "底仓",
    description:
      "银行、保险、公用事业、能源、通信与交通运输的国企 / 中央国企高分红样本，用于长期收息，并只用两到三成卫星仓做周线波段。",
    source: "人工维护的红利观察清单，不是全市场红利指数，也不构成推荐。",
  },
  {
    key: "chengtong",
    label: "中国诚通",
    short: "诚通",
    description: "用户截图「中国诚通」项下的三季度 A 股新进 / 增持标的。",
    source: "来源为用户提供的三季度持仓变动截图；截图未标注年份，仅采用证券简称与变动方向，持股数量与持股比例未纳入本页。",
  },
  {
    key: "guoxin_invest",
    label: "国新投资",
    short: "国新投资",
    description: "用户截图「国新投资」项下的三季度 A 股新进 / 增持标的。",
    source: "来源为用户提供的三季度持仓变动截图；截图未标注年份，仅采用证券简称与变动方向，持股数量与持股比例未纳入本页。",
  },
  {
    key: "guoxin_hongsheng",
    label: "国新宏盛",
    short: "国新宏盛",
    description: "用户截图「国新宏盛」项下的三季度 A 股新进 / 增持标的。",
    source: "来源为用户提供的三季度持仓变动截图；截图未标注年份，仅采用证券简称与变动方向，持股数量与持股比例未纳入本页。",
  },
];

export const DIVIDEND_WATCHLIST: DividendWatchItem[] = [
  { code: "601398", name: "工商银行", sector: "银行", secid: "1.601398", note: "国有大型商业银行，长期分红，A/H 两地上市", groups: CORE },
  { code: "601939", name: "建设银行", sector: "银行", secid: "1.601939", note: "国有大型商业银行，分红率长期稳定", groups: CORE },
  { code: "601288", name: "农业银行", sector: "银行", secid: "1.601288", note: "国有大型商业银行，县域金融覆盖广", groups: CORE },
  { code: "601988", name: "中国银行", sector: "银行", secid: "1.601988", note: "国有大型商业银行，国际化程度较高", groups: CORE },
  { code: "600036", name: "招商银行", sector: "银行", secid: "1.600036", note: "招商局集团控股的股份制银行，零售业务见长", groups: CORE },
  { code: "601628", name: "中国人寿", sector: "保险", secid: "1.601628", note: "寿险龙头，中央金融企业", groups: CORE },
  { code: "601601", name: "中国太保", sector: "保险", secid: "1.601601", note: "上海国资背景，寿险与财险综合经营", groups: CORE },
  { code: "601336", name: "新华保险", sector: "保险", secid: "1.601336", note: "中央汇金控股，以寿险为主", groups: CORE },
  { code: "600900", name: "长江电力", sector: "公用事业", secid: "1.600900", note: "三峡集团旗下水电龙头，现金流与分红稳定", groups: CORE },
  { code: "600674", name: "川投能源", sector: "公用事业", secid: "1.600674", note: "四川省属能源投资平台，参股雅砻江水电", groups: CORE },
  { code: "601985", name: "中国核电", sector: "公用事业", secid: "1.601985", note: "中核集团旗下核电运营平台", groups: CORE },
  {
    code: "601088",
    name: "中国神华",
    sector: "能源",
    secid: "1.601088",
    note: "国家能源集团旗下煤电一体化龙头",
    groups: [
      { group: "core", action: null },
      { group: "guoxin_invest", action: "increase" },
      { group: "guoxin_hongsheng", action: "increase" },
    ],
  },
  { code: "600938", name: "中国海油", sector: "能源", secid: "1.600938", note: "中国最大的海上原油及天然气生产商", groups: CORE },
  { code: "600941", name: "中国移动", sector: "通信运营", secid: "1.600941", note: "全球用户规模领先的电信运营商，A/H 两地上市", groups: CORE },
  { code: "601006", name: "大秦铁路", sector: "交通运输", secid: "1.601006", note: "国铁集团旗下煤运干线，运价与现金流稳定", groups: CORE },
  { code: "600377", name: "宁沪高速", sector: "交通运输", secid: "1.600377", note: "江苏交控旗下高速公路运营龙头", groups: CORE },

  // ---- 中国诚通（13 条） ----
  { code: "688190", name: "云路股份", sector: "新材料", secid: "1.688190", note: "非晶合金带材与磁粉制造商，中国钢研体系", groups: [{ group: "chengtong", action: "increase" }] },
  { code: "600970", name: "中材国际", sector: "建材工程", secid: "1.600970", note: "中国建材集团旗下水泥工程系统集成商", groups: [{ group: "chengtong", action: "increase" }] },
  { code: "688375", name: "国博电子", sector: "军工电子", secid: "1.688375", note: "中国电科体系的有源相控阵 T/R 组件与射频芯片供应商", groups: [{ group: "chengtong", action: "new" }] },
  { code: "301269", name: "华大九天", sector: "EDA 软件", secid: "0.301269", note: "国产 EDA 工具链企业，中国电子（CEC）体系", groups: [{ group: "chengtong", action: "new" }] },
  { code: "600562", name: "国睿科技", sector: "军工电子", secid: "1.600562", note: "中国电科十四所旗下雷达与轨道交通信号平台", groups: [{ group: "chengtong", action: "new" }] },
  { code: "600482", name: "中国动力", sector: "船舶动力", secid: "1.600482", note: "中国船舶集团旗下舰船动力装备平台", groups: [{ group: "chengtong", action: "new" }] },
  { code: "600863", name: "华能蒙电", sector: "电力", secid: "1.600863", note: "华能集团旗下内蒙古火电与新能源运营商（原内蒙华电）", groups: [{ group: "chengtong", action: "new" }] },
  { code: "688187", name: "时代电气", sector: "轨交装备", secid: "1.688187", note: "中车株洲所旗下轨交牵引与 IGBT 平台", groups: [{ group: "chengtong", action: "increase" }] },
  {
    code: "003031",
    name: "中瓷电子",
    sector: "电子陶瓷",
    secid: "0.003031",
    note: "中国电科十三所旗下电子陶瓷外壳与氮化镓射频芯片",
    groups: [
      { group: "chengtong", action: "new" },
      { group: "guoxin_invest", action: "increase" },
    ],
  },
  { code: "002179", name: "中航光电", sector: "军工电子", secid: "0.002179", note: "航空工业旗下军用连接器龙头", groups: [{ group: "chengtong", action: "new" }] },
  { code: "600489", name: "中金黄金", sector: "黄金", secid: "1.600489", note: "中国黄金集团旗下黄金采选冶炼平台", groups: [{ group: "chengtong", action: "new" }] },
  { code: "000807", name: "云铝股份", sector: "铝", secid: "0.000807", note: "中铝集团旗下水电铝一体化企业", groups: [{ group: "chengtong", action: "new" }] },
  {
    code: "600406",
    name: "国电南瑞",
    sector: "电网自动化",
    secid: "1.600406",
    note: "国家电网旗下电网自动化与继电保护龙头",
    groups: [
      { group: "chengtong", action: "increase" },
      { group: "guoxin_hongsheng", action: "increase" },
    ],
  },

  // ---- 国新投资（10 条，中瓷电子 / 中国神华已在上方） ----
  { code: "002046", name: "国机精工", sector: "机械基础件", secid: "0.002046", note: "国机集团旗下轴承、磨料磨具与超硬材料平台", groups: [{ group: "guoxin_invest", action: "increase" }] },
  { code: "002281", name: "光迅科技", sector: "光通信", secid: "0.002281", note: "中国信科旗下光电子器件与光模块厂商", groups: [{ group: "guoxin_invest", action: "increase" }] },
  { code: "600206", name: "有研新材", sector: "稀有金属", secid: "1.600206", note: "中国有研旗下高纯金属与稀土功能材料平台", groups: [{ group: "guoxin_invest", action: "increase" }] },
  { code: "000962", name: "东方钽业", sector: "稀有金属", secid: "0.000962", note: "中国有色集团旗下钽铌冶炼加工企业", groups: [{ group: "guoxin_invest", action: "increase" }] },
  { code: "600483", name: "福能股份", sector: "电力", secid: "1.600483", note: "福建省能源集团旗下火电、风电与气电运营商", groups: [{ group: "guoxin_invest", action: "new" }] },
  { code: "688041", name: "海光信息", sector: "半导体", secid: "1.688041", note: "国产 CPU / DCU 设计企业，中科院体系背景", groups: [{ group: "guoxin_invest", action: "increase" }] },
  { code: "600058", name: "五矿发展", sector: "金属贸易", secid: "1.600058", note: "中国五矿旗下金属矿产贸易与物流平台", groups: [{ group: "guoxin_invest", action: "new" }] },
  { code: "600498", name: "烽火通信", sector: "光通信", secid: "1.600498", note: "中国信科旗下光通信设备与光纤光缆厂商", groups: [{ group: "guoxin_invest", action: "new" }] },

  // ---- 国新宏盛（19 条，国电南瑞 / 中国神华已在上方） ----
  { code: "600760", name: "中航沈飞", sector: "航空装备", secid: "1.600760", note: "航空工业旗下歼击机整机制造平台", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "600025", name: "华能水电", sector: "水电", secid: "1.600025", note: "华能集团旗下澜沧江水电运营平台", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "600150", name: "中国船舶", sector: "船舶制造", secid: "1.600150", note: "中国船舶集团旗下大型造船上市平台", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
  { code: "601728", name: "中国电信", sector: "通信运营", secid: "1.601728", note: "三大基础电信运营商之一，A/H 两地上市", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "601766", name: "中国中车", sector: "轨交装备", secid: "1.601766", note: "全球规模领先的轨道交通装备制造商", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "601919", name: "中远海控", sector: "航运", secid: "1.601919", note: "中远海运集团旗下集装箱航运与码头运营平台", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "601698", name: "中国卫通", sector: "卫星通信", secid: "1.601698", note: "航天科技集团旗下固定通信卫星运营商", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "600028", name: "中国石化", sector: "石油石化", secid: "1.600028", note: "国有大型一体化能源化工公司，A/H 两地上市", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "601857", name: "中国石油", sector: "石油石化", secid: "1.601857", note: "国有大型油气生产与销售公司，A/H 两地上市", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "601600", name: "中国铝业", sector: "铝", secid: "1.601600", note: "中铝集团旗下铝土矿、氧化铝与电解铝一体化企业", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "600176", name: "中国巨石", sector: "玻璃纤维", secid: "1.600176", note: "中国建材集团旗下玻璃纤维龙头", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
  { code: "600050", name: "中国联通", sector: "通信运营", secid: "1.600050", note: "三大基础电信运营商之一，A 股上市", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
  { code: "601872", name: "招商轮船", sector: "航运", secid: "1.601872", note: "招商局集团旗下油轮、散货与集装箱船队", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
  { code: "688396", name: "华润微", sector: "半导体", secid: "1.688396", note: "华润集团旗下功率半导体 IDM 厂商", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
  { code: "600584", name: "长电科技", sector: "半导体", secid: "1.600584", note: "中国华润入主的集成电路封装测试龙头", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
  { code: "601898", name: "中煤能源", sector: "煤炭", secid: "1.601898", note: "中煤集团旗下煤炭与煤化工一体化企业，A/H 两地上市", groups: [{ group: "guoxin_hongsheng", action: "increase" }] },
  { code: "688146", name: "中船特气", sector: "电子特气", secid: "1.688146", note: "中国船舶集团旗下电子特种气体供应商", groups: [{ group: "guoxin_hongsheng", action: "new" }] },
];

export const DIVIDEND_WATCHLIST_NOTE =
  "清单由 16 只国企 / 中央国企红利底仓与 38 只国有资本运营公司新增跟踪标的组成；连同底仓中的中国神华，截图去重后共 39 只跟踪标的。名单来自用户提供的截图（未标注年份），按中国诚通 / 国新投资 / 国新宏盛分组，不是高股息筛选结果，只按同一套周线规则观察，不构成推荐。";
