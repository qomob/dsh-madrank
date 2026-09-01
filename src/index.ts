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
 * 4. Settings section：enabled / endpoint / privacy 面板数据
 */

import { z } from 'zod'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PROJECTION_KEY, STATE_VERSION, applyEvent, buildView, initState,
} from './fold.ts'
import type { MadrankState } from './fold.ts'
import { buildCardSnapshot } from './snapshot.ts'
import type { CtxLike, ProjectionDefinitionLike } from './compat.ts'
import { UsageStore } from './store.ts'
import { syncPendingDays } from './sync.ts'
import {
  cardGlobalFromRecord,
  recordFromRace,
  sameOrigin,
} from './global-rank.ts'
import type { GlobalRankRecord } from './global-rank.ts'
import { readGlobalRank, writeGlobalRank } from './global-rank-file.ts'

export const name = 'dsh-madrank'

/** cordis DI：投影缝 + settings 服务都是硬依赖。
 * ⚠️ 加载器只挂载此处声明过的服务——未声明的服务即使 ctx.inject(['x'], cb) 也永不触发
 * （2026-09-01 实锤：settings 未声明 ⇒ 注册回调静默失效 ⇒ Join 永远无声）。 */
export const inject = ['sessionProjections', 'settings']

// ── 设置 ────────────────────────────────────────────────────
export const SETTINGS_NS = 'madrank-usage'

const SettingsSchema = z.object({
  /** 加入全球榜必须显式开启；默认完全离线。 */
  enabled: z.boolean().default(false),
  /** MADRank ingest 端点。 */
  endpoint: z.string().default('https://madrank.ai/api/usage/ingest'),
})

export type Settings = z.infer<typeof SettingsSchema>

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
  settings: SettingsSchema.parse({}) as Settings,
  globalRank: null,
}

/**
 * 同步后触碰设置文档的合成标记字段（syncEpoch）：raw user layer 变更 →
 * revision bump → settings/document-updated → 浏览器 settings mirror 重读
 * describe → 宿主 resolve 重跑（重读排名内存镜像）→ 卡片 Joined 态实时点亮。
 * 该字段被 zod strip，永不出现在 resolve 输出；只读 provider / memory 模式下
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

const viewSchema = buildViewSchema()
const definition: ProjectionDefinitionLike = {
  key: PROJECTION_KEY,
  // —— rc.8 旧字段：保留，双版本兼容 ——
  schema: viewSchema as unknown as ProjectionDefinitionLike['schema'],
  view: ((state: MadrankState) => buildView(state)) as never,
  // —— rc.2 契约：必须显式声明客户端视图，否则按 host-only 处理
  //    （值不出宿主、onChanged 不触发 ⇒ 卡片全零 / store 不落盘）——
  stateSchema: buildStateSchema() as unknown as ProjectionDefinitionLike['stateSchema'],
  wire: {
    viewSchema: viewSchema as unknown as NonNullable<ProjectionDefinitionLike['wire']>['viewSchema'],
    view: ((state: MadrankState) => buildView(state)) as never,
  },
  init: () => initState(),
  apply: ((state: MadrankState, event: import('./compat.ts').SessionEventLike) =>
    applyEvent(state, event)) as never,
  stateVersion: STATE_VERSION,
}

/**
 * wire 校验：view 输出的形状契约。
 * 用真实 zod 对象——宿主以 .parse/.safeParse 调用。
 */
function buildViewSchema() {
  const daySchema = z.object({
    models: z.record(z.string(), z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      cacheWriteTokens: z.number().int().nonnegative(),
      requests: z.number().int().nonnegative(),
    })),
    activeSeconds: z.number().int().nonnegative(),
  })
  return z.object({
    version: z.literal(STATE_VERSION),
    days: z.record(z.string(), daySchema),
    totalRequests: z.number().int().nonnegative(),
    totalPrimaryTokens: z.number().int().nonnegative(),
    totalCachedTokens: z.number().int().nonnegative(),
  })
}

/**
 * rc.2：持久化状态（MadrankState）在 seed/restore 前必须通过 stateSchema。
 * 注意校验对象是 fold 内部状态（含 activity/last），与 wire 视图形状不同。
 */
function buildStateSchema() {
  const buckets = z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    requests: z.number(),
  })
  return z.object({
    currentModelKey: z.string().nullable(),
    days: z.record(z.string(), z.record(z.string(), buckets)),
    activity: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))),
    last: z.object({
      turn: z.number(),
      step: z.number(),
      ymd: z.string(),
      modelKey: z.string(),
      buckets,
    }).nullable(),
  })
}

export function apply(ctx: CtxLike & Record<string, unknown>): void {
  const log = ctx.logger ?? {
    info: (m: string) => console.info('[madrank]', m),
    warn: (m: string) => console.warn('[madrank]', m),
    error: (m: string) => console.error('[madrank]', m),
  }
  // 投影缝获取：直取（大多数 boot 时序下可用）→ 缺席时降级 ctx.inject 等待
  // （服务提供方 README 的官方消费模式，对插件加载顺序免疫）。
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
  // ⚠️ 必须先在插件导出里声明 inject = ['sessionProjections', 'settings']：
  // cordis 按声明挂载服务并保证就绪；wire（客户端可见）单元在未声明时注册会静默挂起。
  const disposeRegister = registry.register(definition)
  log.info('madrankUsage projection registered')

  // 2) 变更流 → 去抖落盘（节流 2s；只做"整体替换该会话份额"这一件事）
  let pending = false
  const flushSoon = () => {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      try {
        store.flush()
        writeFileSync(
          join(dataDir(), 'card-snapshot.json'),
          JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), cardGlobalFromRecord(storeHolder.globalRank))),
        )
      } catch (e) { log.warn('flush failed', e) }
    }, 2000).unref?.()
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
    if (!s.enabled || !s.endpoint || !storeHolder.store) return
    void syncPendingDays(store, s, getAnonId, globalThis.fetch.bind(globalThis), (race) => {
      // ingest 响应携带按本机 anonId 重算的 7 日名次：持久化 + 内存镜像 +
      // 触碰设置文档 → Joined 卡片实时点亮（P0-1 / P0-2 的最后一环）。
      const rec = recordFromRace(race, s.endpoint, Date.now())
      if (!rec) return
      const prev = storeHolder.globalRank
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
    })
      .then((outcomes) => {
        if (outcomes.length > 0) store.flush()
      })
      .catch(() => undefined) // 同步永不影响宿主（含 onRace 回调内抛错）
  }
  const timer = setInterval(tick, 60_000)
  timer.unref?.()

  log.info('host half applied — projection on, sync tick 60s, global mirror ' + (storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'empty'))

  // 清理：挂宿主生命周期事件；cordis 卸载插件时自动触发
  const onDispose = (ctx as { on?: (ev: string, cb: () => void) => void }).on
  if (typeof onDispose === 'function') {
    onDispose.call(ctx, 'dispose', () => {
      clearInterval(timer)
      disposeListener()
      disposeRegister()
      try { store.flush() } catch { /* ignore */ }
    })
  }
}

/**
 * Settings section 声明（rc.2 正解，2026-09-01 定案）：
 * 必须在 apply「顶层」消费 settings——cordis 按插件导出的 inject 数组把声明过的服务
 * 直接挂上 ctx（ctx.settings），顶层 ctx.inject 的回调也会正常触发；
 * 嵌套在其他 inject 回调里再 inject 的子 fiber 会被回收，注册静默失效。
 * 顺序：rc.8 legacy ctx.installSettingsSection → ctx.settings 直取 → ctx.inject 兜底。
 * rc.2 的 resolve() 以 schema(merged) 可调用约定消费 schema —— zod 需适配器（callable）。
 * resolve 输出注入全球排名——settings mirror 是宿主→浏览器的唯一合法数据缝：
 * 值在解析时从内存镜像读取，持久化文档（base/user 层）永远不含排名；
 * 排名不写回 usage 投影（HANDOFF 冻结约束），只在 describe 答案中出现。
 */
function declareSettingsSection(ctx: CtxLike & Record<string, unknown>, log: { info(m: string): void; warn(m: string, ...rest: unknown[]): void }): void {
  try {
    const hooks = {
      setSource: (get: () => Settings) => { settingsSource = get },
      onChange: () => { /* 下一个 tick 生效 */ },
    }
    // 可调用 + toJSON 双面 schema：resolve 以 schema(merged) 消费（zod 适配），
    // describe 以 schema.toJSON() 序列化（schemastery 图谱；裸函数会被 describe 丢弃）。
    const callable = Object.assign(
      (merged: unknown) => {
        const parsed = SettingsSchema.parse(merged)
        const rec = storeHolder.globalRank
        const global = parsed.enabled && rec && sameOrigin(rec.endpoint, parsed.endpoint)
          ? cardGlobalFromRecord(rec)
          : null
        return { ...parsed, global }
      },
      {
        toJSON: () => ({
          uid: 3,
          refs: {
            1: { type: 'boolean', meta: { default: false } },
            2: { type: 'string', meta: { default: 'https://madrank.ai/api/usage/ingest' } },
            3: { type: 'object', meta: { default: {} }, dict: { enabled: 1, endpoint: 2 } },
          },
        }),
      },
    )
    const registerWith = (provider: { register?: (ns: never, schema: never, opts: never) => unknown }): void => {
      if (typeof provider.register !== 'function') return
      const scope = provider.register(
        SETTINGS_NS as never,
        callable as never,
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
