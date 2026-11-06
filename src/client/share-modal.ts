/// <reference lib="dom" />

/**
 * share-modal.tsx — 分享海报弹层（React 组件，官方 slot/portal 形态）。
 *
 * 契约：
 * - 由 CardShell 用 React 状态挂载，`createPortal` 到 document.body（fixed overlay 的标准做法，
 *   slot 目录也要求 fixed overlay portal 到 body 才能逃离侧栏裁剪）；卸载即回收，无残留 DOM。
 * - 不再手写 DOM / appendChild / 模块级监听器；样式是组件内 `<style>`，随组件卸载移除。
 * - 保留原有能力：卡片图、可编辑文案、复制文案/链接、下载卡片、系统带图分享、分享到 X；
 *   捕获阶段接管 Escape，只关分享层、不连坐下层 Quick View 卡片。
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tr, type Lang } from './i18n.ts'

export interface ShareModalOptions {
  /** 自动卡片截图(OG PNG,CORS 已放开)。 */
  cardUrl: string
  /** 分享落地链接。 */
  url: string
  /** 预填文案（可编辑）。 */
  text: string
  lang: Lang
}

export interface ShareModalProps extends ShareModalOptions {
  onClose(): void
}

const ID = 'madrank-share-modal'
// 必须高于 Quick View 卡片模态(panel.ts overlay = 2147483000):
// 分享按钮就在那张卡里,低了这个值时居中海报会被不透明卡片整个盖住(实锄件)
const Z = 2147483001

const css = [
  '#' + ID + '{position:fixed;inset:0;z-index:' + Z + ';display:flex;align-items:center;justify-content:center;padding:24px;',
  '  background:color-mix(in srgb, #000 55%, transparent);backdrop-filter:blur(2px)}',
  '#' + ID + ' .mks-panel{width:min(420px,92vw);max-height:88vh;overflow:auto;border-radius:14px;',
  '  border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));',
  '  background:var(--dsw-alias-bg-layer-2, #101013);color:var(--dsw-alias-label-primary, #fafafa);',
  '  box-shadow:0 18px 60px rgba(0,0,0,.45);padding:16px 16px 14px;font-size:13px;line-height:1.5}',
  '#' + ID + ' .mks-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}',
  '#' + ID + ' .mks-title{font-size:14px;font-weight:700}',
  '#' + ID + ' .mks-close{min-height:26px;width:26px;padding:0 4px;border:0;border-radius:7px;background:transparent;',
  '  color:inherit;font-size:15px;cursor:pointer}',
  '#' + ID + ' .mks-close:hover{background:var(--dsw-interactive-bg-hover, rgba(255,255,255,.08))}',
  '#' + ID + ' .mks-card{display:block;width:100%;border-radius:10px;border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))}',
  '#' + ID + ' .mks-hint{margin:8px 2px 4px;font-size:11px;color:var(--dsw-alias-label-tertiary, #8b8b93)}',
  '#' + ID + ' .mks-text{width:100%;box-sizing:border-box;min-height:88px;margin-top:4px;border-radius:9px;padding:8px 10px;',
  '  border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));',
  '  background:var(--dsw-alias-bg-layer-1, #0a0a0c);color:inherit;font:inherit;resize:vertical}',
  '#' + ID + ' .mks-text:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, #6ee7b7);outline-offset:-1px}',
  '#' + ID + ' .mks-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}',
  '#' + ID + ' .mks-actions button{min-height:32px;border-radius:8px;padding:5px 10px;cursor:pointer;font:inherit;font-weight:500;',
  '  border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));',
  '  background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.04));color:inherit}',
  '#' + ID + ' .mks-actions button:hover{background:var(--dsw-interactive-bg-hover, rgba(255,255,255,.09))}',
  '#' + ID + ' .mks-actions button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, #6ee7b7);outline-offset:-2px}',
  '#' + ID + ' .mks-primary{grid-column:1 / -1;',
  '  background:var(--dsw-alias-state-business-primary, #10b981)!important;',
  '  border-color:transparent!important;color:#04110b!important;font-weight:700}',
  '#' + ID + '[data-busy=true] .mks-actions{opacity:.6;pointer-events:none}',
  '@media (prefers-reduced-motion: no-preference){#' + ID + ' .mks-panel{animation:mks-in .14s ease-out}}',
  '@keyframes mks-in{from{transform:translateY(6px);opacity:0}to{transform:none;opacity:1}}',
].join('\n')

type Feedback = 'text' | 'link' | 'download' | 'native' | 'fail'

async function copyText(v: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(v)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = v
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

async function fetchCardBlob(cardUrl: string): Promise<Blob | null> {
  try {
    const res = await fetch(cardUrl)
    return res.ok ? await res.blob() : null
  } catch {
    return null
  }
}

/** 分享海报弹层。 */
export function ShareModal(props: ShareModalProps): ReturnType<typeof createPortal> | null {
  const { cardUrl, url, text, lang, onClose } = props
  const [value, setValue] = useState<string>(() => text + '\n' + url)
  // 用户改过文案后，服务器刷新回来的 text 不再覆盖输入
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = useCallback((kind: Feedback): void => {
    setFeedback(kind)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setFeedback(null); timer.current = null }, 1400)
  }, [])

  // 打开后服务器刷新回来的真值文案（未编辑时跟随）
  useEffect(() => {
    if (!dirty) setValue(text + '\n' + url)
  }, [text, url, dirty])

  // 捕获阶段接管 Escape：只关分享层，不连坐关掉压在下面的 Quick View 卡片模态。
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 组件卸载时清掉仍在计时的反馈定时器。
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const flashable = (base: string, key: Feedback): string =>
    feedback === key ? tr(lang, 'shareCopied') : feedback === 'fail' && key === 'text' ? tr(lang, 'shareCopyFailed') : base

  const runCopy = (payload: string, key: Feedback): void => {
    void copyText(payload).then((ok) => showFeedback(ok ? key : 'fail'))
  }

  const download = (): void => {
    setBusy(true)
    void fetchCardBlob(cardUrl).then((blob) => {
      setBusy(false)
      if (blob === null) {
        window.open(cardUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'madrank-card.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      showFeedback('download')
    })
  }

  type ShareCapable = Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
    share?: (data: { files?: File[]; text?: string; url?: string }) => Promise<void>
  }
  const nav = navigator as ShareCapable
  const canNativeShare = typeof nav.share === 'function'

  const nativeShare = (): void => {
    setBusy(true)
    void (async () => {
      let file: File | null = null
      try {
        const blob = await fetchCardBlob(cardUrl)
        if (blob !== null && typeof nav.canShare === 'function') {
          const f = new File([blob], 'madrank-card.png', { type: 'image/png' })
          if (nav.canShare({ files: [f] })) file = f
        }
      } catch { /* 降级为纯文本分享 */ }
      setBusy(false)
      try {
        await nav.share!(file !== null
          ? { files: [file], text: value.split('\n')[0] ?? '', url }
          : { text: value, url })
      } catch { /* 用户取消 */ }
      showFeedback('native')
    })()
  }

  const shareX = (): void => {
    const intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(value.split('\n')[0] ?? '') +
      '&url=' + encodeURIComponent(url)
    window.open(intent, '_blank', 'noopener,noreferrer')
  }

  const btn = (label: string, onClick: () => void, cls?: string): ReturnType<typeof createElement> =>
    createElement('button', { type: 'button', className: cls, onClick }, label)

  const root = createElement('div', {
    id: ID,
    'data-busy': busy ? 'true' : undefined,
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  },
  createElement('style', { id: ID + '-style' }, css),
  createElement('div', { className: 'mks-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr(lang, 'shareModalTitle') },
    createElement('div', { className: 'mks-head' },
      createElement('div', { className: 'mks-title' }, tr(lang, 'shareModalTitle')),
      createElement('button', {
        type: 'button',
        className: 'mks-close',
        'aria-label': tr(lang, 'shareClose'),
        onClick: onClose,
      }, '\u2715'),
    ),
    createElement('img', { className: 'mks-card', src: cardUrl, alt: tr(lang, 'shareCardAlt') }),
    createElement('p', { className: 'mks-hint' }, tr(lang, 'shareQrHint')),
    createElement('p', { className: 'mks-hint' }, tr(lang, 'shareEditHint')),
    createElement('textarea', {
      className: 'mks-text',
      value,
      onChange: (e: { target: { value: string } }) => { setDirty(true); setValue(e.target.value) },
    }),
    createElement('div', { className: 'mks-actions' },
      btn(flashable(tr(lang, 'shareCopyText'), 'text'), () => runCopy(value, 'text')),
      btn(flashable(tr(lang, 'shareCopyLink'), 'link'), () => runCopy(url, 'link')),
      btn(feedback === 'download' ? tr(lang, 'shareCopied') : tr(lang, 'shareDownload'), download),
      btn(tr(lang, 'shareX'), shareX),
      canNativeShare
        ? btn(feedback === 'native' ? tr(lang, 'shareCopied') : tr(lang, 'shareNative'), nativeShare, 'mks-primary')
        : null,
    ),
  ))

  return typeof document !== 'undefined' ? createPortal(root, document.body) : null
}
