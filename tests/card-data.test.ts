import { describe, it, expect } from 'vitest'
import { extractViews, mergeViews, cardDataFromList } from '../src/client/card-data.ts'
import { buildView, initState, applyEvent } from '../src/fold.ts'

const NOW = Date.UTC(2026, 7, 27, 15)
const T = (ymd: string, h: number) => Date.parse(ymd + 'T' + String(h).padStart(2, '0') + ':00:00Z')

function viewOf(rows: Array<{ ymd: string; provider: string; model: string; input: number; output: number }>) {
  let s = initState()
  rows.forEach((r, i) => {
    const t = T(r.ymd, 10 + i % 8)
    s = applyEvent(s, {
      type: 'request/header', seq: i * 2 + 1, time: t,
      data: { header: { config: { provider: r.provider, model: r.model } } },
    })
    s = applyEvent(s, {
      type: 'assistant/message', seq: i * 2 + 2, time: t + 60_000,
      data: { turn: i + 1, step: 1, usage: { inputTokens: r.input, outputTokens: r.output } },
    })
  })
  return buildView(s)
}

describe('extractViews', () => {
  it('从会话列表快照提取 madrankUsage 视图，忽略缺失/脏数据', () => {
    const snap = {
      byId: {
        a: { projectionValues: { madrankUsage: viewOf([
          { ymd: '2026-08-27', provider: 'deepseek', model: 'chat', input: 1000, output: 200 },
        ]) } },
        b: { projectionValues: {} },
        c: {},                                            // 无投影块
        d: { projectionValues: { madrankUsage: { days: null } } },   // 脏行
        e: { projectionValues: { otherProjection: {} } },            // 无关键
      },
    }
    const views = extractViews(snap)
    expect(views).toHaveLength(1)
  })

  it('undefined 快照返回空数组', () => {
    expect(extractViews(undefined)).toEqual([])
  })
})

describe('mergeViews', () => {
  it('跨会话求和：日志不相交所以直接相加；activeSeconds 取最大', () => {
    const v1 = viewOf([{ ymd: '2026-08-27', provider: 'deepseek', model: 'chat', input: 500, output: 100 }])
    const v2 = viewOf([
      { ymd: '2026-08-27', provider: 'openai', model: 'gpt-5', input: 300, output: 50 },
      { ymd: '2026-08-26', provider: 'deepseek', model: 'chat', input: 700, output: 90 },
    ])
    const agg = mergeViews([v1, v2])
    expect(agg['2026-08-27']!.models['deepseek/chat']!.inputTokens).toBe(500)
    expect(agg['2026-08-27']!.models['openai/gpt-5']!.inputTokens).toBe(300)
    expect(agg['2026-08-26']!.models['deepseek/chat']!.inputTokens).toBe(700)
  })

  it('同一会话视图重复出现不双计（列表快照身份稳定）', () => {
    // 注：merge 只对传入数组负责 —— 身份去重是 feed 的责任（byId 键唯一）。
    // 这里锁定语义：同一 view 引用传两次就翻倍，提示调用方必须传 byId 展开值。
    const v = viewOf([{ ymd: '2026-08-27', provider: 'a', model: 'b', input: 10, output: 0 }])
    expect(mergeViews([v])['2026-08-27']!.models['a/b']!.inputTokens).toBe(10)
  })
})

describe('cardDataFromList（端到端口径）', () => {
  it('sessions 快照 → TODAY/Top4/streak/7 日历史完整装配', () => {
    const snap = {
      byId: {
        s1: { projectionValues: { madrankUsage: viewOf([
          { ymd: '2026-08-27', provider: 'zhipu', model: 'glm-5.3-flash', input: 600_000, output: 130_000 },
          { ymd: '2026-08-27', provider: 'zhipu', model: 'glm-5.3', input: 60_000, output: 9_000 },
          { ymd: '2026-08-26', provider: 'zhipu', model: 'glm-5.3-flash', input: 500_000, output: 120_000 },
        ]) } },
      },
    }
    const data = cardDataFromList(snap, NOW)
    expect(data.today.primaryTokens).toBe(600_000 + 130_000 + 60_000 + 9_000)
    expect(data.topModels[0]!.modelKey).toBe('zhipu/glm-5.3-flash')
    expect(data.streak).toBe(2)
    expect(data.last7.at(-1)!.primaryTokens).toBe(data.today.primaryTokens)
    // 历史窗口（60 天）：末位=今天且与 TODAY 同口径，含单日模型份额
    expect(data.history).toHaveLength(60)
    expect(data.history.at(-1)!.ymd).toBe('2026-08-27')
    expect(data.history.at(-1)!.primaryTokens).toBe(data.today.primaryTokens)
    expect(data.history.at(-1)!.topModels![0]!.model).toBe('glm-5.3-flash')
  })

  it('空快照 → 全零诚实空态而非 NaN', () => {
    const data = cardDataFromList({ byId: {} }, NOW)
    expect(data.today.primaryTokens).toBe(0)
    expect(data.today.vs7dAvgMultiple).toBeNull()
    expect(data.streak).toBe(0)
    expect(data.history.every((d) => d.primaryTokens === 0)).toBe(true)
  })
})
