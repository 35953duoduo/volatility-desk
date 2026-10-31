# 波动率观测台（Nasdaq + A-Share Volatility Desk）

仓库：[github.com/35953duoduo/volatility-desk](https://github.com/35953duoduo/volatility-desk)

基于 React / TypeScript / Vite / Tailwind 的波动率与个股诊断看板，配套严格只读的分析 Function：VIX 恐慌指数、纳斯达克与 A 股指数波动率历史、A 股个股五档买卖建议（含 KOSPI 区域联动与 IC 动态权重）、国企红利股周线高抛低吸（长期收息 + 卫星仓波段）、黄金 / 原油 / 美债跨资产风险对比、本机资产配置台账、大摩报告复盘，以及浏览器直连 DeepSeek 的 AI 背景补充、买卖诊断、跨资产风险分析与组合诊断（自带密钥，站点不代持任何密钥）。

站点由三部分组成：`src/` 的九标签可视化面板（波动率总览 / 历史规律 / 买卖诊断 / 个股诊断 / 红利策略 / 跨资产 / 资产配置 / 大摩报告复盘 / API 接口）、`functions/` 的只读分析接口，以及 `functions/data/snapshot.ts`、`functions/data/dividendSnapshot.ts`、`functions/data/macroSnapshot.ts` 的真实行情与分红快照。前端骨架与组件目录源自 Qoder Sites React 起始模板，模板归属、第三方样式许可见 [PROVENANCE.md](PROVENANCE.md) 与 `vendor/`。

页面刷新节奏：头部显示「最近刷新」时间（最近一次页面数据请求完成的时间）与「自动 5 分钟」状态；开启「实时上游」时每 5 分钟自动重取，标签页重新可见且距上次请求超过 5 分钟时立即补刷，也可点「重新计算」手动刷新。上游各接口自身仍有 5–10 分钟缓存，因此这个时间不等于逐笔行情时间。

数据口径：指数、ETF 与 A 股个股日线收盘价来自东方财富公开接口（手动添加的个股在东方财富失败时回退腾讯分页日线），快照由 `node dev/fetch-data.mjs` 重新生成（NDX100 自 2019-04、IXIC 与 SPX 自 2015-01、QQQ 自 2001-01、上证指数与沪深300 自 2015-01，另含 `functions/data/watchlist.ts` 中 5 只 A 股个股与韩国综合指数 KOSPI）。红利股的周线与分红来自另一份快照 `functions/data/dividendSnapshot.ts`，由 `node dev/fetch-dividend-data.mjs` 生成；手动添加的红利个股在运行时按需抓取，不写入该快照。跨资产板块的 GLD / USO / TLT 日线与 10 年期美债收益率来自 `functions/data/macroSnapshot.ts`（`node dev/fetch-macro-data.mjs` 生成）。VXN / VIX 隐含波动率在运行时尝试 CBOE 官方日线（FRED 收盘序列兜底，Yahoo 最后），不可达时接口与页面都会显式标注 `ok:false`，诊断改用真实收盘价计算的 21 / 63 日年化已实现波动率。核心计算集中在 `functions/analytics.ts`（波动率序列、分位、Z 分数、10 条规则信号、历史分位表现、波动率×趋势矩阵、事件研究、个股 8 条规则与 IC 动态权重）、`functions/dividend.ts`（年度股息率、股息率分位、3 年价格分位、周线 RSI、60 周均线偏离、连续分红与固定权重五档）与 `functions/macro.ts`（归一化表现、区间收益、已实现波动、最大回撤、4×4 相关矩阵、10Y 收益率 bp 变动与分位、启发式风险评分与情景），路由与 AI 上下文打包在 `functions/handler.ts`。完整来源、更新节奏与实时性边界见下文「数据来源与更新节奏」。

VIX 恐慌指数：`/api/volatility/panic` 返回标普500 30 天隐含波动率水平、5 年 / 全样本分位、Z 分数与波动状态；每个标的的「波动率总览」顶部固定展示该面板，数据独立于所选指数。数据来自 CBOE 官方日线 CSV（`cdn-api.cboe.com` 优先，`cdn.cboe.com` 备用），失败时回退 FRED `VIXCLS` 镜像与 Yahoo；`quote` 字段是 CBOE 官方延迟报价（约 15 分钟延迟），只在面板上作为盘中参考，不参与分位与 Z 分数。不抓取 investing.com 等转载型财经站点（反爬且非原始数据）。上游全部不可达时接口显式 `available:false` 并给出各探测源的原因，页面用琥珀色降级框说明并回落到已实现波动率，绝不伪造读数。

个股诊断：`functions/data/watchlist.ts` 维护观察清单（默认 5 只，替换为个人持仓后重跑 `node dev/fetch-data.mjs` 即生效），`/api/stocks/list`、`/api/stocks/signals`、`/api/stocks/history?code=` 返回五档建议（≥30 买入 / ≥10 加仓 / -10~10 持有 / ≤-10 减仓 / ≤-30 卖出）、8 条规则明细与按历史信息系数（IC）动态估计的规则权重（|IC| 截断到 [0.5,3] 后归一化合计 100%）；韩国综合指数（KOSPI）只作为个股诊断的区域联动信号（KOSPI 趋势 / 波动状态 + 个股对 KOSPI 的 63 日 beta），不单独给出建议。前端「个股诊断」标签含排行表、KOSPI 上下文、权重方法说明与可切换 1 / 3 年 / 全部窗口的个股详情。

手动添加个股：排行表上方可添加任意沪深 A 股（沪市 60 / 68、深市 00 / 30 开头，最多 6 只），代码列表只写入本机 `localStorage`（键 `vol-desk-extra-stocks`），刷新页面或重开浏览器后自选列表会自动恢复，同一浏览器的多个标签页之间也会同步增删，请求时以 GET 参数 `extra=600000,000001` 传给 `list` / `signals`，`history?code=` 也支持任意受支持的代码。服务端按需抓取 2015 年以来的前复权日线，东方财富优先、失败回退腾讯分页（每页 640 条、最多 5 页），并以东方财富批量报价把现价补到最新交易日；结果只在内存缓存 10 分钟（失败缓存 60 秒），不写入快照、不保存任何账户或自选数据。单个代码抓取失败只影响该行，并在接口与页面上显式标注原因。

红利策略（国企高分红股 · 周线高抛低吸）：`functions/data/dividendWatchlist.ts` 维护 16 只国企 / 中央国企背景的红利底仓样本（银行、保险、公用事业、能源、通信、交运），以及用户提供的「中国诚通 / 国新投资 / 国新宏盛」三季度新进 / 增持跟踪标的 38 只（截图未标注年份，只采用证券简称与变动方向，持股数量与比例未纳入；连同底仓中的中国神华，截图去重后共 39 只跟踪标的）；同一只股票可同时属于多个分组（中国神华、国电南瑞、中瓷电子），因此分组数量之和大于去重后的跟踪标的数。`functions/dividend.ts` 用不复权周线计算年度股息率（最近一个已实施完整年度、含中期+末期）、股息率 5 年分位、3 年价格分位、周线 RSI(14)、60 周均线偏离与连续分红年数，并按固定权重（股息率分位 30% + 3 年价格分位 25% + 周线 RSI 20% + 60 周均线偏离 15% + 连续分红 10%）给出五档（≥30 分批低吸 / ≥10 小仓低吸 / -10~10 持有收息 / -30~-10 分批高抛 / ≤-30 显著高抛）。刻意不使用个股诊断的动态 IC：周线序列自相关强、有效独立样本少，动态优化容易把噪音当规律。仓位框架固定为「底仓 70%–80% 长期收息 + 卫星仓 20%–30% 只做周线波段」，五档结论只作用于卫星仓，底仓不因波段信号清仓。接口为 `/api/dividend/list`、`/api/dividend/history?code=`、`/api/dividend/ai-context?code=&format=`；`/api/dividend/list` 的每只标的带 `groups[]`（`core / chengtong / guoxin_invest / guoxin_hongsheng` 与 `new / increase` 变动方向），并返回 `groups[]` 分组汇总（数量、新进、增持、低吸 / 高抛只数、平均股息率）与 `watchlistNote`；「红利策略」标签含分组筛选与汇总卡片、排行表、周线价格与 MA20w/MA60w、股息率历史与分位、五项规则明细、最近 10 条分红、数据来源说明，以及只针对卫星仓的 DeepSeek 辅助诊断（`lib/deepseek.ts` 的 `diagnoseDividend`，输出 `stance / confidence / summary / basePosition / satellitePlan / tranches / reasons / risks / dividendView / dataGaps`）。快照生成：`node dev/fetch-dividend-data.mjs`（东方财富不复权日线优先，失败回退腾讯分页；分红取东方财富 `RPT_SHAREBONUS_DET` 税前每 10 股派息）。跟踪标的不是高股息筛选结果，其得分只反映自身价格位置与分红记录，与运营公司的持仓判断无关。

红利手动添加个股：与个股诊断的交互一致，「红利策略」排行表上方可添加任意沪深 A 股（沪市 60 / 68、深市 00 / 30 开头，最多 6 只），代码列表只写入本机 `localStorage`（键 `vol-desk-extra-dividends`，与个股诊断的 `vol-desk-extra-stocks` 相互独立），刷新或重开浏览器后自动恢复。请求时以 GET 参数 `extra=600000,601398` 传给 `/api/dividend/list`，响应用 `meta.baseCount` / `meta.extras` / `meta.extraErrors` 区分基础样本、手动代码与抓取失败原因；`/api/dividend/history?code=` 与 `/api/dividend/ai-context?code=` 也接受任意受支持代码。服务端按需抓取 2015 年以来的不复权日线与东方财富分红明细（日线东方财富优先、失败回退腾讯分页，分红沿用税前每 10 股派息），重采样为周线后与基础 54 只用同一套规则计算；成功缓存 10 分钟、失败缓存 60 秒，不写入快照、不保存自选列表。手动添加的个股不一定属于国企红利样本，`groups` 为空数组，只按公开行情与分红数据计算，不构成对其分红持续性的判断；无公开分红记录时年度股息率显示「暂无完整年度分红」，仅按价格与周线规则评估。单个代码抓取失败只影响该行，并在接口与页面上显式标注原因。

跨资产对比（黄金 / 原油 / 美债）：`/api/macro/cross-asset?years=1|2|3|5|10` 以 GLD、USO、TLT 三只 ETF 的日线收盘价作为黄金、原油、美债的可交易代理，10 年期美债收益率取 FRED `DGS10`；返回三资产的最新收盘与日变动、1W / 1M / 3M / YTD / 1Y / 区间收益、21 / 63 日年化已实现波动、窗口最大回撤、距 1 年高点、10Y 收益率的 bp 变动与 5 年 / 全样本分位，以及 4×4 相关矩阵（展示取最近 252 个交易日，风险联动性取最近 63 个交易日）。风险状态是固定权重的启发式压力评分（利率 30% + 美债 25% + 原油 25% + 联动性 20%，0–100，<35 低 / <65 中 / ≥65 高），并给出利率冲击、再通胀、避险、宽松交易、分化五种情景标签与四条观察点；评分不是概率或预测。页面含归一化走势（区间首日 = 100，10Y 收益率走右轴）、区间收益表、相关性矩阵、驱动拆解与数据来源/限制，底部有「DeepSeek 跨资产风险分析」（`lib/deepseek.ts` 的 `diagnoseMacro`，输出 `riskLevel / confidence / summary / drivers / transmission / crossAsset / scenarios / watch / dataGaps / boundary`，明确要求区分 ETF 代理与现货/期货/久期的偏差、相关性不等于因果）。`/api/macro/ai-context?years=&format=markdown|json` 打包同一份数据供模型使用。快照生成：`node dev/fetch-macro-data.mjs`（Nasdaq 官方 ETF 历史 + FRED DGS10 CSV）；运行时开启「实时上游」会逐只顺序刷新上游，单只失败时保留快照并在 `meta.sources` 标注降级原因。

资产配置台账（本机）：`lib/portfolio.ts` 定义七类持仓（黄金 / 股票 / 基金 / 债券 / 存款理财 / 现金 / 其他）、单位（克 / 股 / 份 / 张 / 元）、校验与存储，以及确定性的估值与风控计算。台账只写入本机 `localStorage`（键 `vol-desk-portfolio`，最多 40 笔，同一浏览器的标签页之间自动同步），不写入站点服务端、不读取任何券商账户、不发起网络请求。每笔持仓记录名称、代码、数量、成本单价、手续费、现价（可留空，留空按成本计）、价格日期与备注；手续费按用户填写的合计金额（元）直接计入成本与盈亏，页面同时给出含费成本（即保本价），基金净值按 4 位小数展示。基金可另外填写持仓页上的持有收益（元）与持有收益率（%），两项都可留空：留空时按「市值 − 数量 × 成本净值」自动计算（不含手续费），手填优先；持有收益与含手续费的浮动盈亏是两种口径，页面分行展示并标注「手填 / 自动」，总览卡片同时给出基金持有收益合计。基金优先按 6 位代码识别（例如 018036），录入时校验格式但允许留空，留空时 AI 只按名称识别并在数据包里标注；AI 数据包会写明代码、成本净值、最新净值与手续费。「我的基金」下拉内置持仓页上 8 只可完整辨认的基金名称，选择后自动填入名称与已确认代码（目前只有 018036），其余基金不猜代码、显示「代码待补」；截图最后一只名称被系统截断，未内置，手动输入一次后会自动记住。新基金名称随持仓保存写入本机名单（键 `vol-desk-fund-names`，最多 80 个，与台账一样刷新或重开浏览器后仍在），也可在下拉里直接选择「手动输入 / 新基金」录入任意名称。页面按填写值计算市值、总成本、浮动盈亏、类别占比、最大单一持仓与前三大合计，并按固定阈值给出风控提示：单一持仓 25% 观察 / 40% 上限（集中度剔除现金，避免高现金组合被误报）、风险资产 80%、防守垫 10%（含可投入现金）、黄金 20%、单笔亏损 -20% / -35%、组合浮亏 -15%、股票与基金合计 12 笔提示；另给出 0–100 的结构评分（集中度 45 + 单一持仓 25 + 单笔回撤 20 + 防守垫 10 的固定加权，分数越高风险越大，不是收益预测）。「可投入现金与配置候选」单独记录未建仓的备用金（本机键 `vol-desk-portfolio-cash`，回车或失焦保存），与持仓市值合成总资产并计入防守垫；页面用固定规则给现有风险持仓排性价比（浮亏越深、占比越低、价格越新分越高；接近 25% 集中度观察线、风险资产偏满、黄金超配、价格过旧与手续费过重扣分），每档金额为可投入现金的三分之一，并明确标注这只是启发式排序、不是买卖建议。现价必须手动更新：过期价格会让市值、盈亏与风控结论一并失真，接口与页面都不代为取价。「DeepSeek 组合诊断」把台账（含代码、手续费、保本价）、可投入现金与本站 VIX、所选指数已实现波动率、跨资产指标拼成 Markdown 数据包（`buildPortfolioContext`），由 `diagnosePortfolio` 输出 `riskLevel / confidence / summary / allocationView / riskControls / actions / risks / dataGaps`；系统提示要求基金按 6 位代码识别、评估加减仓必须提到含费成本与保本价、区分「持有收益 / 持有收益率」（App 口径，不含手续费）与「浮动盈亏（含手续费）」两种口径且不得混用、填写了可投入现金时必须给出分批部署方案并优先保留防守垫，同时不得编造价格与收益率、不得承诺收益或建议杠杆、不得点名具体基金与个股、不得给一次性满仓/清仓指令，`actions` 只能引用台账里真实存在的持仓、代码或类别。台账、可投入现金或市场指标变化时旧结论自动作废。

### 数据来源与更新节奏

| 数据 | 来源 | 更新方式 | 实时性与边界 |
| --- | --- | --- | --- |
| 指数 / ETF / A 股个股日线 | 东方财富公开 K 线接口（`push2his.eastmoney.com`，前复权），手动添加的个股失败时回退腾讯分页日线 | `node dev/fetch-data.mjs` 生成 `functions/data/snapshot.ts`；运行时按需抓取个股并缓存 10 分钟 | 日线在收盘后才有最终值；盘中只用东方财富批量报价补最新价，不是逐笔或毫秒级 |
| 韩国综合指数 KOSPI | 东方财富日线，随个股快照一起生成 | 同上 | 只作为个股诊断的区域联动信号，不单独给建议 |
| 红利股周线 | 东方财富不复权日线（`fqt=0`，2015 起），失败回退腾讯不复权日线；按每周最后一个交易日重采样；手动添加的个股在运行时按需抓取 | `node dev/fetch-dividend-data.mjs` 生成 `functions/data/dividendSnapshot.ts`；手动添加的个股在请求时抓取并缓存 10 分钟（失败 60 秒）；开启「实时上游」时用东方财富批量报价覆盖本周最新 K 线 | 周线包含除息缺口；本周 K 线在周末收盘前不是最终值（接口标记 `weekPartial`）；手动添加的个股不写入快照 |
| 红利股分红 | 东方财富数据中心 `RPT_SHAREBONUS_DET`（税前每 10 股派息），按除息日进入计算；手动添加的个股同样按需抓取 | 随红利快照生成；手动添加的个股在请求时抓取并缓存 10 分钟；新方案实施后需重跑脚本 | 年度股息率只认已实施完整年度；近 12 个月现金口径仅参考，银行中期+末期过渡期可能一年三次派息；不保证未来分红 |
| 盘中最新报价 | 东方财富批量行情（`push2.eastmoney.com`） | 每次请求且 `refresh=1` 时拉取；缓存 5 分钟 | 有延迟，可能停牌或缺失；失败时显式降级为本地快照 |
| 黄金 / 原油 / 美债 ETF 日线 | Nasdaq 官方历史接口（`api.nasdaq.com`，GLD / USO / TLT，日频收盘） | `node dev/fetch-macro-data.mjs` 生成 `functions/data/macroSnapshot.ts`；开启「实时上游」时逐只顺序刷新并缓存 10 分钟 | 以 ETF 作为现货/期货代理，含管理费、跟踪误差与展期成本；盘中不更新；上游反爬或不可达时保留快照并显式标注 `ok:false` 降级 |
| 10 年期美债收益率 | FRED `DGS10`（恒定到期收益率，CSV） | 随 `fetch-macro-data.mjs` 生成快照；运行时与 ETF 一起尝试刷新 | 节假日缺失；收益率与 TLT 的久期、票息和价格变动不是一一对应；收益率上行对应美债价格下跌 |
| 资产配置台账 | 用户手动录入（名称、代码、数量、成本、手续费、现价、日期；基金可从内置名单选择并另填持有收益 / 持有收益率；可投入现金单独录入） | 页面内增删改即时写入本机 `localStorage`（台账键 `vol-desk-portfolio`；基金名单键 `vol-desk-fund-names`；可投入现金键 `vol-desk-portfolio-cash`） | 现价与手续费不自动更新，不连接券商账户，不上送站点服务端；基金代码可留空，此时 AI 只按名称识别；持有收益按 App 口径（不含手续费）手填或由填写值自动计算，与含费浮动盈亏不是同一口径；市值、盈亏与风控提示只按填写值计算，价格过期时结论失真；可投入现金是手工备用金，不是券商可用余额 |
| VIX / VXN 隐含波动率 | CBOE 官方日线 `VIX_History.csv` / `VXN_History.csv`（`cdn-api.cboe.com` 优先，`cdn.cboe.com` 备用）；不可达时依次回退 FRED `VIXCLS` / `VXNCLS` 收盘序列镜像与 Yahoo `^VIX` / `^VXN`；另抓 CBOE 官方延迟报价 `_VIX.json` | `node dev/fetch-data.mjs` 生成 VIX / VXN 快照；运行时 `refresh=1` 时探测上游（隐含波动率超时 12 秒，其余 3.5 秒） | CBOE CSV 日期为 `MM/DD/YYYY`、收盘在第 5 列；日线收盘后才有最终值，`quote` 为延迟约 15 分钟的盘中参考，不参与分位与 Z 分数；FRED 通常晚一个交易日；全部不可达时接口返回 `available:false` 与各源原因，绝不伪造读数，改用真实收盘价计算的 21 / 63 日已实现波动率 |
| 大摩报告事件 | `functions/data/events.ts` 人工整理公开报道；「实时抓取」由 DeepSeek 网页搜索 / 抓取生成 | 人工表随代码更新；AI 结果只存本机 `localStorage`（`vol-desk-reports`） | 人工表非穷举；AI 抓取未经人工核对，只作线索 |
| DeepSeek 辅助诊断 / 背景补充 | 浏览器直连 `https://api.deepseek.com`，使用访问者自己的 API Key | 点击时实时调用，单次、非流式、60 秒超时 | 密钥只存本机 `localStorage`（`vol-desk-llm`）；站点服务端不代持、不转发、不记录；模型输出可能有错 |

没有任何逐笔、Level-2 或毫秒级实时行情；所有页面都展示数据截至日期与来源状态，接口在 `/docs` 的 21 条 `data_quality_notes` 中同步声明这些限制（含红利手动添加按需抓取、失败原因与不写快照，以及跨资产 ETF 代理与相关性边界）。红利策略未纳入盈利、派息率、自由现金流、利率、监管与行业景气等因素，AI 诊断被要求显式说明这些数据缺口；跨资产评分是启发式压力打分，不是概率或预测。

大摩报告复盘：`functions/data/events.ts` 人工整理 7 份有明确日期与公开来源的摩根士丹利中国 / A 股策略报告（含目标位调整与来源链接，标注可信度，非穷举）；`/api/events` 返回事件表，`/api/events/study` 以上证与沪深300 为样本，计算报告日后首个交易日锚定的 T−20→T+60 累计收益路径、1/5/20/60/120 日前向收益、60 日峰谷、按立场分组的汇总与无条件基准；A 股标的的 `api/ai-context` 会附带同一份复盘摘要。在此之外，「大摩报告复盘」标签顶部有「实时抓取大摩最新报告」：用 DeepSeek 官方网页搜索（`POST /v1/tools/search`）与抓取（`POST /v1/tools/fetch`）接口检索最新报道、抓取正文，再让 DeepSeek 提取成结构化事件（材料截断为检索结果 6000 字 + 最多 3 页 × 12000 字，推理模型给 8000 `max_tokens`；若正文仍被思维链截断或 JSON 未闭合，会压缩到 2 页 × 8000 字并提高推理档位重试一次），并用真实日线收盘价在浏览器端计算上证与沪深300 的报告后 1/5/20/60 日前向收益；结果标注「AI 抓取 · 未经人工核对」，只存本机 `localStorage`（键 `vol-desk-reports`），不写入服务端。

DeepSeek 辅助诊断（自带密钥，浏览器直连）：`lib/deepseek.ts` 是纯前端适配器，服务端不代持任何大模型密钥。在「买卖诊断」标签的 AI 卡片点「添加模型」，填入自己的 DeepSeek 官方 API Key（模型名与接口地址可改，默认 `deepseek-flash` / `https://api.deepseek.com`，卡片里可一键点选官方在用的 `deepseek-flash` 与 `deepseek-v4-pro`；旧名 `deepseek-chat`、`deepseek-reasoner` 已下线，填了会被 400 拒绝，错误提示会直接说明），配置只写进本机 `localStorage`（键 `vol-desk-llm`），页面上永远只显示掩码（前 6 位 + 后 4 位）；「清除密钥」即彻底删除。点「调用 DeepSeek 诊断」时，浏览器把 `api/ai-context` 返回的 Markdown 上下文连同关注点一起作为 user 消息，直接 `POST https://api.deepseek.com/chat/completions`（`Authorization: Bearer <自己的密钥>`、`credentials:"omit"`、强制 HTTPS，仅回环地址允许 `http` 以便离线测试），单次、非流式、不自动重放、60 秒超时（唯一例外：正文为空或 JSON 解析失败时改用默认推理档位重试一次，最多两次请求）；密钥不经过站点 Function，也不出现在任何日志或响应体中。响应按固定 JSON 结构（`stance` 五档 `buy/add/hold/trim/reduce`、`confidence`、`summary`、`reasons`、`risks`、`scenarios.volUp/volDown`、`dataGaps`）容错解析，兼容 ```json 代码块与前后夹带的说明文字，解析失败时保留原始文本供排查。上游状态码统一映射成中文提示（401 密钥被拒 / 402 余额不足 / 429 限流 / 5xx 上游故障），且不回显上游正文。DeepSeek 官方接口允许浏览器跨域直连（实测预检回显 Origin 并放行 `authorization,content-type`），因此无需中转。注意 DeepSeek V4 系列是推理模型：会先输出思维链再出正文，连接测试与诊断都预留了更大的 `max_tokens` 预算，官方接口再配 `effort:"low"` 压低思维链；若模型偶发截断 JSON，诊断会自动改用默认推理档位重试一次。「红利策略」标签下的「DeepSeek 红利诊断」复用同一份本机密钥（`vol-desk-llm`），运行时先取 `/api/dividend/ai-context?format=markdown`，再让模型只针对卫星仓输出五档结论、底仓处理、分批触发条件与股息可持续性判断；输出结构与买卖诊断不同，但同样只接受固定 JSON、失败最多重试一次、绝不经过站点服务端。「跨资产」标签下的「DeepSeek 跨资产风险分析」也复用同一份本机密钥，运行时先取 `/api/macro/ai-context?format=markdown`，再让模型输出 `riskLevel / confidence / summary / drivers / transmission / crossAsset / scenarios / watch / dataGaps / boundary`；系统提示要求不得给出具体买卖点位、仓位比例或收益承诺，必须区分 ETF 代理与现货/期货/久期的偏差，并声明相关性不等于因果。「资产配置」标签下的「DeepSeek 组合诊断」同样复用本机密钥，但数据包完全在浏览器内由台账与页面已加载的指标拼装（不请求服务端），诊断范围限定在集中度、防守垫、止损与分批再平衡纪律，阈值与本地页面完全一致。网页搜索（`/v1/tools/search`）与抓取（`/v1/tools/fetch`）同样是浏览器直连、消耗访问者额度。服务端随之保持严格只读：`/api/ai/status`、`/api/ai/analyze` 已下线，任何非 GET/HEAD 请求返回 405，站点设置里不需要配置任何 Secret。未添加密钥时卡片只提示「添加模型」，诊断上下文本身仍可免费复制 / 下载或喂给别的模型。

AI 背景补充（VIX / KOSPI）：两个面板底部各有「用 DeepSeek 补充信息」。点击后浏览器先用 DeepSeek 官方网页搜索（`POST /v1/tools/search`）检索公开报道，再把「本站真实指标（唯一数值依据）+ 检索材料」交给 DeepSeek 输出结构化摘要（`headline / summary / bullets / watch / caveats`），并列出可点击来源；检索失败会自动降级为仅依据本站指标的解读，不阻塞主流程。结果按本次使用的本站指标绑定缓存 30 分钟于本机 `localStorage`（键 `vol-desk-brief-VIX` / `vol-desk-brief-KOSPI`）：指标上下文变化时旧摘要立即失效、不再展示，可重复查看或重新生成；页面数据尚未返回时按钮禁用，不会把「暂无读数」写进缓存。明确边界：DeepSeek 不是行情数据源，系统提示与界面都要求不得编造任何数值、日期、机构或链接，所有数值以本站接口为准，摘要固定标注「AI 摘要可能有错」。

页面主题：`src/globals.css` 用 `@custom-variant dark` 把 `dark:` 变体绑到 `data-theme` 属性，`lib/theme.ts` 负责 白天 / 夜晚 / 跟随系统 三态与 `localStorage`（键 `vol-desk-theme`）持久化，`index.html` 的内联脚本在首次绘制前落定主题以避免闪烁；图表颜色全部走同一套 CSS 变量，切换时不需要重算数据。

开发脚本（全部位于 `dev/`，不参与站点打包）：

| 命令 | 作用 |
| --- | --- |
| `node dev/fetch-data.mjs` | 重新抓取行情并覆盖 `functions/data/snapshot.ts`（含观察清单个股与 KOSPI），同时探测 VIX / VXN 上游 |
| `node dev/fetch-dividend-data.mjs` | 抓取基础 54 只标的（16 只红利底仓 + 38 只国有资本运营跟踪）的东方财富不复权日线（失败回退腾讯）与分红明细，重采样为周线并覆盖 `functions/data/dividendSnapshot.ts`（手动添加的个股由运行时按需抓取） |
| `node dev/fetch-macro-data.mjs` | 抓取 GLD / USO / TLT 的近十年日线（Nasdaq 官方接口，受其约十年上限约束）与 10 年期美债收益率（FRED `DGS10`），覆盖 `functions/data/macroSnapshot.ts` |
| `node dev/function-local.mjs` | 用 Node 的类型剥离直接跑 `functions/handler.ts`，无需 Deno，监听 `127.0.0.1:8000`（可用 `PORT` 覆盖） |
| `npm run dev` | Vite 开发服务，`/functions/v1/app` 代理到 8000 |
| `node dev/preview-server.mjs` | 以生产构建产物 `dist/` 提供同源预览，监听 `127.0.0.1:4173`；它在进程内 import `functions/handler.ts`，改完 Function 源码后需要重启才会生效 |
| `node dev/start.mjs` | 本机启动器（`启动波动率观测台.cmd` 调用的就是它）：端口空闲时缺构建产物或前端源码比 `dist/` 新会先 `npm run build`，再拉起 preview-server 并自动打开浏览器；页面已在运行时只打开浏览器；窗口保持开启，关闭窗口或 Ctrl+C 即停止 |
| `node dev/verify-api.mjs` | 对 Function 逐路由回归（48 个用例）：状态码、JSON 结构、CORS、`application/json`、HEAD/405/204、`/docs` 端点数量（18 个且全为 GET）与 21 条数据质量说明、VIX 可用/降级两种形态、个股列表/信号/历史与非法代码 400、个股手动添加（去重 / 非法 / 超限 / 按需抓取）、红利清单/详情/AI 上下文/非法代码 400/固定权重校验、红利手动添加（`extra` 合并、任意代码详情、AI 上下文、非法与超限 400、按需抓取）、跨资产 1/3/10 年窗口（资产、收益、4×4 相关矩阵、收益率与风险评分）、非法 `years` 400、跨资产 AI 上下文的 Markdown/JSON 结构与护栏条数、服务端 AI 路由已下线；其中按需抓取自选股与红利手动添加的 5 个用例需要外网 |
| `node --experimental-strip-types dev/verify-llm.mjs` | 对 `lib/deepseek.ts` 与 `lib/briefCache.ts` 的 167 个用例（用注入的 fetch 记录器，不触真实付费接口）：配置读写与掩码不泄漏密钥、HTTPS 与回环地址校验、默认模型名与官方在用名称一致、提示词组装、容错 JSON 解析、每个失败分支只请求一次且不重放、状态码→中文提示映射、连接测试与推理模型的 token 预算、截断自动重试、网页搜索 / 抓取 / 报告提取的端点、字段映射与材料压缩重试、VIX / KOSPI 背景补充的提示词约束、预算与重试、AI 摘要缓存按本站指标版本失效（指标变化 / 超时 / 损坏数据都不复用旧摘要）、红利诊断的底仓/卫星仓提示词、五档映射、预算与截断重试、跨资产诊断的三资产边界、四情景映射、越界 `riskLevel` 重试、VIX 权益仓位诊断的系统提示与预算、组合诊断的持仓引用 / 动作白名单 / 风控要点校验与重试、组合提示词的基金代码优先、缺代码时按名称识别 / 手续费 / 含费成本 / 持有收益与含费盈亏两种口径不得混用 / 可投入现金分批部署约束，以及请求体不含密钥 |
| `node --experimental-strip-types dev/verify-portfolio.mjs` | 对 `lib/portfolio.ts` 的 115 个用例（本机伪造 `localStorage`，不发起网络请求）：字段校验（类别 / 名称长度 / 数量与成本为正 / 现价可空 / 日期格式 / 非法 id 重写）、现金类按金额归一、手续费校验与含费成本、基金代码格式、基金持有收益 / 持有收益率的手填校验与自动计算（非基金类别忽略、非数字与越界拒绝、空串按未填）、「我的基金」内置名单与只预填已确认的 018036、新增名称 / 代码的去重与长期保存、非法名称与代码忽略、自定义名单上限、名单损坏回退、可投入现金的归一 / 往返 / 上限、存储往返与损坏数据回退、重复 id 去重、40 笔上限、市值与含费盈亏、类别占比、风险/防守拆分（含可投入现金）、集中度剔除现金、固定阈值规则触发、结构评分、部署候选的排除条件 / 评分 / 三档金额 / 价格时效 / 手续费拖累、金额与百分比格式（基金净值 4 位小数），以及 AI 数据包的标题、拆分、分类明细、基金代码、手续费与保本价、基金持有收益与两种盈亏口径、部署候选、阈值、市场背景与空台账说明 |
| `node dev/mock-deepseek.mjs` | 回环的 DeepSeek 兼容 mock（默认 `127.0.0.1:8123`，带 CORS 预检、缺 Bearer 返回 401）。把「添加模型」里的接口地址填成它，即可在不消耗 token 的情况下验证诊断卡片与 AI 背景补充的完整渲染路径 |

本机未安装 Deno，因此 `npm run check:function` 未执行；Function 兼容性目前由 Node 适配器验证（Deno 与 Node 均实现 WHATWG `Request`/`Response`），部署后的真实运行结果仍需一次线上请求确认。

## 本机启动（不打开 Qoder）

双击项目根目录的 **`启动波动率观测台.cmd`** 即可，不依赖 Qoder 进程：

- 首次使用需要先在本目录执行一次 `npm install`（缺依赖时脚本会直接提示）。
- 脚本会检查 Node、在 `dist/` 缺失或前端源码较新时自动 `npm run build`，然后启动 `127.0.0.1:4173` 并自动打开浏览器。
- 弹出的命令行窗口就是服务窗口，**保持它开着**即可访问；关闭窗口或按 Ctrl+C 停止。
- 页面已经在运行时再次双击，只会再打开一个浏览器标签，不会重复启动服务。
- 右键该 `.cmd` →「发送到」→「桌面快捷方式」，即可从桌面一键启动。

服务只监听回环地址 `127.0.0.1`，因此只有这台电脑能访问；手机、其他设备或公网访问需要 Qoder Sites 托管或自己的服务器。改完前端源码后重新双击会自动重新构建；改完 `functions/` 下的 Function 源码要先关闭窗口、再双击重启（preview-server 在启动时加载 Function）。

## Develop

Use a Node version accepted by `package.json` (`^22.13.0 || >=24.0.0`). Select an installed compatible runtime and keep it selected for installation, development and build:

```sh
npm ci
npm run dev
```

Use the loopback URL printed by Vite. Edit `src/App.tsx`, `src/globals.css` and the title/description in `index.html`. Replace the sample page with the requested product before presenting a first meaningful preview. Import existing UI primitives from `@/components/ui/<component>` and compose them for the site's design. The neutral starter theme is a starting point, not the finished visual direction.

For production output:

```sh
npm run build
npm run preview
```

The build fixes `NODE_ENV=production` before loading Vite, independently of the terminal environment. It checks the frontend and bundled component types and emits `dist/index.html` and assets. `npm run preview` serves this output locally. Reuse passing checks while source is unchanged; no additional unit-test suite or browser QA is required by the template.

## Optional Function

The default page is entirely static and does not call a Function. For server behavior, adapt the public, credential-free example in `functions/handler.ts`. `functions/index.ts` is the Deno deployment entry point. Check `deno --version` before using a separate terminal for:

```sh
npm run check:function
npm run dev:function
```

If Deno is unavailable, the static frontend can still build and run. Keep Function validation pending until Deno or an equivalent existing Function checker is available; `npm run build` checks the frontend only. Local proxy requests also need a running compatible Function server.

The local service binds to `127.0.0.1:8000`; Vite development and built preview proxy `/functions/v1/app` to it, preserving the path. Probe with an available HTTP tool or Node `fetch`; with `curl` installed, for example:

```sh
curl --fail 'http://127.0.0.1:5173/functions/v1/app?name=Visitor'
```

Use Vite's actual port if it differs. The same frontend request after deployment is routed by Qoder Sites. Local proxy configuration is not production routing. Keep local-only servers and fixtures in `dev/`, outside both publication directories. The included Function has no dependencies; add self-contained runtime imports as required. Frontend npm dependencies are not automatically installed in Functions.

## Publish with Qoder Sites

Open a local conversation in this project and follow the `sites-hosting` skill. Workspace registration is optional. Use the directory returned by `get_context` with:

- `webDirectory: "dist"` after the build.
- `spa: false` for the default single page; use `true` when adding client-side deep routes that need fallback.
- `functionDirectory: "functions"` only if the application uses the Function. Omit it for static-only delivery.

The Sites tools prepare artifacts and generate the publication descriptor; publish completed hosted work by default, unless the user explicitly requests a preview first or defers publication. Do not upload the project root, `node_modules`, `dev`, or source as the web artifact. A successful build or release does not prove an external integration works.

For a new database-backed React page, follow the installed `sites-building` Skill's `references/function-backend.md`. Its assembled `assets/function-backend/` example includes `Notes.tsx`, Function routes and a schema using the platform's private database credentials. For a runnable records-and-attachments workbench, use that Skill's `references/records-example.md`; its setup command assembles a new project from this starter and keeps local fixtures outside deployment outputs. Preserve and adapt its application identity and ownership checks before exposing private records. `references/database.md`, `assets/database-react/App.tsx` and `assets/database-function/` are for existing legacy allocations only. These optional assets stay in the Skill rather than being copied into every static project.

For database or Storage, follow the corresponding `sites-building` references and `sites-management` capability workflow. For AI, follow `sites-build-agent-app` and keep Cloud Agents access in the Function. Application credentials belong in server-side Sites Settings; frontend environment variables are public. 本项目是例外而非通用做法：AI 用的是访问者自己的 DeepSeek 密钥（浏览器输入、只存本机 `localStorage`、直连官方 HTTPS 接口），因此站点没有任何应用级 AI 凭据，也不通过 Function 转发模型请求；如需改成代持密钥的方案，必须回到服务端 Secret + 独立鉴权路由的形式。This starter does not implement visitor login, database permissions, Cloud resource coordination or QCA sessions; add those only for the requested feature using the existing skills.

See `PROVENANCE.md` and `vendor/` for source attribution and the preserved stylesheet license.

After copying the starter, rename `gitignore.template` to `.gitignore` before installing dependencies. This keeps the file available in npm and bundled CLI resources.
