/*****************************************************************************
 * card-html.ts — 卡片纯标记层（单一 markup 源，零依赖）。
 *
 * 视觉与结构语言对齐官方插件市场（dsh-client-ui-settings-plugin-inventory）：
 *   - 颜色/边框/背景全部走 --dsw-alias-* 主题变量（自动适配明暗主题）
 *   - 状态点（statusDot）+ 状态 pill（configTag）表达 Local/Sync
 *   - 分区标题 + 数量、details 网格（dt/dd）、focus-visible 环
 *   - 动效 .14s var(--ds-ease-in-out)，尊重 prefers-reduced-motion
 * 口径注释：Primary = uncached input + output；缓存单列 "+N cached"。
 *****************************************************************************/

export const SETTINGS_NS = 'madrank-usage'

export interface CardModelRow {
  provider: string
  model: string
  primaryTokens: number
  sharePct: number
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
  global?: { rank: number; topPct: number; race7d: number } | null
  anonIdSuffix?: string
  generatedAt?: number
}

declare global {
  interface Window { __MADRANK_CARD_DATA__?: CardSnapshot }
}

/** Host settingsScope 的最小结构镜像（SettingsScopeController 真实契约）。 */
export interface SettingsScopeLike {
  getSnapshot(): { status?: string; value?: { enabled?: boolean; endpoint?: string } } | undefined
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

// ── 格式化 ──────────────────────────────────────

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function fmtActive(seconds: number): string {
  if (seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? (h + 'h ' + String(m).padStart(2, '0') + 'm') : (m + 'm')
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
'/* 图例页脚 */',
'.madrank-card .mk-foot{display:flex;justify-content:space-between;gap:10px;',
'  font-size:10px;color:var(--dsw-alias-label-tertiary);padding:0 2px}',
'@media (prefers-reduced-motion:no-preference){',
'  .madrank-card .mk-bar i,.madrank-card .mk-hbar i{transition:width .14s var(--ds-ease-in-out),height .14s var(--ds-ease-in-out)}}',
].join('')

/**
 * 大号变体（居中模态用）：解锁固定宽、放大字型、中段双栏、同步区横排。
 * 仅作用于 .madrank-card-lg（由 renderCardHtml 的 opts.size='lg' 挂载）。
 */
const LG_CSS = [
'.madrank-card-lg{width:100%;max-width:none;font-size:14px;line-height:1.5;gap:14px}',
'.madrank-card-lg h3{font-size:15px;line-height:22px}',
'.madrank-card-lg .mk-mark{width:24px;height:24px;font-size:12px;border-radius:7px}',
'.madrank-card-lg .mk-tag{font-size:12px;min-height:24px}',
'.madrank-card-lg .mk-hero{padding:18px 22px;border-radius:14px;gap:6px}',
'.madrank-card-lg .mk-klabel{font-size:12px}',
'.madrank-card-lg .mk-big{font-size:46px;line-height:52px}',
'.madrank-card-lg .mk-sub{font-size:13px}',
'.madrank-card-lg .mk-chip{font-size:12px;line-height:20px;padding:2px 10px}',
'.madrank-card-lg .mk-h b{font-size:13px}',
'.madrank-card-lg .mk-h span{font-size:12px}',
'/* 中段双栏：rank | most used；窄屏自动单列 */',
'.madrank-card-lg .mk-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);',
'  gap:4px 26px;align-items:start}',
'.madrank-card-lg .mk-mrow{font-size:13px;margin-top:8px}',
'.madrank-card-lg .mk-bar{height:6px;border-radius:3px;margin-top:3px}',
'.madrank-card-lg .mk-hist{height:110px;gap:9px}',
'.madrank-card-lg .mk-hval,.madrank-card-lg .mk-hname{font-size:10px}',
'/* 同步区：说明左、按钮右，用足宽度 */',
'.madrank-card-lg .mk-sync{flex-direction:row;align-items:center;justify-content:space-between;',
'  gap:16px;padding-top:14px}',
'.madrank-card-lg .mk-fine{font-size:12px;max-width:62%}',
'.madrank-card-lg button{min-height:40px;padding:8px 18px;border-radius:9px;font-size:14px;',
'  width:auto;min-width:220px;flex:none}',
'.madrank-card-lg .mk-foot{font-size:11px}',
'@media (max-width:620px){',
'  .madrank-card-lg .mk-cols{grid-template-columns:minmax(0,1fr)}',
'  .madrank-card-lg .mk-sync{flex-direction:column;align-items:stretch}',
'  .madrank-card-lg .mk-fine{max-width:none}',
'  .madrank-card-lg button{width:100%}}',
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

function htmlHero(t: NonNullable<CardSnapshot['today']>): string {
  const hasData = t.primaryTokens > 0 || t.requests > 0
  const big = hasData ? fmtTokens(t.primaryTokens) : '—'

  const parts: string[] = []
  parts.push('<b>' + fmtTokens(t.requests) + '</b> requests')
  parts.push('<b>' + fmtActive(t.activeSeconds) + '</b> active')
  if (t.cachedTokens > 0) {
    parts.push('<span style="white-space:nowrap">' + fmtTokens(t.inputTokens) + ' in · ' +
      fmtTokens(t.outputTokens) + ' out · +' + fmtTokens(t.cachedTokens) + ' cached</span>')
  } else if (hasData) {
    parts.push('<span style="white-space:nowrap">' + fmtTokens(t.inputTokens) + ' in · ' +
      fmtTokens(t.outputTokens) + ' out</span>')
  }

  const chips: string[] = []
  const mult = t.vs7dAvgMultiple
  if (mult !== null && mult !== undefined) {
    const up = mult >= 1
    chips.push('<span class="mk-chip" data-tone="' + (up ? 'up' : '') + '">' +
      (up ? '↑ ' : '↓ ') + mult.toFixed(1) + '× vs 7d avg</span>')
  }
  // streak 由调用方拼入 heroChips

  return [
    '<div class="mk-hero">',
    '<div class="mk-klabel">TODAY \u00b7 UNCACHED TOKENS</div>',
    '<div class="mk-big">' + big + '</div>',
    '<div class="mk-sub">' + parts.join(' &nbsp;·&nbsp; ') + '</div>',
    '<div class="mk-chips">' + chips.join('') + '$CHIPS</div>',
    '</div>',
  ].join('')
}

function htmlModels(rows: CardModelRow[] | undefined): string {
  if (!rows || rows.length === 0) return ''
  const bars = rows.map((r) => [
    '<div class="mk-mrow">',
    '<span class="mk-mname">' + esc(r.provider) + ' <i>' + esc(r.model) + '</i></span>',
    '<span class="mk-pct"><i class="mk-mtok">' + fmtTokens(r.primaryTokens) + '</i>' +
      r.sharePct.toFixed(0) + '%</span>',
    '</div>',
    '<div class="mk-bar"><i style="width:' + Math.min(100, r.sharePct) + '%"></i></div>',
  ].join('')).join('')
  return ['<div><div class="mk-h"><b>Most used</b><span>' + rows.length + '</span></div>', bars, '</div>'].join('')
}

function htmlHistory(days: CardSnapshot['last7Days']): string {
  if (!days || days.length === 0 || days.every((d) => d.primaryTokens <= 0)) return ''
  const max = Math.max(1, ...days.map((d) => d.primaryTokens))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const bars = days.map((d) => {
    const dt = new Date(d.ymd + 'T00:00:00Z')
    return [
      '<div class="mk-hday">',
      '<div class="mk-hbar"><i style="height:' + Math.round((d.primaryTokens / max) * 100) + '%"></i></div>',
      '<div class="mk-hval">' + (d.primaryTokens > 0 ? fmtTokens(d.primaryTokens) : '') + '</div>',
      '<div class="mk-hname">' + weekday[dt.getUTCDay()] + '</div>',
      '</div>',
    ].join('')
  }).join('')
  return ['<div><div class="mk-h"><b>Last 7 days</b><span>' +
    fmtTokens(days.reduce((a, d) => a + d.primaryTokens, 0)) + '</span></div>',
    '<div class="mk-hist">', bars, '</div></div>'].join('')
}

function htmlSync(enabled: boolean): string {
  if (enabled) {
    return [
      '<div class="mk-sync">',
      '<p class="mk-fine">Sharing daily token aggregates anonymously \u00b7 anonId •' +
        ' <span style="font-family:var(--ds-font-family-code)">••••</span>. Never prompts or responses.</p>',
      '<button type="button" data-madrank-disable>Leave global ranking</button>',
      '</div>',
    ].join('')
  }
  return [
    '<div class="mk-sync">',
    '<p class="mk-fine">Optional: share <b>daily aggregates only</b> (token counts, model names).',
    ' Never prompts, responses, or files. Off by default.</p>',
    '<button type="button" class="mk-primary" data-madrank-join>Join global ranking</button>',
    '</div>',
  ].join('')
}

/**
 * 纯渲染：卡片 HTML（React 壳与预览工具共用）。
 * opts.style=true 时内联样式（预览/独立场景）；客户端应先 ensureCardStyles()。
 * streakDays 从 snap 读取并拼入 hero chips。
 */
export function renderCardHtml(
  snap: CardSnapshot,
  enabled: boolean,
  opts: { style?: boolean; size?: 'sm' | 'lg' } = { style: false },
): string {
  ensureCardStyles()

  const t = snap.today
  const chips: string[] = []
  const streak = snap.streakDays ?? 0
  if (!enabled && streak > 1) chips.push('<span class="mk-chip">' + streak + '-day streak</span>')
  const hero = t ? htmlHero(t).replace('$CHIPS', chips.join('')) : ''
  const heroBlock = t ? hero : [
    '<div class="mk-hero">',
    '<div class="mk-klabel">TODAY</div>',
    '<div class="mk-big">—</div>',
    '<p class="mk-fine" style="margin:0">No usage recorded yet. Numbers appear after your next AI turn.</p>',
    '</div>',
  ].join('')

  const rank = enabled && snap.global
    ? ['<div><div class="mk-h"><b>Global rank</b></div>',
        '<div class="mk-big">#' + snap.global.rank.toLocaleString('en-US') + '</div>',
        '<div class="mk-sub">top ' + snap.global.topPct.toFixed(1) + '% · ' +
          fmtTokens(snap.global.race7d) + ' tokens / 7d</div></div>'].join('')
    : ''

  const updated = new Date(snap.generatedAt ?? Date.now())
  const hhmm = String(updated.getUTCHours()).padStart(2, '0') + ':' +
    String(updated.getUTCMinutes()).padStart(2, '0')

  const lg = opts.size === 'lg'
  // lg：中段双栏（Global rank | Most used），Last 7 days 独占整行
  const mid = rank + htmlModels(snap.topModels)
  const midBlock = lg && mid !== '' ? '<div class="mk-cols">' + mid + '</div>' : mid

  return [
    opts.style === false ? '' : '<style>' + CSS + LG_CSS + '</style>',
    '<div class="madrank-card' + (lg ? ' madrank-card-lg' : '') + '">',
    '<div class="mk-head">',
    '<span class="mk-mark" aria-hidden="true">M</span>',
    '<h3>MADRank Usage</h3>',
    '<span class="mk-headspacer"></span>',
    '<span class="mk-tag" data-on="' + (enabled ? 'true' : 'false') + '" role="status">',
    '<span class="mk-dot"></span>' + (enabled ? 'Sync on' : 'Local only'),
    '</span>',
    '</div>',
    heroBlock,
    midBlock,
    htmlHistory(snap.last7Days),
    htmlSync(enabled),
    '<div class="mk-foot"><span>UTC ' + hhmm + '</span><span>private by default</span></div>',
    '</div>',
  ].join('')
}
