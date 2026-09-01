import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseIngestRace,
  recordFromRace,
  parseGlobalRecord,
  cardGlobalFromRecord,
  raceUrlFromEndpoint,
  sameOrigin,
} from '../src/global-rank.ts'
import { readGlobalRank, writeGlobalRank, globalRankPath } from '../src/global-rank-file.ts'
import { buildCardSnapshot } from '../src/snapshot.ts'
import { UsageStore } from '../src/store.ts'
import { buildView, initState, applyEvent } from '../src/fold.ts'

const okRace = {
  participants: 2481,
  windowStart: '2026-08-24',
  windowEnd: '2026-08-30',
  leaders: { items: [{ rank: 1, maskAnon: '••A91F', total: 82_400_000 }] },
  me: { rank: 1284, total: 8_210_000, topPct: 7.4 },
}

import { writeFileSync } from 'node:fs'

describe('parseIngestRace（宽容解析，坏形状一律 null）', () => {
  it('完整 race：participants + me 三元组', () => {
    expect(parseIngestRace(okRace)).toEqual({
      participants: 2481,
      windowStart: '2026-08-24',
      windowEnd: '2026-08-30',
      me: { rank: 1284, total: 8_210_000, topPct: 7.4 },
    })
  })
  it('me=null（无完整统计周期）是合法形状', () => {
    expect(parseIngestRace({ participants: 0, me: null })?.me).toBeNull()
  })
  it('participants 缺失 / me 形状坏 / 非对象 → null', () => {
    expect(parseIngestRace({ me: null })).toBeNull()
    expect(parseIngestRace({ participants: 'x', me: null })).toBeNull()
    expect(parseIngestRace({ participants: 3, me: { rank: 'x', total: 1, topPct: 1 } })).toBeNull()
    expect(parseIngestRace('nope')).toBeNull()
    expect(parseIngestRace(null)).toBeNull()
  })
})

describe('recordFromRace / parseGlobalRecord / cardGlobalFromRecord', () => {
  it('race → 记录（带 endpoint + updatedAt）；me 缺位 → null', () => {
    const view = parseIngestRace(okRace)!
    const rec = recordFromRace(view, 'https://madrank.test/ingest', 1_700_000_000_000)
    expect(rec).toMatchObject({
      rank: 1284, total: 8_210_000, topPct: 7.4, participants: 2481,
      endpoint: 'https://madrank.test/ingest', updatedAt: 1_700_000_000_000,
    })
    expect(recordFromRace({ participants: 5, me: null }, 'https://x', 0)).toBeNull()
  })
  it('记录 → wire → 卡片形状往返；race7d = total', () => {
    const rec = recordFromRace(parseIngestRace(okRace)!, 'https://e', 1)
    const round = parseGlobalRecord(JSON.parse(JSON.stringify(rec)))
    expect(cardGlobalFromRecord(round)).toEqual({
      rank: 1284, topPct: 7.4, race7d: 8_210_000, participants: 2481, updatedAt: 1,
    })
  })
  it('坏记录 / null → 卡片 null（诚实空态）', () => {
    expect(cardGlobalFromRecord(null)).toBeNull()
    expect(cardGlobalFromRecord({ nope: 1 } as never)).toBeNull()
    expect(parseGlobalRecord('garbage')).toBeNull()
  })
})

describe('raceUrlFromEndpoint / sameOrigin（self-host 卫生项）', () => {
  it('从 endpoint origin 派生 /race；异常与缺席回退官方主站', () => {
    expect(raceUrlFromEndpoint('https://madrank.ai/api/usage/ingest')).toBe('https://madrank.ai/race')
    expect(raceUrlFromEndpoint('http://127.0.0.1:3000/api/usage/ingest')).toBe('http://127.0.0.1:3000/race')
    expect(raceUrlFromEndpoint(undefined)).toBe('https://madrank.ai/race')
    expect(raceUrlFromEndpoint('not a url')).toBe('https://madrank.ai/race')
  })
  it('sameOrigin 判定换端点场景', () => {
    expect(sameOrigin('https://a/x', 'https://a/y')).toBe(true)
    expect(sameOrigin('https://a/x', 'https://b/y')).toBe(false)
    expect(sameOrigin(undefined, 'https://b')).toBe(false)
  })
})

describe('宿主侧持久化 + 快照贯通（P0-1 数据路径）', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'madrank-gr-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function seedStore(): UsageStore {
    const store = new UsageStore(dir)
    let state = initState()
    const t = Date.UTC(2026, 7, 26, 1)
    state = applyEvent(state, {
      type: 'request/header', seq: 1, time: t,
      data: { header: { config: { provider: 'deepseek', model: 'chat' } } },
    })
    state = applyEvent(state, {
      type: 'assistant/message', seq: 2, time: t + 60_000,
      data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 100_000 } },
    })
    store.replaceSession('s1', 2, buildView(state))
    return store
  }

  it('write → read 往返；坏文件 → null；缺席 → null', () => {
    expect(readGlobalRank(dir)).toBeNull()
    const rec = recordFromRace(parseIngestRace(okRace)!, 'https://e', 42)!
    writeGlobalRank(dir, rec)
    expect(readGlobalRank(dir)).toEqual(rec)
    writeFileSync(globalRankPath(dir), '{broken')
    expect(readGlobalRank(dir)).toBeNull()
  })

  it('buildCardSnapshot 携带 global（v3）；缺省参退化为 null', () => {
    const store = seedStore()
    const now = Date.parse('2026-08-27T12:00:00Z')
    const rec = recordFromRace(parseIngestRace(okRace)!, 'https://e', now)!
    const snap = buildCardSnapshot(store, () => 'anon-xxxx', now, cardGlobalFromRecord(rec))
    expect(snap.version).toBe(3)
    expect(snap.global).toEqual({
      rank: 1284, topPct: 7.4, race7d: 8_210_000, participants: 2481, updatedAt: now,
    })
    const localSnap = buildCardSnapshot(store, () => 'anon-xxxx', now)
    expect(localSnap.global).toBeNull()
  })
})
