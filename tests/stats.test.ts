import { describe, it, expect } from 'vitest'
import { lastNDays, streakDays, topModels, todayCard, raceMetric7d } from '../src/stats.ts'
import type { DayAggregate } from '../src/stats.ts'

const NOW = Date.UTC(2026, 7, 27, 15)   // 2026-08-27T15:00Z
const day = (ymd: string, input: number, output: number, model = 'deepseek/chat'): DayAggregate[string] => ({
  models: { [model]: {
    inputTokens: input, outputTokens: output,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    requests: Math.max(1, Math.round((input + output) / 1000)),
  } },
  activeSeconds: 3600,
})

function fixture(): DayAggregate {
  return {
    '2026-08-21': day('2026-08-21', 300_000, 100_000),
    '2026-08-22': day('2026-08-22', 200_000, 80_000),
    // 23/24/25 空缺 —— 检验均值分母与 streak 断点
    '2026-08-26': day('2026-08-26', 500_000, 120_000),
    '2026-08-27': {
      models: {
        'deepseek/chat': { inputTokens: 800_000, outputTokens: 300_000, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 300 },
        'openai/gpt-5': { inputTokens: 400_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 90 },
        'anthropic/claude-opus': { inputTokens: 10_000, outputTokens: 5_000, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 6 },
      },
      activeSeconds: 7200,
    },
  }
}

describe('todayCard', () => {
  it('主数字=uncached input+output，缓存单列；倍数基于过去 7 天有数日的日均', () => {
    const c = todayCard(fixture(), NOW)
    expect(c.ymd).toBe('2026-08-27')
    expect(c.primaryTokens).toBe(1_615_000)
    expect(c.inputTokens).toBe(1_210_000)
    expect(c.outputTokens).toBeGreaterThan(0)
    expect(c.vs7dAvgMultiple).toBeGreaterThan(2)
  })

  it('无历史 → 倍数为 null（不显示伪基准）', () => {
    const c = todayCard({ '2026-08-27': day('2026-08-27', 100, 50) }, NOW)
    expect(c.vs7dAvgMultiple).toBeNull()
  })
})

describe('7 日历史与 streak', () => {
  it('lastNDays 固定返回 7 天、缺日为零值', () => {
    const hist = lastNDays(fixture(), NOW, 7)
    expect(hist).toHaveLength(7)
    expect(hist[0]!.ymd).toBe('2026-08-21')
    expect(hist.at(-1)!.ymd).toBe('2026-08-27')
    expect(hist.find(h => h.ymd === '2026-08-24')!.primaryTokens).toBe(0)
  })

  it('streak：昨天+今天连续算 2；今天为空时回看昨天', () => {
    expect(streakDays(fixture(), NOW)).toBe(2)
    const emptyToday = fixture()
    delete emptyToday['2026-08-27']
    expect(streakDays(emptyToday, NOW)).toBe(1)
  })
})

describe('topModels', () => {
  it('按 Primary 排序取 Top4 并给出份额百分比', () => {
    const tops = topModels(fixture(), '2026-08-27')
    expect(tops).toHaveLength(3)
    expect(tops[0]!.modelKey).toBe('deepseek/chat')
    expect(tops[1]!.provider).toBe('openai')
    const totalPct = tops.reduce((a, b) => a + b.sharePct, 0)
    expect(totalPct).toBeLessThanOrEqual(100.1)
  })

  it('空日返回空数组而不是 NaN', () => {
    expect(topModels({}, '2026-08-27')).toEqual([])
  })
})

describe('raceMetric7d', () => {
  it('窗口=最近 7 个 UTC 日 Primary 合计（今天是窗口成员）', () => {
    const v = raceMetric7d(fixture(), NOW)
    expect(v).toBe(300_000 + 100_000 + 200_000 + 80_000 + 500_000 + 120_000 + 1_615_000)
  })
})