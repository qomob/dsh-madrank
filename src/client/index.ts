/// <reference lib="dom" />

/**
 * client/index.ts — 浏览器半侧装配（新版 Harness 客户端模型）。
 *
 * 新版契约（DSH 0.2.x）：
 * - 设置：`ctx.configForms.get(entryId)` 取 Host 插件配置表单（快照含
 *   status/value/base/user/revision/writable；set/unset 写回 profile patch）。
 * - 数据：不再有 sessions.list feed；会话投影通过 slot 标准 props 的
 *   `useSessions(selector)` hook 读取（byId[id].projectionValues）。
 * - 槽位：settings.section（配置页）+ sidebar.footer.action（Quick View 入口）；
 *   旧版 settings.plugin.item 已移除。
 * - window.__MADRANK_CARD_DATA__ 仅作 fixture 覆盖口（测试/调试）。
 */

import { createElement, useEffect, useMemo, useState } from 'react'
import type { LocaleFaceLike, SettingsScopeLike, SlotsLike } from './card-html.ts'
import { cardDataFromList, decodeRankView } from './card-data.ts'
import { CardErrorBoundary, dataTick, ensurePanelStyles, MadrankOverlayHost, MadrankSidebarIcon, setActiveLocale } from './panel.ts'
import { disposeStyles } from './style-registry.ts'
import { useTickSource } from './tick.ts'
import { LOCALE_RESOURCES, tr } from './i18n.ts'

/** 必须与 src/rank-projection.ts 的 RANK_PROJECTION_KEY 一致。 */
const RANK_PROJECTION_KEY = 'madrankRank'

/** Loader entry id（必须与 cordis.patch.yml 的 insert.id 一致）。 */
export const MADRANK_ENTRY_ID = 'madrank'

/** bundle 包名（plugins.row.config 的 key = `<包名>#<row id>`）。 */
export const MADRANK_PACKAGE = '@qomob/dsh-madrank'

/** 新版客户端依赖的服务面。 */
export const inject = ['slots', 'locale', 'configForms', 'layout']

// 纯标记层与类型统一从这里出门（预览工具 / 外部消费者兼容面）
export { renderCardHtml } from './card-html.ts'
export type {
  CardSnapshot,
  CardModelRow,
  SettingsScopeLike,
  SlotsLike,
} from './card-html.ts'
export type { CardGlobal } from '../global-rank.ts'
export type { SettingsSectionValue } from './card-data.ts'
export { MadrankFooterCell, MadrankSettingsTab } from './panel.ts'
export { MadrankSettingsPanel, PLUGIN_VERSION } from './settings-panel.ts'

export interface ClientCtxLike {
  slots?: SlotsLike
  /** 新版设置表单服务：entryId → ConfigFormController（形状与 SettingsScopeLike 兼容）。 */
  configForms?: { get(id: string): SettingsScopeLike }
  locale?: LocaleFaceLike
  /** 主区面板导航（关闭卡片后切回会话）。 */
  layout?: { selectPanel?(panelId: string | null): void }
  /** Client 上下文的托管清理：回调返回的函数在插件卸载时执行（官方 restricted ctx.effect）。 */
  effect?: (callback: () => (() => void) | void, label?: string) => unknown
}

const windowFixture = (): Partial<import('./card-html.ts').CardSnapshot> =>
  typeof window !== 'undefined' ? (window.__MADRANK_CARD_DATA__ ?? {}) : {}

/** 从 settings mirror 里读 clearedAt（坏形状 → 0）。 */
function readClearedAt(scope: SettingsScopeLike | undefined): number {
  try {
    const v = (scope?.getSnapshot?.()?.value ?? undefined) as { clearedAt?: unknown } | undefined
    return typeof v?.clearedAt === 'number' && Number.isFinite(v.clearedAt) && v.clearedAt > 0 ? v.clearedAt : 0
  } catch {
    return 0
  }
}

/** 从会话列表（byId[id].projectionValues）聚合出卡片快照。 */
function snapshotFrom(byId: unknown, nowMs: number, clearedAtMs = 0): Partial<import('./card-html.ts').CardSnapshot> {
  try {
    const d = cardDataFromList({ byId } as never, nowMs, clearedAtMs)
    // 排名镜像：优先随 madrankUsage 视图下发（已验证可达的通道），
    // 兼容独立 madrankRank 投影（新版 list 若携带则同源）。
    let global: import('../global-rank.ts').CardGlobal | null = null
    if (byId !== null && typeof byId === 'object') {
      for (const entry of Object.values(byId as Record<string, { projectionValues?: Record<string, unknown> }>)) {
        const pv = entry?.projectionValues
        if (pv === undefined) continue
        const usage = (pv as Record<string, unknown>)['madrankUsage'] as Record<string, unknown> | undefined
        global = decodeRankView(usage?.['global'])
        if (global !== null) break
        global = decodeRankView((pv as Record<string, unknown>)[RANK_PROJECTION_KEY])
        if (global !== null) break
      }
    }
    return {
      today: d.today,
      topModels: d.topModels,
      streakDays: d.streak,
      last7Days: d.last7,
      history: d.history,
      global,
    }
  } catch (e) {
    console.warn('[madrank] projection feed error', e)
    return {}
  }
}

const selectById = (state: unknown): unknown => (state as { byId?: unknown } | undefined)?.byId


/**
 * slot 组件包装：用 slot 标准 props 的 useSessions 读取会话投影，推进共享
 * dataTick（两处 UI 同一快照），并把 settings scope 注入原组件。
 *
 * scope 延迟解析：configForms 可能晚于 client 模块就绪（冷启动 / HMR 重挂载）。
 * clearedAt 参与聚合：设置「清除本地数据」后，早于清除日的历史立即不再显示。
 */
function withSessionData(Comp: unknown, resolveScope: () => SettingsScopeLike | undefined): unknown {
  return function SlotEntry(props: Record<string, unknown>) {
    const [scope, setScope] = useState<SettingsScopeLike | undefined>(() => resolveScope())
    useEffect(() => {
      if (scope !== undefined) return
      const timer = setTimeout(() => {
        const next = resolveScope()
        if (next !== undefined) setScope(next)
      }, 300)
      return () => clearTimeout(timer)
    }, [scope])
    const useSessions = props['useSessions']
    const byId = typeof useSessions === 'function'
      ? (useSessions as (selector: unknown) => unknown)(selectById)
      : undefined
    const scopeSubscribe = useMemo(
      () => (scope && typeof scope.subscribe === 'function' ? scope.subscribe.bind(scope) : undefined),
      [scope],
    )
    const scopeTick = useTickSource(scopeSubscribe)
    const clearedAt = readClearedAt(scope)
    useEffect(() => {
      const snap = { ...snapshotFrom(byId, Date.now(), clearedAt), ...windowFixture() }
      dataTick.set(snap)
    }, [byId, clearedAt, scopeTick])
    if (scope === undefined) {
      return createElement('div', { className: 'madrank-page' })
    }
    return createElement(
      Comp as never,
      { ...props, scope } as never,
    )
  }
}

/** 客户端激活失败时至少留下可检索的日志（不再渲染诊断 banner）。 */
export function apply(ctx: ClientCtxLike): void {
  try {
    applyInner(ctx)
  } catch (e) {
    console.error('[madrank] client apply failed', e)
  }
}

function applyInner(ctx: ClientCtxLike): void {
  // 侧栏脚部样式必须先注入（ghost 按钮同款：透明底/hover 底色/rail 圆形）
  ensurePanelStyles()
  // 资源托管：样式标签 / locale 订阅 / 分享弹层都在插件卸载时回收，而不是永久留在页面上。
  const cleanups: Array<() => void> = [disposeStyles]
  const runCleanups = (): void => {
    for (const fn of cleanups.splice(0)) {
      try { fn() } catch { /* isolated */ }
    }
  }
  if (typeof ctx.effect === 'function') {
    try { ctx.effect(() => runCleanups, 'madrank client resources') } catch { /* restricted ctx without effect */ }
  }
  const slots = ctx.slots
  if (!slots) {
    console.warn('[madrank] slots seam absent — client half idle')
    return
  }
  // configForms 可能晚于 client 模块就绪（冷启动 / HMR 重挂载）：注册期不能硬依赖。
  // 拿到就先缓存，拿不到也继续注册（卡片挂载时再解析，见 MadrankOverlayHost.getScope）。
  const resolveScope = (): SettingsScopeLike | undefined => {
    try { return ctx.configForms?.get(MADRANK_ENTRY_ID) } catch { return undefined }
  }
  if (resolveScope() === undefined) {
    console.warn('[madrank] configForms not ready yet — entries register now, card retries on mount')
  }

  // ── 语言：跟随宿主 ctx.locale（切换推动整体重渲染）──
  const locale = ctx.locale
  const safeActive = (): string | undefined => {
    try { return locale?.getSnapshot?.()?.active } catch { return undefined }
  }
  setActiveLocale(safeActive())
  // 把本插件的文案登记进宿主 locale 目录（官方单 locale 非类型化形式）。
  // 渲染仍走本地 tr()（同一份字典），登记让宿主快照/其它消费者能看到这些资源，
  // 并在语言切换时随 register 的 revision bump 触发已有的 subscribe 重渲染。
  const registerLocale = (locale as { register?: (ns: string, localeId: string, dict: Record<string, string>) => (() => void) | undefined } | undefined)?.register
  if (typeof registerLocale === 'function') {
    for (const [id, dict] of Object.entries(LOCALE_RESOURCES)) {
      try {
        const off = registerLocale.call(locale, 'madrank', id, dict)
        if (typeof off === 'function') cleanups.push(off)
      } catch { /* duplicate (ns, locale) or unsupported locale id */ }
    }
  }
  try {
    const unsubscribe = locale?.subscribe?.(() => { setActiveLocale(safeActive()); dataTick.set(dataTick.get()) })
    if (typeof unsubscribe === 'function') cleanups.push(unsubscribe)
  } catch { /* isolated */ }

  // 1b) 设置 → 插件 → MADRank 的「配置」页：复用同一个 MADRank 设置面板，
  //     让插件页里的配置也走 MADRank 自己的 UI（不再出现一份裸 Config 表单）。
  const uiLang = (): 'en' | 'zh' =>
    String(locale?.getSnapshot?.()?.active ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'

  slots.inject('plugins.row.config', () => {
    slots.register(
      {
        name: 'plugins.row.config',
        key: MADRANK_PACKAGE + '#' + MADRANK_ENTRY_ID,
      },
      (props: { view?: string }) => {
        // 设置已统一到侧栏卡片：插件页只留一句指引，不再渲染第二份完整面板。
        if (props?.view === 'summary') return createElement('span', { className: 'mkp-hsub' }, 'MADRank')
        return createElement('p', { className: 'mkp-hsub', style: { margin: 0, lineHeight: '1.6' } },
          tr(uiLang(), 'sMoveHint'))
      },
    )
  })

  // 2) 侧栏一级入口：位置在「插件」下方、「自媒体工作台」上方（order 2；media-desk=5）。
  //    点击后由 main 槽渲染 MADRank 主区页面（不再占用侧栏底部、不再用居中弹窗）。
  slots.inject('sidebar.panellist', () => {
    slots.register(
      {
        name: 'sidebar.panellist',
        id: MADRANK_ENTRY_ID,
        order: 2,
        label: 'MADRank',
      },
      (props: { size?: number; active?: boolean }) => createElement(MadrankSidebarIcon, props),
    )
  })

  // 2b) 主区占位 + 全窗弹窗卡片：sidebar 入口 id 与 main key 对齐；挂载即弹卡片，
  //     关闭（Esc/遮罩/按钮）后切回会话面板。
  const layout = ctx.layout
  slots.inject('main', () => {
    slots.register(
      { name: 'main', key: MADRANK_ENTRY_ID },
      withSessionData(
        (props: Record<string, unknown>) => createElement(CardErrorBoundary, null,
          createElement(MadrankOverlayHost, {
            ...props,
            onClose: () => { try { layout?.selectPanel?.('conversation') } catch { /* isolated */ } },
          })),
        resolveScope,
      ),
    )
  })
}

export { MadrankSettingsPanel as SettingsPanel } from './settings-panel.ts'
void createElement // keep import shape stable for bundlers