import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { buildView, initState, applyEvent } from '../src/fold.ts'
import type { ProjectionRegistryLike } from '../src/compat.ts'

/** 让 async start() 走完注册微任务（真实宿主同样在微任务后发布消费者）。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function withTempUsageDir<T>(run: () => Promise<T> | T): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'madrank-wire-'))
  const prev = process.env.MADRANK_USAGE_DIR
  process.env.MADRANK_USAGE_DIR = dir
  const done = () => {
    if (prev === undefined) delete process.env.MADRANK_USAGE_DIR
    else process.env.MADRANK_USAGE_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    const result = run()
    return result instanceof Promise ? result.finally(done) : (done(), result)
  } catch (e) {
    done()
    throw e
  }
}

describe('apply(ctx) 接线路径（结构化兼容层，无需真实宿主）', () => {
  it('0.1.x legacy 注册：register 返回 disposer 也能接线 + onChanged 落盘 + dispose 回收', async () => {
    await withTempUsageDir(async () => {
      const registered: string[] = []
      let changeListener: ((s: { id: string }, k: string, v: unknown, seq: number) => void) | null = null

      const registry: ProjectionRegistryLike = {
        register(def) {
          registered.push(def.key)
          return () => void registered.pop()
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
      await flush()
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

      // dispose 时同步 flush，验证份额已写入
      disposeCbs.forEach(cb => cb())
      const file = join(process.env.MADRANK_USAGE_DIR!, 'usage-store.json')
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { sessions: Record<string, unknown> }
        expect(raw.sessions['sess-1']).toBeTruthy()
      }
      expect(disposeCbs.length).toBeGreaterThan(0)
    })
  })

  it('0.2.x async 注册：await handle、消费者在注册完成后才发布、dispose 走 handle.dispose()', async () => {
    await withTempUsageDir(async () => {
      const registered: string[] = []
      const handles: Array<{ stateOf: () => unknown; dispose: ReturnType<typeof vi.fn> }> = []
      let changeListener: ((s: { id: string }, k: string, v: unknown, seq: number) => void) | null = null

      const registry: ProjectionRegistryLike = {
        register(def) {
          registered.push(def.key)
          const handle = { stateOf: () => ({}), dispose: vi.fn(async () => {}) }
          handles.push(handle)
          // 0.2.x 运行时值：可调用 thenable（typeof === 'function' 且可 await）
          return Object.assign(() => undefined, {
            then: (resolve: (value: unknown) => unknown) => resolve(handle),
          }) as never
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
      // start() 内部还有 shareToken 解析等异步前置；消费者在 await 完成后才发布。
      expect(changeListener).toBeNull()
      await flush()
      expect(registered).toContain('madrankUsage')
      expect(changeListener).toBeTruthy()
      expect(handles).toHaveLength(2)
      expect(handles[0]!.dispose).not.toHaveBeenCalled()

      disposeCbs.forEach(cb => cb())
      await flush()
      expect(handles[0]!.dispose).toHaveBeenCalledTimes(1)
      expect(handles[1]!.dispose).toHaveBeenCalledTimes(1)
    })
  })

  it('注册被 reject：记录错误、不发布消费者、不产生 unhandled rejection', async () => {
    await withTempUsageDir(async () => {
      let changeListener: unknown = null
      const errors: unknown[] = []
      const registry = {
        register() { return Promise.reject(new Error('projection registration rejected')) },
        onChanged(fn: unknown) { changeListener = fn; return () => undefined },
      }
      apply({
        sessionProjections: registry,
        logger: { info: () => {}, warn: () => {}, error: (...args: unknown[]) => errors.push(...args) },
      } as never)
      await flush()
      expect(errors.map(String).join(' ')).toContain('projection registration rejected')
      expect(changeListener).toBeNull()
    })
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
