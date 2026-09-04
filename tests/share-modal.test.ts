// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { openShareModal, closeShareModal, shareModalOpen } from '../src/client/share-modal.ts'

describe('share-modal(分享海报弹层)', () => {
  it('打开:卡片图/可编辑文案/动作齐全;关闭:DOM 清场', () => {
    expect(shareModalOpen()).toBe(false)
    openShareModal({
      cardUrl: 'https://madrank.ai/api/og/usage?t=u1234567890abcdef',
      url: 'https://madrank.ai/share/u1234567890abcdef?utm_source=dsh-plugin',
      text: 'My real AI usage last 7 days: 2.21M tokens',
      lang: 'en',
    })
    expect(shareModalOpen()).toBe(true)
    // 实锄件回归:必须压过 Quick View 卡片模态(z 2147483000),否则海报被卡片盖住
    const styleEl = document.getElementById('madrank-share-modal-style') as HTMLStyleElement
    expect(styleEl.textContent).toContain('z-index:2147483001')
    const root = document.getElementById('madrank-share-modal')!
    const img = root.querySelector('img.mks-card') as HTMLImageElement
    expect(img.src).toBe('https://madrank.ai/api/og/usage?t=u1234567890abcdef')
    const ta = root.querySelector('textarea.mks-text') as HTMLTextAreaElement
    expect(ta.value).toContain('2.21M tokens')
    expect(ta.value).toContain('https://madrank.ai/share/u1234567890abcdef')
    const labels = Array.from(root.querySelectorAll('.mks-actions button')).map(b => b.textContent)
    expect(labels).toContain('Copy text')
    expect(labels).toContain('Copy link')
    expect(labels).toContain('Download card')
    expect(labels).toContain('Share to X')
    // 幂等:重复打开不叠加
    openShareModal({ cardUrl: 'x', url: 'y', text: 'z', lang: 'en' })
    expect(document.querySelectorAll('#madrank-share-modal').length).toBe(1)
    closeShareModal()
    expect(shareModalOpen()).toBe(false)
  })

  it('中文词典:按钮文案为中文', () => {
    openShareModal({ cardUrl: 'https://x/og.png', url: 'https://x/s', text: '用量', lang: 'zh' })
    const root = document.getElementById('madrank-share-modal')!
    const labels = Array.from(root.querySelectorAll('.mks-actions button')).map(b => b.textContent)
    expect(labels).toContain('复制文案')
    expect(labels).toContain('下载卡片')
    closeShareModal()
  })

  it('复制文案:clipboard 成功 → 按钮 flash 已复制', async () => {
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (v: string) => { copied = v } },
      configurable: true,
    })
    openShareModal({ cardUrl: 'https://x/og.png', url: 'https://x/s', text: 'hello', lang: 'zh' })
    const root = document.getElementById('madrank-share-modal')!
    const btn = Array.from(root.querySelectorAll('.mks-actions button'))
      .find(b => b.textContent === '复制文案') as HTMLButtonElement
    btn.click()
    await new Promise(r => setTimeout(r, 30))
    expect(copied).toContain('hello')
    expect(copied).toContain('https://x/s')
    expect(btn.textContent).toBe('已复制 ✓')
    closeShareModal()
  })
})
