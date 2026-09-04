/**
 * share-modal.ts — 分享弹层(浏览器半侧,零依赖 vanilla DOM)。
 *
 * 交互形态对齐"分享海报"模式:点击分享 → 自动卡片截图(服务端 OG 图,
 * 带二维码) + 可编辑文案 + 复制/下载/系统带图分享/X。
 * 一次性 overlay 挂 document.body;重复打开先清场;ESC/背板/×关闭。
 * 视觉走 --dsw-alias-* 宿主主题变量(带回退),与卡片语言一致。
 */

import { tr, type Lang } from './i18n.ts'

export interface ShareModalOptions {
  /** 自动卡片截图(OG PNG,CORS 已放开)。 */
  cardUrl: string
  /** 分享落地链接。 */
  url: string
  /** 预填文案(可编辑)。 */
  text: string
  lang: Lang
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

function ensureStyles(): void {
  if (document.getElementById(ID + '-style')) return
  const s = document.createElement('style')
  s.id = ID + '-style'
  s.textContent = css
  document.head.appendChild(s)
}

function flash(btn: HTMLButtonElement, lang: Lang, ok: boolean): void {
  const prev = btn.textContent
  btn.textContent = tr(lang, ok ? 'shareCopied' : 'shareCopyFailed')
  setTimeout(() => { btn.textContent = prev }, 1400)
}

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

/** 打开分享弹层(幂等:已开先关)。 */
export function openShareModal(opts: ShareModalOptions): void {
  closeShareModal()
  ensureStyles()
  const lang = opts.lang

  const root = document.createElement('div')
  root.id = ID

  const panel = document.createElement('div')
  panel.className = 'mks-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', tr(lang, 'shareModalTitle'))

  const head = document.createElement('div')
  head.className = 'mks-head'
  const title = document.createElement('div')
  title.className = 'mks-title'
  title.textContent = tr(lang, 'shareModalTitle')
  const close = document.createElement('button')
  close.className = 'mks-close'
  close.type = 'button'
  close.setAttribute('aria-label', tr(lang, 'shareClose'))
  close.textContent = '\u2715'
  head.append(title, close)

  const img = document.createElement('img')
  img.className = 'mks-card'
  img.src = opts.cardUrl
  img.alt = tr(lang, 'shareCardAlt')

  const hint = document.createElement('p')
  hint.className = 'mks-hint'
  hint.textContent = tr(lang, 'shareQrHint')

  const editHint = document.createElement('p')
  editHint.className = 'mks-hint'
  editHint.textContent = tr(lang, 'shareEditHint')

  const ta = document.createElement('textarea')
  ta.className = 'mks-text'
  ta.value = opts.text + '\n' + opts.url

  const actions = document.createElement('div')
  actions.className = 'mks-actions'

  const mk = (label: string, onClick: (btn: HTMLButtonElement) => void, cls?: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    if (cls) b.className = cls
    b.addEventListener('click', () => { void onClick(b) })
    return b
  }

  const btnCopyText = mk(tr(lang, 'shareCopyText'), async (b) => flash(b, lang, await copyText(ta.value)))
  const btnCopyLink = mk(tr(lang, 'shareCopyLink'), async (b) => flash(b, lang, await copyText(opts.url)))
  const btnDownload = mk(tr(lang, 'shareDownload'), async (b) => {
    root.setAttribute('data-busy', 'true')
    const blob = await fetchCardBlob(opts.cardUrl)
    root.removeAttribute('data-busy')
    if (blob === null) {
      window.open(opts.cardUrl, '_blank', 'noopener,noreferrer')
      return
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'madrank-card.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    flash(b, lang, true)
  })
  const btnX = mk(tr(lang, 'shareX'), () => {
    const intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(ta.value.split('\n')[0] ?? '') +
      '&url=' + encodeURIComponent(opts.url)
    window.open(intent, '_blank', 'noopener,noreferrer')
  })

  actions.append(btnCopyText, btnCopyLink, btnDownload, btnX)

  // 系统带图分享(支持 files 的平台才有;不可用则不显示)
  type ShareCapable = Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
    share?: (data: { files?: File[]; text?: string; url?: string }) => Promise<void>
  }
  const nav = navigator as ShareCapable
  if (typeof nav.share === 'function') {
    const btnNative = mk(tr(lang, 'shareNative'), async (b) => {
      root.setAttribute('data-busy', 'true')
      let file: File | null = null
      try {
        const blob = await fetchCardBlob(opts.cardUrl)
        if (blob !== null && typeof nav.canShare === 'function') {
          const f = new File([blob], 'madrank-card.png', { type: 'image/png' })
          if (nav.canShare({ files: [f] })) file = f
        }
      } catch { /* 降级为纯文本分享 */ }
      root.removeAttribute('data-busy')
      try {
        await nav.share!(file !== null
          ? { files: [file], text: ta.value.split('\n')[0] ?? '', url: opts.url }
          : { text: ta.value, url: opts.url })
      } catch { /* 用户取消 */ }
      flash(b, lang, true)
    }, 'mks-primary')
    actions.append(btnNative)
  }

  panel.append(head, img, hint, editHint, ta, actions)
  root.appendChild(panel)
  root.addEventListener('click', (ev) => { if (ev.target === root) closeShareModal() })
  close.addEventListener('click', closeShareModal)
  // 捕获阶段接管 Escape:只关分享层,不连坐关掉压在下面的 Quick View 卡片模态
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.stopPropagation()
      closeShareModal()
      document.removeEventListener('keydown', onKey, true)
    }
  }
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(root)
}

export function closeShareModal(): void {
  document.getElementById(ID)?.remove()
}

export function shareModalOpen(): boolean {
  return document.getElementById(ID) !== null
}
