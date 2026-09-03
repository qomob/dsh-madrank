/// <reference lib="dom" />

/**
 * settings-panel.ts — 设置 → MADRank 配置面板（v0.2 交互规范落点）。
 *
 * 定位（与 Quick View 卡片的分工）：
 *   侧栏 MADRank   = QUICK VIEW    「我现在用了多少？我排第几？」
 *   设置 → MADRank = CONFIGURATION 「我要不要参与？数据怎么同步？隐私？本地数据？」
 *
 * 五个区块（克制，不加多余开关）：
 *   RANKING  参与 MADRank 全球排名（核心开关；本地统计不受影响，默认关闭）
 *   SYNC     自动同步每日用量（排名关闭时不可用 —— 不出两个互相矛盾的开关）
 *   PRIVACY  固定数据定义（只同步聚合；不做「可选上传 prompt」这类开关）
 *   DATA     本地数据概览 + 清除本地数据（只清本机，不动已提交的排名）
 *   PLUGIN   插件状态 / 版本 / 最近同步 / 安装说明
 *
 * 数据缝：settings mirror（decodeSettingsSection 窄化后的值）+ dataTick 快照。
 * 动作缝：scope.set / unset 写回宿主设置；deleteRequested / clearLocalRequested
 * 是「命令字段」，宿主 tick 消费后回写 0（mirror revision bump → 本面板重渲染）。
 */

import { createElement, useState } from 'react'
import type { ReactElement } from 'react'
import { dataTick, useTickSource, resolveActiveLang } from './tick.ts'
import { resolveLang, tr, type Lang } from './i18n.ts'
import type { SettingsSectionValue } from './card-data.ts'
import type { SettingsScopeLike } from './card-html.ts'

/** 与 dsh-madrank/package.json version 同步（插件状态区展示）。 */
export const PLUGIN_VERSION = '0.2.0'

/** 官方站点回退（self-host 端点缺席/不可解析时）。 */
const SITE_FALLBACK = 'https://madrank.ai'

/** 从 endpoint 派生站点页（self-host 支持）；异常一律回退官方主站。 */
function siteUrl(endpoint: string | undefined, path: string): string {
  try {
    if (!endpoint) return SITE_FALLBACK + path
    return new URL(endpoint).origin + path
  } catch {
    return SITE_FALLBACK + path
  }
}

/** 宽容读取 settings mirror 的 value（scope 未就绪/异常一律 undefined = 离线默认）。 */
function scopeValue(scope: SettingsScopeLike | undefined): SettingsSectionValue | undefined {
  try {
    const v = scope?.getSnapshot?.()?.value as Partial<SettingsSectionValue> | undefined
    if (typeof v !== 'object' || v === null) return undefined
    return {
      enabled: v.enabled === true,
      endpoint: typeof v.endpoint === 'string' ? v.endpoint : undefined,
      global: v.global ?? null,
      autoSync: v.autoSync !== false,
      deleteRequested: typeof v.deleteRequested === 'number' ? v.deleteRequested : 0,
      deletedEpoch: typeof v.deletedEpoch === 'number' ? v.deletedEpoch : 0,
      clearLocalRequested: typeof v.clearLocalRequested === 'number' ? v.clearLocalRequested : 0,
      clearedEpoch: typeof v.clearedEpoch === 'number' ? v.clearedEpoch : 0,
    }
  } catch {
    return undefined
  }
}

// ── 样式（主题 token；注入一次，data-plugin-css 去重） ──────────

const SETTINGS_STYLE_ID = 'madrank/settings-panel'

const SETTINGS_CSS = [
'.mkp{display:flex;flex-direction:column;gap:18px;max-width:640px;color:var(--dsw-alias-label-primary);',
'  font-size:13px;line-height:1.5}',
'/* 头部 */',
'.mkp-head{display:flex;align-items:center;gap:10px}',
'.mkp-mark{width:28px;height:28px;border-radius:8px;flex:none;',
'  background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);',
'  color:var(--dsw-alias-state-business-primary);font-weight:700;font-size:13px;',
'  display:inline-flex;align-items:center;justify-content:center}',
'.mkp-headtext{min-width:0;display:flex;flex-direction:column;gap:1px}',
'.mkp-headtext h3{margin:0;font-size:15px;font-weight:600;line-height:20px}',
'.mkp-hsub{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:16px}',
'.mkp-headspring{flex:1}',
'/* 状态 pill（真实状态语法：on=实心绿 / off=空心） */',
'.mkp-tag{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding:2px 9px;border-radius:6px;',
'  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;',
'  white-space:nowrap}',
'.mkp-dot{width:7px;height:7px;border-radius:999px;flex:none;background:var(--dsw-alias-label-tertiary)}',
'.mkp-tag[data-on=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);',
'  color:var(--dsw-alias-state-success-primary)}',
'.mkp-tag[data-on=true] .mkp-dot{background:var(--dsw-alias-state-success-primary)}',
'.mkp-tag[data-on=false] .mkp-dot{background:transparent;box-sizing:border-box;width:8px;height:8px;',
'  border:1.5px solid var(--dsw-alias-label-tertiary)}',
'/* 区块 */',
'.mkp-sec{display:flex;flex-direction:column;gap:8px}',
'.mkp-sh{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);',
'  letter-spacing:.04em;text-transform:uppercase;padding:0 2px}',
'.mkp-group{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;',
'  background:var(--dsw-alias-bg-layer-2);padding:4px 0}',
'.mkp-row{display:flex;align-items:center;gap:14px;padding:11px 14px}',
'.mkp-row + .mkp-row{border-top:1px solid var(--dsw-alias-border-l2)}',
'.mkp-rt{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}',
'.mkp-label{font-size:13px;font-weight:500;line-height:19px}',
'.mkp-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:18px}',
'/* 开关（仿官方 switch 语法） */',
'.mkp-switch{position:relative;width:38px;height:22px;border-radius:999px;flex:none;cursor:pointer;',
'  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);padding:0;',
'  font:inherit;transition:background .14s var(--ds-ease-in-out,ease-in-out)}',
'.mkp-switch[aria-checked="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}',
'.mkp-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
'.mkp-switch .mkp-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;',
'  background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);',
'  transition:transform .14s var(--ds-ease-in-out,ease-in-out)}',
'.mkp-switch[aria-checked="true"] .mkp-knob{transform:translateX(16px)}',
'.mkp-switch:disabled{opacity:.45;cursor:not-allowed}',
'/* 键值行 */',
'.mkp-kv{display:flex;justify-content:space-between;gap:14px;padding:10px 14px;font-size:12px;',
'  color:var(--dsw-alias-label-secondary)}',
'.mkp-kv + .mkp-kv{border-top:1px solid var(--dsw-alias-border-l2)}',
'.mkp-kv b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;',
'  text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'/* 隐私清单 */',
'.mkp-priv{display:flex;gap:22px;flex-wrap:wrap;padding:12px 14px}',
'.mkp-priv > div{flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px}',
'.mkp-ph{font-size:11px;color:var(--dsw-alias-label-tertiary);letter-spacing:.04em;',
'  text-transform:uppercase;font-weight:600}',
'.mkp-priv ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;',
'  font-size:12px;color:var(--dsw-alias-label-secondary)}',
'.mkp-yes::before{content:"\u2713";color:var(--dsw-alias-state-success-primary);margin-right:7px;font-weight:600}',
'.mkp-no::before{content:"\u2715";color:var(--dsw-alias-label-tertiary);margin-right:7px}',
'/* 注脚 + 动作 */',
'.mkp-note{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:17px;margin:0;padding:0 14px 11px}',
'.mkp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 14px 12px}',
'button.mkp-btn{min-height:30px;padding:4px 12px;border-radius:8px;',
'  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);',
'  font:inherit;font-size:12px;font-weight:500;cursor:pointer}',
'button.mkp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
'button.mkp-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
'button.mkp-btn[data-armed="true"]{border-color:color-mix(in srgb, var(--dsw-alias-state-danger-primary, #ff6b6b) 45%, transparent);',
'  color:var(--dsw-alias-state-danger-primary, #ff6b6b)}',
'button.mkp-btn:disabled{opacity:.55;cursor:default}',
'a.mkp-link{font-size:12px;font-weight:500;color:var(--dsw-alias-state-business-primary);',
'  text-decoration:none;border-radius:4px}',
'a.mkp-link:hover{text-decoration:underline}',
'a.mkp-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
'/* 命令反馈行 */',
'.mkp-feedback{font-size:11px;line-height:17px;margin:0;padding:0 14px 11px;',
'  color:var(--dsw-alias-state-success-primary)}',
].join('')

/** 注入一次（data-plugin-css 去重；与 card-html/panel 同范式）。 */
export function ensureSettingsStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'madrank-usage/' + SETTINGS_STYLE_ID
  if (document.querySelector('style[data-plugin-css="' + JSON.stringify(tagId).slice(1, -1) + '"]')) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'madrank-usage'
  tag.dataset.pluginCss = tagId
  tag.textContent = SETTINGS_CSS
  document.head.appendChild(tag)
}

// ── 小组件 ──────────────────────────────────────

/** 开关行：label + 描述 + role="switch"。disabled 时附 hint。 */
function ToggleRow(props: {
  label: string
  desc?: string
  checked: boolean
  disabled?: boolean
  disabledHint?: string
  onToggle: (next: boolean) => void
}): ReactElement {
  return createElement('div', { className: 'mkp-row' },
    createElement('div', { className: 'mkp-rt' },
      createElement('div', { className: 'mkp-label' }, props.label),
      props.desc !== undefined
        ? createElement('div', { className: 'mkp-desc' }, props.desc)
        : null,
      props.disabled === true && props.disabledHint !== undefined
        ? createElement('div', { className: 'mkp-desc' }, props.disabledHint)
        : null,
    ),
    createElement('button', {
      type: 'button',
      role: 'switch',
      className: 'mkp-switch',
      'aria-checked': props.checked ? 'true' : 'false',
      'aria-label': props.label,
      disabled: props.disabled === true,
      onClick: () => { if (props.disabled !== true) props.onToggle(!props.checked) },
    },
      createElement('span', { className: 'mkp-knob', 'aria-hidden': 'true' }),
    ),
  )
}

/** 键值行。 */
function Kv(props: { k: string; v: string }): ReactElement {
  return createElement('div', { className: 'mkp-kv' },
    createElement('span', null, props.k),
    createElement('b', null, props.v),
  )
}

/**
 * 两步确认按钮（v0.2 安全语法：第一次点 = 进入确认态改文案；第二次点 = 真执行）。
 * busy（命令执行中）时禁用；完成反馈由调用方以 feedback 行呈现。
 */
function ConfirmButton(props: {
  /** 稳定测试/样式锚（'delete' | 'clear'）。 */
  cmd: string
  label: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
}): ReactElement {
  const [armed, setArmed] = useState(false)
  const text = props.busy ? props.label + '…' : armed ? props.confirmLabel : props.label
  return createElement('button', {
    type: 'button',
    className: 'mkp-btn',
    'data-armed': armed && !props.busy ? 'true' : 'false',
    'data-madrank-cmd': props.cmd,
    disabled: props.busy,
    onClick: () => {
      if (props.busy) return
      if (armed) { setArmed(false); props.onConfirm(); return }
      setArmed(true)
    },
  }, text)
}

/** 本地时间 「YYYY-MM-DD HH:mm」（最近同步时间戳；无效值回退 '—'）。 */
function fmtLocalDateTime(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '\u2014'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/** 紧凑 token 数（与卡片 fmtTokens 同口径；本地副本避免引 card-html 渲染层）。 */
function fmtTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

// ── 主面板 ──────────────────────────────────────

export interface MadrankSettingsPanelProps {
  scope: SettingsScopeLike
}

export function MadrankSettingsPanel(props: MadrankSettingsPanelProps): ReactElement {
  const { scope } = props
  ensureSettingsStyles()
  useTickSource(dataTick.subscribe)
  const scopeSubscribe = (
    scope && typeof scope.subscribe === 'function' ? scope.subscribe.bind(scope) : undefined
  )
  useTickSource(scopeSubscribe)
  const lang: Lang = resolveActiveLang()

  const sv = scopeValue(scope)
  const enabled = sv?.enabled === true
  const autoSync = sv?.autoSync !== false

  // 本地统计概览（Quick View 同一快照缝；只读，不做第二份聚合）
  const snap = dataTick.get()
  const last7 = Array.isArray(snap.last7Days) ? snap.last7Days : []
  const total7 = last7.reduce((a, d) => a + (d.primaryTokens > 0 ? d.primaryTokens : 0), 0)
  const recordDays = Array.isArray(snap.history)
    ? snap.history.filter((d) => d.primaryTokens > 0).length
    : 0

  // 最近同步：排名记录的采集时间即「最近一次成功同步」（宿主 onRace 捕获缝）
  const lastSyncText = sv?.global?.updatedAt !== undefined && sv.global.updatedAt > 0
    ? fmtLocalDateTime(sv.global.updatedAt) + ' · ' +
      tr(lang, 'race7dShort', { v: fmtTokensCompact(sv.global.race7d) })
    : tr(lang, 'sNeverSynced')

  // 命令通道（pending = 请求时间戳新于完成时间戳；done 只作一次性反馈展示）
  const delPending = (sv?.deleteRequested ?? 0) > (sv?.deletedEpoch ?? 0) && (sv?.deleteRequested ?? 0) > 0
  const delDone = !delPending && (sv?.deletedEpoch ?? 0) > 0 &&
    (sv?.deleteRequested ?? 0) > 0 && (sv?.deleteRequested ?? 0) <= (sv?.deletedEpoch ?? 0)
  const clrPending = (sv?.clearLocalRequested ?? 0) > (sv?.clearedEpoch ?? 0) && (sv?.clearLocalRequested ?? 0) > 0
  const clrDone = !clrPending && (sv?.clearedEpoch ?? 0) > 0 &&
    (sv?.clearLocalRequested ?? 0) > 0 && (sv?.clearLocalRequested ?? 0) <= (sv?.clearedEpoch ?? 0)

  return createElement('div', { className: 'mkp', 'data-madrank-settings': 'true' },
    // ── 头部：MADRank + 定位副标题 + 真实状态 pill ──
    createElement('div', { className: 'mkp-head' },
      createElement('span', { className: 'mkp-mark', 'aria-hidden': 'true' }, 'M'),
      createElement('div', { className: 'mkp-headtext' },
        createElement('h3', null, tr(lang, 'cardTitle')),
        createElement('div', { className: 'mkp-hsub' }, tr(lang, 'cardSubtitle')),
      ),
      createElement('span', { className: 'mkp-headspring' }),
      createElement('span', { className: 'mkp-tag', 'data-on': enabled ? 'true' : 'false', role: 'status' },
        createElement('span', { className: 'mkp-dot', 'aria-hidden': 'true' }),
        tr(lang, enabled ? 'pillOn' : 'pillLocal'),
      ),
    ),

    // ── RANKING：参与全球排名（核心开关） ──
    createElement('section', { className: 'mkp-sec' },
      createElement('div', { className: 'mkp-sh' }, tr(lang, 'sRanking')),
      createElement('div', { className: 'mkp-group' },
        createElement(ToggleRow, {
          label: tr(lang, 'sRankingToggle'),
          desc: tr(lang, 'sRankingDesc'),
          checked: enabled,
          onToggle: (next) => {
            void Promise.resolve(next ? scope.set('enabled', true) : scope.unset('enabled')).catch(() => {})
          },
        }),
      ),
    ),

    // ── SYNC：自动同步（排名关闭 = 不可用，避免两个互相矛盾的开关） ──
    createElement('section', { className: 'mkp-sec' },
      createElement('div', { className: 'mkp-sh' }, tr(lang, 'sSync')),
      createElement('div', { className: 'mkp-group' },
        createElement(ToggleRow, {
          label: tr(lang, 'sSyncToggle'),
          desc: tr(lang, 'sSyncDesc'),
          checked: autoSync,
          disabled: !enabled,
          disabledHint: enabled ? undefined : tr(lang, 'sSyncOffHint'),
          onToggle: (next) => {
            void Promise.resolve(scope.set('autoSync', next)).catch(() => {})
          },
        }),
        createElement(Kv, { k: tr(lang, 'sLastSync'), v: enabled ? lastSyncText : tr(lang, 'sNeverSynced') }),
      ),
    ),

    // ── PRIVACY：固定数据定义（不是开关 —— 本来就不上传） + 删除已同步数据 ──
    createElement('section', { className: 'mkp-sec' },
      createElement('div', { className: 'mkp-sh' }, tr(lang, 'sPrivacy')),
      createElement('div', { className: 'mkp-group' },
        createElement('div', { className: 'mkp-priv' },
          createElement('div', null,
            createElement('div', { className: 'mkp-ph' }, tr(lang, 'sSyncedHead')),
            createElement('ul', null,
              ['sItemTokens', 'sItemDates', 'sItemModels'].map((k) =>
                createElement('li', { key: k, className: 'mkp-yes' }, tr(lang, k as never)),
              ),
            ),
          ),
          createElement('div', null,
            createElement('div', { className: 'mkp-ph' }, tr(lang, 'sNeverHead')),
            createElement('ul', null,
              ['sItemChats', 'sItemPrompts', 'sItemResponses', 'sItemFiles', 'sItemKeys', 'sItemTools']
                .map((k) => createElement('li', { key: k, className: 'mkp-no' }, tr(lang, k as never))),
            ),
          ),
        ),
        createElement('div', { className: 'mkp-actions' },
          createElement('a', {
            className: 'mkp-link',
            href: siteUrl(sv?.endpoint, '/privacy'),
            target: '_blank', rel: 'noreferrer noopener',
          }, tr(lang, 'sPrivacyMore'), ' \u2192'),
        ),
        createElement('p', { className: 'mkp-note' }, tr(lang, 'sDeleteNote')),
        createElement('div', { className: 'mkp-actions' },
          createElement(ConfirmButton, {
            cmd: 'delete',
            label: tr(lang, 'deleteBtn'),
            confirmLabel: tr(lang, 'deleteConfirmBtn'),
            busy: delPending,
            onConfirm: () => {
              void Promise.resolve(scope.set('deleteRequested', Date.now())).catch(() => {})
            },
          }),
        ),
        delDone ? createElement('p', { className: 'mkp-feedback', 'data-madrank-feedback': 'delete' },
          tr(lang, 'deleteDone')) : null,
      ),
    ),

    // ── DATA：本地数据概览 + 清除本地数据（只清本机，不动已提交排名） ──
    createElement('section', { className: 'mkp-sec' },
      createElement('div', { className: 'mkp-sh' }, tr(lang, 'sData')),
      createElement('div', { className: 'mkp-group' },
        createElement(Kv, { k: tr(lang, 'last7'), v: fmtTokensCompact(total7) + ' tokens' }),
        createElement(Kv, { k: tr(lang, 'sDataRecords'), v: tr(lang, 'sDaysCount', { n: recordDays }) }),
        createElement('p', { className: 'mkp-note' }, tr(lang, 'sDataNote')),
        createElement('p', { className: 'mkp-note' }, tr(lang, 'sClearNote')),
        createElement('div', { className: 'mkp-actions' },
          createElement(ConfirmButton, {
            cmd: 'clear',
            label: tr(lang, 'sClearBtn'),
            confirmLabel: tr(lang, 'sClearConfirmBtn'),
            busy: clrPending,
            onConfirm: () => {
              void Promise.resolve(scope.set('clearLocalRequested', Date.now())).catch(() => {})
            },
          }),
        ),
        clrDone ? createElement('p', { className: 'mkp-feedback', 'data-madrank-feedback': 'clear' },
          tr(lang, 'sClearDone')) : null,
      ),
    ),

    // ── PLUGIN：插件状态（版本 / 启用 / 最近同步 / 安装说明） ──
    createElement('section', { className: 'mkp-sec' },
      createElement('div', { className: 'mkp-sh' }, tr(lang, 'sPlugin')),
      createElement('div', { className: 'mkp-group' },
        createElement(Kv, { k: tr(lang, 'sPluginName'), v: 'v' + PLUGIN_VERSION }),
        createElement(Kv, { k: tr(lang, 'sStatus'), v: '\u25CF ' + tr(lang, 'sPluginEnabled') }),
        createElement(Kv, { k: tr(lang, 'sLastSync'), v: lastSyncText }),
        createElement('div', { className: 'mkp-actions' },
          createElement('a', {
            className: 'mkp-link',
            href: siteUrl(sv?.endpoint, '/install'),
            target: '_blank', rel: 'noreferrer noopener',
          }, tr(lang, 'sInstallGuide'), ' \u2192'),
        ),
      ),
    ),
  )
}
