import { describe, it, expect } from 'vitest'
import { applyEvent, buildView, initState, ymdOf } from '../src/fold.ts'
import type { MadrankState } from '../src/fold.ts'

const T0 = Date.UTC(2026, 7, 27, 12, 0, 0)          // 2026-08-27T12:00Z
const T_NEXT_DAY = Date.UTC(2026, 7, 28, 0, 30, 0)  // 跨午夜之后

let seq = 0
const ev = (type: string, data: unknown, time = T0) =>
  ({ type, seq: ++seq, time, data })

const header = (provider: string, model: string) =>
  ev('request/header', { header: { config: { provider, model } }, reason: 'initial' })

const usageChunk = (turn: number, step: number, u: { i: number; o: number; cr?: number; cw?: number }, time?: number) =>
  ev('assistant/chunk', {
    turn, step,
    chunk: { type: 'usage', usage: {
      inputTokens: u.i, outputTokens: u.o,
      cacheReadTokens: u.cr ?? 0, cacheWriteTokens: u.cw ?? 0,
    } },
  }, time)

const finalMessage = (turn: number, step: number, u: { i: number; o: number; cr?: number; cw?: number }, time?: number) =>
  ev('assistant/message', {
    turn, step,
    usage: {
      inputTokens: u.i, outputTokens: u.o,
      cacheReadTokens: u.cr ?? 0, cacheWriteTokens: u.cw ?? 0,
    },
  }, time)

function run(state: MadrankState, ...events: ReturnType<typeof ev>[]): MadrankState {
  for (const e of events) state = applyEvent(state, e)
  return state
}

describe('madrankUsage fold', () => {
  it('无关事件返回同一引用（零下游工作）', () => {
    const s = initState()
    expect(applyEvent(s, ev('user/message', {}))).toBe(s)
    expect(applyEvent(s, ev('tool/call', { name: 'x' }))).toBe(s)
  })

  it('基础累计：chunk + message 各一次，四桶与请求数正确', () => {
    const s = run(initState(),
      header('deepseek', 'deepseek-chat'),
      usageChunk(1, 1, { i: 100, o: 50, cr: 200 }),
      finalMessage(2, 1, { i: 110, o: 60 }),
    )
    const v = buildView(s)
    const m = v.days[ymdOf(T0)]!.models['deepseek/deepseek-chat']!
    expect(m.inputTokens).toBe(210)
    expect(m.outputTokens).toBe(110)
    expect(m.cacheReadTokens).toBe(200)
    expect(m.requests).toBe(2)
  })

  it('同一 (turn,step) 的 message 替换 chunk，绝不双计（token-meter 同构）', () => {
    const s = run(initState(),
      header('deepseek', 'deepseek-chat'),
      usageChunk(3, 1, { i: 100, o: 50 }),
      finalMessage(3, 1, { i: 120, o: 70 }),   // 最终值替换流式估值
    )
    const m = buildView(s).days[ymdOf(T0)]!.models['deepseek/deepseek-chat']!
    expect(m.inputTokens).toBe(120)
    expect(m.outputTokens).toBe(70)
    expect(m.requests).toBe(1)
  })

  it('不同 step 的样本各自独立入账', () => {
    const s = run(initState(),
      header('deepseek', 'deepseek-chat'),
      usageChunk(1, 1, { i: 10, o: 5 }),
      usageChunk(1, 2, { i: 20, o: 8 }),
      finalMessage(1, 3, { i: 30, o: 9 }),
    )
    const m = buildView(s).days[ymdOf(T0)]!.models['deepseek/deepseek-chat']!
    expect(m.inputTokens).toBe(60)
    expect(m.requests).toBe(3)
  })

  it('模型归因跟随最近的 request/header；header 未变时引用稳定', () => {
    const h = header('deepseek', 'deepseek-chat')
    let s = initState()
    s = applyEvent(s, h)
    const before = s.currentModelKey
    s = applyEvent(s, header('deepseek', 'deepseek-chat')) // 相同 header
    expect(before).toBe('deepseek/deepseek-chat')
    expect(s.currentModelKey).toBe(before)

    s = run(s,
      usageChunk(1, 1, { i: 10, o: 2 }),
      header('openai', 'gpt-5'),
      usageChunk(1, 2, { i: 99, o: 4 }),
    )
    const dayModels = buildView(s).days[ymdOf(T0)]!.models
    expect(dayModels['deepseek/deepseek-chat']!.inputTokens).toBe(10)
    expect(dayModels['openai/gpt-5']!.inputTokens).toBe(99)
  })

  it('跨 UTC 午夜自然分桶到两天', () => {
    const s = run(initState(),
      header('deepseek', 'r1'),
      usageChunk(1, 1, { i: 10, o: 1 }, T0),
      usageChunk(1, 2, { i: 20, o: 2 }, T_NEXT_DAY),
    )
    const v = buildView(s)
    expect(Object.keys(v.days).sort()).toEqual(['2026-08-27', '2026-08-28'])
    expect(v.days['2026-08-28']!.models['deepseek/r1']!.inputTokens).toBe(20)
  })

  it('已知限制：header 缺失时样本计入 unknown/unknown（不丢弃）', () => {
    const s = run(initState(), usageChunk(1, 1, { i: 7, o: 1 }))
    const v = buildView(s)
    expect(v.days[ymdOf(T0)]!.models['unknown/unknown']!.inputTokens).toBe(7)
  })
})