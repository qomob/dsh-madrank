/**
 * dsh-madrank — MADRank Usage 插件（Host 半侧入口）。
 *
 * 集成方式（cordis.yml 一行启用）：
 *   - name: '/absolute/path/to/dsh-madrank/src/index.ts'
 *   - name: 'dsh-madrank'                      # 发布为 npm 包后
 *
 * 本插件贡献：
 * 1. madrankUsage 投影单元 —— framework 驱动的纯 fold（唯一事件语义源）
 * 2. onChanged → 带去抖的本地持久化（按会话整体替换，见 store.ts）
 * 3. opt-in 日级批量同步循环（绝不实时上传，见 sync.ts）
 * 4. Settings section：enabled / autoSync / endpoint + 删除与清除命令字段
 *    （v0.2 交互规范：设置面 = CONFIGURATION，浏览器半侧渲染 settings-panel.ts；
 *    Quick View 卡片只负责「看」，配置动作全部收进设置）
 *
 * 官方文档对齐（2026-09，对齐 @deepseek-ai 0.1.1-rc.2 系）：
 * - 投影定义：官方 ProjectionDefinition 形状 `{key, stateSchema, init, apply,
 *   wire?, stateVersion}`（stateSchema 为 zod ZodType，wire.viewSchema 同）；
 *   已移除 rc.8 遗留的顶层 schema/view 双轨（wire 是唯一客户端视图声明）。
 * - 设置注册：官方 schemastery `z<T>` schema + installSettingsSection 语义
 *   （register(ns, schema, {base}) + setSource + watch + onChange + dispose 回退）；
 *   cookbook docs/cookbook/adding-a-settings-card.md 是权威。
 * - 计时：官方 timer 服务（ctx.timer.timeout/interval，fiber 绑定 disposer）；
 *   无缝环境（单测/工具链裸跑）回退全局计时器，功能不受损。
 */

import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PROJECTION_KEY, STATE_VERSION, applyEvent, buildView, initState,
} from './fold.ts'
import type { MadrankState } from './fold.ts'
import { buildCardSnapshot } from './snapshot.ts'
import type { CtxLike, ProjectionDefinitionLike } from './compat.ts'
import { UsageStore } from './store.ts'
import { deleteRemoteData, syncPendingDays } from './sync.ts'
import {
  cardGlobalFromRecord,
  recordFromRace,
  sameOrigin,
} from './global-rank.ts'
import type { GlobalRankRecord } from './global-rank.ts'
import { readGlobalRank, writeGlobalRank } from './global-rank-file.ts'
import { fetchShareToken, fetchRaceMe } from './whoami.ts'
import {
  SETTINGS_NAMESPACE,
  MadrankUsageSettingsSchema,
} from './settings-schema.ts'
import type {
  MadrankResolvedSettings,
  MadrankUsageSettings,
} from './settings-schema.ts'

export const name = 'dsh-madrank'

/** cordis DI：投影缝 + settings 服务都是硬依赖。
 * ⚠️ 加载器只挂载此处声明过的服务——未声明的服务即使 ctx.inject(['x'], cb) 也永不触发
 * （2026-09-01 实锤：settings 未声明 ⇒ 注册回调静默失效 ⇒ Join 永远无声）。
 * timer 一并声明：官方计时服务（cordis-plugin-timer 随 dsh-base 挂载），
 * start() 里经 ctx.get('timer') 使用，无缝环境回退全局计时器。 */
export const inject = ['sessionProjections', 'settings', 'timer']

// ── 设置 ────────────────────────────────────────────────────
export const SETTINGS_NS = SETTINGS_NAMESPACE

export type Settings = MadrankUsageSettings

/** 匿名安装 ID：本地生成 UUID，服务端加盐哈希后才是 anonId（README 写明换机=新身份）。 */
function resolveAnonId(): string {
  // 复用宿主环境的 crypto；本包不引入额外依赖
  return globalThis.crypto?.randomUUID?.() ?? 'unresolved-installation-id'
}

let cachedId: string | null = null
function getAnonId(): string {
  cachedId ||= readOrCreateInstallId()
  return cachedId
}

function dataDir(): string {
  return process.env.MADRANK_USAGE_DIR
    ?? join(homedir(), '.madrank', 'usage')
}

function installIdPath(): string {
  return join(dataDir(), 'installation-id')
}

// ── 分享令牌懒换(whoami;节流:每进程每小时至多尝试一次) ──────────
let whoamiInFlight = false
let whoamiLastAttempt = 0
async function ensureShareToken(endpoint: string): Promise<void> {
  const rec = storeHolder.globalRank
  if (!rec || rec.shareToken) return
  if (whoamiInFlight || Date.now() - whoamiLastAttempt < 3_600_000) return
  whoamiInFlight = true
  whoamiLastAttempt = Date.now()
  try {
    const token = await fetchShareToken(endpoint, getAnonId(), globalThis.fetch.bind(globalThis))
    if (token && storeHolder.globalRank) {
      const next: GlobalRankRecord = { ...storeHolder.globalRank, shareToken: token }
      storeHolder.globalRank = next
      try { writeGlobalRank(dataDir(), next) } catch { /* 展示数据,尽力而为 */ }
      touchSettingsDocument()
    }
  } finally {
    whoamiInFlight = false
  }
}

// 服务器权威 race 刷新(15 分钟节流):修复缓存陈旧 —— 无新日可传时 global 不更新,
// 窗口滚动后卡在旧 total(2.54M vs 4.35M 事件)。失败静默,不影响同步主链路。
let lastRaceRefresh = 0
async function refreshRaceThrottled(endpoint: string): Promise<void> {
  const rec = storeHolder.globalRank
  if (!rec?.shareToken) return
  if (Date.now() - lastRaceRefresh < 15 * 60_000) return
  lastRaceRefresh = Date.now()
  try {
    const v = await fetchRaceMe(endpoint, rec.shareToken, globalThis.fetch.bind(globalThis))
    if (!v?.me) return
    const next: GlobalRankRecord = {
      ...rec,
      rank: v.me.rank, total: v.me.total, topPct: v.me.topPct,
      participants: v.participants,
      windowStart: v.windowStart, windowEnd: v.windowEnd,
      updatedAt: Date.now(),
    }
    storeHolder.globalRank = next
    const unchanged = next.rank === rec.rank && next.total === rec.total && next.participants === rec.participants
    if (!unchanged) {
      try { writeGlobalRank(dataDir(), next) } catch { /* 尽力而为 */ }
      touchSettingsDocument()
    }
  } catch { /* 静默 */ }
}

/** 删除完成时间戳（settings mirror 注入 deletedEpoch 用；持久化跨进程）。 */
let cachedDeletedEpoch: number | null = null
function deletedEpochPath(): string {
  return join(dataDir(), 'deleted-epoch')
}
function readDeletedEpoch(): number {
  if (cachedDeletedEpoch !== null) return cachedDeletedEpoch
  try {
    cachedDeletedEpoch = parseInt(readFileSync(deletedEpochPath(), 'utf8').trim(), 10) || 0
  } catch {
    cachedDeletedEpoch = 0
  }
  return cachedDeletedEpoch
}
function writeDeletedEpoch(epoch: number): void {
  cachedDeletedEpoch = epoch
  mkdirSync(dataDir(), { recursive: true })
  writeFileSync(deletedEpochPath(), String(epoch))
}

/** 本地清除完成时间戳（settings mirror 注入 clearedEpoch 用；持久化跨进程）。 */
let cachedClearedEpoch: number | null = null
function clearedEpochPath(): string {
  return join(dataDir(), 'cleared-epoch')
}
function readClearedEpoch(): number {
  if (cachedClearedEpoch !== null) return cachedClearedEpoch
  try {
    cachedClearedEpoch = parseInt(readFileSync(clearedEpochPath(), 'utf8').trim(), 10) || 0
  } catch {
    cachedClearedEpoch = 0
  }
  return cachedClearedEpoch
}
function writeClearedEpoch(epoch: number): void {
  cachedClearedEpoch = epoch
  mkdirSync(dataDir(), { recursive: true })
  writeFileSync(clearedEpochPath(), String(epoch))
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
function readOrCreateInstallId(): string {
  try {
    mkdirSync(dataDir(), { recursive: true })
    if (existsSync(installIdPath())) {
      return readFileSync(installIdPath(), 'utf8').trim()
    }
    const id = resolveAnonId()
    writeFileSync(installIdPath(), id)
    return id
  } catch {
    return resolveAnonId()
  }
}

// ── 插件主体 ────────────────────────────────────────────────

const storeHolder: {
  store?: UsageStore
  settings: Settings
  ctx?: CtxLike
  /** 最近一次同步捕获的全球排名（global-rank.json 的内存镜像；null = 从未捕获）。 */
  globalRank: GlobalRankRecord | null
  /** rc.2 settings scope 引用：update 用于同步后触碰 raw section（点亮客户端 mirror）。 */
  settingsScope?: { update?(patch: Record<string, unknown>): void | Promise<void> }
} = {
  settings: MadrankUsageSettingsSchema({} as MadrankUsageSettings) as Settings,
  globalRank: null,
}

/**
 * 同步后触碰设置文档的合成标记字段（syncEpoch）：raw user layer 变更 →
 * revision bump → settings/document-updated → 浏览器 settings mirror 重读
 * describe → 宿主 resolve 重跑（重读排名内存镜像）→ 卡片 Joined 态实时点亮。
 * 该字段被 schemastery strip，永不出现在 resolve 输出；只读 provider / memory 模式下
 * update 会抛错——静默退化到下一次连接刷新，功能不受损。
 */
function touchSettingsDocument(): void {
  try {
    void storeHolder.settingsScope?.update?.({ syncEpoch: Date.now() })
  } catch {
    // isolated：触碰失败只影响点亮时机
  }
}

/** 活设置来源：attach 前读默认值，attach 后由 setSource 换成宿主解析 thunk。 */
let settingsSource: () => Settings = () => storeHolder.settings

/**
 * resolve 出口 schema：官方 schemastery transform —— schema(merged) 时把
 * 「同步链路捕获的全球排名 + 删除/清除完成时间戳」作为镜像字段注入解析值。
 * 与旧 zod-callable 适配器行为等价，但 schema 是官方可调用 + toJSON 对象，
 * 手写 uid/refs toJSON 图整个消失。注入字段不进持久化文档。
 */
const resolveSettingsSchema = z.transform(
  MadrankUsageSettingsSchema as z<MadrankUsageSettings>,
  (value): MadrankResolvedSettings => {
    const parsed = value as MadrankUsageSettings
    const rec = storeHolder.globalRank
    const global = parsed.enabled && rec && sameOrigin(rec.endpoint, parsed.endpoint)
      ? cardGlobalFromRecord(rec)
      : null
    return {
      ...parsed,
      global,
      deletedEpoch: readDeletedEpoch(),
      clearedEpoch: readClearedEpoch(),
    }
  },
)

/**
 * 投影定义：官方 ProjectionDefinition 形状（stateSchema 为 zod ZodType +
 * wire 客户端视图）。无 rc.8 遗留字段。stateSchema 校验持久化折叠种子；
 * wire.viewSchema 校验出宿主值 —— 官方类型来自 'zod'（与 settings 的 schemastery 分工）。
 */
function buildViewSchema() {
  const daySchema = zod.object({
    models: zod.record(zod.string(), zod.object({
      inputTokens: zod.number().int().nonnegative(),
      outputTokens: zod.number().int().nonnegative(),
      cacheReadTokens: zod.number().int().nonnegative(),
      cacheWriteTokens: zod.number().int().nonnegative(),
      requests: zod.number().int().nonnegative(),
    })),
    activeSeconds: zod.number().int().nonnegative(),
  })
  return zod.object({
    version: zod.literal(STATE_VERSION),
    days: zod.record(zod.string(), daySchema),
    totalRequests: zod.number().int().nonnegative(),
    totalPrimaryTokens: zod.number().int().nonnegative(),
    totalCachedTokens: zod.number().int().nonnegative(),
  })
}

/** 持久化状态（MadrankState）在 seed/restore 前必须通过 stateSchema（zod）。 */
function buildStateSchema() {
  const buckets = zod.object({
    inputTokens: zod.number(),
    outputTokens: zod.number(),
    cacheReadTokens: zod.number(),
    cacheWriteTokens: zod.number(),
    requests: zod.number(),
  })
  return zod.object({
    currentModelKey: zod.string().nullable(),
    days: zod.record(zod.string(), zod.record(zod.string(), buckets)),
    activity: zod.record(zod.string(), zod.array(zod.tuple([zod.number(), zod.number()]))),
    last: zod.object({
      turn: zod.number(),
      step: zod.number(),
      ymd: zod.string(),
      modelKey: zod.string(),
      buckets,
    }).nullable(),
  })
}

function buildDefinition(): ProjectionDefinitionLike {
  const viewSchema = buildViewSchema()
  const stateSchema = buildStateSchema()
  return {
    key: PROJECTION_KEY,
    stateSchema: stateSchema as unknown as ProjectionDefinitionLike['stateSchema'],
    init: () => initState(),
    apply: ((state: MadrankState, event: Parameters<typeof applyEvent>[1]) =>
      applyEvent(state, event)) as never,
    wire: {
      viewSchema: viewSchema as unknown as NonNullable<ProjectionDefinitionLike['wire']>['viewSchema'],
      view: ((state: MadrankState) => buildView(state)) as never,
    },
    stateVersion: STATE_VERSION,
  }
}

export function apply(ctx: CtxLike & Record<string, unknown>): void {
  const log = ctx.logger ?? {
    info: (m: string) => console.info('[madrank]', m),
    warn: (m: string) => console.warn('[madrank]', m),
    error: (m: string) => console.error('[madrank]', m),
  }
  // 投影缝获取：直取（大多数 boot 时序下可用）→ 缺席时降级 ctx.inject 等待
  // （官方 README 的消费模式：可选能力经 ctx.inject(['sessionProjections'], …)
  // 注册，无注册表的 headless 组装完全不受影响）。
  const registry = (ctx as { sessionProjections?: import('./compat.ts').ProjectionRegistryLike })
    .sessionProjections
  if (registry && typeof registry.register === 'function') {
    try {
      start(registry, ctx, log)
    } catch (e) {
      log.error('start threw — host half partially applied', e)
      throw e
    }
    // settings 声明必须在 apply 顶层：嵌套进 inject 回调里的子 fiber 会被回收，
    // 注册回调永不触发（2026-09-01 实锤）；且 cordis 已把声明的服务直接挂上 ctx。
    declareSettingsSection(ctx, log)
    return
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionProjections'], (sctx) => {
      const reg = (sctx as { sessionProjections?: import('./compat.ts').ProjectionRegistryLike })
        ?.sessionProjections
      if (reg && typeof reg.register === 'function') {
        start(reg, ctx, log)
      } else {
        log.warn('sessionProjections service unusable even via inject — plugin idle')
      }
    })
  } else {
    // 无缝环境（单元测试 / 工具链裸跑）：功能不可用但绝不让宿主崩溃
    log.warn('sessionProjections seam absent — plugin idle')
  }
}

/** 官方 timer 服务优先（可选能力，经 ctx.get('timer') 读取——不声明 inject，
 * Guard 绝不会因读取未声明属性抛错）；无缝环境（测试/裸跑）回退全局计时器，
 * disposer 同形（返回清理函数）。 */
function timerOf(ctx: CtxLike): {
  timeout(cb: () => void, delay: number): () => void
  interval(cb: () => void, delay: number): () => void
} {
  const get = (ctx as { get?: (key: string) => unknown }).get
  const t = (typeof get === 'function' ? get('timer') : undefined) as
    import('./compat.ts').TimerLike | undefined
  const timer = t ?? (ctx as { timer?: import('./compat.ts').TimerLike }).timer
  if (timer && typeof timer.timeout === 'function' && typeof timer.interval === 'function') {
    return { timeout: (cb, d) => timer.timeout(cb, d), interval: (cb, d) => timer.interval(cb, d) }
  }
  return {
    timeout(cb, delay) {
      const handle = setTimeout(cb, delay)
      handle.unref?.()
      return () => clearTimeout(handle)
    },
    interval(cb, delay) {
      const handle = setInterval(cb, delay)
      handle.unref?.()
      return () => clearInterval(handle)
    },
  }
}

function start(
  registry: import('./compat.ts').ProjectionRegistryLike,
  ctx: CtxLike & Record<string, unknown>,
  log: { info(m: string): void; warn(m: string, ...rest: unknown[]): void; error(m: string, ...rest: unknown[]): void },
): void {
  const store = new UsageStore(dataDir(), STATE_VERSION)
  storeHolder.store = store
  storeHolder.ctx = ctx
  // 排名记录是跨进程持久化的（上次同步的采集结果）——启动即载入内存镜像
  storeHolder.globalRank = readGlobalRank(dataDir())

  // 1) 注册 madrankUsage 单元（framework 拥有订阅与驱动，我们只交数学）。
  const definition = buildDefinition()
  const disposeRegister = registry.register(definition)
  log.info('madrankUsage projection registered')

  // 2) 变更流 → 去抖落盘（节流 2s；只做"整体替换该会话份额"这一件事）
  const timer = timerOf(ctx)
  let pending = false
  const flushSoon = () => {
    if (pending) return
    pending = true
    timer.timeout(() => {
      pending = false
      try {
        store.flush()
        writeFileSync(
          join(dataDir(), 'card-snapshot.json'),
          JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), cardGlobalFromRecord(storeHolder.globalRank))),
        )
      } catch (e) { log.warn('flush failed', e) }
    }, 2000)
  }

  const disposeListener = registry.onChanged((session, key, value, seq) => {
    if (key !== PROJECTION_KEY || !value) return
    try {
      store.replaceSession(session.id, seq, value as Parameters<typeof store.replaceSession>[2])
      flushSoon()
    } catch (e) {
      log.warn('replaceSession failed', e)
    }
  })

  // 3) opt-in 日级批量同步检查（≤1 次/分钟；只碰已结束的 UTC 日）
  const tick = () => {
    const s = settingsSource()
    // 3a) 删除通道（隐私审计缺口 #4）：独立于 enabled——退出排名后仍可删。
    // 成功后清排名镜像 + 记 deletedEpoch + 回写 deleteRequested=0（raw 层触碰
    // → mirror revision bump → 卡片立即显示完成态）。失败静默保留标志，下轮重试
    // （服务端幂等）。语义：只删远端；已上传标记保留，旧数据不会自动重传。
    const delReq = typeof s.deleteRequested === 'number' ? s.deleteRequested : 0
    if (delReq > 0 && s.endpoint) {
      void deleteRemoteData(s.endpoint, getAnonId, globalThis.fetch.bind(globalThis))
        .then((ok) => {
          if (!ok) return
          storeHolder.globalRank = null
          try { writeDeletedEpoch(Date.now()) } catch { /* 内存态兜底 */ }
          void Promise.resolve(storeHolder.settingsScope?.update?.({ deleteRequested: 0 }))
            .catch(() => {})
          touchSettingsDocument()
          log.info('remote usage data deleted per user request')
        })
        .catch(() => undefined)
      return // 删除轮不与同步轮混跑
    }
    // 3b) 清除本地数据通道（v0.2 设置面板「本地数据」块）：只清本机统计份额。
    // 保留 uploadedDays —— 已上传的日子不因本地清除而重传；远端排名数据走
    // 删除通道（3a），「清本地」与「删远端」语义严格分离。独立于 enabled。
    // 完成后：记 clearedEpoch + 回写 clearLocalRequested=0（raw 层触碰 → mirror
    // revision bump → 设置面板立即显示完成态）。
    const clrReq = typeof s.clearLocalRequested === 'number' ? s.clearLocalRequested : 0
    if (clrReq > 0 && storeHolder.store) {
      try {
        storeHolder.store.clearLocalStats()
        writeFileSync(
          join(dataDir(), 'card-snapshot.json'),
          JSON.stringify(buildCardSnapshot(storeHolder.store, getAnonId, Date.now(), cardGlobalFromRecord(storeHolder.globalRank))),
        )
        writeClearedEpoch(Date.now())
        void Promise.resolve(storeHolder.settingsScope?.update?.({ clearLocalRequested: 0 }))
          .catch(() => {})
        touchSettingsDocument()
        log.info('local usage records cleared per user request')
      } catch (e) {
        log.warn('clear-local failed — flag kept for retry', e)
      }
      return
    }
    // 同步轮门控（v0.2）：参与排名（enabled）+ 自动同步（autoSync）双开关，
    // 缺一不发 —— 设置面板的「自动同步」不是装饰，是真门。
    if (!s.enabled || s.autoSync === false || !s.endpoint || !storeHolder.store) return
    // 分享令牌懒换(每进程每小时至多一次;失败静默,绝不影响同步)
    void ensureShareToken(s.endpoint)
    // 服务器权威 race 刷新(15 分钟节流;缓存陈旧修复)
    void refreshRaceThrottled(s.endpoint)
    void syncPendingDays(store, s, getAnonId, globalThis.fetch.bind(globalThis), (race) => {
      // ingest 响应携带按本机 anonId 重算的 7 日名次：持久化 + 内存镜像 +
      // 触碰设置文档 → Joined 卡片实时点亮（P0-1 / P0-2 的最后一环）。
      const rec = recordFromRace(race, s.endpoint, Date.now())
      if (!rec) return
      const prev = storeHolder.globalRank
      // 保留已换得的分享令牌:recordFromRace 重建的 record 不带它,
      // 不保留会导致名次一变按钮就消失(whoami 节流 1/h 内不自愈)
      if (prev?.shareToken) rec.shareToken = prev.shareToken
      if (prev !== null
        && prev.rank === rec.rank && prev.total === rec.total
        && prev.participants === rec.participants && prev.endpoint === rec.endpoint) {
        return // 名次未变（含同端点）：不落盘、不触碰文档，避免设置 revision 空转
      }
      storeHolder.globalRank = rec
      try {
        writeGlobalRank(dataDir(), rec)
      } catch (e) {
        log.warn('global-rank write failed — keep in-memory mirror', e)
      }
      touchSettingsDocument()
      void ensureShareToken(s.endpoint)
    })
      .then((outcomes) => {
        if (outcomes.length > 0) store.flush()
      })
      .catch(() => undefined) // 同步永不影响宿主（含 onRace 回调内抛错）
  }
  const disposeTick = timer.interval(tick, 60_000)

  log.info('host half applied — projection on, sync tick 60s, global mirror ' + (storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'empty'))

  // 清理：挂宿主生命周期事件；cordis 卸载插件时自动触发
  const onDispose = (ctx as { on?: (ev: string, cb: () => void) => void }).on
  if (typeof onDispose === 'function') {
    onDispose.call(ctx, 'dispose', () => {
      disposeTick()
      disposeListener()
      disposeRegister()
      try { store.flush() } catch { /* ignore */ }
    })
  }
}

/**
 * Settings section 声明（官方 installSettingsSection 语义，2026-09-01 定案）：
 * 必须在 apply「顶层」消费 settings——cordis 按插件导出的 inject 数组把声明过的服务
 * 直接挂上 ctx（ctx.settings），顶层 ctx.inject 的回调也会正常触发；
 * 嵌套在其他 inject 回调里再 inject 的子 fiber 会被回收，注册静默失效。
 * 语义与 @deepseek-ai/dsh-settings 的 installSettingsSection(ctx, ns, schema,
 * entry, hooks) 同构：register(ns, schema, {base: entry}) → setSource 指向
 * scope.get() → onChange 在 attach 即触发一次 → scope.watch 变更再触发 →
 * dispose 时 setSource 回退 entry（服务卸载后按组合配置继续工作）。
 * resolve 输出注入全球排名——settings mirror 是宿主→浏览器的唯一合法数据缝：
 * 排名不写回 usage 投影（HANDOFF 冻结约束），只在 describe 答案中出现。
 */
function declareSettingsSection(ctx: CtxLike & Record<string, unknown>, log: { info(m: string): void; warn(m: string, ...rest: unknown[]): void }): void {
  try {
    const hooks = {
      setSource: (get: () => Settings) => { settingsSource = get },
      onChange: () => { /* 下一个 tick 生效 */ },
    }
    const registerWith = (provider: { register?: (ns: never, schema: never, opts: never) => unknown }): void => {
      if (typeof provider.register !== 'function') return
      const scope = provider.register(
        SETTINGS_NS as never,
        resolveSettingsSchema as never,
        { base: { ...storeHolder.settings } } as never,
      ) as unknown as {
        get(): Settings
        watch(cb: () => void): () => void
        update?(patch: Record<string, unknown>): void | Promise<void>
      }
      storeHolder.settingsScope = typeof scope.update === 'function' ? scope : undefined
      hooks.setSource(() => scope.get())
      hooks.onChange()
      scope.watch(() => { /* 设置变更 → 下一个 tick 生效 */ })
      // 启动证据行：宿主终端（ttys）出现这一行 = settings 注册成功
      log.info('settings ns registered: ' + SETTINGS_NS + ' — Join 可用')
    }
    // ⚠️ 绝不能先探测 ctx.installSettingsSection（rc.8 遗痕）：cordis 插件 ctx 禁止读取
    // 未在 inject 数组声明过的属性，读取即抛 'cannot get property ... without inject'，
    // settings 注册因此整体静默失效（2026-09-01 总根因）。只走已声明的 ctx.settings。
    const direct = (ctx as { settings?: { register?: (ns: never, schema: never, opts: never) => unknown } }).settings
    // 插件 ctx 的服务可能被加载器按 entry 隔离（我们拿到的 provider 与 web app / describe
    // 所用的根作用域实例不同）→ 注册必须落进根上下文的 provider，客户端才看得见。
    const rootCtx = (ctx as unknown as { root?: { settings?: typeof direct } }).root
    const rootSettings = rootCtx?.settings
    const provider0 = rootSettings && typeof rootSettings.register === 'function' ? rootSettings : direct
    if (provider0 && typeof provider0.register === 'function') {
      registerWith(provider0)
    } else if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (sctx) => {
        const provider = (sctx as { settings?: typeof direct } | undefined)?.settings
        if (!provider || typeof provider.register !== 'function') {
          // 绝不静默：注册形状不符 = Join 永远无声失效
          log.warn('settings service shape unexpected — madrank-usage NOT registered')
          return
        }
        registerWith(provider)
      })
    } else {
      log.warn('settings seam absent — running with defaults (sync off)')
    }
  } catch (e) {
    log.warn('settings declare failed — sync stays off', e)
  }
}