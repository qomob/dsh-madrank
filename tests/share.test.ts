import { describe, expect, it } from 'vitest'
import { renderCardHtml } from '../src/client/card-html.ts'
import { parseGlobalRecord, cardGlobalFromRecord } from '../src/global-rank.ts'
import { whoamiUrlFrom, fetchShareToken, fetchRaceMe, SHARE_TOKEN_RE } from '../src/whoami.ts'

const joinedSnap = {
  ymd: '2026-09-03',
  today: {
    primaryTokens: 120000, inputTokens: 90000, outputTokens: 30000,
    cachedTokens: 500000, requests: 42, activeSeconds: 3000, vs7dAvgMultiple: 1.2,
  },
  topModels: [{ provider: 'DeepSeek', model: 'deepseek-chat', primaryTokens: 400000, sharePct: 80 }],
  streakDays: 5,
  last7Days: [{ ymd: '2026-09-02', primaryTokens: 300000 }],
  global: {
    rank: 1, topPct: 50, race7d: 2212631, participants: 2,
    shareToken: 'u1234567890abcdef',
  },
  generatedAt: Date.parse('2026-09-03T12:00:00Z'),
} as Parameters<typeof renderCardHtml>[0]

describe('share button on card', () => {
  it('joined + token → 按钮出现,链接/卡片图/文案齐备', () => {
    const html = renderCardHtml(joinedSnap, true, { raceUrl: 'https://madrank.ai/rank' })
    expect(html).toContain('data-madrank-share')
    expect(html).toContain('/share/u1234567890abcdef')
    expect(html).toContain('utm_source=dsh-plugin')
    expect(html).toContain('data-share-card="https://madrank.ai/api/og/usage?t=u1234567890abcdef"')
    expect(html).toContain('data-share-text=')
    expect(html).toContain('2.21M')
    expect(html).toContain('rank #1/2')
  })

  it('中文 locale → 中文文案 + 中文按钮', () => {
    const html = renderCardHtml(joinedSnap, true, { raceUrl: 'https://madrank.ai/rank', locale: 'zh-CN' })
    expect(html).toContain('分享排名')
    expect(html).toContain('你排第几')
    expect(html).toContain('全球第 1/2 名')
    expect(html).not.toContain('Where do you rank')
  })

  it('无 token / 未出排名 / 关闭态 → 按钮不出现', () => {
    const noToken = { ...joinedSnap, global: { rank: 1, topPct: 50, race7d: 2212631, participants: 2 } }
    expect(renderCardHtml(noToken, true, {})).not.toContain('data-madrank-share')
    const zero = { ...joinedSnap, global: { rank: 0, topPct: 0, race7d: 0, participants: 0, shareToken: 'u1234567890abcdef' } }
    expect(renderCardHtml(zero, true, {})).not.toContain('data-madrank-share')
    expect(renderCardHtml(joinedSnap, false, {})).not.toContain('data-madrank-share')
  })

  it('唯一参与者文案不用 #1/1 充数,用 Where do you rank', () => {
    const sole = { ...joinedSnap, global: { rank: 1, topPct: 100, race7d: 500000, participants: 1, shareToken: 'u1234567890abcdef' } }
    const html = renderCardHtml(sole, true, {})
    expect(html).toContain('Where do you rank')
    expect(html).not.toContain('#1/1')
  })

  it('坏 token 形状 → 不渲染按钮(不注入任意 URL)', () => {
    const bad = { ...joinedSnap, global: { rank: 1, topPct: 50, race7d: 1, participants: 2, shareToken: 'javascript:alert(1)' } }
    expect(renderCardHtml(bad, true, {})).not.toContain('data-madrank-share')
  })
})

describe('shareToken 贯穿 record → wire → card', () => {
  it('parseGlobalRecord / cardGlobalFromRecord 透传', () => {
    const rec = parseGlobalRecord({
      rank: 2, total: 1000, topPct: 100, participants: 2,
      endpoint: 'https://madrank.ai/api/usage/ingest', updatedAt: 1,
      shareToken: 'u1234567890abcdef',
    })
    expect(rec?.shareToken).toBe('u1234567890abcdef')
    expect(cardGlobalFromRecord(rec)?.shareToken).toBe('u1234567890abcdef')
  })

  it('decodeSettingsSection 不丢 shareToken(2026-09-04 实锤:曾致分享按钮永不出现)', async () => {
    const { decodeSettingsSection } = await import('../src/client/card-data.ts')
    const decoded = decodeSettingsSection({
      enabled: true,
      endpoint: 'https://madrank.ai/api/usage/ingest',
      global: { rank: 1, topPct: 100, race7d: 2544157, participants: 1, shareToken: 'u1234567890abcdef' },
    })
    expect(decoded?.global?.shareToken).toBe('u1234567890abcdef')
    // 无 token 的 wire 不凭空造一个
    const noToken = decodeSettingsSection({
      enabled: true,
      global: { rank: 1, topPct: 100, race7d: 100, participants: 1 },
    })
    expect(noToken?.global?.shareToken).toBeUndefined()
  })
})

describe('whoami', () => {
  it('endpoint 派生', () => {
    expect(whoamiUrlFrom('https://madrank.ai/api/usage/ingest')).toBe('https://madrank.ai/api/usage/whoami')
  })
  it('换取 token;坏形状/HTTP 失败 → null', async () => {
    const ok = async () => new Response(JSON.stringify({ ok: true, shareToken: 'u1234567890abcdef' }), { status: 200 })
    expect(await fetchShareToken('https://x/api/usage/ingest', 'abcd1234-abcd', ok as unknown as typeof fetch)).toBe('u1234567890abcdef')
    const badShape = async () => new Response(JSON.stringify({ shareToken: 'nope' }), { status: 200 })
    expect(await fetchShareToken('https://x/api/usage/ingest', 'abcd1234', badShape as unknown as typeof fetch)).toBeNull()
    const http500 = async () => new Response('boom', { status: 500 })
    expect(await fetchShareToken('https://x/api/usage/ingest', 'abcd1234', http500 as unknown as typeof fetch)).toBeNull()
    expect(SHARE_TOKEN_RE.test('u1234567890abcdef')).toBe(true)
  })
})

describe('fetchRaceMe — /api/usage/me 服务器权威取数(修复缓存陈旧)', () => {
  it('返回合法的 race 快照', async () => {
    const ok = async () => new Response(JSON.stringify({
      participants: 4, windowStart: '2026-08-28T00:00:00+08:00', windowEnd: '2026-09-03T23:59:59+08:00',
      topModel: 'deepseek-chat', me: { rank: 2, total: 4349764, topPct: 50 },
    }), { status: 200 })
    const got = await fetchRaceMe('https://x/api/usage/ingest', 'u1234567890abcdef', ok as unknown as typeof fetch)
    expect(got?.participants).toBe(4)
    expect(got?.me?.rank).toBe(2)
    expect(got?.me?.total).toBe(4349764)
    expect(got?.topModel).toBe('deepseek-chat')
    expect(got?.windowEnd).toContain('2026-09-03')
  })
  it('me 缺席/形状不符/HTTP 失败/坏 token → null(调用方回退本地缓存)', async () => {
    const noMe = async () => new Response(JSON.stringify({ participants: 3, me: null }), { status: 200 })
    expect(await fetchRaceMe('https://x/api/usage/ingest', 'u1234567890abcdef', noMe as unknown as typeof fetch)).not.toBeNull()
    const bad = async () => new Response(JSON.stringify({ me: { rank: 'x' } }), { status: 200 })
    expect(await fetchRaceMe('https://x/api/usage/ingest', 'u1234567890abcdef', bad as unknown as typeof fetch)).toBeNull()
    const http500 = async () => new Response('boom', { status: 500 })
    expect(await fetchRaceMe('https://x/api/usage/ingest', 'u1234567890abcdef', http500 as unknown as typeof fetch)).toBeNull()
    // 插件侧不校验 token 形状(按钮渲染层把关):按响应形状处理
    const bodyNoMe = await fetchRaceMe('https://x/api/usage/ingest', 'not-a-token', noMe as unknown as typeof fetch)
    expect(bodyNoMe?.participants).toBe(3)
  })
})
