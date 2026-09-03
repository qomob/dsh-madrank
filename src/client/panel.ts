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

import { createElement, useEffect, useMemo, useRef, useState, Component } from 'react'
import type { ReactElement, ReactPortal, ErrorInfo, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { renderCardHtml, scopeEnabled } from './card-html.ts'
import type { CardSnapshot, SettingsScopeLike } from './card-html.ts'
import { composeGlobalView } from './card-data.ts'
import { resolveLang, tr, type Lang } from './i18n.ts'
import { dataTick, useTickSource, activeLocaleValue, resolveActiveLang, setActiveLocale } from './tick.ts'
import { MadrankSettingsPanel } from './settings-panel.ts'

// ── 微观共享状态：数据节拍 + 宿主 locale（实现在 tick.ts；此处转出口保持既有导入面） ──

export { dataTick, useTickSource, setActiveLocale } from './tick.ts'

// ── 语言：跟随宿主 ctx.locale（状态在 tick.ts；变化经 dataTick 重渲染） ──

function cardLang(): Lang {
  return resolveActiveLang()
}

/** 宽容读取 settings mirror 的 value（scope 未就绪/异常一律 undefined = 离线默认）。 */
function scopeValue(
  scope: SettingsScopeLike | undefined,
): { enabled?: boolean; endpoint?: string; global?: CardSnapshot['global']; deleteRequested?: number; deletedEpoch?: number } | undefined {
  try {
    return scope?.getSnapshot?.()?.value
  } catch {
    return undefined
  }
}

// ── 崩溃诊断边界：occupant 崩溃时原地显示错误文本而不是「点击就消失」──

/**
 * 挂在 footer 卡与 settings 卡最外层的自家边界。宿主边界只做卸载（「点击就没了」
 * 事故），我们抢先一步接住：把 error stack 渲染在原地（可选中复制），同时打到 console。
 * 这是诊断探针——问题定位后保留，防止任何未来回归再变成无声消失。
 */
export class CardErrorBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  readonly state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[madrank] occupant crashed — 请把界面上的错误文本反馈给维护者', error, info)
  }
  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    const raw = this.state.error?.stack ?? String(this.state.error)
    return createElement(
      'div',
      {
        'data-madrank-error': 'true',
        style: {
          font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
          color: 'var(--dsw-alias-label-danger, #ff6b6b)',
          background: 'rgba(255,107,107,.08)',
          border: '1px solid rgba(255,107,107,.35)',
          borderRadius: '8px',
          padding: '8px 10px',
          margin: '4px 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: '220px',
          overflow: 'auto',
          textAlign: 'left',
          cursor: 'text',
          userSelect: 'text',
          pointerEvents: 'auto',
        } as Record<string, string>,
        onClick: (e?: { stopPropagation(): void }) => e?.stopPropagation(),
      },
      '[MADRank debug] ' + raw.slice(0, 1600),
    )
  }
}

// ── 卡片面壳（settings 卡与 popover 共用）───────────────────

interface CardShellProps {
  scope: SettingsScopeLike
  onClose?: () => void
  anchored: boolean
  /** lg 变体内联（设置 tab 页全宽大卡）；与居中模态共用同一套 lg 排版。 */
  lg?: boolean
}

export function CardShell(props: CardShellProps): ReactElement | ReactPortal {
  const { scope, onClose, anchored, lg } = props
  const tick = useTickSource(dataTick.subscribe)
  // settings mirror 变更（Join/Leave 写入、同步后宿主触碰文档）也推进重渲染。
  // ⚠️ scope.subscribe 是类方法（内部 this.store）——必须绑定 this 再交给 hook；
  // 裸方法抽取调用 = 「Cannot read properties of undefined (reading 'store')」（点击即消失真凶）。
  // useMemo 保证 scope 稳定时引用稳定（否则 effect 每渲染重订阅）。
  const scopeSubscribe = useMemo(
    () => (scope && typeof scope.subscribe === 'function' ? scope.subscribe.bind(scope) : undefined),
    [scope],
  )
  const scopeTick = useTickSource(scopeSubscribe)
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
    // global / raceUrl 组装走纯函数（优先级：fixture > settings mirror > null）
    const sv = scopeValue(scope)
    const { global, raceUrl } = composeGlobalView(fixture, sv)
    const snap: CardSnapshot = { ...base, ...fixture, global }
    // 模态容器大：卡片用 lg 变体（解锁 320px 固定宽 + 双栏中段）。
    // v0.2：删除通道等配置动作收进 settings-panel.ts，卡片只负责「看」。
    html = renderCardHtml(
      snap,
      scopeEnabled(scope),
      anchored || lg
        ? { size: 'lg', locale: activeLocaleValue(), range, selectedYmd: selYmd, raceUrl }
        : { locale: activeLocaleValue(), range, selectedYmd: selYmd, raceUrl },
    )
  } catch (e) {
    console.warn('[madrank] card render fallback', e)
    html = '<div class="madrank-card"><h3 style="margin:0">' + tr(cardLang(), 'cardTitle') + '</h3>' +
      '<section class="mod"><div class="muted">Card unavailable this tick.</div></section></div>'
  }

  // 绑定卡片内按钮（v0.2 只剩 Join：关闭态的「开启全球排名」转化入口；
  // 退出/删除等配置动作在 Settings → MADRank 面板，见 settings-panel.ts）
  useEffect(() => {
    const rootEl = ref.current
    if (!rootEl) return
    const join = rootEl.querySelector('[data-madrank-join]')
    const onJoin = (): void => { void Promise.resolve(scope.set('enabled', true)).catch(() => {}); force(x => x + 1) }
    join?.addEventListener('click', onJoin)

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
      rangeBtns.forEach((b) => b.removeEventListener('click', onRange))
      dayBars.forEach((b) => b.removeEventListener('click', onDayBar))
    }
  }, [scope, tick, scopeTick, range, selYmd])

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

/**
 * 脚部入口样式 —— 对齐「插件市场」launcher（宿主 Button ghost 变体）的观感：
 *   - 字色 label-primary（Button.module.css .button 同款；此前 inline 的
 *     label-secondary 是「偏灰」的根因）
 *   - hover 背景 --dsw-alias-interactive-bg-hover（.ghost:hover 同款，视觉上
 *     即用户感知的「移上去有阴影」）；active 用 bg-active
 *   - inline style 表达不了 :hover/:active 伪类 —— 必须走注入 CSS。
 *   注入沿用 card-html 的 data-plugin-css 去重范式。
 */
const PANEL_STYLE_ID = 'madrank/panel'

const PANEL_CSS = [
'.madrank-foot{position:relative;flex:1 1 auto;min-width:0}',
'/* 包裹层铺满 footerActions 行（flex 项默认 shrink-wrap，是高亮不随侧栏宽度铺满的根因）；',
'   rail 态交还定宽，由宿主 footerActions 的 justify-content:center 居中 */',
'.madrank-foot[data-wide="false"]{flex:0 0 auto;width:auto}',
'/* 几何 1:1 对齐 .dshMarketLauncher：calc(100%+4px)+margin -2px 出血 = 高亮随侧栏全宽；',
'   rail 态 36px 圆形（同 launcher [data-wide=false]） */',
'.madrank-foot-btn{flex:none;box-sizing:border-box;display:flex;align-items:center;',
'  width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;gap:8px;',
'  justify-content:flex-start;overflow:hidden;border:none;border-radius:12px;',
'  background:transparent;color:var(--dsw-alias-label-primary);font:inherit;',
'  font-size:14px;line-height:22px;cursor:pointer;text-align:left;white-space:nowrap}',
'.madrank-foot-btn[data-wide="false"]{width:36px;height:36px;margin:8px 0 10px;',
'  justify-content:center;gap:0;padding:0;border-radius:50%}',
'/* hover/active：与宿主 ghost Button 完全同 token */',
'.madrank-foot-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
'.madrank-foot-btn:active{background:var(--dsw-alias-interactive-bg-active,',
'  var(--dsw-alias-interactive-bg-hover))}',
'/* 展开态：保持按下底色，不再额外 hover 叠加 */',
'.madrank-foot-btn[data-open="true"]{background:var(--dsw-alias-interactive-bg-active,',
'  var(--dsw-alias-interactive-bg-hover))}',
'.madrank-foot-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);',
'  outline-offset:-2px}',
'.madrank-foot-count{margin-left:6px;opacity:.75;font-variant-numeric:tabular-nums}',
'@media (prefers-reduced-motion:no-preference){',
'  .madrank-foot-btn{transition:background .14s var(--ds-ease-in-out,ease-in-out)}}',
].join('')

/** 注入一次（data-plugin-css 去重；与 card-html ensureCardStyles 同范式）。 */
function ensurePanelStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'madrank-usage/' + PANEL_STYLE_ID
  if (document.querySelector('style[data-plugin-css="' + JSON.stringify(tagId).slice(1, -1) + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'madrank-usage'
  tag.dataset.pluginCss = tagId
  tag.textContent = PANEL_CSS
  document.head.appendChild(tag)
}

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
    { className: 'madrank-foot', 'data-wide': String(wide), style: { pointerEvents: 'auto' } },
    // 样式走 PANEL_CSS（ghost Button 同款 label-primary + hover 底色）；
    // inline style 表达不了 :hover —— 「移上去没阴影」的根因就是全 inline。
    createElement('button', {
      type: 'button',
      className: 'madrank-foot-btn',
      'data-wide': String(wide),
      'data-open': String(open),
      onClick: () => setOpen(o => !o),
      title: tr(cardLang(), 'cardTitle'),
      'aria-label': tr(cardLang(), 'cardTitle'),
      'aria-expanded': open,
    },
      createElement(TrendIcon),
      wide ? createElement('span', { style: {
          display: 'block',
          minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis',
        } },
        'MADRank', todayShort ? createElement('span', { className: 'madrank-foot-count' }, todayShort) : null,
      ) : null,
    ),
    open ? createElement(CardShell, {
      scope,
      anchored: true,
      onClose: () => setOpen(false),
    }) : null,
  )
}

// ── 设置分区页（settings.section 槽）─────────────────────────

export interface SettingsTabProps {
  scope: SettingsScopeLike
}

/**
 * Settings 主导航的 MADRank 顶级分区页（同「桌面设置 / Agent 预设」形态）。
 * v0.2 交互规范：设置页 = CONFIGURATION（参与排名/同步/隐私/本地数据/插件），
 * 不再复用 Quick View 用量卡 —— 二者分工：侧栏入口「看」，设置页「改」。
 * 配置面板实现见 settings-panel.ts。
 */
export function MadrankSettingsTab(props: SettingsTabProps): ReturnType<typeof createElement> {
  return createElement(
    CardErrorBoundary,
    null,
    createElement(MadrankSettingsPanel, { scope: props.scope }),
  )
}

// ── 注册入口（由 index.ts 的 apply 调用）─────────────────────

export function registerFooterEntry(
  slots: { inject(slot: string, register: () => void): void; register(cfg: Record<string, unknown>, component: unknown): void },
  scope: SettingsScopeLike,
): void {
  ensurePanelStyles()
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
        createElement(CardErrorBoundary, null,
          createElement(MadrankFooterCell, { ...cellProps, scope })),
    )
  })
}
