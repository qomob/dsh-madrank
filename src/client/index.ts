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

import { createElement, useEffect } from 'react'
import type { LocaleFaceLike, SettingsScopeLike, SlotsLike } from './card-html.ts'
import { cardDataFromList, decodeRankView } from './card-data.ts'
import { CardErrorBoundary, dataTick, ensurePanelStyles, MadrankFooterCell, MadrankSettingsTab, setActiveLocale } from './panel.ts'
import { MadrankSettingsPanel } from './settings-panel.ts'

/** 必须与 src/rank-projection.ts 的 RANK_PROJECTION_KEY 一致。 */
const RANK_PROJECTION_KEY = 'madrankRank'

/** Loader entry id（必须与 cordis.patch.yml 的 insert.id 一致）。 */
export const MADRANK_ENTRY_ID = 'madrank'

/** 新版客户端依赖的服务面。 */
export const inject = ['slots', 'locale', 'configForms']

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
}

const windowFixture = (): Partial<import('./card-html.ts').CardSnapshot> =>
  typeof window !== 'undefined' ? (window.__MADRANK_CARD_DATA__ ?? {}) : {}

/** 从会话列表（byId[id].projectionValues）聚合出卡片快照。 */
function snapshotFrom(byId: unknown, nowMs: number): Partial<import('./card-html.ts').CardSnapshot> {
  try {
    const d = cardDataFromList({ byId } as never, nowMs)
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
 */
function withSessionData(Comp: unknown, scope: SettingsScopeLike): unknown {
  return function SlotEntry(props: Record<string, unknown>) {
    const useSessions = props['useSessions']
    const byId = typeof useSessions === 'function'
      ? (useSessions as (selector: unknown) => unknown)(selectById)
      : undefined
    useEffect(() => {
      const snap = { ...snapshotFrom(byId, Date.now()), ...windowFixture() }
      dataTick.set(snap)
    }, [byId])
    return createElement(
      Comp as never,
      { ...props, scope } as never,
    )
  }
}

export function apply(ctx: ClientCtxLike): void {
  // 侧栏脚部样式必须先注入（ghost 按钮同款：透明底/hover 底色/rail 圆形）
  ensurePanelStyles()
  const slots = ctx.slots
  const scope = ctx.configForms?.get(MADRANK_ENTRY_ID)
  if (!slots || !scope) {
    console.warn('[madrank] slots/configForms seam absent — client half idle')
    return
  }

  // ── 语言：跟随宿主 ctx.locale（切换推动整体重渲染）──
  const locale = ctx.locale
  const safeActive = (): string | undefined => {
    try { return locale?.getSnapshot?.()?.active } catch { return undefined }
  }
  setActiveLocale(safeActive())
  try {
    locale?.subscribe?.(() => { setActiveLocale(safeActive()); dataTick.set(dataTick.get()) })
  } catch { /* isolated */ }

  // 1) Settings 主导航分区（MADRank 配置页）。
  slots.inject('settings.section', () => {
    slots.register(
      {
        name: 'settings.section',
        id: MADRANK_ENTRY_ID,
        order: 30,
        label: 'MADRank',
      },
      withSessionData(
        (props: { scope: SettingsScopeLike }) =>
          createElement(CardErrorBoundary, null, createElement(MadrankSettingsTab, props)),
        scope,
      ),
    )
  })

  // 2) 侧栏脚部动作（Quick View 入口，点击展开同一张卡）。
  slots.inject('sidebar.footer.action', () => {
    slots.register(
      {
        name: 'sidebar.footer.action',
        id: MADRANK_ENTRY_ID,
        order: 40,
        label: 'MADRank',
      },
      withSessionData(
        (props: { scope: SettingsScopeLike }) =>
          createElement(CardErrorBoundary, null, createElement(MadrankFooterCell, props)),
        scope,
      ),
    )
  })
}

export { MadrankSettingsPanel as SettingsPanel } from './settings-panel.ts'
void createElement // keep import shape stable for bundlers