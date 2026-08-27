/**
 * stats.ts — 展示层聚合：Settings 卡片 / 7 日历史 / Streak 的唯一数据源。
 * 输入永远是 store.aggregateDays() 的输出；本模块无 IO、可全量单测。
 * 口径一律经 src/caliber.ts，不在展示层发明算法。
 */

import { PRIMARY_TOKENS, CACHED_TOKENS } from './caliber.ts'
import type { ModelBuckets } from './fold.ts'

export type DayAggregate = Record<
  string,
  { models: Record<string, ModelBuckets>; activeSeconds: number }
>

export interface DaySummary {
  ymd: string
  primaryTokens: number
  cachedTokens: number
  requests: number
  activeSeconds: number
}

export function summarizeDay(ymd: string, day: {
  models: Record<string, ModelBuckets>; activeSeconds: number
}): DaySummary {
  let primary = 0
  let cached = 0
  let requests = 0
  for (const b of Object.values(day.models)) {
    primary += PRIMARY_TOKENS(b)
    cached += CACHED_TOKENS(b)
    requests += b.requests
  }
  return { ymd, primaryTokens: primary, cachedTokens: cached, requests, activeSeconds: day.activeSeconds }
}

export interface TodayCardData {
  ymd: string
  primaryTokens: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  requests: number
  activeSeconds: number
  /** 相对过去 7 天日均的倍数（无足够历史时为 null）。 */
  vs7dAvgMultiple: number | null
}

export function todayCard(
  aggregate: DayAggregate,
  nowMs: number,
): TodayCardData {
  const ymd = new Date(nowMs).toISOString().slice(0, 10)
  const day = aggregate[ymd]
  const s = summarizeDay(ymd, day ?? { models: {}, activeSeconds: 0 })

  const { inputTokens, outputTokens } = splitPrimary(day?.models ?? {})
  const avg = trailingAverage(aggregate, ymd, /* excludeToday */ true)

  return {
    ...s,
    inputTokens,
    outputTokens,
    vs7dAvgMultiple: avg > 0 ? Math.round(((s.primaryTokens / avg) * 100)) / 100 : null,
  }
}

function splitPrimary(models: Record<string, ModelBuckets>): {
  inputTokens: number; outputTokens: number
} {
  let i = 0
  let o = 0
  for (const b of Object.values(models)) {
    i += b.inputTokens
    o += b.outputTokens
  }
  return { inputTokens: i, outputTokens: o }
}

/** 前 N 天（不含参照日）某主指标的移动平均。 */
export function trailingAverage(
  aggregate: DayAggregate,
  refYmd: string,
  excludeToday: boolean,
  days = 7,
): number {
  const ref = Date.parse(refYmd + 'T00:00:00Z')
  if (Number.isNaN(ref)) return 0

  let sum = 0
  let counted = 0
  for (let k = 1; k <= days; k++) {
    const d = new Date(ref - k * 86_400_000).toISOString().slice(0, 10)
    const aggDay = aggregate[d]
    if (!aggDay) continue
    const s = summarizeDay(d, aggDay)
    sum += primaryOf(s)
    counted++
  }
  void excludeToday // 参照日本就不在窗口内
  return counted > 0 ? sum / counted : 0

  function primaryOf(x: DaySummary): number { return x.primaryTokens }
}

export interface HistoryEntry extends DaySummary {}

export function lastNDays(aggregate: DayAggregate, nowMs: number, n = 7): HistoryEntry[] {
  const out: HistoryEntry[] = []
  const today = new Date(nowMs).toISOString().slice(0, 10)
  const base = Date.parse(today + 'T00:00:00Z')

  for (let k = n - 1; k >= 0; k--) {
    const ymd = new Date(base - k * 86_400_000).toISOString().slice(0, 10)
    const day = aggregate[ymd]
    out.push(summarizeDay(ymd, day ?? { models: {}, activeSeconds: 0 }))
  }
  return out
}

/** 连续活跃天数：从今天起算；今天为零则允许从昨天起算（不杀昨日连续性）。 */
export function streakDays(aggregate: DayAggregate, nowMs: number): number {
  const hasUsage = (ymd: string): boolean => {
    const d = aggregate[ymd]
    if (!d) return false
    for (const b of Object.values(d.models)) {
      if (b.requests > 0) return true
    }
    return false
  }

  const base = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z')
  let cursor = hasUsage(new Date(base).toISOString().slice(0, 10))
    ? base
    : base - 86_400_000

  let n = 0
  while (hasUsage(new Date(cursor).toISOString().slice(0, 10))) {
    n++
    cursor -= 86_400_000
  }
  return n
}

export interface ModelShareEntry {
  modelKey: string
  provider: string
  model: string
  primaryTokens: number
  sharePct: number
}

export function topModels(
  aggregate: DayAggregate,
  refYmd: string,
  limit = 4,
): ModelShareEntry[] {
  const day = aggregate[refYmd]
  if (!day) return []

  let total = 0
  const rows: ModelShareEntry[] = []
  for (const [modelKey, b] of Object.entries(day.models)) {
    const p = PRIMARY_TOKENS(b)
    total += p
    const slash = modelKey.indexOf('/')
    rows.push({
      modelKey,
      provider: slash === -1 ? modelKey : modelKey.slice(0, slash),
      model: slash === -1 ? '' : modelKey.slice(slash + 1),
      primaryTokens: p,
      sharePct: 0,
    })
  }

  rows.sort((a, b) => b.primaryTokens - a.primaryTokens || a.modelKey.localeCompare(b.modelKey))
  for (const r of rows) r.sharePct = total > 0 ? Math.round((r.primaryTokens / total) * 1000) / 10 : 0
  return rows.slice(0, limit)
}

/** 竞赛指标：最近 7 个 UTC 日的 Primary Tokens 总和（今天计入；未含任何数据则窗口自然缺失）。 */
export function raceMetric7d(aggregate: DayAggregate, nowMs: number): number {
  return lastNDays(aggregate, nowMs, 7).reduce((acc, d) => acc + d.primaryTokens, 0)
}
