/**
 * card-data.ts — 浏览器半侧的数据装配（纯函数，可全量单测）。
 *
 * 数据源是官方缝隙：`ctx.sessions.list`（ISessions 标准 feed）的每行
 * SessionSummary.projectionValues 里携带宿主折算好的 madrankUsage view。
 * 跨会话求和得到机器级 TODAY —— 会话日志互不相交，直接相加无重复。
 * 所有聚合口径复用 src/stats.ts / src/caliber.ts（本包内导入合规）。
 */

import { lastNDays, streakDays, topModels, todayCard } from '../stats.ts'
import type { DayAggregate } from '../stats.ts'
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

/** 列表快照 → 卡片展示所需的完整口径集（不含 global：本地版恒无排名）。 */
export function cardDataFromList(
  snap: SessionsListSnapshotLike | undefined,
  nowMs: number,
): {
  today: ReturnType<typeof todayCard>
  topModels: ReturnType<typeof topModels>
  streak: number
  last7: Array<{ ymd: string; primaryTokens: number }>
} {
  const agg = mergeViews(extractViews(snap))
  return {
    today: todayCard(agg, nowMs),
    topModels: topModels(agg, new Date(nowMs).toISOString().slice(0, 10)),
    streak: streakDays(agg, nowMs),
    last7: lastNDays(agg, nowMs, 7).map(d => ({ ymd: d.ymd, primaryTokens: d.primaryTokens })),
  }
}
