// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ShareModal } from '../src/client/share-modal.ts'
import type { ShareModalProps } from '../src/client/share-modal.ts'

declare global {
  // React 19 act() 环境标记
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function mount(props: ShareModalProps): { unmount(): void; query<T extends Element>(sel: string): T } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(createElement(ShareModal, props)) })
  return {
    unmount: () => { act(() => root.unmount()); host.remove() },
    query: <T extends Element>(sel: string) => document.querySelector(sel) as T,
  }
}

describe('ShareModal（分享海报弹层，React 组件）', () => {
  it('挂载: portal 到 body、卡片图/可编辑文案/动作齐全; 卸载: 无残留节点与样式', () => {
    const onClose = vi.fn()
    const m = mount({
      cardUrl: 'https://madrank.ai/api/og/usage?t=u1234567890abcdef',
      url: 'https://madrank.ai/share/u1234567890abcdef?utm_source=dsh-plugin',
      text: 'My real AI usage last 7 days: 2.21M tokens',
      lang: 'en',
      onClose,
    })
    const root = document.getElementById('madrank-share-modal')!
    expect(root).toBeTruthy()
    // 实锄件回归:必须压过 Quick View 卡片模态(z 2147483000)
    const styleEl = document.getElementById('madrank-share-modal-style') as HTMLStyleElement
    expect(styleEl.textContent).toContain('z-index:2147483001')
    const img = m.query<HTMLImageElement>('img.mks-card')
    expect(img.src).toBe('https://madrank.ai/api/og/usage?t=u1234567890abcdef')
    const ta = m.query<HTMLTextAreaElement>('textarea.mks-text')
    expect(ta.value).toContain('2.21M tokens')
    expect(ta.value).toContain('https://madrank.ai/share/u1234567890abcdef')
    const labels = Array.from(root.querySelectorAll('.mks-actions button')).map(b => b.textContent)
    expect(labels).toContain('Copy text')
    expect(labels).toContain('Copy link')
    expect(labels).toContain('Download card')
    expect(labels).toContain('Share to X')

    m.unmount()
    expect(document.getElementById('madrank-share-modal')).toBeNull()
    expect(document.getElementById('madrank-share-modal-style')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('中文词典:按钮文案为中文', () => {
    const m = mount({
      cardUrl: 'https://x/og.png', url: 'https://x/s', text: '用量', lang: 'zh', onClose: vi.fn(),
    })
    const root = document.getElementById('madrank-share-modal')!
    const labels = Array.from(root.querySelectorAll('.mks-actions button')).map(b => b.textContent)
    expect(labels).toContain('复制文案')
    expect(labels).toContain('下载卡片')
    m.unmount()
  })

  it('Escape 关闭（捕获阶段，不连坐下层弹层）', () => {
    const onClose = vi.fn()
    const m = mount({ cardUrl: 'x', url: 'y', text: 'z', lang: 'en', onClose })
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    act(() => { document.dispatchEvent(ev) })
    expect(onClose).toHaveBeenCalledTimes(1)
    m.unmount()
  })

  it('点遮罩关闭、点面板不关闭', () => {
    const onClose = vi.fn()
    const m = mount({ cardUrl: 'x', url: 'y', text: 'z', lang: 'en', onClose })
    const panel = m.query<HTMLElement>('.mks-panel')
    act(() => { panel.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onClose).not.toHaveBeenCalled()
    const root = document.getElementById('madrank-share-modal')!
    act(() => { root.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(1)
    m.unmount()
  })

  it('复制文案: clipboard 成功 → 按钮显示已复制', async () => {
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (v: string) => { copied = v } },
      configurable: true,
    })
    const m = mount({ cardUrl: 'https://x/og.png', url: 'https://x/s', text: 'hello', lang: 'zh', onClose: vi.fn() })
    const state = m as unknown as { unmount(): void }
    const btn = Array.from(document.querySelectorAll('#madrank-share-modal .mks-actions button'))
      .find(b => b.textContent === '复制文案') as HTMLButtonElement
    await act(async () => {
      btn.click()
      await new Promise(r => setTimeout(r, 20))
    })
    expect(copied).toContain('hello')
    expect(copied).toContain('https://x/s')
    const after = Array.from(document.querySelectorAll('#madrank-share-modal .mks-actions button'))
      .find(b => b.textContent?.startsWith('已复制')) as HTMLButtonElement
    expect(after).toBeTruthy()
    state.unmount()
  })
})
