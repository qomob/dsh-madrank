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

export const name = 'dsh-madrank'

/** cordis DI：投影缝是硬依赖。 */
export const inject = ['sessionProjections']

// ── 设置 ────────────────────────────────────────────────────
export const SETTINGS_NS = 'madrank-usage'

const SettingsSchema = z.object({
  /** 加入全球榜必须显式开启；默认完全离线。 */
  enabled: z.boolean().default(false),
  /** MADRank ingest 端点。 */
  endpoint: z.string().default('https://madrank.app/api/usage/ingest'),
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

const storeHolder: { store?: UsageStore; settings: Settings; ctx?: CtxLike } = {
  settings: SettingsSchema.parse({}) as Settings,
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
  const registry = (ctx as { sessionProjections?: import('./compat.ts').ProjectionRegistryLike })
    .sessionProjections
  if (!registry || typeof registry.register !== 'function') {
    // 无缝环境（单元测试 / 工具链裸跑）：功能不可用但绝不让宿主崩溃
    log.warn('sessionProjections seam absent — plugin idle')
    return
  }

  const store = new UsageStore(dataDir(), STATE_VERSION)
  storeHolder.store = store
  storeHolder.ctx = ctx

  // 1) 注册 madrankUsage 单元（framework 拥有订阅与驱动，我们只交数学）
  const disposeRegister = registry.register(definition)

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
          JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now())),
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
    void syncPendingDays(store, s, getAnonId, globalThis.fetch.bind(globalThis))
      .then((outcomes) => {
        if (outcomes.length > 0) store.flush()
      })
      .catch(() => undefined) // 同步永不影响宿主
  }
  const timer = setInterval(tick, 60_000)
  timer.unref?.()

  // 4) Settings section 声明（双版本适配）。
  //    rc.8：ctx.installSettingsSection(ctx, ns, schema, current, hooks)。
  //    rc.2：installSettingsSection 移出 ctx（dsh-settings 具名导出），等价动作为
  //    ctx.inject(['settings'], sctx => sctx.settings.register(ns, callable, { base }))。
  //    ⚠️ rc.2 的 resolve() 以 schema(merged) 可调用约定消费 schema —— zod 需适配器；
  //    不声明 ⇒ 客户端 scope 恒 unavailable ⇒ 卡片 Join 按钮点击无任何效果。
  try {
    const hooks = {
      setSource: (get: () => Settings) => { settingsSource = get },
      onChange: () => { /* 下一个 tick 生效 */ },
    }
    const legacy = (ctx as { installSettingsSection?: CtxLike['installSettingsSection'] })
      .installSettingsSection
    if (typeof legacy === 'function') {
      legacy.call(ctx, ctx, SETTINGS_NS, SettingsSchema, storeHolder.settings, hooks)
    } else if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (sctx) => {
        const provider = sctx?.settings
        if (!provider || typeof provider.register !== 'function') return
        // zod → 可调用适配：rc.2 resolve() 执行 schema(mergeLayers(base, section))
        const callable = (merged: unknown) => SettingsSchema.parse(merged)
        const scope = provider.register(
          SETTINGS_NS as never,
          callable as never,
          { base: { ...storeHolder.settings } } as never,
        )
        hooks.setSource(() => scope.get())
        hooks.onChange()
        scope.watch(() => { /* 设置变更 → 下一个 tick 生效 */ })
      })
    } else {
      log.warn('settings seam absent — running with defaults (sync off)')
    }
  } catch (e) {
    log.warn('settings declare failed — sync stays off', e)
  }

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