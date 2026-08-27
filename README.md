# dsh-madrank

> **MADRank Usage** — Track your AI usage. See how you rank.
>
> **v0.1 — Local Usage**（当前阶段：P1）


DeepSeek Harness 插件：把本机 AI 用量变成私人仪表盘 + 可选的匿名全球排名
（7-Day Token Race）。这是 **MADRank Usage Network 的第一个客户端节点**。

## 硬约束（实现层承诺）

1. 只注册 ProjectionDefinition，不出现第二套事件订阅 —— 事件语义唯一来源是 framework。
2. DSH session log 是 Source of Truth；本地 `usage-store.json` 是可删除可重建的投影缓存。
3. usage 替换语义与 `@deepseek-ai/dsh-token-meter` 同构：同一 `(turn, step)` 不双计。
4. 全球同步默认关闭、opt-in，且只上传【已结束 UTC 日】的天级聚合；实时上传在代码路径上不存在。
5. 全球榜定性为 Community Usage Ranking：服务端校验（日上限/模型白名单/合理性/速率），不是精确排名。

## 架构

```
DSH session log（Source of Truth）
      ↓  framework 驱动
madrankUsage 投影（纯 fold：src/fold.ts）
      ↓  onChanged 变更流
UsageStore（按会话整体替换 → 防漂移；src/store.ts）
      ↓  日级批处理（opt-in）
MADRank /api/usage/ingest（src/sync.ts）
```

## 接入 DSH（宿主侧）

方式 A — 本地路径试用：

```yaml
# cordis.yml 增加一行
- name: '/absolute/path/to/dsh-madrank/src/index.ts'
```

方式 B — 发布为 npm 包后：

```yaml
- name: 'dsh-madrank'
```

依赖缝：`sessionProjections`（硬）、settings（软，缺席时以默认值离线运行）。
数据目录：`$MADRANK_USAGE_DIR` 或 `~/.madrank/usage/`。

无 DOM 副作用；插件卸载经 ctx dispose 自动回收 timer/listener/register。

## 浏览器半侧（Settings 卡片）

按 cookbook 范式实现在 `src/client/index.ts`（slots 注入 `settings.plugin.item`，
namespace `madrank-usage`）。启用卡片需要把本包纳入 DSH 客户端模块系统构建：
包内已声明 `"dsh": { "client": { "platform": "web" } }`。
V1 卡片 = SYNC 开关 + Privacy Center + anonId 尾号；
TODAY/MODELS/RANK 实时数字接 apiproxy 投影读面为 P1 任务。

## 已知限制（诚实清单）

- **浏览器半侧尚未真机装载**：loader spike 只验证了 Host 半侧生命周期；
  slots/settingsScope/panels 的真实渲染要在 Field Test 首日验证。
  特别注意：`slots.register(cfg, component)` 的 component 形参按 slot-catalog
  范例应是 React 组件（React.createElement 构树），我们传入的是空对象 +
  自建 DOM —— 在 React 渲染管线中可能不显示，若如此则改为最小 React 包装
  （唯一允许的 Frost 期修补：只修显示，不加功能）。
- **面板放置候选已调研**（未实施，等 Field Test 信号）：
  **方案 A = `sidebar.footer.action`**（list 槽、replaceRisk: none，
  官方语义就是"侧栏脚部 Settings 旁边的可选动作"；fresh id 并列追加，
  支持 order 排序与 label，owner 给 `wide` 布尔须适配 56px 收窄栏）。
  备选：`conversation.session.header.utilities`（头部徽章）、
  `shell.overlay`（浮层 pill）。不可取：`sidebar`/`sidebar.settings`/
  `sidebar.workspaces`/`details` —— 全是 single 已占用槽，注册即 shadow 官方 UI。

- 模型归因取最近一次 `request/header`（epoch 快照）；同 turn 内 waterfall 换模
  在日志上是新 header —— 归因切换点即 header 切换点，无法更细。
- 匿名 ID 是本机安装 UUID，服务端加盐；换机 = 新身份（未来 optional linking）。
- 缓存写入（cacheWrite）在上报口径并入 input 侧；cacheRead 单列。

## DSH 升级兼容性

```bash
npm run verify:dsh          # 五步守门，人读报告（--json 机器可读）
npm run reconcile:fixture   # 仅黄金回放框图
```

矩阵与历史见 [COMPATIBILITY.md](./COMPATIBILITY.md)；脱敏黄金回放 `tests/fixtures/real-world/` 是 token-meter 语义的 CI 常驻报警器。

## 开发

```bash
npm install
npm test        # vitest：fold 语义 + store 防漂移 + sync 隐私约束
npm run typecheck
```

# Non-Negotiable Architecture Rules

1. Never fork DSH.
2. Never read internal SQLite / state DB directly —— 采集只走 Projection。
3. Never duplicate token-meter semantics —— 一致性由对账证明（见下）。
4. Never listen to session/event independently —— 状态机只有 framework 一个驱动者。
5. Never upload same-day usage —— 全球同步只传已结束的 UTC 日。
6. Never upload prompts / responses / tool arguments。
7. Never let global sync block local usage —— 同步失败不影响本地统计。

`src/compat.ts` 是与 DSH 的唯一耦合面。

## 真实流量对账（P1.1，已完成一次 ✓）

2026-08-27 对本机真实 DSH 会话（`~/.dsh/sessions/…madrank…/session.jsonl.zstd`，
71,590 events / 474 usage-bearing）跑通：

```
│ bucket       madrank    reference   diff │
│ input        745,120      745,120     = │
│ output       186,324      186,324     = │
│ cache read  26,352,384   26,352,384    = │
│ cache write          0            0     = │
│                  MATCH ✓
```

覆盖：流式替换、waterfall 工具流量、跨午夜分桶。以后每次 DSH 升级重跑一遍，
即为 token-meter 兼容性报警器。

## 数据口径（锁定）

- **Primary Tokens**（一切展示与排名的主数字）= uncached input + output —— `src/caliber.ts` 唯一定义
- 缓存（cacheRead/cacheWrite）永远单列，UI 显示为 "+N cached"，绝不混入主数字
- 全球榜竞赛指标（P2 起）：**7-Day Uncached Tokens**
- 活跃时长为分段合并的保守下界估计（5 分钟内的相邻样本并为一段）

## P1 状态

- ✅ **P1-A 数据对账**：Golden Cases A–E（普通/缓存/同 step 替换/跨午夜/失败请求）
  以 token-meter 参照折叠器逐桶对账（`tests/reconcile.test.ts`）；
  真实流量复核用 `npm run reconcile -- <events.jsonl>`，PASS 后数据层冻结。
- ✅ **P1-B 本地体验**：7 日历史 / Top4 模型 / streak / vs-7d-avg（`src/stats.ts`）；
  Settings 卡片三模块 TODAY/MODELS/RANK + Join the race 流程，无网络完整可用。
- ⏳ **P1-C 全球同步**：协议已就绪（日批、(anonId,date) 幂等），待 MADRank Cloud ingest 上线。

## 卡片数据路径（P1.2，官方缝隙，零服务端改动 ✅）

浏览器半侧 inject `sessions`（ISessions 标准 feed）：每行 SessionSummary 的
`projectionValues['madrankUsage']` 就是宿主折算好的投影 view ——
session.list 基线 + 实时推送，这正是 `packages/client/runtime` 的 useProjection 座位。

- 跨会话求和 = 机器级 TODAY（会话日志互不相交，直接相加无重复）——
  实现：`src/client/card-data.ts`（纯函数，6 个单测锁定口径）
- 口径全部复用 src/stats.ts / caliber.ts；bundle 纯净度门禁合规
  （type-only 镜像运行时契约，不 value-import 任何 DSH 包）
- `window.__MADRANK_CARD_DATA__` 降级为 fixture 覆盖口（单测/调试）
- Host 侧 flush 时写 `$MADRANK_USAGE_DIR/card-snapshot.json` 与
  `npm run preview` 预览页保留为调试/导出工具

调研结论备忘：apiproxy 是封闭域集合（sessions/settings/events/…），插件不注册
自定义 RPC；第三方数据进页面的正解就是投影 feed —— 我们天然长在它上面。

## 文件地图

- src/compat.ts — 与 DSH 的唯一耦合面（结构化镜像已核实的契约，含源码路径注释）
- src/fold.ts   — madrankUsage 投影纯数学（事件→状态→view）
- src/caliber.ts — 数据口径唯一来源（Primary/Cached/RACE_METRIC_NAME/活跃合并参数）
- src/fold.ts   — madrankUsage 投影纯数学（事件→状态→view；v2 含活跃时长）
- src/stats.ts  — 展示层聚合（todayCard/topModels/streak/raceMetric7d）
- src/store.ts  — 本机缓存（会话切片整体替换 / 版本失效 / wipe）
- src/sync.ts   — 日级批量上传（只传昨日及更早；失败退避重试）
- src/index.ts  — apply(ctx)：注册 + 落盘节流 + 定时同步 + settings
- src/client/   — 浏览器半侧 Settings 卡片 v1（TODAY/MODELS/RANK/SYNC）
- src/snapshot.ts               — CardSnapshot 装配（store→卡片形状；flush 时同写 card-snapshot.json）
- tools/reference-token-meter.ts — DSH token-meter 参照折叠器（对账基准）
- tools/dsh-log-adapter.ts       — 真实日志解码器（复用 DSH zstd/scanLog；隐私裁剪只留 usage 字段）
- tools/reconcile-cli.ts         — 双折叠比对 CLI（框图 + --json 机器 diff；exit code 可接 CI）
- tools/build-card-preview.ts    — 用真实快照渲染卡片预览页（与客户端共用同一 markup 源）
- tests/        — vitest 单元测试（30 例，含 Golden Cases 对账）

MADRank 主产品文档见仓库根目录：《MADRank_Production_v1.0_产品技术实现文档.md》。