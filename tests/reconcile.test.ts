/**
 * Golden Cases 对账套件（P1-A）。
 *
 * 判据链：madrankUsage fold ≡ token-meter 参照移植（tools/reference-token-meter.ts，
 * 逐行镜像 packages/llm/token-meter/src/usage-projection.ts）≡ 手算字面量。
 * 通过后，数据层对 DSH 原生语义的一致性由结构保证；
 * 真实流量的最终对账用 npm run reconcile -- <session-log> 人工复核 StatsLine。
 */

import { describe, it, expect } from 'vitest'
import { applyEvent, buildView, initState } from '../src/fold.ts'
import { refApply, refInit, refTotals } from '../tools/reference-token-meter.ts'
import { PRIMARY_TOKENS, CACHED_TOKENS } from '../src/caliber.ts'
import type { SessionEventLike } from '../src/compat.ts'

let seq = 0
const T = (h: number, m = 0) => Date.UTC(2026, 7, 27, h, m)
const ev = (type: string, data: unknown, time: number): SessionEventLike =>
  ({ type, seq: ++seq, time, data })
const header = (p: string, mo: string, t: number) =>
  ev('request/header', { header: { config: { provider: p, model: mo } }, reason: 'initial' }, t)
const chunkU = (turn: number, step: number, u: Usage, t: number) =>
  ev('assistant/chunk', { turn, step, chunk: { type: 'usage', usage: u } }, t)
const msgU = (turn: number, step: number, u: Usage, t: number) =>
  ev('assistant/message', { turn, step, usage: u }, t)

interface Usage {
  inputTokens: number; outputTokens: number
  cacheReadTokens?: number; cacheWriteTokens?: number
}

function runBoth(events: SessionEventLike[]) {
  let ours = initState()
  const ref = refInit()
  for (const e of events) {
    ours = applyEvent(ours, e)
    refApply(ref, e)
  }
  return { view: buildView(ours), refTotals: refTotals(ref) }
}

function expectEqual(view: ReturnType<typeof buildView>, ref: ReturnType<typeof refTotals>) {
  // 分桶维度是我们特有的；全局合计必须逐桶一致 —— 这就是对账判据
  let oursUncachedIn = 0, oursOut = 0, oursCr = 0, oursCw = 0, ourReqs = 0
  for (const day of Object.values(view.days)) {
    for (const b of Object.values(day.models)) {
      oursUncachedIn += b.inputTokens
      oursOut += b.outputTokens
      oursCr += b.cacheReadTokens
      oursCw += b.cacheWriteTokens
      ourReqs += b.requests
    }
  }
  expect(oursUncachedIn).toBe(ref.uncachedInputTokens)
  expect(oursOut).toBe(ref.outputTokens)
  expect(oursCr).toBe(ref.cacheReadTokens)
  expect(oursCw).toBe(ref.cacheWriteTokens)
  void ourReqs
}

describe('Golden Case A：普通请求', () => {
  it('input=10K output=3K → Primary=13K，与参照逐桶一致', () => {
    const events = [
      header('deepseek', 'deepseek-chat', T(9)),
      msgU(1, 1, { inputTokens: 10_000, outputTokens: 3_000 }, T(9, 1)),
    ]
    const { view, refTotals } = runBoth(events)
    expectEqual(view, refTotals)

    const d = view.days['2026-08-27']!.models['deepseek/deepseek-chat']!
    expect(PRIMARY_TOKENS(d)).toBe(13_000)
    expect(d.requests).toBe(1)
  })
})

describe('Golden Case B：缓存请求', () => {
  it('cacheRead 不混入 uncached input；口径分列', () => {
    const events = [
      header('deepseek', 'deepseek-chat', T(10)),
      msgU(1, 1, { inputTokens: 10_000, outputTokens: 3_000, cacheReadTokens: 100_000 }, T(10, 5)),
    ]
    const { view, refTotals } = runBoth(events)
    expectEqual(view, refTotals)

    const d = view.days['2026-08-27']!.models['deepseek/deepseek-chat']!
    expect(PRIMARY_TOKENS(d)).toBe(13_000)          // 主数字不含缓存
    expect(CACHED_TOKENS(d)).toBe(100_000)          // 缓存单列
    expect(d.inputTokens).toBe(10_000)
  })
})

describe('Golden Case C：同 step 替换不双计', () => {
  it('chunk(100/50) → message 最终值整槽替换', () => {
    const events = [
      header('deepseek', 'deepseek-chat', T(11)),
      chunkU(2, 1, { inputTokens: 100, outputTokens: 50 }, T(11, 0)),
      msgU(2, 1, { inputTokens: 120, outputTokens: 70 }, T(11, 0)),
    ]
    const { view, refTotals } = runBoth(events)
    expectEqual(view, refTotals)

    const d = view.days['2026-08-27']!.models['deepseek/deepseek-chat']!
    expect(d.inputTokens).toBe(120)
    expect(d.outputTokens).toBe(70)
    expect(d.requests).toBe(1)
  })
})

describe('Golden Case D：跨午夜', () => {
  it('23:59 与 00:01 分别入两个 UTC 日；总量仍对齐参照', () => {
    const t2359 = Date.UTC(2026, 7, 27, 23, 59)
    const t0001 = Date.UTC(2026, 7, 28, 0, 1)
    const events = [
      header('deepseek', 'deepseek-chat', t2359),
      msgU(3, 1, { inputTokens: 500, outputTokens: 100 }, t2359),
      msgU(3, 2, { inputTokens: 700, outputTokens: 200 }, t0001),
    ]
    const { view, refTotals } = runBoth(events)
    expectEqual(view, refTotals)

    expect(view.days['2026-08-27']!.models['deepseek/deepseek-chat']).toBeDefined()
    expect(Object.keys(view.days).sort()).toEqual(['2026-08-27', '2026-08-28'])
    const sum =
      view.days['2026-08-27']!.models['deepseek/deepseek-chat']!.inputTokens +
      view.days['2026-08-28']!.models['deepseek/deepseek-chat']!.inputTokens
    expect(sum).toBe(1_200)
  })
})

describe('Golden Case E：失败请求的 usage chunk 也计入', () => {
  it('chunk 之后没有 message（请求失败），usage 已按 token-meter 语义入账', () => {
    const events = [
      header('deepseek', 'deepseek-chat', T(14)),
      chunkU(4, 1, { inputTokens: 800, outputTokens: 0 }, T(14, 2)),
      ev('error/occurred', { turn: 4, step: 1, error: { code: 'provider' } }, T(14, 3)),
    ]
    const { view, refTotals } = runBoth(events)
    expectEqual(view, refTotals)

    const d = view.days['2026-08-27']!.models['deepseek/deepseek-chat']!
    expect(d.inputTokens).toBe(800)
    expect(d.requests).toBe(1)
  })
})

describe('总量等价压力：混合流量（含同 step 多次替换 + 换模 + 空转事件）', () => {
  it('任何顺序下 madrank 全局合计 ≡ 参照折叠器', () => {
    const events = [
      header('deepseek', 'r1', T(8)),
      chunkU(1, 1, { i: 0, o: 0 } as never as Usage, T(8, 0)),   // 空流样本
      msgU(1, 1, { inputTokens: 900, outputTokens: 300 }, T(8, 1)),
      header('openai', 'gpt-5', T(8, 30)),                        // epoch 换模
      chunkU(2, 1, { inputTokens: 5000, outputTokens: 1500, cacheReadTokens: 20_000 }, T(8, 31)),
      msgU(2, 1, { inputTokens: 5200, outputTokens: 1600, cacheReadTokens: 21_000 }, T(8, 32)),
      ev('tool/call', { turn: 2, step: 1, name: 'fs' }, T(8, 33)),   // 无关事件
      msgU(2, 2, { inputTokens: 777, outputTokens: 88 }, T(8, 40)),
      header('deepseek', 'r1', T(9)),                             // 换回
      msgU(3, 1, { inputTokens: 1234, outputTokens: 567 }, T(9, 15)),
    ]

    interface Usage2 { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
    // 展开 i/o 简写
    const normalized: SessionEventLike[] = events.map((e, idx) => {
      if (e.type === 'assistant/chunk' || e.type === 'assistant/message') {
        const d = e.data as { turn: number; step: number; chunk?: { type: string; usage?: Record<string, number> }; usage?: Record<string, number> }
        const src = d.chunk?.usage ?? d.usage
        if (src && typeof (src as unknown as { i?: number }).i === 'number') {
          const u = src as never as { i: number; o: number; cr?: number }
          const fixed = { inputTokens: u.i, outputTokens: u.o, cacheReadTokens: u.cr ?? 0 }
          const clone = JSON.parse(JSON.stringify(e)) as SessionEventLike
          const dd = clone.data as Record<string, unknown>
          if (dd.chunk) (dd.chunk as { usage: unknown }).usage = fixed
          else dd.usage = fixed
          return clone
        }
        void idx
      }
      return e
    })

    const { view, refTotals } = runBoth(normalized)
    expectEqual(view, refTotals)
  })
})