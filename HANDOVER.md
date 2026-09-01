# dsh-madrank 卡片交接文档（Usage 插件轨道）

> 生成于 2026-08-31 · 基于 dsh-madrank 子包当前代码实态，全部结论有测试/构建证据。
> 阅读顺序：根目录 `HANDOVER.md`（主产品全景）→ 本文（卡片轨道）→ `README.md`（接入与口径）→
> `HANDOFF.md` §3–§4（DSH 集成步骤与血泪坑，接手前必读）。
> 主应用（Next.js 站点）不在本文范围。

---

## 0. 一页速览

- **是什么**：DeepSeek Harness 插件 —— 本机 AI 用量私人卡片（DSH 设置页 + 左侧栏弹窗）+ Usage Network 第一个客户端节点。
- **当前阶段**：Joined 全链已贯通（2026-08-31）：真实排名数据进入卡片（P0-1）+ Join 全链 E2E 实跑通过（P0-2）+ RACE_URL 随 endpoint 派生；此前已完成中英双语、状态 A/B、7D·30D·单日历史切换、空心点状态语法。
- **验证状态**：**85 测试全绿**（10 文件，含 panel-mount 真实 DOM 点击路径回归：模态挂载 / Join 接线 / Joined 渲染 / Esc / this 依赖 mock / unavailable 形态 / 崩溃边界）/ `tsc --noEmit` 绿 / `dist/client.js` 已重建且运行中的 DSH 已在 serve 新 bundle（哈希比对一致——刷新页面即得新浏览器半侧）/ `verify:dsh` 五步 PASS / Join 全链 E2E PASS（2026-08-31）；「点击即消失」真凶已实锤并修复（见 §7 类方法裸抽取坑）。
- **真实数据现状**：本机 `~/.madrank/usage/usage-store.json` 已有真实分日历史；**`snap.global` 已接 `/api/usage/ingest` 真实返回**（sync 捕获 race → `global-rank.json` → settings resolve 注入 → 卡片点亮）。`scripts/plugin-join-e2e.mjs` 对本地栈全链 PASS（SYNC→INGEST→RANK→READ→RENDER）；浏览器半侧的 JOIN 点击→实时点亮需真实 DSH GUI 实机验证（§6 第 2 项余量）。「UI 不动，数据一到即点亮」的设计兑现。
- ⚠️ **本轮全部改动未提交**（git status 约 17 个文件 modified + `src/client/i18n.ts` 未跟踪），接手人 review 后需提交。

## 1. 三条链路（架构记忆图）

```
① 在线卡片链路（实时）
  DSH session log（事实源）
    → fold.ts 投影 madrankUsage（全量分日，无窗口裁剪）
    → sessions.list projectionValues 下发浏览器
    → client/card-data.ts mergeViews → DayAggregate → CardSnapshot（含 history 60 天）
    → panel.ts dataTick → card-html.ts renderCardHtml

② 离线快照链路（预览/诊断）
  store.aggregateDays() → snapshot.ts buildCardSnapshot（version 2）
    → ~/.madrank/usage/card-snapshot.json → tools/build-card-preview.ts

③ 同步链路（opt-in，日级）
  sync.ts → POST {endpoint}（默认 https://madrank.app/api/usage/ingest）
    只传已结束 UTC 日；uploadedDays 防重；服务端单调幂等
```

全部日期口径 = **UTC**（与上传、排名、streak 一致；卡片日期标注注明）。

## 2. 卡片当前形态（自上而下，锁定）

| 区块 | 内容 | 设计依据 |
|---|---|---|
| 头部 pill | `● 仅本地`（**空心点**）/ `● 全球排名已开启`（实心绿） | 对齐官方 statusDot/configTag 语法：灰=未激活、绿=启用；空心点让 off 显刻意而非失效 |
| Hero | `今日 · 未缓存 Token` 主数字 + 明细分段 + ⓘ 缓存口径 tooltip | Primary = uncached in + out；缓存单列不污染主数字 |
| 常用模型 | Top4 + 份额进度条（标题无计数） | 排名语义由百分比表达 |
| 历史区 | 分段控件 `7天/30天/单日` + 直方（列头 = `MM-DD`，hover 出完整日期+星期） | 30D 密排隐藏柱内数值、每周刻度；**点任意柱进入单日视图** |
| 单日视图 | 日期标题（`周四 · 2026-08-27`）+ 当日主数字 + 同口径明细 + 当日模型份额 | 与 TODAY 完全同口径（dayDetail） |
| 同步区 | 状态 A：隐私承诺 + Join CTA；状态 B：`你的全球排名 #N 前 x% / 7日Token` + 查看排名赛 → + 轻量退出 | 大按钮退场；**今日恒在全球排名之上**（Utility > Gamification） |
| footer | `更新于 HH:MM UTC` 单行 | 状态归 pill、新鲜度归 footer，隐私话术不重复 |

Joined 但排名未出 → 诚实空态（"已加入 — 完成今晚首次日级同步后显示排名"），不出假排名。

## 3. 关键契约与设计决策（为什么这么做，别推翻前先读懂）

1. **单一 markup 源**：卡片 HTML 只出自 `client/card-html.ts`（纯函数、零依赖、React 壳与预览工具共用）。改样式/结构只有一个入口。
2. **双语词典**（`client/i18n.ts`）：en/zh **键集必须一致**（双语平衡，对齐官方 locale 契约）；新增文案两份同步补。语言消费方式 = **只读 `ctx.locale.getSnapshot().active` + subscribe**，**不注册 namespace** —— 单一 markup 源自持词典，规避 (ns, locale) 单一占用与客户端模块重放冲突。`LocaleId = 'zh' | 'en'`，未知回退 en（官方 FALLBACK_LOCALE 语义）。
3. **事件绑定模式**：卡片是 HTML 字符串，交互统一走 `data-madrank-*` attr + `panel.ts` useEffect querySelector 绑定（join/leave/分段/柱点击同一模式）；range/selYmd 是 React 会话态，**不写 settings**（P2 有意跳过）。
4. **snapshot v2**（`version: 2`，新增 `history` 60 天明细）：客户端把 history 视为可选 —— v1 旧快照优雅退化为纯 7D（分段控件不出现）。注意 `store.stateVersion`(=2，投影缓存格式) 与 snapshot `version`(=2，卡片快照格式) 是**两码事**。
5. **数据类型细节**：卡片侧 `CardModelRow`（provider/model/primaryTokens/sharePct）**没有 modelKey**；stats 的 `ModelShareEntry` 有 —— 装配 history 时直接丢弃 modelKey，测试断言用 `.model`。
6. **`View race →` 链接从 settings 的 endpoint 同源派生**（`raceUrlFromEndpoint`，panel 传入 `opts.raceUrl`）；派生失败/缺席回退 `https://madrank.app/race`。
7. **全球排名的传输缝 = settings mirror**（宿主→浏览器唯一合法通道）：宿主在 settings resolve（callable）里注入 `global`——值在解析时从 `global-rank.json` 内存镜像读取，**持久化文档（base/user 层）永远不含排名**；客户端 `bind({ decode })` 显式窄化（SDK 实测：显式 decode 完全跳过 schemastery 默认校验，注入字段才过得去）。同步后宿主 `scope.update({ syncEpoch })` 触碰 raw section → revision bump → `settings/document-updated` → mirror 重读 describe → resolve 重跑（重读排名）→ `scope.subscribe` 重渲染 → 卡片实时点亮。`syncEpoch` 被 zod strip，resolve 输出永不携带。enabled=false 或换端点（`sameOrigin` 判定）注入 null → 诚实空态。

## 4. 验证体系（全绿才算完成）

```bash
cd dsh-madrank
npm test            # vitest：60 测试 / 8 文件（fold 7 · stats 9 · card-data 6 · reconcile 6 · golden 2 · card-html 20 · store-sync 8 · wiring 2）
npm run typecheck   # tsc --noEmit（严格模式 + noUncheckedIndexedAccess，索引访问用 ! 惯例）
npm run build:client # rolldown → dist/client.js（工厂信封/纯净度门禁内置）
npm run preview      # 双语 × 六状态预览页（默认吃 ~/.madrank/usage 真实 store）
npm run verify:dsh   # 兼容性五步守门
```

预览产物：`../.spike/madrank-card-preview.html`（EN/中文两行 × SYNC OFF / SYNC ON·PENDING / JOINED demo / lg 模态 / **30D** / **单日**）。历史来源优先级：**本机 usage-store（真实）→ snapshot.history → last7Days 退化**，控制台打印来源。

## 5. 本轮（2026-08-31）改动清单

| 主题 | 文件 | 要点 |
|---|---|---|
| v0.1 冻结四项修订 + 状态 B | `client/card-html.ts` | pill/footer 去重、MOST USED 去计数、cached ⓘ、Your global rank 块 |
| 双语 | `client/i18n.ts`（新）、`card-html.ts`、`panel.ts`、`client/index.ts` | locale 面消费 + 26 键 ×2 词典 + aria 本地化 |
| 空心点 | `card-html.ts` CSS | `[data-on=false]` 空心 / `[data-on=true]` 实心绿 |
| 日期标注 + 范围切换 | `stats.ts`（dayDetail/HISTORY_WINDOW_DAYS）、`card-data.ts`、`card-html.ts`、`panel.ts`、`snapshot.ts` | history 60 天贯通三条链路；30D 密排；单日视图 |
| 预览 | `tools/build-card-preview.ts` | 真实 store 历史 + 六窗格双语 |
| 测试 | `tests/stats.test.ts`(9)、`card-data.test.ts`(6)、`card-html.test.ts`(20) | dayDetail / history 端到端 / 三态渲染 / zh 回退 |

### 2026-08-31 追加（Joined 全链贯通轮）

| 主题 | 文件 | 要点 |
|---|---|---|
| 排名捕获 + 持久化 | `src/sync.ts`（onRace）、`src/global-rank.ts`（新，纯）、`src/global-rank-file.ts`（新，node） | ingest 响应 race 宽容解析；`global-rank.json` 尽力而为读写 |
| 快照接通 | `src/snapshot.ts`（v3 + global） | `buildCardSnapshot` 第 4 参；缺省 null（诚实空态不破坏旧调用） |
| 传输缝 | `src/index.ts`（resolve 注入 + touch）、`src/client/index.ts`（decode）、`src/client/panel.ts`（组装） | 见 §3 第 7 条；settings 文档语义零污染 |
| ⚠️ 协议修复 | `src/sync.ts` composeDayPayload | **wire 形状修复：models 由数组改为对象映射**（P0-2 联调抓出：数组被服务端 400 BAD_MODELS 拒绝——此前插件从未成功上传过） |
| RACE_URL 派生 | `src/client/card-html.ts`（opts.raceUrl） | self-host 支持 |
| E2E | `scripts/plugin-join-e2e.mjs`（根仓库） | CLICK→SYNC→INGEST→RANK→READ→RENDER 全链实跑 |
| 测试 | `tests/global-rank.test.ts`(10)、`card-data`(11：decode/组装优先级)、`panel-mount`(7：真实 DOM 点击路径 + 崩溃边界)、`store-sync`(9)、`card-html`(22) | 共 85 测试全绿 |
| 传输缝下沉 | `src/client/card-data.ts`（decodeSettingsSection + composeGlobalView 纯函数） | panel 变薄；优先级 fixture > settings mirror > null 有测试锁定 |
| ⚠️ 点击路径加固 | `src/client/panel.ts` useTickSource | subscribe 形状不符（宿主变体/热切换瞬间）静默跳过——effect 抛错会被 React 边界放大成整个入口卸载（「点击就没了」同款根因）；devDeps 加 happy-dom + react-dom 专供挂载回归 |

## 6. 待办与路线图（按优先级）

1. ~~**真实排名数据进入**~~ ✅ 2026-08-31 完成：sync 捕获 ingest 响应 race → `global-rank.json` → settings resolve 注入 → 状态 B/C 自动点亮。UI 零改动。
2. **Join 实机验证（余量）**：宿主链路已对真实本地栈全链跑通（`scripts/plugin-join-e2e.mjs` PASS，含幂等与坏形状静默）；剩浏览器半侧「点击 Join → ≤60s 排名点亮」在真实 DSH GUI 里点一遍确认（机制：sync 后 `touchSettingsDocument` → mirror 重读 → `scope.subscribe` 重渲染）。刷新语义实测：DSH 已在 serve 重构后 bundle（哈希一致），页面刷新即得新浏览器半侧；若 Join 后行为异常（宿主半侧仍是旧代码的迹象），按坑 6 重启 DSH 进程后复验。
3. **卫生项：fold 保留上限**（~400 天）：view 全量分日无 prune，数月后线路 payload 缓慢膨胀；独立小改动，与功能解耦。
4. ~~**RACE_URL 派生**~~ ✅ 2026-08-31 完成：`raceUrlFromEndpoint`（card-html `opts.raceUrl` + panel 从 settings endpoint 派生；`sameOrigin` 保证换端点后旧排名不串站）。
5. **P2（可选）**：范围偏好持久化（settings schema 加 `range` 字段）；当前有意用会话态。
6. **文档漂移清理**：`README.md` 的 "浏览器半侧" 节还写着 V1 形态（P1.2 早已完成）；根目录两份 v1.0 产品/设计文档未反映本轮；`HANDOFF.md` 可补本轮 §17。
7. **死 CSS**：`card-html.ts` 残留无消费者的 `madrank-pulse` keyframes（可删）。

## 7. 已知坑（本轮实测 + 继承）

**继承（详见根 `HANDOFF.md` §3–§4，接手前必读）**：

- DSH 安装在 git 之外：`~/.dsh/profiles/web/` 的 link 依赖 + cordis.patch.yml 条目，丢了插件即从 DSH 消失。
- 热更新语义：改源码/重建 `dist/client.js` → 刷新页面生效；改 patch/装依赖 → 必须重启 DSH 进程。
- 开发期 profile 依赖必须 `link:`（`file:` 会实体复制不同步）；`exports["./client"]` 是分发硬门槛。

**本轮新增：**

- 源码里 `·` 有两种形态：字面 `\u00b7` 转义（多数字符串）与字面 `·` 字符混用 —— 做精确文本替换时先读目标行实际字节。
- 测试断言 CSS 内容时必须用 `{ style: true }` 渲染（默认渲染不内联样式）。
- `tsconfig` 开了 `noUncheckedIndexedAccess`：数组索引访问一律 `?.`/`!`（仓库惯例用 `!` + 前置守卫）。
- 预览工具的 store 查找基于**传入 snapshot 的同目录**：`npm run preview`（默认路径）才吃到真实 store；显式传 fixture 路径会退化为 last7Days。
- `dist/client.js` 是构建产物（勿手改）；改 `src/client/**` 后必须 `npm run build:client`。
- **settings wire 校验的坑**：客户端 scope 默认按宿主 schemastery envelope 校验 section——宿主 resolve 注入的非 schema 字段会被判失败。必须 `bind({ decode })` 显式窄化（实测 decode 存在时 SDK 完全跳过默认校验）。
- **ingest wire 契约的唯一权威是服务端** `lib/usage/protocol.ts`：`days[].models` 是对象映射；客户端 payload 形状永远以它为准，别凭插件单测想象。
- **SDK 类方法不可裸抽取**（点击即消失真凶，2026-09-01 实锤）：`scope.subscribe` 是类方法、内部 `this.store`——`useTickSource(scope.subscribe)` 抽取后 `this` 为 undefined → 渲染崩溃 → 宿主边界卸载整个入口。必须 `useMemo(() => scope.subscribe.bind(scope), [scope])` 后再交给 hook；mock 也要做成 `this` 依赖形态（tests/panel-mount.test.ts makeScope），否则测试永远抓不住。
- **panel 层是单测/E2E 盲区**：只有 happy-dom 真实挂载（tests/panel-mount.test.ts）盖得住；卡片最外层已挂 `CardErrorBoundary`（原位渲染 [MADRank debug] 错误栈），任何回归不再无声消失——接手人别删。

## 8. 文件地图（dsh-madrank 内，卡片轨道）

| 文件 | 职责 |
|---|---|
| `src/client/card-html.ts` | **卡片唯一 markup 源**：CSS（含 lg 变体）+ 全部区块渲染（hero/模型/历史三态/同步区/单日视图）+ 纯 CSS tooltip |
| `src/client/i18n.ts` | en/zh 词典（26 键）、resolveLang、tr 插值、WEEKDAYS、fmtActive(lang) |
| `src/client/panel.ts` | React 壳：设置卡 + 侧栏入口 + 居中模态；dataTick；locale 状态；全部事件绑定 |
| `src/client/index.ts` | 客户端装配：slots 注入、inject 面（slots/locale/settingsScope/sessions）、pullFrom → dataTick |
| `src/client/card-data.ts` | sessions 投影 → CardSnapshot（today/topModels/streak/last7/**history**） |
| `src/fold.ts` | madrankUsage 投影纯数学（分日模型桶 + 活跃分段；view 全量分日） |
| `src/store.ts` | usage-store.json 持久化（按会话整体替换防漂移；aggregateDays 跨会话求和） |
| `src/stats.ts` | 展示聚合唯一数据源：todayCard/topModels/lastNDays/streak/raceMetric7d/**dayDetail**/HISTORY_WINDOW_DAYS |
| `src/snapshot.ts` | 离线卡片快照（**v2** + history 60 天） |
| `src/sync.ts` `src/index.ts` `src/settings-schema.ts` | 日级上传 + 宿主半侧装配 + settings（enabled/endpoint） |
| `tools/build-client.mjs` | rolldown 打包浏览器半侧（工厂信封 + 纯净度门禁） |
| `tools/build-card-preview.ts` | 双语六状态预览页（真实 store 历史优先） |
| `tests/` | 60 测试（形状/口径/渲染三态/双语/回退/golden 重放） |

## 9. 接手第一天的路径

1. `cd dsh-madrank && npm test && npm run typecheck`（应全绿）→ `npm run build:client` → 刷新 DSH 页面看真卡。
2. `npm run preview` 打开 `.spike/madrank-card-preview.html`，对照本文 §2 逐区块认识当前形态（EN/中文各六窗格）。
3. 改卡片：只动 `card-html.ts`（结构/样式）+ `i18n.ts`（文案，en/zh 成对）；交互进 `panel.ts` 的 data-attr 模式。
4. 读根 `HANDOFF.md` §3–§4 再碰 DSH 集成相关的东西。
5. 推进 §6 待办第 1、2 项 —— 那是卡片叙事的最后一块：`我今天用了 1.60M → 我这周用了 8.21M → 全网 #1,284`。