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
import { CardErrorBoundary, CardShell, dataTick, registerFooterEntry, setActiveLocale } from './panel.ts'

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
export { MadrankFooterCell } from './panel.ts'

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

  // 1) Settings 卡片（plugin 配置分区；keyed：namespace 配对）
  slots.inject('settings.plugin.item', () => {
    slots.register({
      name: 'settings.plugin.item',
      key: 'madrank.usage.card',
      order: 90,
    }, () => createElement(CardErrorBoundary, null, createElement(CardShell, { scope, anchored: false })))
  })

  // 2) 侧栏脚部动作（Settings 旁；点击锚定展开同一张卡）
  registerFooterEntry(slots, scope)
}
