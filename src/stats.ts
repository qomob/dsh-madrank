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

/** 卡片历史窗口上限（30 天视图 + 单日回看的取数窗口；card-data/snapshot/preview 对齐）。 */
export const HISTORY_WINDOW_DAYS = 60

/** 任意单日的完整明细（in/out 拆分；day 视图与 TODAY 同口径）。 */
export interface DayDetail extends DaySummary {
  inputTokens: number
  outputTokens: number
}

export function dayDetail(aggregate: DayAggregate, ymd: string): DayDetail {
  const day = aggregate[ymd]
  const s = summarizeDay(ymd, day ?? { models: {}, activeSeconds: 0 })
  const { inputTokens, outputTokens } = splitPrimary(day?.models ?? {})
  return { ...s, inputTokens, outputTokens }
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

/**
 * 竞赛指标：最近 7 个 UTC 日的 Primary Tokens 总和（今天计入；未含任何数据则窗口自然缺失）。
 *
 * 定位说明（避免误当死代码删除）：这是「本机口径」的 7 日窗口（含今天、local primary），
 * 与卡面「计入全球排名 · 7 日」数字**不是同一把尺子**——
 * 卡上 race7d 来自服务器镜像（只含已结束 UTC 日、上传口径含 cacheWrite，见 sync.ts
 * composeDayPayload），时点也可能滞后。本机/服务器两把尺子的差异是产品有意为之：
 * 本地实时 vs 统计权威。当前卡面只展示服务器镜像；本函数保留供：
 *   1) 设置面板「本地数据」概览的未来本机对照；
 *   2) 诊断/对账（本地 7 日 vs 服务器 7 日，验证同步完整性）。
 * 若未来在卡上并列两把尺子，必须带口径标注（见 card-html mk-src 来源标注范式）。
 */
export function raceMetric7d(aggregate: DayAggregate, nowMs: number): number {
  return lastNDays(aggregate, nowMs, 7).reduce((acc, d) => acc + d.primaryTokens, 0)
}
