/*****************************************************************************
 * card-html.ts — 卡片纯标记层（单一 markup 源，零依赖）。
 *
 * 视觉与结构语言对齐官方插件市场（dsh-client-ui-settings-plugin-inventory）：
 *   - 颜色/边框/背景全部走 --dsw-alias-* 主题变量（自动适配明暗主题）
 *   - 状态点（statusDot）+ 状态 pill（configTag）表达 Local/Sync
 *   - 分区标题 + 数量、details 网格（dt/dd）、focus-visible 环
 *   - 动效 .14s var(--ds-ease-in-out)，尊重 prefers-reduced-motion
 *   - 文案双语（i18n.ts 单一词典），语言跟随宿主 ctx.locale
 * 口径注释：Primary = uncached input + output；缓存单列 "N cached ⓘ"（hover 出口径说明）。
 *****************************************************************************/

import { fmtActive, resolveLang, tr, WEEKDAYS, type Lang } from './i18n.ts'
import type { CardGlobal } from '../global-rank.ts'

export type { CardGlobal } from '../global-rank.ts'

export const SETTINGS_NS = 'madrank-usage'

export interface CardModelRow {
  provider: string
  model: string
  primaryTokens: number
  sharePct: number
}

/** 历史单日明细（30d/单日视图；缺省字段视为 0 —— 兼容仅 last7Days 的 v1 快照）。 */
export interface CardDayEntry {
  ymd: string
  primaryTokens: number
  cachedTokens: number
  requests: number
  activeSeconds: number
  inputTokens?: number
  outputTokens?: number
  topModels?: CardModelRow[]
}

export interface CardSnapshot {
  ymd?: string
  today?: {
    primaryTokens: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    requests: number
    activeSeconds: number
    vs7dAvgMultiple: number | null
  }
  topModels?: CardModelRow[]
  streakDays?: number
  last7Days?: Array<{ ymd: string; primaryTokens: number }>
  /** 近 60 天日级明细（HISTORY_WINDOW_DAYS）；缺席 = 仅 7 天直方（v1 快照）。 */
  history?: CardDayEntry[]
  /** Join 后的全球排名（宿主经 settings mirror 注入；Local 态恒 null）。 */
  global?: CardGlobal | null
  anonIdSuffix?: string
  generatedAt?: number
}

declare global {
  interface Window { __MADRANK_CARD_DATA__?: CardSnapshot }
}

/** Host settingsScope 的最小结构镜像（SettingsScopeController 真实契约）。 */
export interface SettingsScopeLike {
  getSnapshot(): {
    status?: string
    value?: { enabled?: boolean; endpoint?: string; global?: CardGlobal | null }
  } | undefined
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): void | Promise<void>
  unset(field: string): void | Promise<void>
}

/** 安全读取 enabled；scope 未就绪/形状异常时一律 false（离线默认）。 */
export function scopeEnabled(scope: SettingsScopeLike | undefined): boolean {
  try {
    return scope?.getSnapshot?.()?.value?.enabled === true
  } catch {
    return false
  }
}

/** 客户端槽位系统最小结构镜像。 */
export interface SlotsLike {
  inject(slot: string, register: () => void): void
  register(cfg: Record<string, unknown>, component: unknown): void
}

/** 宿主 locale 面最小结构镜像（dsh-client-locale LocaleRuntime；只读 active/subscribe）。 */
export interface LocaleFaceLike {
  getSnapshot?(): { active?: string; revision?: number } | undefined
  subscribe?(fn: () => void): () => void
}

// ── 格式化 ──────────────────────────────────────

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch] ?? ch)

// ── 主题样式（对齐插件市场 token；注入一次，data-plugin-css 去重） ──

const STYLE_ID = 'madrank/card'

const CSS = [
'.madrank-card{width:320px;max-width:88vw;color:var(--dsw-alias-label-primary);',
'  display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.45}',
'.madrank-card .mk-head{display:flex;align-items:center;gap:8px}',
'.madrank-card .mk-mark{width:20px;height:20px;border-radius:6px;',
'  background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);',
'  color:var(--dsw-alias-state-business-primary);font-weight:700;font-size:11px;',
'  display:inline-flex;align-items:center;justify-content:center;flex:none}',
'.madrank-card h3{margin:0;font-size:13px;font-weight:600;line-height:20px;min-width:0}',
'/* 标题 + 副标题（定位语：卡片=看用量；设置=改配置） */',
'.madrank-card .mk-headtext{min-width:0;display:flex;flex-direction:column;gap:1px}',
'.madrank-card .mk-hsub{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:15px;',
'  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
'.madrank-card .mk-headspacer{flex:1}',
'/* 状态 pill：仿 configTag */',
'.madrank-card .mk-tag{display:inline-flex;align-items:center;gap:6px;min-height:20px;',
'  padding:1px 8px;border-radius:5px;background:var(--dsw-alias-bg-layer-1);',
'  color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}',
'.madrank-card .mk-dot{width:7px;height:7px;border-radius:999px;flex:none;',
'  background:var(--dsw-alias-label-tertiary)}',
'.madrank-card .mk-tag[data-on=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);',
'  color:var(--dsw-alias-state-success-primary)}',
'.madrank-card .mk-tag[data-on=true] .mk-dot{background:var(--dsw-alias-state-success-primary)}',
'/* Local 态：空心点（off=空心 / on=实心绿 的开关语法；off 是刻意设计而非失效） */',
'.madrank-card .mk-tag[data-on=false] .mk-dot{background:transparent;',
'  box-sizing:border-box;width:8px;height:8px;border:1.5px solid var(--dsw-alias-label-tertiary)}',
'/* Hero：今日主数字 */',
'.madrank-card .mk-hero{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
'  background:var(--dsw-alias-bg-layer-3);padding:12px 14px;display:flex;flex-direction:column;gap:4px}',
'.madrank-card .mk-klabel{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:17px}',
'.madrank-card .mk-big{font-size:26px;font-weight:700;line-height:32px;',
'  font-variant-numeric:tabular-nums}',
'.madrank-card .mk-sub{font-size:12px;color:var(--dsw-alias-label-secondary);',
'  font-variant-numeric:tabular-nums}',
'.madrank-card .mk-sub b{color:var(--dsw-alias-label-primary);font-weight:600}',
'/* chips：vs7d / streak：仿 details dd 语气 */',
'.madrank-card .mk-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}',
'.madrank-card .mk-chip{font-size:11px;line-height:17px;padding:1px 8px;border-radius:999px;',
'  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
'.madrank-card .mk-chip[data-tone=up]{color:var(--dsw-alias-state-success-primary);',
'  border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent)}',
'.madrank-card .mk-chip[data-tone=hot]{color:var(--dsw-alias-state-business-primary);',
'  border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent)}',
'/* 分区标题：仿 catalogHeading */',
'.madrank-card .mk-h{display:flex;align-items:baseline;gap:7px;padding:0 2px}',
'.madrank-card .mk-h b{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);',
'  letter-spacing:.04em;text-transform:uppercase}',
'.madrank-card .mk-h span{font-size:11px;color:var(--dsw-alias-label-tertiary);',
'  font-variant-numeric:tabular-nums}',
'/* 模型行 */',
'.madrank-card .mk-mrow{display:flex;justify-content:space-between;gap:10px;',
'  align-items:baseline;font-size:12px}',
'.madrank-card .mk-mname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.madrank-card .mk-mname i{font-style:normal;color:var(--dsw-alias-label-tertiary)}',
'.madrank-card .mk-pct{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none}',
'.madrank-card .mk-mtok{font-style:normal;font-weight:400;color:var(--dsw-alias-label-tertiary);',
'  font-variant-numeric:tabular-nums;margin-right:7px;flex:none}',
'.madrank-card .mk-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
'.madrank-card .mk-bar i{display:block;height:100%;border-radius:2px;',
'  background:var(--dsw-alias-state-business-primary);opacity:.75}',
'/* 7 日直方 */',
'.madrank-card .mk-hist{display:flex;gap:6px;align-items:flex-end;height:56px}',
'.madrank-card .mk-hday{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;min-width:0}',
'.madrank-card .mk-hbar{flex:1;width:100%;display:flex;align-items:flex-end}',
'.madrank-card .mk-hbar i{display:block;width:100%;background:var(--dsw-alias-state-business-primary);',
'  opacity:.55;border-radius:2px 2px 0 0;min-height:2px}',
'/* 直方柱可点（进入单日视图）；30 天密排：隐藏柱内数值、每周刻度 */',
'.madrank-card button.mk-hbar{min-height:0;padding:0;border:0;border-radius:0;',
'  background:transparent;cursor:pointer}',
'.madrank-card button.mk-hbar:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);',
'  outline-offset:1px}',
'.madrank-card .mk-hist[data-cols="30"]{gap:2px}',
'.madrank-card .mk-hist[data-cols="30"] .mk-hbar i{border-radius:1px 1px 0 0}',
'.madrank-card .mk-hval{font-size:9px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
'.madrank-card .mk-hname{font-size:9px;color:var(--dsw-alias-label-tertiary)}',
'/* 同步区：单句承诺 + 官方形制按钮 */',
'.madrank-card .mk-sync{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;',
'  display:flex;flex-direction:column;gap:8px}',
'.madrank-card .mk-fine{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:17px;margin:0}',
'.madrank-card button{width:100%;min-height:32px;padding:5px 12px;border-radius:8px;',
'  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);',
'  font:inherit;font-weight:500;cursor:pointer}',
'.madrank-card button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
'.madrank-card button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
'.madrank-card button.mk-primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;',
'  color:#fff}',
'.madrank-card button.mk-primary:hover{filter:brightness(1.06);background:var(--dsw-alias-state-business-primary)}',
'/* 范围切换（7D/30D/单日）：标题行右侧分段控件 */',
'.madrank-card .mk-hspring{flex:1}',
'.madrank-card .mk-seg{display:inline-flex;gap:2px;padding:2px;border-radius:6px;',
'  background:var(--dsw-alias-bg-layer-1);flex:none;align-self:center}',
'.madrank-card button.mk-segbtn{width:auto;min-height:0;padding:1px 8px;border:0;border-radius:4px;',
'  background:transparent;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;',
'  font-weight:500;cursor:pointer}',
'.madrank-card button.mk-segbtn[aria-pressed=true]{background:var(--dsw-alias-bg-layer-3);',
'  color:var(--dsw-alias-label-primary)}',
'.madrank-card button.mk-segbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);',
'  outline-offset:-1px}',
'/* 单日视图：日期标题 + 紧凑主数字 */',
'.madrank-card .mk-daysize{font-size:22px;line-height:28px}',
'.madrank-card button.mk-quiet{width:auto;min-height:24px;padding:2px 8px;border:none;border-radius:6px;',
'  background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400}',
'.madrank-card button.mk-quiet:hover{color:var(--dsw-alias-label-secondary);',
'  background:var(--dsw-alias-interactive-bg-hover)}',
'/* joined：Your global rank 区（替换 Join CTA；Utility 恒在 Gamification 之上） */',
'.madrank-card .mk-rankrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
'.madrank-card .mk-rankrow .mk-big{font-size:24px;line-height:30px}',
'.madrank-card .mk-rlab{font-size:11px;color:var(--dsw-alias-label-tertiary);',
'  letter-spacing:.04em;text-transform:uppercase;margin-right:8px}',
'.madrank-card .mk-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
'.madrank-card button.mk-share{min-height:26px;padding:2px 10px;border-radius:7px;font-size:12px;flex:none}',
'.madrank-card a.mk-race{font-size:12px;font-weight:500;line-height:20px;',
'  color:var(--dsw-alias-state-business-primary);text-decoration:none;border-radius:4px}',
'.madrank-card a.mk-race:hover{text-decoration:underline}',
'.madrank-card a.mk-race:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
'/* cached ⓘ：纯 CSS tooltip（hover/focus），口径说明单点解释 */',
'.madrank-card .mk-tip{position:relative;cursor:help;',
'  border-bottom:1px dotted var(--dsw-alias-border-l2)}',
'.madrank-card .mk-tip i{font-style:normal;color:var(--dsw-alias-label-tertiary);margin-left:2px}',
'.madrank-card .mk-tip::after{content:attr(data-tip);position:absolute;right:-6px;bottom:calc(100% + 7px);',
'  width:220px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
'  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);',
'  font-size:11px;line-height:1.5;white-space:normal;',
'  box-shadow:var(--dsw-shadow-lv1,0 4px 16px rgba(0,0,0,.25));',
'  opacity:0;pointer-events:none;transition:opacity .14s var(--ds-ease-in-out);z-index:2}',
'.madrank-card .mk-tip:hover::after,.madrank-card .mk-tip:focus-visible::after{opacity:1}',
'/* 图例页脚 */',
'.madrank-card .mk-foot{display:flex;justify-content:space-between;gap:10px;',
'  font-size:10px;color:var(--dsw-alias-label-tertiary);padding:0 2px}',
'@media (prefers-reduced-motion:no-preference){',
'  .madrank-card .mk-bar i,.madrank-card .mk-hbar i{transition:width .14s var(--ds-ease-in-out),height .14s var(--ds-ease-in-out)}}',
].join('')

/**
 * 大号变体（居中模态用）：解锁固定宽、放大字型、同步区横排。
 * 仅作用于 .madrank-card-lg（由 renderCardHtml 的 opts.size='lg' 挂载）。
 */
const LG_CSS = [
'.madrank-card-lg{width:100%;max-width:none;font-size:14px;line-height:1.5;gap:14px;container-type:inline-size}',
'.madrank-card-lg h3{font-size:15px;line-height:22px}',
'.madrank-card-lg .mk-hsub{font-size:12px;line-height:17px}',
'.madrank-card-lg .mk-mark{width:24px;height:24px;font-size:12px;border-radius:7px}',
'.madrank-card-lg .mk-tag{font-size:12px;min-height:24px}',
'.madrank-card-lg .mk-hero{padding:18px 22px;border-radius:14px;gap:6px}',
'.madrank-card-lg .mk-klabel{font-size:12px}',
'.madrank-card-lg .mk-big{font-size:46px;line-height:56px}',
'.madrank-card-lg .mk-sub{font-size:13px}',
'.madrank-card-lg .mk-chip{font-size:12px;line-height:20px;padding:2px 10px}',
'.madrank-card-lg .mk-h b{font-size:13px}',
'.madrank-card-lg .mk-h span{font-size:12px}',
'/* 模型行放大（Global rank 已下移至同步区） */',
'.madrank-card-lg .mk-mrow{font-size:13px;margin-top:8px}',
'.madrank-card-lg .mk-rankrow .mk-big{font-size:34px;line-height:44px}',
'.madrank-card-lg .mk-rlab{font-size:12px}',
'.madrank-card-lg a.mk-race{font-size:13px}',
'.madrank-card-lg .mk-tip::after{width:260px;font-size:12px}',
'.madrank-card-lg button.mk-quiet{min-width:0;min-height:24px;padding:2px 8px;font-size:12px}',
'.madrank-card-lg .mk-daysize{font-size:30px;line-height:36px}',
'.madrank-card-lg button.mk-segbtn{min-width:0;min-height:0;padding:1px 9px;font-size:11px}',
'.madrank-card-lg .mk-bar{height:6px;border-radius:3px;margin-top:3px}',
'.madrank-card-lg .mk-hist{height:110px;gap:9px}',
'.madrank-card-lg .mk-hval,.madrank-card-lg .mk-hname{font-size:10px}',
'/* 同步区：按容器宽度（非视口！）自适应 —— DSH 弹窗 320px 固定宽时桌面横排曾被硬塞，',
'   是 2026-09-01 「卡片乱版」根因。窄容器纵排为默认，宽容器（≥620px）才横排。 */',
'.madrank-card-lg .mk-fine{font-size:12px}',
'.madrank-card-lg .mk-foot{font-size:11px}',
'@container (min-width:620px){',
'  .madrank-card-lg .mk-sync{flex-direction:row;align-items:center;justify-content:space-between;',
'    gap:16px;padding-top:14px}',
'  .madrank-card-lg .mk-fine{max-width:62%}',
'  .madrank-card-lg button{min-height:40px;padding:8px 18px;border-radius:9px;font-size:14px;',
'    width:auto;min-width:220px;flex:none}}',
].join('')

/** 样式注入一次（官方 data-plugin-css 去重范式）；预览工具可 opts.style 内联。 */
export function ensureCardStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'madrank-usage/' + STYLE_ID
  if (document.querySelector('style[data-plugin-css="' + JSON.stringify(tagId).slice(1, -1) + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'madrank-usage'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS + LG_CSS
  document.head.appendChild(tag)
}

// ── 模块渲染 ─────────────────────────────────────

/** View race 链接回退值（endpoint 缺席/不可解析时；与默认 endpoint 同源）。 */
const RACE_URL_DEFAULT = 'https://madrank.ai/race'

/** 匿名 ID 掩码（shareFine 的 {mask} 占位；两种语言共用同一标记）。 */
const ANON_MASK = '<span style="font-family:var(--ds-font-family-code)">••••</span>'

/** 明细分段（requests/active/in/out/cached+tip）；hero 与单日视图共用同一口径。 */
function breakdownParts(
  d: { requests: number; activeSeconds: number; inputTokens: number; outputTokens: number; cachedTokens: number },
  hasData: boolean,
  lang: Lang,
): string[] {
  const parts: string[] = []
  parts.push(tr(lang, 'heroRequests', { n: fmtTokens(d.requests) }))
  parts.push(tr(lang, 'heroActive', { n: fmtActive(d.activeSeconds, lang) }))
  if (d.cachedTokens > 0) {
    const tip = tr(lang, 'cachedTip')
    const segs = [
      tr(lang, 'segIn', { v: fmtTokens(d.inputTokens) }),
      tr(lang, 'segOut', { v: fmtTokens(d.outputTokens) }),
      '<span class="mk-tip" tabindex="0" aria-label="' + tip + '" data-tip="' + tip + '">' +
        tr(lang, 'segCached', { v: fmtTokens(d.cachedTokens) }) + '<i aria-hidden="true"> \u24D8</i></span>',
    ]
    parts.push('<span style="white-space:nowrap">' + segs.join(' · ') + '</span>')
  } else if (hasData) {
    parts.push('<span style="white-space:nowrap">' +
      tr(lang, 'segIn', { v: fmtTokens(d.inputTokens) }) + ' · ' +
      tr(lang, 'segOut', { v: fmtTokens(d.outputTokens) }) + '</span>')
  }
  return parts
}

function htmlHero(t: NonNullable<CardSnapshot['today']>, lang: Lang): string {
  const hasData = t.primaryTokens > 0 || t.requests > 0
  const big = hasData ? fmtTokens(t.primaryTokens) : '—'

  const parts = breakdownParts(t, hasData, lang)

  const chips: string[] = []
  const mult = t.vs7dAvgMultiple
  if (mult !== null && mult !== undefined) {
    const up = mult >= 1
    chips.push('<span class="mk-chip" data-tone="' + (up ? 'up' : '') + '">' +
      (up ? '↑ ' : '↓ ') + mult.toFixed(1) + '× ' + tr(lang, 'chipVs') + '</span>')
  }
  // streak 由调用方拼入 heroChips

  return [
    '<div class="mk-hero">',
    '<div class="mk-klabel">' + tr(lang, 'todayLabel') + '</div>',
    '<div class="mk-big">' + big + '</div>',
    '<div class="mk-sub">' + parts.join(' &nbsp;·&nbsp; ') + '</div>',
    '<div class="mk-chips">' + chips.join('') + '$CHIPS</div>',
    '</div>',
  ].join('')
}

function modelBars(rows: CardModelRow[]): string {
  return rows.map((r) => [
    '<div class="mk-mrow">',
    '<span class="mk-mname">' + esc(r.provider) + ' <i>' + esc(r.model) + '</i></span>',
    '<span class="mk-pct"><i class="mk-mtok">' + fmtTokens(r.primaryTokens) + '</i>' +
      r.sharePct.toFixed(0) + '%</span>',
    '</div>',
    '<div class="mk-bar"><i style="width:' + Math.min(100, r.sharePct) + '%"></i></div>',
  ].join('')).join('')
}

function htmlModels(rows: CardModelRow[] | undefined, lang: Lang): string {
  if (!rows || rows.length === 0) return ''
  return ['<div><div class="mk-h"><b>' + tr(lang, 'mostUsed') + '</b></div>', modelBars(rows), '</div>'].join('')
}

// ── 历史区：7D / 30D 直方 + 单日视图（范围切换；日期一律 UTC 口径） ──

/** 快照历史条目；v1 快照无 history 时由 last7Days 退化（仅柱状，明细为零）。 */
function dayEntriesOf(snap: CardSnapshot): CardDayEntry[] {
  if (Array.isArray(snap.history) && snap.history.length > 0) return snap.history
  return (snap.last7Days ?? []).map((d) => ({
    ymd: d.ymd, primaryTokens: d.primaryTokens, cachedTokens: 0, requests: 0, activeSeconds: 0,
  }))
}

function shortDate(ymd: string): string {
  return ymd.slice(5) // UTC 'MM-DD'
}

function weekdayOf(ymd: string, lang: Lang): string {
  return WEEKDAYS[lang][new Date(ymd + 'T00:00:00Z').getUTCDay()] ?? ''
}

function htmlSeg(lang: Lang, range: '7d' | '30d' | 'day'): string {
  const btn = (key: '7d' | '30d' | 'day'): string => {
    const label = key === '7d' ? tr(lang, 'seg7d') : key === '30d' ? tr(lang, 'seg30d') : tr(lang, 'segDay')
    return '<button type="button" class="mk-segbtn" data-madrank-range="' + key + '"' +
      ' aria-pressed="' + (range === key ? 'true' : 'false') + '">' + label + '</button>'
  }
  return '<div class="mk-seg" role="group">' + btn('7d') + btn('30d') + btn('day') + '</div>'
}

function htmlHistBars(days: CardDayEntry[], lang: Lang): string {
  const cols = days.length
  const max = Math.max(1, ...days.map((d) => d.primaryTokens))
  const dense = cols > 7
  const bars = days.map((d, i) => {
    // 7D 每柱都标日期；30D 仅每周刻度（最右柱起每 7 根）
    const label = dense ? ((cols - 1 - i) % 7 === 0 ? shortDate(d.ymd) : '') : shortDate(d.ymd)
    return [
      '<div class="mk-hday">',
      '<button type="button" class="mk-hbar" data-madrank-day="' + d.ymd + '" title="' +
        d.ymd + ' ' + weekdayOf(d.ymd, lang) + ' · ' + fmtTokens(d.primaryTokens) + '">' +
        '<i style="height:' + Math.round((d.primaryTokens / max) * 100) + '%"></i></button>',
      '<div class="mk-hval">' + (!dense && d.primaryTokens > 0 ? fmtTokens(d.primaryTokens) : '') + '</div>',
      '<div class="mk-hname">' + label + '</div>',
      '</div>',
    ].join('')
  }).join('')
  return '<div class="mk-hist" data-cols="' + cols + '">' + bars + '</div>'
}

function htmlDayView(
  snap: CardSnapshot,
  lang: Lang,
  selectedYmd: string | undefined,
  seg: string,
): string {
  const entries = dayEntriesOf(snap)
  const fallback = snap.ymd ?? entries[entries.length - 1]?.ymd ?? ''
  const ymd = selectedYmd !== undefined && entries.some((e) => e.ymd === selectedYmd)
    ? selectedYmd
    : fallback
  const e = entries.find((x) => x.ymd === ymd)
  const hasData = (e?.requests ?? 0) > 0 || (e?.primaryTokens ?? 0) > 0
  const big = hasData && e ? fmtTokens(e.primaryTokens) : '—'
  const parts = e
    ? breakdownParts(
        {
          requests: e.requests, activeSeconds: e.activeSeconds,
          inputTokens: e.inputTokens ?? 0, outputTokens: e.outputTokens ?? 0,
          cachedTokens: e.cachedTokens,
        },
        hasData,
        lang,
      )
    : []
  return [
    '<div class="mk-dayview">',
    '<div class="mk-h"><b>' + tr(lang, 'dayHeading', { w: weekdayOf(ymd, lang), d: ymd }) + '</b>',
    '<span class="mk-hspring"></span>', seg, '</div>',
    '<div class="mk-big mk-daysize">' + big + '</div>',
    parts.length > 0 ? '<div class="mk-sub">' + parts.join(' &nbsp;·&nbsp; ') + '</div>' : '',
    e?.topModels && e.topModels.length > 0 ? modelBars(e.topModels) : '',
    '</div>',
  ].join('')
}

function htmlHistorySection(
  snap: CardSnapshot,
  lang: Lang,
  range: '7d' | '30d' | 'day',
  selectedYmd: string | undefined,
): string {
  const entries = dayEntriesOf(snap)
  if (entries.length === 0 || entries.every((d) => d.primaryTokens <= 0)) return ''
  const hasHistory = Array.isArray(snap.history) && snap.history.length > 0
  const seg = hasHistory ? htmlSeg(lang, range) : ''
  if (range === 'day' && hasHistory) return htmlDayView(snap, lang, selectedYmd, seg)
  const n = range === '30d' && hasHistory ? Math.min(30, entries.length) : Math.min(7, entries.length)
  const days = entries.slice(-n)
  const total = days.reduce((a, d) => a + d.primaryTokens, 0)
  return [
    '<div>',
    '<div class="mk-h"><b>' + tr(lang, range === '30d' && hasHistory ? 'last30' : 'last7') + '</b><span>' +
      fmtTokens(total) + '</span><span class="mk-hspring"></span>' + seg + '</div>',
    htmlHistBars(days, lang),
    '</div>',
  ].join('')
}

/**
 * Local 态（状态 A）：「你的全球排名」heading + 尚未参与（真实状态空态）
 * + 单句隐私承诺 + 开启 CTA。配置类动作（退出/删除）在 Settings，不在此处。
 */
function htmlJoinCta(lang: Lang): string {
  return [
    '<div class="mk-sync">',
    '<div class="mk-h"><b>' + tr(lang, 'yourRank') + '</b></div>',
    '<p class="mk-fine" data-madrank-not-joined>' + tr(lang, 'notJoined') + '</p>',
    '<p class="mk-fine">' + tr(lang, 'joinFine') + '</p>',
    '<button type="button" class="mk-primary" data-madrank-join>' + tr(lang, 'joinCta') + '</button>',
    '</div>',
  ].join('')
}

/**
 * Joined 态（状态 B）：Your global rank 块替换大 CTA。
 * 有排名：#N + TOP x% + 7-day tokens；未出排名：诚实空态（等首个日级 sync）。
 * v0.2 交互规范：退出/删除是配置动作，收进 Settings \u2192 MADRank；
 * Quick View 只负责「看」（View race 链接保留），两入口不再同质。
 */
function htmlJoined(
  hasRank: boolean,
  global: { rank: number; topPct: number; race7d: number; participants?: number },
  lang: Lang,
  raceUrl: string,
  activeDays: number,
  share: { url: string; text: string; card: string } | null = null,
): string {
  // GAP-D 信任修补：#1/1 时 TOP 100% 读作垫底 —— 唯一参与者改显 onlyParticipant
  const sole = hasRank && global.participants === 1
  const rankBlock = hasRank
    ? [
        '<div class="mk-rankrow">',
        '<span class="mk-big">#' + global.rank.toLocaleString('en-US') + '</span>',
        '<span class="mk-chip" data-tone="hot">' +
          (sole
            ? tr(lang, 'onlyParticipant')
            : tr(lang, 'topChip', { x: global.topPct.toFixed(1) })) + '</span>',
        '<span class="mk-chip">' + tr(lang, 'activeDays7', { n: Math.min(7, Math.max(0, activeDays)) }) + '</span>',
        '</div>',
        '<div class="mk-sub"><span class="mk-rlab">' + tr(lang, 'race7dLabel') + '</span><b>' +
          fmtTokens(global.race7d) + '</b></div>',
      ].join('')
    : '<p class="mk-fine">' + tr(lang, 'joinedPending') + '</p>'
  return [
    '<div class="mk-sync">',
    '<div class="mk-h"><b>' + tr(lang, 'yourRank') + '</b></div>',
    rankBlock,
    '<p class="mk-fine">' + tr(lang, 'shareFine', { mask: ANON_MASK }) + '</p>',
    '<div class="mk-actions">',
    '<a class="mk-race" href="' + raceUrl + '" target="_blank" rel="noreferrer noopener">' +
      tr(lang, 'viewRace') + ' <span aria-hidden="true">\u2192</span></a>',
    share !== null
      ? '<button type="button" class="mk-share" data-madrank-share="1"' +
        ' data-share-url="' + esc(share.url) + '"' +
        ' data-share-card="' + esc(share.card) + '"' +
        ' data-share-text="' + esc(share.text) + '">' +
        tr(lang, 'shareCta') + '</button>'
      : '',
    '</div>',
    '</div>',
  ].join('')
}

/** 分享文案(仅文字;浏览器分享前可用 /me 现取服务器真值重建 —— 修复缓存陈旧 2.54M vs 4.35M)。 */
export function formatShareText(
  global: { rank: number; participants?: number; race7d: number },
  topModel: string | undefined,
  lang: Lang,
): string {
  const multi = (global.participants ?? 0) > 1 && global.rank > 0
  if (lang === 'zh') {
    let text = '我最近 7 天真实 AI 用量:' + fmtTokens(global.race7d) + ' tokens'
    if (topModel) text += '(主要 ' + topModel + ')'
    return text + (multi
      ? ' —— 全球第 ' + global.rank + '/' + global.participants + ' 名。实测,不虚报。你排第几?'
      : ' —— 实测,不虚报。你排第几?')
  }
  let text = 'My real AI usage last 7 days: ' + fmtTokens(global.race7d) + ' tokens'
  if (topModel) text += ' (mostly ' + topModel + ')'
  return text + (multi
    ? ' — rank #' + global.rank + '/' + global.participants + ' on MADRank. Measured, not self-reported.'
    : ' — measured, not self-reported. Where do you rank?')
}

/** 分享链接/文案/卡片图(绝对数字优先 —— N=1 也成立;token 缺席 = null = 按钮不出现)。 */
function buildShare(
  raceUrl: string,
  token: string | undefined,
  global: { rank: number; participants?: number; race7d: number },
  topModel: string | undefined,
  lang: Lang,
): { url: string; text: string; card: string } | null {
  if (typeof token !== 'string' || !/^u[0-9a-f]{16}$/.test(token)) return null
  let origin = 'https://madrank.ai'
  try { origin = new URL(raceUrl).origin } catch { /* 回退官方主站 */ }
  const url = origin + '/share/' + token + '?utm_source=dsh-plugin&utm_campaign=usage-share'
  const card = origin + '/api/og/usage?t=' + token
  return { url, text: formatShareText(global, topModel, lang), card }
}

function htmlSync(
  enabled: boolean,
  snap: CardSnapshot,
  lang: Lang,
  raceUrl: string,
): string {
  if (!enabled) return htmlJoinCta(lang)
  const g = snap.global
  // Active Days：本机近 7 个已完成 UTC 日中有用量数据的天数（本地真实计数，
  // 与站点 /rank 的 x/7 days 辅助信号同口径；纯展示，绝不参与排名公式）。
  const activeDays = (snap.last7Days ?? []).filter((d) => d.primaryTokens > 0).length
  // 分享按钮:已出排名 + 持有分享令牌才出现(whoami 懒换,见宿主 index.ts)
  const share = g != null
    ? buildShare(raceUrl, g.shareToken, g, snap.topModels?.[0]?.model, lang)
    : null
  return htmlJoined(
    g != null,
    g ?? { rank: 0, topPct: 0, race7d: 0, participants: 0 },
    lang, raceUrl, activeDays, hasShareRank(g) ? share : null,
  )
}

/** 分享出现的门槛:有排名数据(文案依赖真实数字,不用 0 充数)。 */
function hasShareRank(g: CardGlobal | null | undefined): boolean {
  return g != null && g.race7d > 0
}

/**
 * 纯渲染：卡片 HTML（React 壳与预览工具共用）。
 * opts.style=true 时内联样式（预览/独立场景）；客户端应先 ensureCardStyles()。
 * streakDays 从 snap 读取并拼入 hero chips。
 */
export function renderCardHtml(
  snap: CardSnapshot,
  enabled: boolean,
  opts: {
    style?: boolean
    size?: 'sm' | 'lg'
    locale?: string
    range?: '7d' | '30d' | 'day'
    selectedYmd?: string
    /** View race 链接（self-host：调用方从 settings 的 endpoint 派生；缺省官方主站）。 */
    raceUrl?: string
  } = { style: false },
): string {
  ensureCardStyles()
  const lang = resolveLang(opts.locale)
  const raceUrl = opts.raceUrl ?? RACE_URL_DEFAULT

  const t = snap.today
  const chips: string[] = []
  const streak = snap.streakDays ?? 0
  if (!enabled && streak > 1) chips.push('<span class="mk-chip">' + tr(lang, 'chipStreak', { n: streak }) + '</span>')
  const hero = t ? htmlHero(t, lang).replace('$CHIPS', chips.join('')) : ''
  const heroBlock = t ? hero : [
    '<div class="mk-hero">',
    '<div class="mk-klabel">' + tr(lang, 'todayEmpty') + '</div>',
    '<div class="mk-big">—</div>',
    '<p class="mk-fine" style="margin:0">' + tr(lang, 'noUsage') + '</p>',
    '</div>',
  ].join('')

  const updated = new Date(snap.generatedAt ?? Date.now())
  const hhmm = String(updated.getUTCHours()).padStart(2, '0') + ':' +
    String(updated.getUTCMinutes()).padStart(2, '0')

  const lg = opts.size === 'lg'
  // Global rank 在底部同步区（Utility 恒在上）；中段只剩 Most used
  const midBlock = htmlModels(snap.topModels, lang)

  return [
    opts.style === false ? '' : '<style>' + CSS + LG_CSS + '</style>',
    '<div class="madrank-card' + (lg ? ' madrank-card-lg' : '') + '">',
    '<div class="mk-head">',
    '<span class="mk-mark" aria-hidden="true"><svg viewBox="0 0 24 24" style="width:12px;height:12px;display:block"><path d="M5 18 V6 L12 13 L19 6 V18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
    '<div class="mk-headtext">',
    '<h3>' + tr(lang, 'cardTitle') + '</h3>',
    '<div class="mk-hsub">' + tr(lang, 'cardSubtitle') + '</div>',
    '</div>',
    '<span class="mk-headspacer"></span>',
    '<span class="mk-tag" data-on="' + (enabled ? 'true' : 'false') + '" role="status">',
    '<span class="mk-dot"></span>' + tr(lang, enabled ? 'pillOn' : 'pillLocal'),
    '</span>',
    '</div>',
    heroBlock,
    midBlock,
    htmlHistorySection(snap, lang, opts.range ?? '7d', opts.selectedYmd),
    htmlSync(enabled, snap, lang, raceUrl),
    '<div class="mk-foot"><span>' + tr(lang, 'footerUpdated', { t: hhmm }) + '</span></div>',
    '</div>',
  ].join('')
}
