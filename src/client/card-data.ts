/**
 * card-data.ts — 浏览器半侧的数据装配（纯函数，可全量单测）。
 *
 * 数据源是官方缝隙：`ctx.sessions.list`（ISessions 标准 feed）的每行
 * SessionSummary.projectionValues 里携带宿主折算好的 madrankUsage view。
 * 跨会话求和得到机器级 TODAY —— 会话日志互不相交，直接相加无重复。
 * 所有聚合口径复用 src/stats.ts / src/caliber.ts（本包内导入合规）。
 */

import { dayDetail, HISTORY_WINDOW_DAYS, lastNDays, streakDays, topModels, todayCard } from '../stats.ts'
import type { DayAggregate } from '../stats.ts'
import { cardGlobalFromRecord, parseGlobalRecord, raceUrlFromEndpoint } from '../global-rank.ts'
import type { CardGlobal } from '../global-rank.ts'
import type { CardDayEntry, CardSnapshot } from './card-html.ts'
import type { DayView, ModelBuckets, UsageView } from '../fold.ts'

/** 最小结构镜像：客户端不依赖 DSH 包（bundle 纯净度门禁）。 */
export interface SessionsListSnapshotLike {
  byId: Record<string, { projectionValues?: Readonly<Record<string, unknown>> }>
}

function isUsageView(v: unknown): v is UsageView {
  if (typeof v !== 'object' || v === null) return false
  const days = (v as { days?: unknown }).days
  return typeof days === 'object' && days !== null
}

/** 把宿主的分日模型桶安全收敛为本包形状（字段缺省视为 0）。 */
function normalizeBuckets(raw: unknown): ModelBuckets {
  const b = (raw ?? {}) as Partial<Record<keyof ModelBuckets, unknown>>
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)
  return {
    inputTokens: n(b.inputTokens),
    outputTokens: n(b.outputTokens),
    cacheReadTokens: n(b.cacheReadTokens),
    cacheWriteTokens: n(b.cacheWriteTokens),
    requests: n(b.requests),
  }
}

function normalizeDay(raw: unknown): DayView {
  const models: Record<string, ModelBuckets> = {}
  if (typeof raw === 'object' && raw !== null) {
    for (const [k, b] of Object.entries((raw as { models?: Record<string, unknown> }).models ?? {})) {
      models[k] = normalizeBuckets(b)
    }
  }
  const activeSeconds = (raw as { activeSeconds?: unknown }).activeSeconds
  return { models, activeSeconds: typeof activeSeconds === 'number' ? Math.max(0, activeSeconds) : 0 }
}

export function extractViews(snap: SessionsListSnapshotLike | undefined): UsageView[] {
  const out: UsageView[] = []
  for (const row of Object.values(snap?.byId ?? {})) {
    const pv = row?.projectionValues
    if (!pv || typeof pv !== 'object') continue
    const view = (pv as Record<string, unknown>)['madrankUsage']
    if (isUsageView(view)) out.push(view)
  }
  return out
}

/** 跨会话求和。activeSeconds 取最大者（与 store 的保守口径一致）。 */
export function mergeViews(views: UsageView[]): DayAggregate {
  const agg: DayAggregate = {}
  for (const view of views) {
    for (const [ymd, day] of Object.entries(view.days)) {
      const dst = (agg[ymd] ??= { models: {}, activeSeconds: 0 })
      for (const [modelKey, b] of Object.entries(day.models)) {
        const acc = (dst.models[modelKey] ??= {
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0,
        })
        const nb = b // 已是宿主 view 形状
        acc.inputTokens += nb.inputTokens
        acc.outputTokens += nb.outputTokens
        acc.cacheReadTokens += nb.cacheReadTokens
        acc.cacheWriteTokens += nb.cacheWriteTokens
        acc.requests += nb.requests
      }
      if (day.activeSeconds > dst.activeSeconds) dst.activeSeconds = day.activeSeconds
    }
  }
  void normalizeDay // 防御性归一保留给未来 wire 差异（v1 宿主已同构）
  return agg
}

/** 卡片历史窗口（30 天视图 + 单日回看；card-html 的 history 消费口径）。 */
function buildHistory(agg: DayAggregate, nowMs: number): CardDayEntry[] {
  return lastNDays(agg, nowMs, HISTORY_WINDOW_DAYS).map((d) => ({
    ...dayDetail(agg, d.ymd),
    topModels: topModels(agg, d.ymd),
  }))
}

/** 列表快照 → 卡片展示所需的完整口径集（不含 global：本地版恒无排名）。 */
export function cardDataFromList(
  snap: SessionsListSnapshotLike | undefined,
  nowMs: number,
): {
  today: ReturnType<typeof todayCard>
  topModels: ReturnType<typeof topModels>
  streak: number
  last7: Array<{ ymd: string; primaryTokens: number }>
  history: CardDayEntry[]
} {
  const agg = mergeViews(extractViews(snap))
  return {
    today: todayCard(agg, nowMs),
    topModels: topModels(agg, new Date(nowMs).toISOString().slice(0, 10)),
    streak: streakDays(agg, nowMs),
    last7: lastNDays(agg, nowMs, 7).map(d => ({ ymd: d.ymd, primaryTokens: d.primaryTokens })),
    history: buildHistory(agg, nowMs),
  }
}

/**
 * settings wire 段窄化（SettingsScopeSpec.decode）。
 * 显式 decode 使客户端跳过宿主 schemastery 默认校验、原样消费 describe 的
 * value——这是排名走 settings mirror 的前提（resolve 注入的 global 不是
 * schema 字段，默认校验不认识它）。坏形状一律降级：enabled=false、global=null。
 */
export function decodeSettingsSection(section: unknown): {
  enabled: boolean
  endpoint: string | undefined
  global: CardGlobal | null
} | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const s = section as Record<string, unknown>
  return {
    enabled: s['enabled'] === true,
    endpoint: typeof s['endpoint'] === 'string' ? s['endpoint'] : undefined,
    global: decodeWireGlobal(s['global']),
  }
}

/**
 * wire 段 global 的双形状解码（2026-09-01 第六坑）。
 * 宿主 resolve 注入的已是 CardGlobal（race7d；index.ts callable 出口），
 * 而 parseGlobalRecord 只认 GlobalRankRecord（total/endpoint）——单测用
 * 错误形状喂 decode 曾致全绿假象，真实 rank 首次点亮当日实锤。
 */
function decodeWireGlobal(raw: unknown): CardGlobal | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (num(r['rank']) && num(r['topPct']) && num(r['race7d'])) {
    return {
      rank: r['rank'],
      topPct: r['topPct'],
      race7d: r['race7d'],
      participants: num(r['participants']) ? r['participants'] : undefined,
      updatedAt: num(r['updatedAt']) ? r['updatedAt'] : undefined,
    }
  }
  return cardGlobalFromRecord(parseGlobalRecord(raw))
}

/**
 * 卡片 global / View race 链接组装（优先级锁定）：
 * fixture（window.__MADRANK_CARD_DATA__，测试/调试覆盖口）
 *   > settings mirror（宿主 resolve 注入的唯一排名缝）> null（诚实空态）。
 * 投影 feed 不携带排名——usage 语义与 gamification 永不互串。
 */
export function composeGlobalView(
  fixture: Partial<CardSnapshot> | undefined,
  scope: { enabled?: boolean; endpoint?: string; global?: CardGlobal | null } | undefined,
): { global: CardGlobal | null; raceUrl: string } {
  return {
    global: fixture?.global !== undefined ? fixture.global ?? null : scope?.global ?? null,
    raceUrl: raceUrlFromEndpoint(scope?.endpoint),
  }
}
