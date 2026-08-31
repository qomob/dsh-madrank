# dsh-madrank 卡片交接文档（Usage 插件轨道）

> 生成于 2026-08-31 · 基于 dsh-madrank 子包当前代码实态，全部结论有测试/构建证据。
> 阅读顺序：根目录 `HANDOVER.md`（主产品全景）→ 本文（卡片轨道）→ `README.md`（接入与口径）→
> `HANDOFF.md` §3–§4（DSH 集成步骤与血泪坑，接手前必读）。
> 主应用（Next.js 站点）不在本文范围。

---

## 0. 一页速览

- **是什么**：DeepSeek Harness 插件 —— 本机 AI 用量私人卡片（DSH 设置页 + 左侧栏弹窗）+ Usage Network 第一个客户端节点。
- **当前阶段**：卡片 v0.1 冻结后的增强轮已完成：中英双语（跟随宿主语言）、状态 A/B（Local / Joined）、7D·30D·单日历史切换、空心点状态语法。
- **验证状态**：**60 测试全绿**（8 文件）/ `tsc --noEmit` 绿 / `dist/client.js` 已重建（49.7KB，工厂信封门禁通过）/ 双语预览已用本机真实 60 天历史渲染验证。
- **真实数据现状**：本机 `~/.madrank/usage/usage-store.json` 已有真实分日历史（含 2026-08-31 当日 133K tokens）；**全球排名 `global` 恒 null**（诚实空态），等 Usage Network 真实数据进入后 State B 自动点亮，**无需改 UI**。
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
6. **`View race →` 指向硬编码 `https://madrank.app/race`**（与 endpoint 默认同源）；self-host 场景应改为从 endpoint 派生 origin —— 见 §6 待办。

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

## 6. 待办与路线图（按优先级）

1. **真实排名数据进入**（无 UI 工作）：宿主侧把 `snap.global` 从恒 null 接上 `/race` 真实返回 → 状态 B 自动点亮。UI 已就绪并测试锁定。
2. **Join 真实协议联调**：`scope.set('enabled', true)` → host sync 全链路已在代码上就绪，需对真实 ingest 跑一次端到端。
3. **卫生项：fold 保留上限**（~400 天）：view 全量分日无 prune，数月后线路 payload 缓慢膨胀；独立小改动，与功能解耦。
4. **RACE_URL 派生**：从 endpoint origin 派生，支持 self-host。
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