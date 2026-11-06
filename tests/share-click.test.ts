// @vitest-environment happy-dom
/**
 * share-click.test.ts — 「点分享排名没反应」回归锁。
 *
 * 真实事故：分享按钮要等 /api/usage/me 先返回才打开弹层，网络慢/被墙时看起来毫无响应。
 * 现在要求：点击 **同步** 打开弹层（先用卡片内文案），服务器真值稍后刷新；请求挂起也不能无响应。
 */
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CardShell, dataTick } from '../src/client/panel.ts'
import type { SettingsScopeLike } from '../src/client/card-html.ts'

const FIXTURE = {
  ymd: '2026-08-31',
  today: {
    primaryTokens: 1_600_000, inputTokens: 1_350_000, outputTokens: 248_000,
    cachedTokens: 23_010_000, requests: 194, activeSeconds: 3_120, vs7dAvgMultiple: 0.4,
  },
  topModels: [{ provider: 'zhipu', model: 'glm-5.3-flash', primaryTokens: 1_600_000, sharePct: 100 }],
  streakDays: 2,
  last7Days: [{ ymd: '2026-08-31', primaryTokens: 1_600_000 }],
  global: {
    rank: 1, topPct: 100, race7d: 9_000_000, participants: 2, updatedAt: 42,
    shareToken: 'u0123456789abcdef',
  },
  anonIdSuffix: 'abcd',
  generatedAt: Date.UTC(2026, 7, 31, 7, 2),
}

let root: Root | undefined
let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  dataTick.set({ ...FIXTURE } as never)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function mountCard(): void {
  const scope = {
    getSnapshot: () => ({
      status: 'ready',
      value: { enabled: true, endpoint: 'https://madrank.ai/api/usage/ingest' },
    }),
    subscribe: () => () => {},
    set: async () => {},
  } as unknown as SettingsScopeLike
  root = createRoot(host)
  act(() => { root!.render(createElement(CardShell, { scope, anchored: true, onClose: () => {} })) })
}

describe('分享按钮点击路径', () => {
  it('服务器请求一直挂起 → 点击仍然立即打开弹层', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* never settles */ })))
    mountCard()
    const btn = document.querySelector('[data-madrank-share]')
    expect(btn).not.toBeNull()
    act(() => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 同一 tick 内就应有弹层（不依赖网络）
    expect(document.getElementById('madrank-share-modal')).not.toBeNull()
    expect(document.body.textContent).toContain('Share your rank')
  })

  it('服务器返回真值 → 弹层文案刷新为最新数字', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        participants: 7,
        topModel: 'glm-5.3-flash',
        me: { rank: 3, total: 12_345_678, topPct: 42.9 },
      }),
    })))
    mountCard()
    const btn = document.querySelector('[data-madrank-share]')
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise(r => setTimeout(r, 30))
    })
    const ta = document.querySelector('#madrank-share-modal textarea') as HTMLTextAreaElement
    expect(ta.value).toContain('12.35M')
    expect(ta.value).toContain('#3')
  })
})
