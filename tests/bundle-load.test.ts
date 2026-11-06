// @vitest-environment happy-dom
/** dist/client.js 冒烟：真实加载产物 + 用假 ctx 跑 apply，确认各槽位都注册（不依赖源码导入路径）。 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import * as ReactDOM from 'react-dom'

interface LoaderOpts { id: string; factory(require: (id: string) => unknown): Record<string, unknown> }

function loadBundle(): Record<string, unknown> {
  const code = readFileSync(join(process.cwd(), 'dist/client.js'), 'utf8')
  let opts: LoaderOpts | undefined
  ;(window as unknown as { __ModuleLoader__: { load(o: LoaderOpts): void } }).__ModuleLoader__ = {
    load(o) { opts = o },
  }
  // 直接 eval：bundle 只依赖 window.__ModuleLoader__ / require 注入
  new Function('window', 'document', 'navigator', code)(window, document, navigator)
  if (!opts) throw new Error('bundle did not call __ModuleLoader__.load')
  return opts.factory((id) => (id === 'react' ? React : id === 'react-dom' ? ReactDOM : (() => { throw new Error('unexpected require ' + id) })())) as Record<string, unknown>
}

describe('dist/client.js 产物加载', () => {
  it('apply() 注册 sidebar.panellist / main / plugins.row.config，且不抛错', () => {
    const mod = loadBundle()
    const registrations: Array<{ slot: string; options: Record<string, unknown> }> = []
    const injections: string[] = []
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: { enabled: true } }),
      subscribe: () => () => {},
      set: async () => {}, unset: async () => {},
    }
    const ctx = {
      slots: {
        inject(slot: string, cb: () => void) { injections.push(slot); cb() },
        register(options: Record<string, unknown>) { registrations.push({ slot: String(options.name), options }) },
      },
      configForms: { get: () => scope },
      locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {}, register: () => () => {} },
      layout: { selectPanel() {} },
      effect: () => () => {},
    }
    const apply = mod.apply as (c: unknown) => void
    expect(typeof apply).toBe('function')
    expect(() => apply(ctx)).not.toThrow()
    const slots = registrations.map(r => r.slot)
    expect(slots).toContain('sidebar.panellist')
    expect(slots).toContain('main')
    expect(slots).toContain('plugins.row.config')
    expect(slots).not.toContain('settings.section')
    expect(slots).not.toContain('sidebar.footer.action')
  })

  it('configForms 尚未就绪时也先注册入口（卡片挂载后再重试），不再整个 client 静默 idle', () => {
    const mod = loadBundle()
    const registrations: string[] = []
    const ctx = {
      slots: {
        inject(_slot: string, cb: () => void) { cb() },
        register(options: Record<string, unknown>) { registrations.push(String(options.name)) },
      },
      // 模拟冷启动/HMR 重挂载竞态：service 暂时拿不到
      configForms: { get: () => undefined },
      locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {}, register: () => () => {} },
      layout: { selectPanel() {} },
      effect: () => () => {},
    }
    expect(() => (mod.apply as (c: unknown) => void)(ctx)).not.toThrow()
    expect(registrations).toContain('sidebar.panellist')
    expect(registrations).toContain('main')
    expect(registrations).toContain('plugins.row.config')
  })
})
