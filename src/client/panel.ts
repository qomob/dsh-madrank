/// <reference lib="dom" />

/**
 * panel.ts — 侧栏脚部入口 + 卡片面板（React，官方 sidebar.footer.action 槽）。
 *
 * 契约要点（slot-catalog 实测）：
 * - 'sidebar.footer.action' 是 list 槽、replaceRisk: none；fresh id 并列追加。
 * - 组件形参是 React 渲染管线的一部分（官方 CordisPanel 同款），owner 传入
 *   `wide: boolean`（false = 56px 收窄栏 → 图标态）。
 * - 页脚按钮点击后以 **页面居中的全屏模态** 呈现（react-dom Portal 挂 document.body，
 *   彻底逃离侧栏的 overflow 裁剪与 stacking context；点遮罩 / Esc 关闭）。
 *
 * 样式：主题 CSS 变量（非字面色），卡片标记与 settings 卡共用 card-html。
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import { renderCardHtml, scopeEnabled } from './card-html.ts'
import type { CardSnapshot, SettingsScopeLike } from './card-html.ts'
import { resolveLang, tr, type Lang } from './i18n.ts'
import { cardDataFromList } from './card-data.ts'

// ── 微观共享状态：数据节拍 ──────────────────────────────────

/** apply() 装配时推进；两处 UI（settings 卡 / 侧栏面板）共享同一份快照。 */
export const dataTick = (() => {
  let snap: Partial<CardSnapshot> = {}
  const listeners = new Set<() => void>()
  return {
    set(next: Partial<CardSnapshot>): void {
      snap = next
      for (const fn of [...listeners]) { try { fn() } catch { /* isolated */ } }
    },
    get(): Partial<CardSnapshot> { return snap },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
})()

// ── 语言：跟随宿主 ctx.locale（只读 active + subscribe；变化经 dataTick 重渲染） ──

let activeLocale: string | undefined

/** 由 client/index.ts 的 apply() 装配：喂入宿主 locale 面的 active LocaleId。 */
export function setActiveLocale(raw: string | undefined): void {
  activeLocale = raw
}

function cardLang(): Lang {
  return resolveLang(activeLocale)
}

function useTickSource(subscribe: (fn: () => void) => () => void): number {
  const [v, setV] = useState(0)
  useEffect(() => subscribe(() => setV(x => x + 1)), [subscribe])
  return v
}

// ── 卡片面壳（settings 卡与 popover 共用）───────────────────

interface CardShellProps {
  scope: SettingsScopeLike
  onClose?: () => void
  anchored: boolean
}

export function CardShell(props: CardShellProps): ReactElement | ReactPortal {
  const { scope, onClose, anchored } = props
  const tick = useTickSource(dataTick.subscribe)
  const [, force] = useState(0)
  // 历史范围（会话态视图偏好，不写 settings）：7D 直方 / 30D 密排 / 单日明细
  const [range, setRange] = useState<'7d' | '30d' | 'day'>('7d')
  const [selYmd, setSelYmd] = useState<string | undefined>(undefined)
  const ref = useRef<HTMLDivElement | null>(null)

  // 组装快照：feed 实时数据优先，window fixture 覆盖口其次。
  // 渲染任何异常都降级为最小卡片 —— 绝不让 occupant 被 React 边界卸载（点击即消失的教训）。
  let html: string
  try {
    const base = dataTick.get()
    const fixture = (typeof window !== 'undefined' ? window.__MADRANK_CARD_DATA__ : undefined) ?? {}
    const snap: CardSnapshot = { ...base, ...fixture }
    // 模态容器大：卡片用 lg 变体（解锁 320px 固定宽 + 双栏中段）
    html = renderCardHtml(snap, scopeEnabled(scope), anchored ? { size: 'lg', locale: activeLocale, range, selectedYmd: selYmd } : { locale: activeLocale, range, selectedYmd: selYmd })
  } catch (e) {
    console.warn('[madrank] card render fallback', e)
    html = '<div class="madrank-card"><h3 style="margin:0">' + tr(cardLang(), 'cardTitle') + '</h3>' +
      '<section class="mod"><div class="muted">Card unavailable this tick.</div></section></div>'
  }

  // 绑定卡片内按钮（join/leave 写回 settings，UI 即时翻转）
  useEffect(() => {
    const rootEl = ref.current
    if (!rootEl) return
    const join = rootEl.querySelector('[data-madrank-join]')
    const leave = rootEl.querySelector('[data-madrank-disable]')
    const onJoin = (): void => { void Promise.resolve(scope.set('enabled', true)).catch(() => {}); force(x => x + 1) }
    const onLeave = (): void => { void Promise.resolve(scope.unset('enabled')).catch(() => {}); force(x => x + 1) }
    join?.addEventListener('click', onJoin)
    leave?.addEventListener('click', onLeave)

    // 范围切换 + 直方柱点击进入单日（同 join/leave 的 data-attr 绑定模式）
    const snap = dataTick.get()
    const fallbackDay = (): string => {
      const hist = snap.history
      if (hist && hist.length > 0) {
        for (let i = hist.length - 1; i >= 0; i--) {
          if ((hist[i]?.primaryTokens ?? 0) > 0) return hist[i]!.ymd
        }
      }
      return snap.ymd ?? new Date().toISOString().slice(0, 10)
    }
    const onRange = (ev: Event): void => {
      const v = (ev.currentTarget as HTMLElement | null)?.getAttribute('data-madrank-range')
      if (v === '7d' || v === '30d' || v === 'day') {
        setRange(v)
        if (v === 'day') setSelYmd(selYmd ?? fallbackDay())
      }
    }
    const onDayBar = (ev: Event): void => {
      const ymd = (ev.currentTarget as HTMLElement | null)?.getAttribute('data-madrank-day')
      if (ymd) { setSelYmd(ymd); setRange('day') }
    }
    const rangeBtns = Array.from(rootEl.querySelectorAll('[data-madrank-range]'))
    const dayBars = Array.from(rootEl.querySelectorAll('[data-madrank-day]'))
    rangeBtns.forEach((b) => b.addEventListener('click', onRange))
    dayBars.forEach((b) => b.addEventListener('click', onDayBar))
    return () => {
      join?.removeEventListener('click', onJoin)
      leave?.removeEventListener('click', onLeave)
      rangeBtns.forEach((b) => b.removeEventListener('click', onRange))
      dayBars.forEach((b) => b.removeEventListener('click', onDayBar))
    }
  }, [scope, tick, range, selYmd])

  // Escape 关闭（模态态）
  useEffect(() => {
    if (!anchored || !onClose) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [anchored, onClose])

  // 卡片本体样式（居中模态下的放大版）
  const cardStyle: Record<string, string> = {
    width: '620px',
    maxWidth: '92vw',
    maxHeight: '84vh',
    overflowY: 'auto',
    background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1c21))',
    color: 'var(--dsw-alias-label-primary, inherit)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
    borderRadius: '16px',
    boxShadow: 'var(--dsw-shadow-lv2, 0 24px 64px rgba(0,0,0,.5))',
    padding: '18px 22px',
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  }

  // 页脚按钮 = 页面正中的模态弹窗：遮罩 + 放大卡片；点遮罩/Esc 关闭。
  // Portal 挂 document.body：fixed 定位若仍落在带 transform/backdrop-filter 的
  // 侧栏祖先内会被收窄，body 挂载彻底逃离任何侧栏层叠上下文与裁剪。
  if (anchored && onClose) {
    const overlay = createElement(
      'div',
      {
        key: 'madrank-modal-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': tr(cardLang(), 'cardTitle'),
        style: {
          position: 'fixed',
          top: '0', right: '0', bottom: '0', left: '0',
          zIndex: '2147483000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'rgba(0,0,0,.55)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
        },
        onClick: onClose,
      } as Record<string, unknown>,
      createElement('div', {
        ref,
        className: 'madrank-panel madrank-panel-modal',
        style: cardStyle,
        onClick: (e?: { stopPropagation(): void }) => e?.stopPropagation(),
        onPointerDown: (e?: { stopPropagation(): void }) => e?.stopPropagation(),
        dangerouslySetInnerHTML: { __html: html },
      }),
    )
    return typeof document !== 'undefined'
      ? createPortal(overlay, document.body)
      : overlay
  }

  // 内联态（Settings 页卡片）：不约束尺寸，随容器自适应
  return createElement('div', {
    ref,
    className: 'madrank-panel',
    dangerouslySetInnerHTML: { __html: html },
  })
}

// ── 侧栏脚部动作组件（wide 行态 / rail 图标态）────────────────

function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

export interface FooterCellProps {
  wide?: boolean
  scope: SettingsScopeLike
}

/**
 * 折线趋势图标（stroke 16px 网格）：三段上扬折线 + 终点圆点。
 * currentColor 描边，随宿主主题变色；decorative，语义由按钮 aria-label 承担。
 */
function TrendIcon(): ReturnType<typeof createElement> {
  return createElement(
    'svg',
    {
      width: '18px',
      height: '18px',
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': 'true',
      style: { flexShrink: 0, display: 'block' },
    } as Record<string, unknown>,
    createElement('path', {
      d: 'M1.5 12.5 L5.5 8 L8.5 10.5 L14.5 3.5',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    createElement('circle', {
      cx: '13',
      cy: '5',
      r: '1.7',
      fill: 'currentColor',
    }),
  )
}

export function MadrankFooterCell(props: FooterCellProps): ReturnType<typeof createElement> {
  const { scope } = props
  const wide = props.wide ?? true
  const [open, setOpen] = useState(false)
  useTickSource(dataTick.subscribe)
  const t = dataTick.get().today
  const todayShort = t ? fmtCompact(t.primaryTokens) : ''

  return createElement(
    'div',
    { style: { position: 'relative', pointerEvents: 'auto' } },
    createElement('button', {
      type: 'button',
      onClick: () => setOpen(o => !o),
      title: tr(cardLang(), 'cardTitle'),
      'aria-label': tr(cardLang(), 'cardTitle'),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: wide ? '6px 10px' : '6px 0',
        justifyContent: wide ? 'flex-start' : 'center',
        border: 'none',
        borderRadius: '8px',
        background: open ? 'var(--dsw-alias-interactive-bg-hover, transparent)' : 'transparent',
        color: 'var(--dsw-alias-label-secondary, #b9b9bf)',
        font: 'inherit',
        fontSize: wide ? '12px' : '11px',
        cursor: 'pointer',
        textAlign: 'left',
      } as Record<string, string>,
    },
      createElement(TrendIcon),
      wide ? createElement('span', { style: {
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontVariantNumeric: 'tabular-nums',
        } },
        'MADRank', todayShort ? createElement('span', { style: { marginLeft: '6px', opacity: .75 } }, todayShort) : null,
      ) : null,
    ),
    open ? createElement(CardShell, {
      scope,
      anchored: true,
      onClose: () => setOpen(false),
    }) : null,
  )
}

// ── 注册入口（由 index.ts 的 apply 调用）─────────────────────

export function registerFooterEntry(
  slots: { inject(slot: string, register: () => void): void; register(cfg: Record<string, unknown>, component: unknown): void },
  scope: SettingsScopeLike,
): void {
  slots.inject('sidebar.footer.action', () => {
    slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'madrank-usage',
        order: 40,
        label: 'MADRank Usage',
      },
      // 官方形态：第二参是组件；owner 注入 wide 等标准 props
      (cellProps?: { wide?: boolean }) =>
        createElement(MadrankFooterCell, { ...cellProps, scope }),
    )
  })
}
