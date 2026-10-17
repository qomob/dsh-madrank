/**
 * card-data.ts — 浏览器半侧的数据装配（纯函数，可全量单测）。
 *
 * 数据源是官方缝隙：slot 标准 props 的 useSessions 钩子读取会话列表，
 * 每行 SessionSummary.projectionValues 携带宿主折算好的 madrankUsage view。
 * 跨会话求和得到机器级 TODAY —— 会话日志互不相交，直接相加无重复。
 * 所有聚合口径复用 src/stats.ts / src/caliber.ts（本包内导入合规）。
 */

import { dayDetail, HISTORY_WINDOW_DAYS, lastNDays, streakDays, topModels, todayCard } from '../stats.ts'
import type { DayAggregate } from '../stats.ts'
import { raceUrlFromEndpoint } from '../global-rank.ts'
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
 * 设置表单值的客户端形状（新版 configForms 快照的 value）：
 * 只包含插件 Config 的字段（enabled / endpoint / autoSync）。
 * 排名镜像已不再经设置通道传输（新版无 resolve 注入缝），global 恒为 null。
 */
export interface SettingsSectionValue {
  enabled: boolean
  endpoint: string | undefined
  /** 自动同步每日用量（默认 true；参与排名关闭时宿主根本不启动同步轮）。 */
  autoSync: boolean
}

/**
 * 解码宿主 madrankRank 投影值（安装级排名镜像；坏形状 → null）。
 * 宿主 wire.viewSchema 已校验，这里只做宽容结构转换。
 */
export function decodeRankView(raw: unknown): CardGlobal | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (!num(r['rank']) || !num(r['topPct']) || !num(r['race7d'])) return null
  return {
    rank: r['rank'],
    topPct: r['topPct'],
    race7d: r['race7d'],
    participants: num(r['participants']) ? r['participants'] : undefined,
    updatedAt: num(r['updatedAt']) ? r['updatedAt'] : undefined,
    shareToken: typeof r['shareToken'] === 'string' && r['shareToken'].length > 0
      ? r['shareToken']
      : undefined,
  }
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
