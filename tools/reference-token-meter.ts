/**
 * reference-token-meter.ts — @deepseek-ai/dsh-token-meter "tokenUsage"
 * 投影语义的独立移植（对照基准，不进入运行时依赖）。
 *
 * 移植自 packages/llm/token-meter/src/usage-projection.ts：
 * - 全局四桶 totals；
 * - 单 last 槽按 (turn, step) 整槽替换（addReplacing）；
 * - chunk usage 与 message usage 均为样本；失败请求的 usage 也计入。
 *
 * 对账判据：同一事件流上，reference.totals 必须与 madrankUsage 的
 * 全局合计完全一致（分桶维度是我们特有的，故只比总量）。
 */

import type { SessionEventLike, TokenUsageBuckets } from '../src/compat.ts'

export interface RefBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface RefState {
  totals: RefBuckets
  last: { turn: number; step: number; buckets: RefBuckets } | null
}

const zero = (): RefBuckets => ({
  uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
})

const fromUsage = (u: TokenUsageBuckets): RefBuckets => ({
  uncachedInputTokens: u.inputTokens ?? 0,
  outputTokens: u.outputTokens ?? 0,
  cacheReadTokens: u.cacheReadTokens ?? 0,
  cacheWriteTokens: u.cacheWriteTokens ?? 0,
})

function addReplacing(totals: RefBuckets, prev: RefBuckets | undefined, next: RefBuckets): void {
  for (const k of Object.keys(zero()) as Array<keyof RefBuckets>) {
    totals[k] = totals[k] - (prev?.[k] ?? 0) + next[k]
  }
}

const usageOf = (e: SessionEventLike): TokenUsageBuckets | undefined => {
  const d = e.data as {
    turn?: unknown; step?: unknown
    chunk?: { type?: unknown; usage?: TokenUsageBuckets }
    usage?: TokenUsageBuckets
  }
  if (e.type === 'assistant/chunk' && d?.chunk?.type === 'usage') return d.chunk.usage!
  if (e.type === 'assistant/message') return d.usage
  return undefined
}

export function refInit(): RefState {
  return { totals: zero(), last: null }
}

export function refApply(state: RefState, event: SessionEventLike): RefState {
  const d = event.data as { turn?: unknown; step?: unknown }
  const usage = usageOf(event)
  if (!usage || typeof d.turn !== 'number' || typeof d.step !== 'number') return state

  const buckets = fromUsage(usage)
  const prev =
    state.last && state.last.turn === d.turn && state.last.step === d.step
      ? state.last.buckets
      : undefined

  addReplacing(state.totals, prev, buckets)
  state.last = { turn: d.turn, step: d.step, buckets }
  return state
}

export function refTotals(state: RefState): RefBuckets {
  return { ...state.totals }
}
