/// <reference lib="dom" />

/**
 * style-registry.ts — Client 全局 <style> 的生命周期。
 *
 * 规范要求（ui-plugin.md:13）：样式是注册在 apply 上下文里的资源，插件卸载时
 * 必须被回收，而不是永久留在 document.head。本模块只做三件事：
 * 1. 统一生成 `data-plugin-css` 去重 id（沿用官方 data-plugin-css 范式）；
 * 2. 登记每一个实际插入的 <style> 元素；
 * 3. 提供一次性移除入口，由 client 入口的 ctx.effect 清理函数调用。
 */

const owned = new Set<HTMLStyleElement>()

/** `madrank-usage/<scope>`：与官方 style[data-plugin-css] 去重键同名。 */
export function styleTagId(scope: string): string {
  return 'madrank-usage/' + scope
}

export function styleTagInstalled(scope: string): boolean {
  if (typeof document === 'undefined') return true
  const id = JSON.stringify(styleTagId(scope)).slice(1, -1)
  return document.querySelector('style[data-plugin-css="' + id + '"]') !== null
}

/** 插入并登记一个 <style>；已存在则复用（不重复登记）。 */
export function insertTrackedStyle(scope: string, css: string): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (styleTagInstalled(scope)) return null
  const tag = document.createElement('style')
  tag.dataset.plugin = 'madrank-usage'
  tag.dataset.pluginCss = styleTagId(scope)
  tag.textContent = css
  document.head.appendChild(tag)
  owned.add(tag)
  return tag
}

/** 登记外部创建的 <style>（share-modal 用自带 id 的范式）。 */
export function trackStyleTag(tag: HTMLStyleElement): void {
  owned.add(tag)
}

/** 移除本插件插入过的全部样式；可重复调用。 */
export function disposeStyles(): void {
  for (const tag of owned) {
    try { tag.remove() } catch { /* already detached */ }
  }
  owned.clear()
}
