/**
 * dsh-madrank — MADRank Usage 插件（Host 半侧入口，新版 Harness 插件模型）。
 *
 * 集成方式（bundle 的 cordis.patch.yml 插入行）：
 *   - insert:
 *       - id: madrank
 *         name: '@qomob/dsh-madrank'
 * 入口：dist/host/index.js（编译产物；源码 src/index.ts 仅供开发/类型检查）。
 *
 * 本插件贡献：
 * 1. madrankUsage 投影单元 —— framework 驱动的纯 fold（唯一事件语义源）
 * 2. onChanged → 带去抖的本地持久化（按会话整体替换，见 store.ts）
 * 3. opt-in 日级批量同步循环（绝不实时上传，见 sync.ts）
 * 4. Config：enabled / endpoint / autoSync（volatile，设置页可热更新）
 *
 * 新版契约要点（DSH 0.2.x）：
 * - 插件不再注册设置命名空间；配置由导出的 schemastery `Config` 描述，
 *   用户经 Settings → 插件页编辑 volatile 字段，值写入 profile patch 并热更新。
 * - 投影定义仍是 `{key, stateSchema, init, apply, wire?, stateVersion}`。
 * - 计时优先官方 timer 服务；无缝环境（单测/裸跑）回退全局计时器。
 */

import { z as zod } from 'zod'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  PROJECTION_KEY, STATE_VERSION, applyEvent, buildView, initState,
} from './fold.ts'
import type { MadrankState } from './fold.ts'
import { buildCardSnapshot } from './snapshot.ts'
import type {
  CtxLike, ProjectionDefinitionLike, ProjectionHandleLike, ProjectionRegisterResult, ProjectionRegistryLike,
} from './compat.ts'
import { UsageStore } from './store.ts'
import { syncPendingDays } from './sync.ts'
import { cardGlobalFromRecord, recordFromRace } from './global-rank.ts'
import type { GlobalRankRecord } from './global-rank.ts'
import { readGlobalRank, writeGlobalRank } from './global-rank-file.ts'
import { fetchShareToken, fetchRaceMe } from './whoami.ts'
import { Config, MADRANK_ENTRY_ID, readSettings } from './settings-schema.ts'
import { debugLog } from './debug-log.ts'
import { RANK_PROJECTION_KEY, buildRankDefinition } from './rank-projection.ts'
import type { CardGlobal } from './global-rank.ts'
import type { MadrankUsageSettings } from './settings-schema.ts'

export { Config }

export const name = 'dsh-madrank'

/** 相对配置的 API 兼容导出（旧版本消费方/工具可能读取）。 */
export const SETTINGS_NS = MADRANK_ENTRY_ID

export type Settings = MadrankUsageSettings

/** cordis DI：投影缝 + 官方 timer 服务。
 * ⚠️ 加载器只挂载此处声明过的服务；timer 随 dsh-base 挂载，
 * 读取经 ctx.get('timer')，无缝环境回退全局计时器。 */
export const inject = ['sessionProjections', 'timer']

// ── 身份与存储 ──────────────────────────────────────────────

/** 匿名安装 ID：本地生成 UUID，服务端加盐哈希后才是 anonId（换机=新身份）。 */
function resolveAnonId(): string {
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

// ── 分享令牌懒换(whoami;节流:每进程每小时至多一次) ──────────
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
      setGlobalRank(next)
      try { writeGlobalRank(dataDir(), next) } catch { /* 展示数据,尽力而为 */ }
    }
  } finally {
    whoamiInFlight = false
  }
}

// 服务器权威 race 刷新(15 分钟节流):修复缓存陈旧。失败静默,不影响同步主链路。
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
    setGlobalRank(next)
    const unchanged = next.rank === rec.rank && next.total === rec.total && next.participants === rec.participants
    if (!unchanged) {
      try { writeGlobalRank(dataDir(), next) } catch { /* 尽力而为 */ }
    }
  } catch { /* 静默 */ }
}

// ── 插件主体 ────────────────────────────────────────────────

const storeHolder: {
  store?: UsageStore
  /** 最近一次同步捕获的全球排名（global-rank.json 的内存镜像；null = 从未捕获）。 */
  globalRank: GlobalRankRecord | null
  /** 排名投影的缓存引用：仅在记录变化时替换，避免每次事件触发客户端重渲染。 */
  globalView: CardGlobal | null
} = {
  globalRank: null,
  globalView: null,
}

/** 统一更新排名镜像 + 客户端投影引用（同源同引用）。 */
function setGlobalRank(rec: GlobalRankRecord | null): void {
  const prev = storeHolder.globalRank
  storeHolder.globalRank = rec
  storeHolder.globalView = rec === null ? null : cardGlobalFromRecord(rec)
  if (rec?.rank !== prev?.rank || rec?.total !== prev?.total || rec?.shareToken !== prev?.shareToken) {
    debugLog(dataDir(), `rank mirror updated rank=${rec?.rank ?? 'none'} total=${rec?.total ?? 0}`)
  }
}

/**
 * 投影定义：官方 ProjectionDefinition 形状（stateSchema 为 zod ZodType +
 * wire 客户端视图）。无 rc.8 遗留字段。stateSchema 校验持久化折叠种子；
 * wire.viewSchema 校验出宿主值 —— 官方类型来自 'zod'。
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
    // 排名镜像随 usage 视图一起下发（客户端列表已证明可达的通道）
    global: zod.object({
      rank: zod.number(),
      topPct: zod.number(),
      race7d: zod.number(),
      participants: zod.number().optional(),
      updatedAt: zod.number().optional(),
      shareToken: zod.string().optional(),
    }).nullable(),
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
  // view 缓存：framework 只在 state 引用变化时调用 view；这里再按 (state, global) 复用同一
  // 引用，避免同样的数据因 global 重新包装而重复发布。排名镜像变化才换引用。
  let lastState: MadrankState | null = null
  let lastGlobal: CardGlobal | null = null
  let lastView: unknown = null
  const view = (state: MadrankState): unknown => {
    const global = storeHolder.globalView
    if (state === lastState && global === lastGlobal) return lastView
    lastState = state
    lastGlobal = global
    lastView = { ...buildView(state), global }
    return lastView
  }
  return {
    key: PROJECTION_KEY,
    stateSchema: stateSchema as unknown as ProjectionDefinitionLike['stateSchema'],
    init: () => initState(),
    apply: ((state: MadrankState, event: Parameters<typeof applyEvent>[1]) =>
      applyEvent(state, event)) as never,
    wire: {
      viewSchema: viewSchema as unknown as NonNullable<ProjectionDefinitionLike['wire']>['viewSchema'],
      // wire.summary 保持默认 true：客户端当前只能经 session 列表的 projectionValues 读取
      // （slot 标准 props 只提供 useSessions）；关闭 summary 会切断唯一读通道，
      // 若要改成按需 snapshot 读面，届时再切 false。
      view: view as never,
    },
    stateVersion: STATE_VERSION,
  }
}

export function apply(ctx: CtxLike & Record<string, unknown>, config?: unknown): void {
  debugLog(dataDir(), `apply v0.5.12 config=${JSON.stringify(readSettings(config))}`)
  const log = ctx.logger ?? {
    info: (m: string) => console.info('[madrank]', m),
    warn: (m: string, ...rest: unknown[]) => console.warn('[madrank]', m, ...rest),
    error: (m: string, ...rest: unknown[]) => console.error('[madrank]', m, ...rest),
  }
  // 投影缝获取：直取（大多数 boot 时序下可用）→ 缺席时降级 ctx.inject 等待。
  const registry = (ctx as { sessionProjections?: ProjectionRegistryLike })
    .sessionProjections
  if (registry && typeof registry.register === 'function') {
    // 0.2.x 契约：register 是异步的，必须 await 后才发布消费者（onChanged / timer / 落盘）。
    void start(registry, ctx, log, config).catch((e) => {
      log.error('start failed — host half partially applied', e)
    })
    return
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionProjections'], (sctx) => {
      const reg = (sctx as { sessionProjections?: ProjectionRegistryLike })
        ?.sessionProjections
      if (reg && typeof reg.register === 'function') {
        void start(reg, ctx, log, config).catch((e) => {
          log.error('start failed after inject — host half partially applied', e)
        })
      } else {
        log.warn('sessionProjections service unusable even via inject — plugin idle')
      }
    })
  } else {
    // 无缝环境（单元测试 / 工具链裸跑）：功能不可用但绝不让宿主崩溃
    log.warn('sessionProjections seam absent — plugin idle')
  }
}

/** 官方 timer 服务优先；无缝环境（测试/裸跑）回退全局计时器（disposer 同形）。 */
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

type AsyncDisposer = () => Promise<void> | void

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function'
}

/**
 * 适配两种 register 契约并返回**真正的释放函数**：
 * - 0.2.x：返回可调用 thenable → await 得到 `ProjectionHandle`，释放走 `handle.dispose()`；
 * - 0.1.x：返回 disposer 函数 → 直接使用。
 * 注册失败（Promise reject）会向上抛，由调用方按“宿主半边未就绪”记录，不再静默。
 */
async function adoptRegistration(
  registry: ProjectionRegistryLike,
  definition: ProjectionDefinitionLike,
  log: { warn(m: string, ...rest: unknown[]): void },
): Promise<AsyncDisposer> {
  const result: ProjectionRegisterResult = registry.register(definition)
  if (isThenable(result)) {
    const handle = (await result) as ProjectionHandleLike | (() => void) | undefined
    if (handle && typeof (handle as ProjectionHandleLike).dispose === 'function') {
      return () => (handle as ProjectionHandleLike).dispose()
    }
    if (typeof handle === 'function') return handle as AsyncDisposer
    log.warn('projection registration resolved without a handle; cleanup is a no-op')
    return () => undefined
  }
  if (typeof result === 'function') return result
  if (result && typeof (result as ProjectionHandleLike).dispose === 'function') {
    return () => (result as ProjectionHandleLike).dispose()
  }
  log.warn('projection registration returned no handle; cleanup is a no-op')
  return () => undefined
}

async function start(
  registry: ProjectionRegistryLike,
  ctx: CtxLike & Record<string, unknown>,
  log: { info(m: string): void; warn(m: string, ...rest: unknown[]): void; error(m: string, ...rest: unknown[]): void },
  config: unknown,
): Promise<void> {
  const initialSettings = readSettings(config)
  const store = new UsageStore(dataDir(), STATE_VERSION, 'usage-store.json', initialSettings.clearedAt)
  let lastClearedAt = initialSettings.clearedAt
  // 冷启动就按清除点裁剪一次，并落盘（旧历史不再保留）
  if (initialSettings.clearedAt > 0) {
    try { store.flush() } catch { /* best effort */ }
  }
  storeHolder.store = store
  // 卸载钩子先挂上：await 注册期间若插件被卸载，已创建的资源仍会被回收。
  const disposers: Array<() => Promise<void> | void> = []
  const onDispose = (ctx as { on?: (ev: string, cb: () => void) => void }).on
  if (typeof onDispose === 'function') {
    onDispose.call(ctx, 'dispose', () => {
      for (const dispose of disposers.splice(0)) {
        try { void Promise.resolve(dispose()).catch(() => undefined) } catch { /* ignore */ }
      }
      try { store.flush() } catch { /* ignore */ }
    })
  }
  // 排名记录是跨进程持久化的（上次同步的采集结果）——启动即载入内存镜像
  setGlobalRank(readGlobalRank(dataDir()))

  // 1) 注册 madrankUsage 单元（framework 拥有订阅与驱动，我们只交数学）。
  const definition = buildDefinition()
  const disposeRegister = await adoptRegistration(registry, definition, log)
  disposers.push(disposeRegister)
  // 排名镜像 → 客户端可见投影（独立 key；view 读缓存引用）
  let rankViewCalls = 0
  const rankDefinition = buildRankDefinition(() => {
    rankViewCalls += 1
    if (rankViewCalls === 1) {
      debugLog(dataDir(), `rank projection view first call -> ${storeHolder.globalView ? '#' + storeHolder.globalView.rank : 'null'}`)
    }
    return storeHolder.globalView
  })
  const disposeRankRegister = await adoptRegistration(registry, rankDefinition, log)
  disposers.push(disposeRankRegister)
  log.info('madrankUsage + madrankRank projections registered')
  debugLog(dataDir(), 'start: projection registered, store loaded')

  // 2) 变更流 → 去抖落盘（节流 2s；只做"整体替换该会话份额"这一件事）
  const timer = timerOf(ctx)
  let pending = false
  const flushSoon = () => {
    if (pending) return
    pending = true
    const handle = setTimeout(() => {
      pending = false
      try {
        store.flush()
        writeFileSync(
          join(dataDir(), 'card-snapshot.json'),
          JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), cardGlobalFromRecord(storeHolder.globalRank))),
        )
        debugLog(dataDir(), 'flush ok')
      } catch (e) {
        log.warn('flush failed', String(e))
        debugLog(dataDir(), `flush failed ${String(e)}`)
      }
    }, 2000)
    handle.unref?.()
  }

  let changeSeen = 0
  const disposeListener = registry.onChanged((session, key, value, seq) => {
    changeSeen += 1
    if (changeSeen === 1 || changeSeen % 25 === 0) {
      debugLog(dataDir(), `onChanged #${changeSeen} key=${String(key)} seq=${String(seq)}`)
    }
    if (key !== PROJECTION_KEY || !value) return
    try {
      store.replaceSession(session.id, seq, value as Parameters<typeof store.replaceSession>[2])
      flushSoon()
    } catch (e) {
      log.warn('replaceSession failed', String(e))
      debugLog(dataDir(), `replaceSession failed ${String(e)}`)
    }
  })
  disposers.push(disposeListener)

  // 2b) 会话播种：会话实例创建/恢复时把完整投影视图写进 store。
  // 只靠 onChanged 会漏掉「没有新事件的历史会话」→ 历史日期永远不入 store、
  // 同步漏日（2026-10 实锤：store 停在旧日期）。snapshot() 是官方读面。
  const seedSession = (session: unknown): void => {
    try {
      const snap = (registry as unknown as {
        snapshot(session: unknown, keys?: string[]): { asOfSeq?: number; values?: Record<string, unknown> } | undefined
      }).snapshot(session, [PROJECTION_KEY])
      const view = snap?.values?.[PROJECTION_KEY]
      const id = (session as { id?: unknown } | undefined)?.id
      if (view === undefined || id === undefined) return
      store.replaceSession(id as never, snap?.asOfSeq ?? 0, view as never)
      debugLog(dataDir(), `seed session=${String(id)} asOf=${String(snap?.asOfSeq)}`)
      flushSoon()
    } catch (e) {
      debugLog(dataDir(), `seed failed ${String(e)}`)
    }
  }
  const onCreated = (ctx as { on?: (event: string, cb: (session: unknown) => void) => void }).on
  if (typeof onCreated === 'function') {
    onCreated.call(ctx, 'session/created', seedSession)
  }

  // 3) opt-in 日级批量同步检查（≤1 次/分钟；只碰已结束的 UTC 日）
  //    配置通过 volatile 引用热更新 → 每轮读取最新值。
  const tick = () => {
    const s = readSettings(config)
    debugLog(dataDir(), `tick enabled=${s.enabled} autoSync=${s.autoSync} endpoint=${s.endpoint} rank=${storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'none'} clearedAt=${s.clearedAt}`)
    // 本地数据清除（设置页写 clearedAt）：裁剪已存历史并立即落盘/刷新快照。
    if (s.clearedAt !== lastClearedAt) {
      lastClearedAt = s.clearedAt
      try {
        store.setClearedAt(s.clearedAt)
        store.flush()
        writeFileSync(
          join(dataDir(), 'card-snapshot.json'),
          JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), cardGlobalFromRecord(storeHolder.globalRank))),
        )
        debugLog(dataDir(), `clearedAt applied=${s.clearedAt}`)
      } catch (e) {
        log.warn('clear local stats failed', String(e))
      }
    }
    // 同步轮门控：参与排名（enabled）+ 自动同步（autoSync）双开关，缺一不发。
    if (!s.enabled || s.autoSync === false || !s.endpoint || !storeHolder.store) return
    void ensureShareToken(s.endpoint)
    void refreshRaceThrottled(s.endpoint)
    void syncPendingDays(store, s, getAnonId, globalThis.fetch.bind(globalThis), (race) => {
      // ingest 响应携带按本机 anonId 重算的 7 日名次：持久化 + 内存镜像。
      const rec = recordFromRace(race, s.endpoint, Date.now())
      if (!rec) return
      const prev = storeHolder.globalRank
      if (prev?.shareToken) rec.shareToken = prev.shareToken
      if (prev !== null
        && prev.rank === rec.rank && prev.total === rec.total
        && prev.participants === rec.participants && prev.endpoint === rec.endpoint) {
        return
      }
      setGlobalRank(rec)
      try {
        writeGlobalRank(dataDir(), rec)
      } catch (e) {
        log.warn('global-rank write failed — keep in-memory mirror', String(e))
      }
      void ensureShareToken(s.endpoint)
    })
      .then((outcomes) => {
        if (outcomes.length > 0) {
          store.flush()
          debugLog(dataDir(), `sync uploaded days=${outcomes.map((o) => JSON.stringify(o)).join(',')}`)
        }
      })
      .catch(() => undefined) // 同步永不影响宿主
  }
  const disposeTick = timer.interval(tick, 60_000)
  disposers.push(disposeTick)

  log.info('host half applied — projection on, sync tick 60s, global mirror ' + (storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'empty'))

}