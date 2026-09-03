/**
 * tick.ts — 微观共享状态（数据节拍 + 订阅 hook）。
 *
 * 从 panel.ts 抽出为独立模块：设置面板（settings-panel.ts）与卡片壳（panel.ts）
 * 共享同一份快照，但二者互相渲染 —— 放在同一文件会成环。独立模块后依赖恒为
 * settings-panel → tick ← panel，无循环（bundle CJS 工厂对环最不友好）。
 */

import { useEffect, useState } from 'react'
import type { CardSnapshot } from './card-html.ts'
import { resolveLang, type Lang } from './i18n.ts'

/** apply() 装配时推进；两处 UI（设置面板 / 侧栏卡片）共享同一份快照。 */
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

/** 订阅一个快照源推进重渲染；subscribe 形状不符（宿主变体/热切换瞬间）静默跳过——
 *  effect 里抛错会被 React 边界放大成整个入口卸载（「点击就没了」事故的同款根因）。 */
export function useTickSource(subscribe: ((fn: () => void) => () => void) | undefined): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (typeof subscribe !== 'function') return
    return subscribe(() => setV(x => x + 1))
  }, [subscribe])
  return v
}

// ── 语言：跟随宿主 ctx.locale（卡片与设置面板共用同一份 active LocaleId） ──

let activeLocale: string | undefined

/** 由 client/index.ts 的 apply() 装配：喂入宿主 locale 面的 active LocaleId。 */
export function setActiveLocale(raw: string | undefined): void {
  activeLocale = raw
}

export function activeLocaleValue(): string | undefined {
  return activeLocale
}

/** 当前生效语言（未知/缺席回退 en，官方 FALLBACK_LOCALE 语义）。 */
export function resolveActiveLang(): Lang {
  return resolveLang(activeLocale)
}
