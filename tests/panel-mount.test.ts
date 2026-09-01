// @vitest-environment happy-dom
/**
 * panel-mount.test.ts — 点击路径的真实 DOM 挂载回归（点击即消失事故的防回归锁）。
 *
 * 背景：panel 层是 E2E 与纯函数单测的盲区——CardShell 挂载 / Portal / effect /
 * join 接线只有真实 DOM 才能验证。happy-dom + react-dom/client 真渲染：
 * 1. 点击侧栏入口 → 模态出现（含遮罩）
 * 2. 模态内 Join → scope.set('enabled', true) 被调用
 * 3. Joined 快照（含 global）→ 模态渲染 #N + View race 派生链接
 * 4. Esc / 遮罩点击 → onClose
 * 5. scope 缺 subscribe（极端宿主）→ 挂载仍不抛（防御性降级）
 */
// @vitest-environment happy-dom
/* eslint-disable */
// React 19 的 act 需要显式声明测试环境
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MadrankFooterCell, CardShell, CardErrorBoundary, dataTick } from '../src/client/panel.ts'
import type { CardSnapshot, SettingsScopeLike } from '../src/client/card-html.ts'

const snap: CardSnapshot = {
  ymd: '2026-08-31',
  today: {
    primaryTokens: 1_600_000, inputTokens: 1_350_000, outputTokens: 248_000,
    cachedTokens: 23_010_000, requests: 194, activeSeconds: 3_120, vs7dAvgMultiple: 0.4,
  },
  topModels: [{ provider: 'zhipu', model: 'glm-5.3-flash', primaryTokens: 1_600_000, sharePct: 100 }],
  streakDays: 2,
  last7Days: [{ ymd: '2026-08-31', primaryTokens: 1_600_000 }],
  global: null,
  anonIdSuffix: 'abcd',
  generatedAt: Date.UTC(2026, 7, 31, 7, 2),
}

function makeScope(overrides: {
  value?: Record<string, unknown>
  setSpy?: (field: string, value: unknown) => void
  snapshot?: { status: string; value?: Record<string, unknown> }
} = {}): SettingsScopeLike {
  const listeners = new Set<() => void>()
  // 真实 SettingsScopeController 形态：subscribe 是类方法、内部走 this.store。
  // 刻意保持 this 依赖——panel 若再犯「裸方法抽取」错误，这里会像生产环境一样炸。
  const store = {
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
  return {
    store,
    getSnapshot: () => overrides.snapshot ?? { status: 'ready', value: overrides.value ?? { enabled: false, endpoint: 'https://madrank.ai/api/usage/ingest' } },
    subscribe(this: { store: typeof store }, fn: () => void): () => void {
      return this.store.subscribe(fn)
    },
    set: async (field: string, value: unknown) => { overrides.setSpy?.(field, value) },
    unset: async (field: string) => { overrides.setSpy?.(field, undefined) },
  } as SettingsScopeLike
}

let host: HTMLElement
let root: Root | undefined
beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  dataTick.set({ ...snap })
})
afterEach(() => {
  // 规范卸载：Portal 挂在 document.body，先 unmount 再清 DOM，避免 removeChild 竞态
  act(() => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ''
})

function mount(ui: Parameters<typeof createElement>[0] extends never ? never : React.ReactElement): void {
  root = createRoot(host)
  act(() => { root!.render(ui) })
}

function click(el: Element | null): void {
  act(() => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('点击路径真实挂载（happy-dom）', () => {
  it('点击侧栏入口 → 模态出现且不消失；scope 正常形态', () => {
    mount(createElement(MadrankFooterCell, { scope: makeScope() }))
    const btn = host.querySelector('button')
    expect(btn).not.toBeNull()
    click(btn)
    // 模态经 Portal 挂 document.body
    expect(document.querySelector('.madrank-panel-modal')).not.toBeNull()
    expect(document.body.textContent).toContain('MADRank')
  })

  it('模态内 Join → scope.set("enabled", true)', () => {
    const setSpy = vi.fn()
    mount(createElement(MadrankFooterCell, { scope: makeScope({ setSpy }) }))
    click(host.querySelector('button'))
    click(document.querySelector('[data-madrank-join]'))
    expect(setSpy).toHaveBeenCalledWith('enabled', true)
  })

  it('Joined 快照（global 经 settings mirror 注入形态）→ 模态渲染 #N + 同源 View race', () => {
    const scope = makeScope({
      value: {
        enabled: true,
        endpoint: 'http://127.0.0.1:3010/api/usage/ingest',
        global: { rank: 1284, topPct: 7.4, race7d: 8_210_000, participants: 2481, updatedAt: 42 },
      },
    })
    mount(createElement(CardShell, { scope, anchored: true, onClose: () => {} }))
    const modal = document.querySelector('.madrank-panel-modal')
    expect(modal).not.toBeNull()
    expect(document.body.textContent).toContain('Your global rank')
    expect(document.body.textContent).toContain('1,284')
    expect(document.querySelector('a.mk-race')?.getAttribute('href')).toBe('http://127.0.0.1:3010/race')
  })

  it('Esc 关闭模态', () => {
    mount(createElement(MadrankFooterCell, { scope: makeScope() }))
    click(host.querySelector('button'))
    expect(document.querySelector('.madrank-panel-modal')).not.toBeNull()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('.madrank-panel-modal')).toBeNull()
  })

  it('真实 unavailable 形态（宿主 describe 缺 madrank-usage，实测运行态）→ 点击不炸、模态出现', () => {
    const scope = makeScope({ snapshot: { status: 'unavailable', value: undefined } })
    mount(createElement(MadrankFooterCell, { scope }))
    click(host.querySelector('button'))
    expect(document.querySelector('.madrank-panel-modal')).not.toBeNull()
    // 离线默认：Local only + Join CTA
    expect(document.body.textContent).toContain('Local only')
  })

  it('渲染崩溃被自家边界接住 → 显示 [MADRank debug] 错误文本而不是入口消失', () => {
    const evil = makeScope()
    Object.defineProperty(evil, 'getSnapshot', { get() { throw new Error('boom-probe') } })
    // 直接构造：把会炸的组件塞进边界内（模拟任意渲染期异常）
    const Bomb = (): never => { throw new Error('boom-probe') }
    mount(createElement(CardErrorBoundary, null, createElement(Bomb)))
    const banner = document.querySelector('[data-madrank-error]')
    expect(banner).not.toBeNull()
    expect(document.body.textContent).toContain('[MADRank debug]')
    expect(document.body.textContent).toContain('boom-probe')
    void evil
  })

  it('scope.subscribe 缺席（极端宿主形态）→ 挂载不抛、模态仍出现', () => {
    const bare = makeScope() as SettingsScopeLike & { subscribe?: unknown }
    const noSub = { getSnapshot: bare.getSnapshot, set: bare.set, unset: bare.unset } as unknown as SettingsScopeLike
    expect(() => mount(createElement(MadrankFooterCell, { scope: noSub }))).not.toThrow()
    click(host.querySelector('button'))
    expect(document.querySelector('.madrank-panel-modal')).not.toBeNull()
  })
})
