# 波动率观测台（Nasdaq + A-Share Volatility Desk）

基于 React / TypeScript / Vite / Tailwind 的波动率与个股诊断看板，配套严格只读的分析 Function：VIX 恐慌指数、纳斯达克与 A 股指数波动率历史、A 股个股五档买卖建议（含 KOSPI 区域联动与 IC 动态权重）、大摩报告复盘，以及浏览器直连 DeepSeek 的 AI 背景补充（自带密钥，站点不代持任何密钥）。

站点由三部分组成：`src/` 的六标签可视化面板（波动率总览 / 历史规律 / 买卖诊断 / 个股诊断 / 大摩报告复盘 / API 接口）、`functions/` 的只读分析接口，以及 `functions/data/snapshot.ts` 的真实行情快照。前端骨架与组件目录源自 Qoder Sites React 起始模板，模板归属、第三方样式许可见 [PROVENANCE.md](PROVENANCE.md) 与 `vendor/`。

数据口径：指数、ETF 与 A 股个股日线收盘价来自东方财富公开接口（手动添加的个股在东方财富失败时回退腾讯分页日线），快照由 `node dev/fetch-data.mjs` 重新生成（NDX100 自 2019-04、IXIC 与 SPX 自 2015-01、QQQ 自 2001-01、上证指数与沪深300 自 2015-01，另含 `functions/data/watchlist.ts` 中 5 只 A 股个股与韩国综合指数 KOSPI）。VXN / VIX 隐含波动率在运行时尝试 CBOE / Yahoo 上游，不可达时接口与页面都会显式标注 `ok:false`，诊断改用真实收盘价计算的 21 / 63 日年化已实现波动率。核心计算集中在 `functions/analytics.ts`（波动率序列、分位、Z 分数、10 条规则信号、历史分位表现、波动率×趋势矩阵、事件研究、个股 8 条规则与 IC 动态权重），路由与 AI 上下文打包在 `functions/handler.ts`。

VIX 恐慌指数：`/api/volatility/panic` 返回标普500 30 天隐含波动率水平、5 年 / 全样本分位、Z 分数与波动状态；每个标的的「波动率总览」顶部固定展示该面板，数据独立于所选指数。上游（CBOE CSV / Yahoo）不可达时接口显式 `available:false` 并给出各探测源的原因，页面用琥珀色降级框说明并回落到已实现波动率，绝不伪造读数。

个股诊断：`functions/data/watchlist.ts` 维护观察清单（默认 5 只，替换为个人持仓后重跑 `node dev/fetch-data.mjs` 即生效），`/api/stocks/list`、`/api/stocks/signals`、`/api/stocks/history?code=` 返回五档建议（≥30 买入 / ≥10 加仓 / -10~10 持有 / ≤-10 减仓 / ≤-30 卖出）、8 条规则明细与按历史信息系数（IC）动态估计的规则权重（|IC| 截断到 [0.5,3] 后归一化合计 100%）；韩国综合指数（KOSPI）只作为个股诊断的区域联动信号（KOSPI 趋势 / 波动状态 + 个股对 KOSPI 的 63 日 beta），不单独给出建议。前端「个股诊断」标签含排行表、KOSPI 上下文、权重方法说明与可切换 1 / 3 年 / 全部窗口的个股详情。

手动添加个股：排行表上方可添加任意沪深 A 股（沪市 60 / 68、深市 00 / 30 开头，最多 6 只），代码列表只写入本机 `localStorage`（键 `vol-desk-extra-stocks`），请求时以 GET 参数 `extra=600000,000001` 传给 `list` / `signals`，`history?code=` 也支持任意受支持的代码。服务端按需抓取 2015 年以来的前复权日线，东方财富优先、失败回退腾讯分页（每页 640 条、最多 5 页），并以东方财富批量报价把现价补到最新交易日；结果只在内存缓存 10 分钟（失败缓存 60 秒），不写入快照、不保存任何账户或自选数据。单个代码抓取失败只影响该行，并在接口与页面上显式标注原因。

大摩报告复盘：`functions/data/events.ts` 人工整理 7 份有明确日期与公开来源的摩根士丹利中国 / A 股策略报告（含目标位调整与来源链接，标注可信度，非穷举）；`/api/events` 返回事件表，`/api/events/study` 以上证与沪深300 为样本，计算报告日后首个交易日锚定的 T−20→T+60 累计收益路径、1/5/20/60/120 日前向收益、60 日峰谷、按立场分组的汇总与无条件基准；A 股标的的 `api/ai-context` 会附带同一份复盘摘要。在此之外，「大摩报告复盘」标签顶部有「实时抓取大摩最新报告」：用 DeepSeek 官方网页搜索（`POST /v1/tools/search`）与抓取（`POST /v1/tools/fetch`）接口检索最新报道、抓取正文，再让 DeepSeek 提取成结构化事件（材料截断为检索结果 6000 字 + 最多 3 页 × 12000 字，推理模型给 8000 `max_tokens`；若正文仍被思维链截断或 JSON 未闭合，会压缩到 2 页 × 8000 字并提高推理档位重试一次），并用真实日线收盘价在浏览器端计算上证与沪深300 的报告后 1/5/20/60 日前向收益；结果标注「AI 抓取 · 未经人工核对」，只存本机 `localStorage`（键 `vol-desk-reports`），不写入服务端。

DeepSeek 辅助诊断（自带密钥，浏览器直连）：`lib/deepseek.ts` 是纯前端适配器，服务端不代持任何大模型密钥。在「买卖诊断」标签的 AI 卡片点「添加模型」，填入自己的 DeepSeek 官方 API Key（模型名与接口地址可改，默认 `deepseek-flash` / `https://api.deepseek.com`，卡片里可一键点选官方在用的 `deepseek-flash` 与 `deepseek-v4-pro`；旧名 `deepseek-chat`、`deepseek-reasoner` 已下线，填了会被 400 拒绝，错误提示会直接说明），配置只写进本机 `localStorage`（键 `vol-desk-llm`），页面上永远只显示掩码（前 6 位 + 后 4 位）；「清除密钥」即彻底删除。点「调用 DeepSeek 诊断」时，浏览器把 `api/ai-context` 返回的 Markdown 上下文连同关注点一起作为 user 消息，直接 `POST https://api.deepseek.com/chat/completions`（`Authorization: Bearer <自己的密钥>`、`credentials:"omit"`、强制 HTTPS，仅回环地址允许 `http` 以便离线测试），单次、非流式、不自动重放、60 秒超时（唯一例外：正文为空或 JSON 解析失败时改用默认推理档位重试一次，最多两次请求）；密钥不经过站点 Function，也不出现在任何日志或响应体中。响应按固定 JSON 结构（`stance` 五档 `buy/add/hold/trim/reduce`、`confidence`、`summary`、`reasons`、`risks`、`scenarios.volUp/volDown`、`dataGaps`）容错解析，兼容 ```json 代码块与前后夹带的说明文字，解析失败时保留原始文本供排查。上游状态码统一映射成中文提示（401 密钥被拒 / 402 余额不足 / 429 限流 / 5xx 上游故障），且不回显上游正文。DeepSeek 官方接口允许浏览器跨域直连（实测预检回显 Origin 并放行 `authorization,content-type`），因此无需中转。注意 DeepSeek V4 系列是推理模型：会先输出思维链再出正文，连接测试与诊断都预留了更大的 `max_tokens` 预算，官方接口再配 `effort:"low"` 压低思维链；若模型偶发截断 JSON，诊断会自动改用默认推理档位重试一次。网页搜索（`/v1/tools/search`）与抓取（`/v1/tools/fetch`）同样是浏览器直连、消耗访问者额度。服务端随之保持严格只读：`/api/ai/status`、`/api/ai/analyze` 已下线，任何非 GET/HEAD 请求返回 405，站点设置里不需要配置任何 Secret。未添加密钥时卡片只提示「添加模型」，诊断上下文本身仍可免费复制 / 下载或喂给别的模型。

AI 背景补充（VIX / KOSPI）：两个面板底部各有「用 DeepSeek 补充信息」。点击后浏览器先用 DeepSeek 官方网页搜索（`POST /v1/tools/search`）检索公开报道，再把「本站真实指标（唯一数值依据）+ 检索材料」交给 DeepSeek 输出结构化摘要（`headline / summary / bullets / watch / caveats`），并列出可点击来源；检索失败会自动降级为仅依据本站指标的解读，不阻塞主流程。结果缓存 30 分钟于本机 `localStorage`（键 `vol-desk-brief-VIX` / `vol-desk-brief-KOSPI`），可重复查看或重新生成。明确边界：DeepSeek 不是行情数据源，系统提示与界面都要求不得编造任何数值、日期、机构或链接，所有数值以本站接口为准，摘要固定标注「AI 摘要可能有错」。

页面主题：`src/globals.css` 用 `@custom-variant dark` 把 `dark:` 变体绑到 `data-theme` 属性，`lib/theme.ts` 负责 白天 / 夜晚 / 跟随系统 三态与 `localStorage`（键 `vol-desk-theme`）持久化，`index.html` 的内联脚本在首次绘制前落定主题以避免闪烁；图表颜色全部走同一套 CSS 变量，切换时不需要重算数据。

开发脚本（全部位于 `dev/`，不参与站点打包）：

| 命令 | 作用 |
| --- | --- |
| `node dev/fetch-data.mjs` | 重新抓取行情并覆盖 `functions/data/snapshot.ts`（含观察清单个股与 KOSPI），同时探测 VIX / VXN 上游 |
| `node dev/function-local.mjs` | 用 Node 的类型剥离直接跑 `functions/handler.ts`，无需 Deno，监听 `127.0.0.1:8000`（可用 `PORT` 覆盖） |
| `npm run dev` | Vite 开发服务，`/functions/v1/app` 代理到 8000 |
| `node dev/preview-server.mjs` | 以生产构建产物 `dist/` 提供同源预览，监听 `127.0.0.1:4173`；它在进程内 import `functions/handler.ts`，改完 Function 源码后需要重启才会生效 |
| `node dev/verify-api.mjs` | 对 Function 逐路由回归（33 个用例）：状态码、JSON 结构、CORS、`application/json`、HEAD/405/204、`/docs` 端点数量（13 个且全为 GET）、VIX 可用/降级两种形态、个股列表/信号/历史与非法代码 400、手动添加（去重 / 非法 / 超限 / 按需抓取）、服务端 AI 路由已下线；其中按需抓取自选股的 2 个用例需要外网 |
| `node --experimental-strip-types dev/verify-llm.mjs` | 对 `lib/deepseek.ts` 的 79 个用例（用注入的 fetch 记录器，不触真实付费接口）：配置读写与掩码不泄漏密钥、HTTPS 与回环地址校验、默认模型名与官方在用名称一致、提示词组装、容错 JSON 解析、每个失败分支只请求一次且不重放、状态码→中文提示映射、连接测试与推理模型的 token 预算、截断自动重试、网页搜索 / 抓取 / 报告提取的端点、字段映射与材料压缩重试、VIX / KOSPI 背景补充的提示词约束、预算与重试 |
| `node dev/mock-deepseek.mjs` | 回环的 DeepSeek 兼容 mock（默认 `127.0.0.1:8123`，带 CORS 预检、缺 Bearer 返回 401）。把「添加模型」里的接口地址填成它，即可在不消耗 token 的情况下验证诊断卡片与 AI 背景补充的完整渲染路径 |

本机未安装 Deno，因此 `npm run check:function` 未执行；Function 兼容性目前由 Node 适配器验证（Deno 与 Node 均实现 WHATWG `Request`/`Response`），部署后的真实运行结果仍需一次线上请求确认。

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
