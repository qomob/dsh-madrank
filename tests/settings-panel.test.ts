// @vitest-environment happy-dom
/**
 * settings-panel.test.ts — 设置 → MADRank 配置面板挂载回归（v0.2 交互规范锁）。
 *
 * 规范要点（每个用例 = 规范的一句）：
 * 1. 设置面 = CONFIGURATION：五个区块齐全（RANKING/SYNC/PRIVACY/DATA/PLUGIN），
 *    不再渲染 Quick View 用量卡（无 mk-hero 直方等）。
 * 2. 「参与全球排名」是真开关：off → set('enabled', true)；on → unset('enabled')。
 * 3. 「自动同步」依赖排名开启：off 时禁用 + hint；on 时可切（set('autoSync', …)）。
 * 4. 隐私是固定数据定义：仅同步清单 / 绝不同步清单，不做「可选上传」开关。
 * 5. 删除/清除走两步确认命令缝（deleteRequested / clearLocalRequested）。
 * 6. 头部 pill = 真实状态（on 实心 / off 空心）。
 */
/* eslint-disable */
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MadrankSettingsPanel } from '../src/client/settings-panel.ts'
import { dataTick } from '../src/client/tick.ts'
import type { SettingsScopeLike } from '../src/client/card-html.ts'
import type { SettingsSectionValue } from '../src/client/card-data.ts'

function makeScope(
  value: Partial<SettingsSectionValue>,
  setSpy?: (field: string, v: unknown) => void,
): SettingsScopeLike {
  const listeners = new Set<() => void>()
  const full: SettingsSectionValue = {
    enabled: false,
    endpoint: 'https://madrank.ai/api/usage/ingest',
    global: null,
    autoSync: true,
    deleteRequested: 0,
    deletedEpoch: 0,
    clearLocalRequested: 0,
    clearedEpoch: 0,
    ...value,
  }
  return {
    getSnapshot: () => ({ status: 'ready', value: full }),
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: async (field, v) => { setSpy?.(field, v) },
    unset: async (field) => { setSpy?.(field, undefined) },
  } as SettingsScopeLike
}

let host: HTMLElement
let root: Root | undefined
beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  dataTick.set({
    ymd: '2026-09-03',
    last7Days: [
      { ymd: '2026-08-28', primaryTokens: 1_000_000 },
      { ymd: '2026-09-03', primaryTokens: 2_180_000 },
    ],
    history: [
      { ymd: '2026-08-28', primaryTokens: 1_000_000, cachedTokens: 0, requests: 10, activeSeconds: 60, inputTokens: 0, outputTokens: 0 },
      { ymd: '2026-09-03', primaryTokens: 2_180_000, cachedTokens: 0, requests: 20, activeSeconds: 120, inputTokens: 0, outputTokens: 0 },
    ],
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ''
})

function mount(ui: React.ReactElement): void {
  root = createRoot(host)
  act(() => { root!.render(ui) })
}

function switchBtn(label: string): HTMLButtonElement | null {
  for (const b of Array.from(host.querySelectorAll('button[role="switch"]'))) {
    if (b.getAttribute('aria-label') === label) return b as HTMLButtonElement
  }
  return null
}

describe('Settings → MADRank 配置面板（v0.2 交互规范）', () => {
  it('五个区块齐全 + 头部定位副标题；不渲染 Quick View 用量卡', () => {
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}) }))
    const text = document.body.textContent ?? ''
    for (const heading of ['Global ranking', 'Data sync', 'Privacy', 'Local data', 'Plugin']) {
      expect(text).toContain(heading)
    }
    expect(text).toContain('MADRank')
    expect(text).toContain('Your AI usage')
    // CONFIGURATION 而非 Usage Dashboard：无 hero 大数字区
    expect(document.querySelector('.mk-hero')).toBeNull()
  })

  it('头部 pill = 真实状态（off 空心 → on 实心）', () => {
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}) }))
    expect(document.querySelector('.mkp-tag')?.getAttribute('data-on')).toBe('false')
    act(() => { root?.unmount() })
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({ enabled: true }) }))
    expect(document.querySelector('.mkp-tag')?.getAttribute('data-on')).toBe('true')
  })

  it('「参与全球排名」真开关：off → set("enabled", true)；on → unset("enabled")', () => {
    const setSpy = vi.fn()
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}, setSpy) }))
    const sw = switchBtn('Participate in MADRank global ranking')
    expect(sw?.getAttribute('aria-checked')).toBe('false')
    act(() => { sw?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(setSpy).toHaveBeenCalledWith('enabled', true)
    act(() => { root?.unmount() })
    const setSpy2 = vi.fn()
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({ enabled: true }, setSpy2) }))
    const sw2 = switchBtn('Participate in MADRank global ranking')
    expect(sw2?.getAttribute('aria-checked')).toBe('true')
    act(() => { sw2?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(setSpy2).toHaveBeenCalledWith('enabled', undefined)
  })

  it('「自动同步」依赖排名开启：off 禁用 + hint；on 可切（set("autoSync", …)）', () => {
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}) }))
    const off = switchBtn('Auto-sync daily usage')
    expect(off?.disabled).toBe(true)
    expect(document.body.textContent).toContain('Available when global ranking is on')
    act(() => { root?.unmount() })
    const setSpy = vi.fn()
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({ enabled: true }, setSpy) }))
    const on = switchBtn('Auto-sync daily usage')
    expect(on?.disabled).toBe(false)
    expect(on?.getAttribute('aria-checked')).toBe('true')
    act(() => { on?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(setSpy).toHaveBeenCalledWith('autoSync', false)
  })

  it('隐私 = 固定数据定义：仅同步/绝不同步清单都在；不做「可选上传」开关', () => {
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}) }))
    const text = document.body.textContent ?? ''
    expect(text).toContain('Token counts')
    expect(text).toContain('Usage dates')
    expect(text).toContain('Model names')
    expect(text).toContain('Prompts')
    expect(text).toContain('Responses')
    expect(text).toContain('API keys')
    // 隐私清单区块内没有开关（数据定义不可选）
    const privSection = document.querySelectorAll('.mkp-sec')[2]
    expect(privSection.querySelector('[role="switch"]')).toBeNull()
  })

  it('删除已同步数据：两步确认（arm → confirm 才写 deleteRequested）', () => {
    const setSpy = vi.fn()
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}, setSpy) }))
    const del = host.querySelector('[data-madrank-cmd="delete"]') as HTMLButtonElement
    expect(del).not.toBeNull()
    act(() => { del.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(setSpy).not.toHaveBeenCalled()                 // 第一步只 arm
    expect(del.getAttribute('data-armed')).toBe('true')
    expect(del.textContent).toContain('Confirm delete')
    act(() => { del.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy.mock.calls[0]![0]).toBe('deleteRequested')
    expect(typeof setSpy.mock.calls[0]![1]).toBe('number') // 时间戳命令字段
  })

  it('命令状态机：pending 禁用按钮；done 显示完成反馈行', () => {
    mount(createElement(MadrankSettingsPanel, {
      scope: makeScope({ deleteRequested: Date.now(), deletedEpoch: 0 }),
    }))
    const del = host.querySelector('[data-madrank-cmd="delete"]') as HTMLButtonElement
    expect(del.disabled).toBe(true)
    act(() => { root?.unmount() })
    mount(createElement(MadrankSettingsPanel, {
      scope: makeScope({ deleteRequested: 100, deletedEpoch: 200 }),
    }))
    expect(document.querySelector('[data-madrank-feedback="delete"]')?.textContent)
      .toContain('deleted from MADRank')
  })

  it('本地数据：最近 7 天汇总来自 dataTick 快照（与 Quick View 同一数据缝）', () => {
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({}) }))
    const text = document.body.textContent ?? ''
    expect(text).toContain('3.18M tokens') // 1.00M + 2.18M
    expect(text).toContain('Local records')
  })

  it('最近同步：取排名记录 updatedAt；未同步 = 诚实空态', () => {
    mount(createElement(MadrankSettingsPanel, {
      scope: makeScope({ enabled: true, global: { rank: 1, topPct: 12.5, race7d: 9_500_000, updatedAt: Date.UTC(2026, 8, 3, 8, 2) } }),
    }))
    expect(document.body.textContent).toContain('7-day total 9.50M')
    act(() => { root?.unmount() })
    mount(createElement(MadrankSettingsPanel, { scope: makeScope({ enabled: true }) }))
    expect(document.body.textContent).toContain('Not synced yet')
  })
})
