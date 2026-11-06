// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageStore } from '../src/store.ts'
import { cardDataFromList } from '../src/client/card-data.ts'
import type { UsageView } from '../src/fold.ts'

const buckets = (n: number) => ({ inputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 1 })
const view = (days: Record<string, number>): UsageView => ({
  version: 2,
  days: Object.fromEntries(Object.entries(days).map(([ymd, n]) => [ymd, { models: { m: buckets(n) }, activeSeconds: 1 }])),
  totalRequests: Object.keys(days).length,
  totalPrimaryTokens: Object.values(days).reduce((a, b) => a + b, 0),
  totalCachedTokens: 0,
})

describe('清除本地数据（clearedAt 语义）', () => {
  it('store：设置清除点后裁剪旧历史；之后 replaceSession 也不会带回旧日期', () => {
    const dir = mkdtempSync(join(tmpdir(), 'madrank-clear-'))
    try {
      const store = new UsageStore(dir, 2, 'usage-store.json', 0)
      store.replaceSession('s1', 5, view({ '2026-01-01': 10, '2026-01-03': 30 }))
      const cutoff = Date.UTC(2026, 0, 3)
      expect(store.setClearedAt(cutoff)).toBe(true)
      const agg = store.aggregateDays()
      expect(agg['2026-01-01']).toBeUndefined()
      expect(agg['2026-01-03']).toBeTruthy()

      // 清除后新 view 仍带旧日期 → 不入账（会话历史投影不会把清掉的旧数据带回来）
      store.replaceSession('s2', 6, view({ '2026-01-02': 20, '2026-01-04': 40 }))
      const agg2 = store.aggregateDays()
      expect(agg2['2026-01-02']).toBeUndefined()
      expect(agg2['2026-01-04']).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('client 聚合：早于清除日的历史不计入卡片', () => {
    const snap = {
      byId: {
        a: { projectionValues: { madrankUsage: view({ '2026-01-01': 10, '2026-01-04': 40 }) } },
      },
    }
    const clearedAt = Date.UTC(2026, 0, 4)
    const filtered = cardDataFromList(snap as never, Date.UTC(2026, 0, 5), clearedAt)
    const total = filtered.history.reduce((a, d) => a + d.primaryTokens, 0)
    // 只剩 01-04 的 40
    expect(total).toBe(40)
    const unfiltered = cardDataFromList(snap as never, Date.UTC(2026, 0, 5), 0)
    expect(unfiltered.history.reduce((a, d) => a + d.primaryTokens, 0)).toBe(50)
  })
})
