// 摩根士丹利（大摩）中国 / A 股策略报告事件表
// 人工整理：每条事件都给出可核对的公开来源与可靠性标注，非穷举清单。
// 日期口径：报告发布日（多为美东时间，A 股影响体现在其后最近一个交易日，事件研究会显式记录对齐偏移）。
// 这些记录用于「报告发布后 A 股主要指数如何走」的复盘统计，不代表大摩完整观点，也不构成投资建议。

export interface ReportTarget {
  /** 被调整的指数 */
  index: string;
  /** 调整前目标位（首次给出时可为空） */
  from: number | null;
  /** 调整后目标位 */
  to: number;
  /** 目标对应时点 */
  horizon: string;
}

export interface ReportEvent {
  id: string;
  /** 报告发布日 YYYY-MM-DD */
  date: string;
  /** 报告 / 研报标题或媒体概括 */
  title: string;
  /** 动作类型 */
  action: "评级上调" | "评级下调" | "目标上调" | "目标下调" | "展望报告";
  /** 方向：用于分组统计 */
  stance: "看多" | "看空";
  /** 一句话结论 */
  summary: string;
  /** 报告核心团队 */
  team: string;
  /** 目标位变化 */
  targets: ReportTarget[];
  /** 来源 */
  sources: { label: string; url: string }[];
  /** 来源可靠性 */
  confidence: "多源交叉" | "二手整理";
  /** 日期与口径备注 */
  dateNote: string;
}

export const REPORT_BROKER = "摩根士丹利";

export const reportEvents: ReportEvent[] = [
  {
    id: "ms-2022-12-06",
    date: "2022-12-06",
    title: "时隔近两年重新看多：中国股票升至「增持」",
    action: "评级上调",
    stance: "看多",
    summary: "结束自 2021 年 1 月以来的持股观望，上调至增持，称「一个新的牛市周期正在开始」，建议增配消费与离岸中国股票。",
    team: "Laura Wang（王滢）团队",
    targets: [
      { index: "MSCI 中国", from: 59, to: 70, horizon: "2023 年末" },
      { index: "恒生指数", from: 18200, to: 21200, horizon: "2023 年末" },
    ],
    sources: [
      { label: "智通财经 / 新浪财经：时隔两年再次看涨，大摩上调中国股市评级至「增持」", url: "https://news.sina.cn/j_uc.d.html?docid=mqmmthc7087690" },
      { label: "雪球：大摩近两年来首次上调中国股市评级", url: "https://xueqiu.com/1107854878/237072095" },
      { label: "网易财经：大摩时间线（明确记为 2022 年 12 月 6 日）", url: "https://m.163.com/dy/article/IMIKFPN5055653YJ.html" },
    ],
    confidence: "多源交叉",
    dateNote: "报告在 12 月上旬的周末发布，媒体披露日为 12-06；王滢于 12-09 媒体会重申该判断。",
  },
  {
    id: "ms-2023-08-02",
    date: "2023-08-02",
    title: "上调之后转谨慎：中国股市降回「持股观望」",
    action: "评级下调",
    stance: "看空",
    summary: "认为宽松举措零碎、渐进，建议投资者在这轮上涨中获利了结；新兴市场配置框架中中国排名由第 3 位降至第 13 位。",
    team: "Laura Wang 团队",
    targets: [],
    sources: [
      { label: "新华网：「大摩」唱空中国股市（明确记为 8 月 2 日发布报告）", url: "https://www.xinhuanet.com/2023-08/04/c_1212252307.htm" },
      { label: "财联社：下调中国股票评级，摩根士丹利遭国内公募与券商群怼", url: "https://m.cls.cn/detail/1422875" },
    ],
    confidence: "多源交叉",
    dateNote: "报告 8 月 2 日（周三）发布，8 月 3 日起见报并引发国内机构公开反驳。",
  },
  {
    id: "ms-2023-08-25",
    date: "2023-08-25",
    title: "一周后再下调主要股指目标位",
    action: "目标下调",
    stance: "看空",
    summary: "因增长预测下修，同步下调中国与香港主要股指目标，对 A 股的预期下调约 14%。",
    team: "Laura Wang 团队",
    targets: [
      { index: "沪深300", from: null, to: 4000, horizon: "2024 年 6 月（基本情境）" },
      { index: "恒生指数", from: null, to: 18500, horizon: "2024 年 6 月（基本情境）" },
      { index: "恒生中国企业", from: null, to: 6450, horizon: "2024 年 6 月（基本情境）" },
      { index: "MSCI 中国", from: 70, to: 60, horizon: "2024 年 6 月（基本情境）" },
    ],
    sources: [
      { label: "雪球：大摩历次动作整理（记为 8 月 24 日）", url: "https://xueqiu.com/1660405142/281547977" },
      { label: "网易财经：大摩时间线（记为 8 月 25 日）", url: "https://m.163.com/dy/article/IMGH7OKP0556092A.html" },
    ],
    confidence: "二手整理",
    dateNote: "两家来源分别记为 8-24 与 8-25，本表取 8-25；事件研究按其后最近交易日对齐，1 日差异不改变结论。",
  },
  {
    id: "ms-2024-01-25",
    date: "2024-01-25",
    title: "下调中国股指年底目标，同时上调日本东证指数",
    action: "目标下调",
    stance: "看空",
    summary: "以盈利增长放缓与估值假设为由，将 MSCI 中国年底目标由 60 点降至 53 点，意味着当年基准几乎无上涨空间。",
    team: "Laura Wang 团队",
    targets: [{ index: "MSCI 中国", from: 60, to: 53, horizon: "2024 年末" }],
    sources: [{ label: "雪球：大摩历次动作整理", url: "https://xueqiu.com/1660405142/281547977" }],
    confidence: "二手整理",
    dateNote: "来源为公开整理帖，日期按其记载采用。",
  },
  {
    id: "ms-2025-02-19",
    date: "2025-02-19",
    title: "结构性判断转向：中国股票由「低配」上调至「平配」",
    action: "评级上调",
    stance: "看多",
    summary: "称中国股市（尤其离岸市场）发生结构性质变，判断 DeepSeek 式技术突破让涨势更具可持续性；恒指目标由 19400 上调至 24000。",
    team: "Laura Wang 团队",
    targets: [
      { index: "MSCI 中国", from: 63, to: 77, horizon: "2025 年末" },
      { index: "恒生指数", from: 19400, to: 24000, horizon: "2025 年末" },
      { index: "恒生中国企业", from: 6970, to: 8600, horizon: "2025 年末" },
    ],
    sources: [
      { label: "新浪财经：摩根士丹利加入唱多中国股市之列（2025-02-20，报告为周三发布）", url: "https://finance.sina.cn/usstock/mggd/2025-02-20/detail-inemawir9354864.d.html" },
      { label: "新京报：今年 2 月大摩将中国股票评级从「低配」上调至「平配」", url: "https://m.bjnews.com.cn/detail/1741698170129609.html" },
      { label: "东方财富股吧：摩根士丹利大转向", url: "https://mguba.eastmoney.com/mguba/article/0/1519189120" },
    ],
    confidence: "多源交叉",
    dateNote: "多家报道称报告于周三发布，对应 2025-02-19；北京时间 02-20 见报。",
  },
  {
    id: "ms-2025-03-25",
    date: "2025-03-25",
    title: "一个多月内第二次上修：建议在中国组合中高配 A 股",
    action: "目标上调",
    stance: "看多",
    summary: "以四季度盈利净增长 8%（三年半来首次）与估值重估为由，全面上调港股与沪深300 目标，并明确建议高配 A 股。",
    team: "Laura Wang、Jonathan Garner 等",
    targets: [
      { index: "沪深300", from: 4200, to: 4220, horizon: "2025 年末" },
      { index: "恒生指数", from: 24000, to: 25800, horizon: "2025 年末" },
      { index: "恒生中国企业", from: 8600, to: 9500, horizon: "2025 年末" },
      { index: "MSCI 中国", from: 77, to: 83, horizon: "2025 年末" },
    ],
    sources: [
      { label: "格隆汇：摩根士丹利时隔一个多月再次上调中国股票目标", url: "https://m.gelonghui.com/live/1862891" },
      { label: "新浪财经：摩根士丹利和摩根大通上调中国股票目标位（称「周二的报告」）", url: "https://finance.sina.com.cn/stock/relnews/us/2025-03-27/doc-inerachv8288582.shtml" },
      { label: "东方财富：上调恒生指数年底目标至 25800 点", url: "https://fund.eastmoney.com/a/202503263356567846.html" },
    ],
    confidence: "多源交叉",
    dateNote: "报告为美东周二发布，即 2025-03-25；北京时间 03-26 早间见报。",
  },
  {
    id: "ms-2026-05-13",
    date: "2026-05-13",
    title: "《锻造新前沿》2026 下半年中国股票市场展望",
    action: "展望报告",
    stance: "看多",
    summary: "以盈利改善、上游供应链主导地位与人民币走成为支撑，全面上调至 2027 年二季度目标；同时认为指数弹性与个股机会错位，建议主题性选股。",
    team: "Laura Wang 团队",
    targets: [
      { index: "沪深300", from: 4840, to: 5400, horizon: "2027 年二季度" },
      { index: "MSCI 中国", from: null, to: 91, horizon: "2027 年二季度" },
      { index: "恒生指数", from: null, to: 28400, horizon: "2027 年二季度" },
      { index: "恒生中国企业", from: null, to: 9900, horizon: "2027 年二季度" },
    ],
    sources: [
      { label: "上海证券报（中国证券网）：盈利复苏提振吸引力 外资机构看多中国资产（5 月 13 日发布）", url: "https://paper.cnstock.com/html/2026-05/15/content_2216927.htm" },
      { label: "中国经济网：同题报道", url: "http://wap.ce.cn/xwzx/gnsz/gdxw/202605/t20260515_2967383.shtml" },
      { label: "今日头条：沪深300 目标调至 5400 点，大摩力推上游资源与半导体（报告标题与日期）", url: "https://www.toutiao.com/a7644381182981702144/" },
    ],
    confidence: "多源交叉",
    dateNote: "沪深300 的 4,840 点是该行 2025 年 12 月设定的 2026 年 12 月目标（由 2026-05 报告回溯提及，具体日期未单独核实）。",
  },
];

export const EVENTS_PROVENANCE = {
  broker: REPORT_BROKER,
  curatedBy: "站点维护者人工整理公开报道",
  exhaustive: false,
  caveat:
    "仅收录有明确日期与可核对公开来源的大摩中国 / A 股策略报告，非穷举；未纳入个股评级、行业专题与媒体转述不清的条目。",
};
