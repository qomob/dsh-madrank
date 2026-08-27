import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageStore } from '../src/store.ts'
import { composeDayPayload, syncPendingDays, yesterdayYmd } from '../src/sync.ts'
import { buildView, initState, applyEvent } from '../src/fold.ts'
import type { UsageView } from '../src/fold.ts'

function makeView(rows: Array<[string, string, number]>): UsageView {
  // [ymd, provider/model, inputTokens]
  let state = initState()
  for (const [date, modelKey] of rows) {
    const slash = modelKey.indexOf('/')
    const t = Date.parse(date + 'T00:00:00Z') + 3_600_000
    state = applyEvent(state, {
      type: 'request/header', seq: 1, time: t,
      data: { header: { config: { provider: modelKey.slice(0, slash), model: modelKey.slice(slash + 1) } } },
    })
    state = applyEvent(state, {
      type: 'assistant/message', seq: 2, time: t + 60_000,
      data: {
        turn: 9, step: Math.floor(Math.random() * 1000) + 10, // 随机 step 避免跨行误替换
        usage: { inputTokens: rows.find(r => r[0] === date && r[1] === modelKey)![2], outputTokens: 0 },
      },
    })
  }
  return buildView(state)
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'madrank-test-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('UsageStore', () => {
  it('按会话整体替换：重复 replace 不产生双计', () => {
    const store = new UsageStore(dir)
    const view = makeView([['2026-08-26', 'deepseek/chat', 500]])
    store.replaceSession('s1', 10, view)
    store.replaceSession('s1', 11, view)
    const agg = store.aggregateDays()
    expect(agg['2026-08-26']!.models['deepseek/chat']!.inputTokens).toBe(500)
  })

  it('活跃时长随 view 入切片，聚合取多会话最大者（保守口径）', () => {
    const store = new UsageStore(dir)
    const base = makeView([['2026-08-26', 'a/b', 100]])
    store.replaceSession('s-a', 1, { ...base, days: { ...base.days, '2026-08-26': { ...base.days['2026-08-26']!, activeSeconds: 3600 } } })
    store.replaceSession('s-b', 2, { ...base, days: { ...base.days, '2026-08-26': { ...base.days['2026-08-26']!, activeSeconds: 600 } } })
    expect(store.aggregateDays()['2026-08-26']!.activeSeconds).toBe(3600)
  })

  it('flush 后可重载；状态版本不符则整体作废重建', () => {
    const store = new UsageStore(dir)
    store.replaceSession('s1', 1, makeView([['2026-08-26', 'a/b', 100]]))
    store.flush()
    const reloaded = new UsageStore(dir)
    expect(reloaded.aggregateDays()['2026-08-26']!.models['a/b']!.requests).toBe(1)

    const mismatched = new UsageStore(dir, 999)
    expect(Object.keys(mismatched.aggregateDays())).toHaveLength(0)
  })

  it('wipe 清空一切（Export/Delete 权利）', () => {
    const store = new UsageStore(dir)
    store.replaceSession('s1', 1, makeView([['2026-08-26', 'a/b', 100]]))
    store.markUploaded('2026-08-26', 'https://x')
    store.wipe()
    expect(store.isUploaded('2026-08-26')).toBe(false)
    expect(Object.keys(store.aggregateDays())).toHaveLength(0)
  })
})

describe('sync（日级批量、只传已结束的日）', () => {
  it('composeDayPayload 口径：cacheWrite 并入 input，cacheRead 单列', () => {
    const payload = composeDayPayload('anon-x', '2026-08-26', {
      'deepseek/chat': { inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 10, requests: 2 },
    })
    expect(payload.schemaVersion).toBe(1) // Usage Protocol v1 冻结字段
    expect(payload.days[0]!.models[0]).toMatchObject({
      model: 'deepseek/chat', input: 110, output: 40, cacheRead: 900, requests: 2,
    })
  })

  it('未开启 → 绝不出网', async () => {
    const store = new UsageStore(dir)
    let calls = 0
    const fakeFetch = (async () => { calls++; return new Response('{}') }) as typeof fetch
    const out = await syncPendingDays(store, { enabled: false, endpoint: 'https://e' }, () => 'a', fakeFetch)
    expect(out).toHaveLength(0)
    expect(calls).toBe(0)
  })

  it('当天数据永不上传；昨日成功后标记幂等', async () => {
    const store = new UsageStore(dir)
    const today = new Date().toISOString().slice(0, 10)
    store.replaceSession('s1', 1, makeView([
      [today, 'deepseek/chat', 111],
      ['2026-08-26', 'deepseek/chat', 222],
    ]))

    const bodies: string[] = []
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch

    const settings = { enabled: true, endpoint: 'https://madrank.test/ingest' }
    const out1 = await syncPendingDays(store, settings, () => 'anon-1', fakeFetch)
    expect(out1.map(o => o.date)).toEqual(['2026-08-26'])
    expect(out1[0]!.ok).toBe(true)

    const sent = JSON.parse(bodies[0]!) as { anonId: string; days: Array<{ date: string }> }
    expect(sent.anonId).toBe('anon-1')
    expect(sent.days[0]!.date).toBe('2026-08-26')

    const out2 = await syncPendingDays(store, settings, () => 'anon-1', fakeFetch)
    expect(out2).toHaveLength(0)
  })

  it('失败不标记可重试；yesterdayYmd 基于 UTC', async () => {
    const store = new UsageStore(dir)
    store.replaceSession('s1', 1, makeView([['2026-08-25', 'a/b', 5]]))
    const failing = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch
    const out = await syncPendingDays(store, { enabled: true, endpoint: 'https://e' }, () => 'a', failing)
    expect(out[0]!.ok).toBe(false)
    expect(store.isUploaded('2026-08-25')).toBe(false)

    expect(yesterdayYmd(Date.UTC(2026, 7, 27, 12))).toBe('2026-08-26')
  })
})
