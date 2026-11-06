/**
 * fold.ts — madrankUsage 投影的纯数学。
 *
 * 规则：
 * 1. 只作为 ProjectionDefinition 被 framework 驱动；本文件绝不出现事件订阅。
 * 2. DSH session log 是 Source of Truth；本状态是 log-derived state，
 *    可删除、可从日志全量重放重建（stateVersion 变更时持久化缓存自然失效）。
 * 3. usage 替换语义与 DSH token-meter 的 addReplacing 同构（对账见
 *    tests/reconcile.test.ts + tools/reference-token-meter.ts）。
 * 4. 模型归因来自最近一次 request/header；waterfall 换模会落新 header ——
 *    已知限制：同 step 内换模时，全局总量仍精确，仅分桶归因切在 header 点。
 * 5. 全部函数同步纯函数；状态可 JSON 化。命中事件必须返回**新 state 引用**
 *    （DSH 0.2.x 注册表的 Object.is 状态门依赖引用变化触发 view / onChanged）。
 *
 * v2 新增：活跃时长。按 UTC 日记录 [start,end] 合并分段：
 * 相邻样本间隔 ≤ ACTIVITY_GAP_MS 视为同段；段数超 CAP 时并入尾段（保守近似）。
 */

import type { SessionEventLike, TokenUsageBuckets } from './compat.ts'
import { ACTIVITY_GAP_MS } from './caliber.ts'

export const PROJECTION_KEY = 'madrankUsage'
export const STATE_VERSION = 2

/** 单日保留的合并段上限；超出则并入尾段（极端碎片场景的保守下界）。 */
const MAX_SEGMENTS_PER_DAY = 48

export interface ModelBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  requests: number
}

export interface MadrankState {
  currentModelKey: string | null
  /** UTC 日 → 模型键 → 四桶。 */
  days: Record<string, Record<string, ModelBuckets>>
  /** UTC 日 → 合并后的活跃分段 [startMs, endMs]（升序、互不重叠）。 */
  activity: Record<string, Array<[number, number]>>
  last: {
    turn: number; step: number; ymd: string; modelKey: string; buckets: ModelBuckets
  } | null
}

export function initState(): MadrankState {
  return { currentModelKey: null, days: {}, activity: {}, last: null }
}

const zeroBuckets = (): ModelBuckets => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0,
})

const fromUsage = (u: TokenUsageBuckets): ModelBuckets => ({
  inputTokens: u.inputTokens ?? 0,
  outputTokens: u.outputTokens ?? 0,
  cacheReadTokens: u.cacheReadTokens ?? 0,
  cacheWriteTokens: u.cacheWriteTokens ?? 0,
  requests: 1,
})

function addInto(acc: ModelBuckets, b: ModelBuckets): void {
  acc.inputTokens += b.inputTokens
  acc.outputTokens += b.outputTokens
  acc.cacheReadTokens += b.cacheReadTokens
  acc.cacheWriteTokens += b.cacheWriteTokens
  acc.requests += b.requests
}

function subFrom(acc: ModelBuckets, b: ModelBuckets): void {
  acc.inputTokens -= b.inputTokens
  acc.outputTokens -= b.outputTokens
  acc.cacheReadTokens -= b.cacheReadTokens
  acc.cacheWriteTokens -= b.cacheWriteTokens
  acc.requests -= b.requests
}

export function ymdOf(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 10)
}

function withModels(
  days: MadrankState['days'],
  originalDays: MadrankState['days'],
  ymd: string,
): Record<string, ModelBuckets> {
  const current = days[ymd]
  // 已在本轮事件里复制过（不是旧状态里的引用）→ 直接复用这份可变副本
  if (current !== undefined && current !== originalDays[ymd]) return current
  const next: Record<string, ModelBuckets> = { ...(originalDays[ymd] ?? {}) }
  days[ymd] = next
  return next
}

function withBucket(
  models: Record<string, ModelBuckets>,
  original: Record<string, ModelBuckets> | undefined,
  modelKey: string,
): ModelBuckets {
  const current = models[modelKey]
  if (current !== undefined && current !== original?.[modelKey]) return current
  const next = current === undefined ? zeroBuckets() : { ...current }
  models[modelKey] = next
  return next
}

/** 纯函数：把一个时间点合入某日活跃分段（升序且归并不重叠区间）。 */
function withActivity(state: MadrankState, ymd: string, timeMs: number): MadrankState['activity'] {
  const segs: Array<[number, number]> = (state.activity[ymd] ?? []).slice()

  // 尾段扩展（最常见路径）
  const tail = segs[segs.length - 1]
  if (tail && timeMs - tail[1] <= ACTIVITY_GAP_MS) {
    if (timeMs > tail[1]) segs[segs.length - 1] = [tail[0], timeMs]
  } else if (segs.length >= MAX_SEGMENTS_PER_DAY) {
    // 保守并入尾段：宁可低估活跃，不凭空拉长 —— 保证是使用时长的下界估计
    if (tail) segs[segs.length - 1] = [tail[0], Math.max(tail[1], timeMs)]
    else segs.push([timeMs, timeMs])
  } else {
    segs.push([timeMs, timeMs])
  }

  return { ...state.activity, [ymd]: segs }
}

function activeSecondsOf(segs: Array<[number, number]> | undefined): number {
  if (!segs || segs.length === 0) return 0
  let ms = 0
  for (const [s, e] of segs) ms += Math.max(0, e - s)
  return Math.round(ms / 1000)
}

/**
 * 纯转移：命中 usage 时必须返回**新的 state 引用**（0.2.x 注册表用 `Object.is(state)`
 * 做第一道门；原地改对象会被判定“状态未变”，view 不计算、onChanged 永不触发）。
 * 只为受影响的日子 / 模型桶复制新对象，其余结构保持引用共享。
 */
function sample(
  state: MadrankState,
  turn: number,
  step: number,
  timeMs: number,
  usage: TokenUsageBuckets,
): MadrankState {
  const ymd = ymdOf(timeMs)
  const modelKey = state.currentModelKey ?? 'unknown/unknown'
  const buckets = fromUsage(usage)
  const prev =
    state.last !== null && state.last.turn === turn && state.last.step === step
      ? state.last
      : null

  const days: MadrankState['days'] = { ...state.days }
  if (prev !== null) {
    subFrom(
      withBucket(withModels(days, state.days, prev.ymd), state.days[prev.ymd], prev.modelKey),
      prev.buckets,
    )
  }
  addInto(withBucket(withModels(days, state.days, ymd), state.days[ymd], modelKey), buckets)

  return {
    currentModelKey: state.currentModelKey,
    days,
    activity: withActivity(state, ymd, timeMs),
    last: { turn, step, ymd, modelKey, buckets },
  }
}

/** 纯转移函数。无关事件必须返回同一引用（零下游工作）。 */
export function applyEvent(state: MadrankState, event: SessionEventLike): MadrankState {
  switch (event.type) {
    case 'request/header': {
      const d = event.data as { header?: { config?: { provider?: unknown; model?: unknown } } }
      const provider = d?.header?.config?.provider
      const model = d?.header?.config?.model
      if (typeof provider === 'string' && typeof model === 'string') {
        const key = provider + '/' + model
        if (state.currentModelKey === key) return state
        return { ...state, currentModelKey: key }
      }
      return state
    }

    case 'assistant/chunk': {
      const d = event.data as {
        turn?: unknown; step?: unknown
        chunk?: { type?: unknown; usage?: TokenUsageBuckets }
      }
      if (
        d?.chunk?.type === 'usage' && d.chunk.usage &&
        typeof d.turn === 'number' && typeof d.step === 'number'
      ) {
        return sample(state, d.turn, d.step, event.time, d.chunk.usage)
      }
      return state
    }

    case 'assistant/message': {
      const d = event.data as { turn?: unknown; step?: unknown; usage?: TokenUsageBuckets }
      if (d?.usage && typeof d.turn === 'number' && typeof d.step === 'number') {
        return sample(state, d.turn, d.step, event.time, d.usage)
      }
      return state
    }

    default:
      return state
  }
}

// ── view ────────────────────────────────────────────────────

export interface DayView {
  models: Record<string, ModelBuckets>
  /** 该日合并活跃时长（秒）。跨会话重叠不扣减；多会话取最大者（保守显示口径）。 */
  activeSeconds: number
}

export interface UsageView {
  version: number
  days: Record<string, DayView>
  totalRequests: number
  totalPrimaryTokens: number
  totalCachedTokens: number
}

export function buildView(state: MadrankState): UsageView {
  let totalRequests = 0
  let totalPrimaryTokens = 0
  let totalCachedTokens = 0

  const days: Record<string, DayView> = {}
  for (const [ymd, models] of Object.entries(state.days)) {
    const dayModels: Record<string, ModelBuckets> = {}
    for (const [k, b] of Object.entries(models)) {
      dayModels[k] = { ...b }
      totalRequests += b.requests
      totalPrimaryTokens += b.inputTokens + b.outputTokens
      totalCachedTokens += b.cacheReadTokens + b.cacheWriteTokens
    }
    days[ymd] = { models: dayModels, activeSeconds: activeSecondsOf(state.activity[ymd]) }
  }

  return { version: STATE_VERSION, days, totalRequests, totalPrimaryTokens, totalCachedTokens }
}
