/// <reference lib="dom" />

/**
 * client/index.ts — 浏览器半侧装配（方案 A + 方案 A'）:
 * slots.inject + sidebar.footer.action 注册；数据 = sessions 投影 feed +
 * settings mirror（全球排名唯一传输缝，decodeSettingsSection 窄化）；
 * window.__MADRANK_CARD_DATA__ 仅作 fixture 覆盖口（测试/调试）。
 */

import { createElement } from 'react'
import type { LocaleFaceLike } from './card-html.ts'
import { cardDataFromList, decodeSettingsSection } from './card-data.ts'
import { CardErrorBoundary, dataTick, MadrankSettingsTab, registerFooterEntry, setActiveLocale } from './panel.ts'
import { MadrankSettingsPanel } from './settings-panel.ts'

export const SETTINGS_NS = 'madrank-usage'

/** 官方数据缝隙见上；'sessions' 为 ISessions 标准 feed。 */
export const inject = ['slots', 'locale', 'settingsScope', 'sessions']

// 纯标记层与类型统一从这里出门（预览工具 / 外部消费者兼容面）
export { renderCardHtml, SETTINGS_NS as CARD_SETTINGS_NS } from './card-html.ts'
export type {
  CardSnapshot,
  CardModelRow,
  SettingsScopeLike,
  SlotsLike,
} from './card-html.ts'
export type { CardGlobal } from '../global-rank.ts'
export { decodeSettingsSection } from './card-data.ts'
export type { SettingsSectionValue } from './card-data.ts'
export { MadrankFooterCell, MadrankSettingsTab } from './panel.ts'
export { MadrankSettingsPanel, PLUGIN_VERSION } from './settings-panel.ts'

interface SessionsFaceLike {
  list: { getSnapshot(): unknown; subscribe(fn: () => void): () => void }
}

export interface ClientCtxLike {
  slots?: import('./card-html.ts').SlotsLike
  settingsScope?: {
    bind(opts: {
      namespace: string
      /** 窄化 wire 段；提供后跳过宿主 schemastery 默认校验（global 注入依赖此口）。 */
      decode?: (section: unknown) => unknown
    }): import('./card-html.ts').SettingsScopeLike
  }
  sessions?: SessionsFaceLike
  locale?: LocaleFaceLike
}

function pullFrom(feed: SessionsFaceLike['list'] | undefined): Record<string, unknown> {
  if (feed === undefined) return {}
  try {
    const d = cardDataFromList(feed.getSnapshot() as never, Date.now())
    return {
      today: d.today,
      topModels: d.topModels,
      streakDays: d.streak,
      last7Days: d.last7,
      history: d.history,
      global: null,
    }
  } catch (e) {
    console.warn('[madrank] projection feed error', e)
    return {}
  }
}

const windowFixture = (): Partial<import('./card-html.ts').CardSnapshot> =>
  typeof window !== 'undefined' ? (window.__MADRANK_CARD_DATA__ ?? {}) : {}

export function apply(ctx: ClientCtxLike): void {
  const scope = ctx.settingsScope?.bind({ namespace: SETTINGS_NS, decode: decodeSettingsSection })
  const slots = ctx.slots
  if (!scope || !slots) return

  // ── 数据面：订阅投影 feed；任何变更推进 dataTick（两处 UI 共享）──
  const feed = ctx.sessions?.list
  const refresh = (): void => {
    dataTick.set({ ...pullFrom(feed), ...windowFixture() })
  }
  refresh()
  feed?.subscribe(refresh)

  // ── 语言：跟随宿主系统设置（ctx.locale.active；切换经 subscribe 推动整体重渲染）──
  // inject 声明过的 'locale' 面在此消费；缺席/异常一律回退 en（官方 FALLBACK_LOCALE 语义）。
  const locale = ctx.locale
  const safeActive = (): string | undefined => {
    try { return locale?.getSnapshot?.()?.active } catch { return undefined }
  }
  setActiveLocale(safeActive())
  try {
    locale?.subscribe?.(() => { setActiveLocale(safeActive()); refresh() })
  } catch { /* isolated */ }

  // 1) Settings 插件配置分区（插件页内的本插件配置卡）。
  //    官方 cookbook（adding-a-settings-card.md）：settings.plugin.item 是 keyed
  //    槽、键 = 命名空间 —— Plugins 页按宿主已服务的命名空间派发，键对上即自动
  //    配对（旧键 madrank.usage.card 永不落入该派发）。keyed 条目不声明 order。
  slots.inject('settings.plugin.item', () => {
    slots.register({
      name: 'settings.plugin.item',
      key: SETTINGS_NS,
    }, () => createElement(CardErrorBoundary, null, createElement(MadrankSettingsPanel, { scope })))
  })

  // 2) Settings 主导航顶级分区（同「桌面设置 / Agent 预设」的 settings.section 槽：
  //    宿主 settings-general 用 slots.entries('settings.section') 生成导航行，
  //    renderSlot("settings.section", { close }, { only: id }) 渲染分区页；
  //    label 经 resolveSlotLabel 解析，string | () => string 皆可。
  //    既有 order：general=0 / models=10 / plugins=15 / agent-presets=20 → MADRank 收尾）
  slots.inject('settings.section', () => {
    slots.register(
      {
        name: 'settings.section',
        id: 'madrank-usage',
        order: 30,
        label: 'MADRank',
      },
      () => createElement(CardErrorBoundary, null,
        createElement(MadrankSettingsTab, { scope })),
    )
  })

  // 3) 侧栏脚部动作（Settings 旁；点击锚定展开同一张卡）
  registerFooterEntry(slots, scope)
}
