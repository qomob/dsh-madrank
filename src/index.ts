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

const definition: ProjectionDefinitionLike = {
  key: PROJECTION_KEY,
  schema: buildViewSchema() as unknown as ProjectionDefinitionLike['schema'],
  init: () => initState(),
  apply: ((state: MadrankState, event: import('./compat.ts').SessionEventLike) =>
    applyEvent(state, event)) as never,
  view: ((state: MadrankState) => buildView(state)) as never,
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
    const s = storeHolder.settings
    if (!s.enabled || !s.endpoint || !storeHolder.store) return
    void syncPendingDays(store, s, getAnonId, globalThis.fetch.bind(globalThis))
      .then((outcomes) => {
        if (outcomes.length > 0) store.flush()
      })
      .catch(() => undefined) // 同步永不影响宿主
  }
  const timer = setInterval(tick, 60_000)
  timer.unref?.()

  // 4) Settings section（有 settings 缝时自动挂卡片配置；无缝则保持默认离线）
  try {
    ;(ctx as { installSettingsSection?: NonNullable<CtxLike['installSettingsSection']> })
      ?.installSettingsSection?.(
        ctx,
        SETTINGS_NS,
        SettingsSchema,
        storeHolder.settings,
        {
          setSource: (get) => { storeHolder.settings = get() },
          onChange: () => { /* 下一个 tick 生效 */ },
        },
      )
  } catch {
    log.info('settings seam absent — running with defaults (sync off)')
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