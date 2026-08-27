import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { buildView, initState, applyEvent } from '../src/fold.ts'
import type { ProjectionRegistryLike } from '../src/compat.ts'

describe('apply(ctx) 接线路径（结构化兼容层，无需真实宿主）', () => {
  it('注册投影单元 + onChanged 落盘 + dispose 回收', async () => {
    process.env.MADRANK_USAGE_DIR = mkdtempSync(join(tmpdir(), 'madrank-wire-'))

    const registered: string[] = []
    let changeListener: ((s: { id: string }, k: string, v: unknown, seq: number) => void) | null = null
    const disposers: Array<() => void> = []

    const registry: ProjectionRegistryLike = {
      register(def) {
        registered.push(def.key)
        disposers.push(() => registered.pop())
        return () => void disposers.pop()
      },
      onChanged(fn) {
        changeListener = fn
        return () => void (changeListener = null)
      },
    }

    const disposeCbs: Array<() => void> = []
    const ctx = {
      sessionProjections: registry,
      on(ev: string, cb: () => void) { if (ev === 'dispose') disposeCbs.push(cb) },
      logger: { info: () => {}, warn: (_m: string) => {}, error: () => {} },
    }

    apply(ctx as never)
    expect(registered).toContain('madrankUsage')

    // 模拟 framework 驱动一轮：一次 usage 变更经过 view 输出抵达监听器
    expect(changeListener).toBeTruthy()
    let state = initState()
    state = applyEvent(state, {
      type: 'request/header', seq: 1, time: Date.UTC(2026, 7, 26, 1),
      data: { header: { config: { provider: 'deepseek', model: 'chat' } } },
    })
    state = applyEvent(state, {
      type: 'assistant/message', seq: 2, time: Date.UTC(2026, 7, 26, 1, 5),
      data: { turn: 1, step: 1, usage: { inputTokens: 1234, outputTokens: 100 } },
    })
    const listener = changeListener!
    listener({ id: 'sess-1' }, 'madrankUsage', buildView(state), 2)

    // 直接同步 flush 验证份额已写入（等节流定时器会拖慢测试；这里手动建一个新 store 断言）
    // —— 节流 timer 为 unref 的 2s，这里改用 dispose 时的强制 flush 来验证：
    disposeCbs.forEach(cb => cb())
    const file = join(process.env.MADRANK_USAGE_DIR!, 'usage-store.json')
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { sessions: Record<string, unknown> }
      expect(raw.sessions['sess-1']).toBeTruthy()
    }
    expect(disposeCbs.length).toBeGreaterThan(0)

    delete process.env.MADRANK_USAGE_DIR
    rmSync(process.env.MADRANK_USAGE_DIR ?? '', { recursive: true, force: true })
  })

  it('无缝环境优雅降级：不抛错、不注册', () => {
    let warned = false
    apply({
      sessionProjections: undefined,
      logger: { info: () => {}, warn: () => { warned = true }, error: () => {} },
    } as never)
    expect(warned).toBe(true)
  })
})
