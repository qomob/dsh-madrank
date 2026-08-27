/**
 * 黄金回放：脱敏的真实 DSH usage 流。
 *
 * 这是 token-meter 兼容性报警器的 CI 形态 —— DSH 升级后：
 *   manifest.goldenAggregate 漂移 ⇒ 我们的 fold 或 DSH 替换语义变了 ⇒ 红灯
 * 判据与 tools/reconcile-cli.ts 完全同源：ours ≡ reference ≡ manifest 金标。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { applyEvent, buildView, initState } from '../src/fold.ts'
import { refApply, refInit, refTotals } from '../tools/reference-token-meter.ts'

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/real-world')

const events = readFileSync(join(fixtureDir, 'usage-events.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean)
  .map(l => JSON.parse(l) as Parameters<typeof applyEvent>[1])

const manifest = JSON.parse(
  readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'),
) as {
  fixtureVersion: number; utcDays: string[]; fixtureEventCount: number
  goldenAggregate: { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number }
}

describe('黄金回放（desensitized real-world fixture）', () => {
  it('madrank fold ≡ token-meter 参照折叠器 ≡ manifest 金标', () => {
    let ours = initState()
    const ref = refInit()
    for (const e of events) {
      ours = applyEvent(ours, e)
      refApply(ref, e)
    }
    const view = buildView(ours)
    const r = refTotals(ref)

    let inp = 0, out = 0, cr = 0, cw = 0, reqs = 0
    for (const day of Object.values(view.days)) {
      for (const b of Object.values(day.models)) {
        inp += b.inputTokens; out += b.outputTokens
        cr += b.cacheReadTokens; cw += b.cacheWriteTokens; reqs += b.requests
      }
    }
    expect(inp).toBe(r.uncachedInputTokens)
    expect(out).toBe(r.outputTokens)
    expect(cr).toBe(r.cacheReadTokens)
    expect(cw).toBe(r.cacheWriteTokens)

    expect(inp).toBe(manifest.goldenAggregate.input)
    expect(out).toBe(manifest.goldenAggregate.output)
    expect(cr).toBe(manifest.goldenAggregate.cacheRead)
    expect(cw).toBe(manifest.goldenAggregate.cacheWrite)
    expect(reqs).toBe(manifest.goldenAggregate.requests)
  })

  it('fixture 结构健全：多日跨午夜、多模型替换链存在', () => {
    expect(manifest.fixtureVersion).toBe(1)
    expect(events.length).toBe(manifest.fixtureEventCount)
    expect(manifest.utcDays.length).toBeGreaterThanOrEqual(2)
    const models = new Set<string>()
    for (const e of events) {
      if (e.type === 'request/header') {
        const cfg = (e.data as { header?: { config?: { provider?: string; model?: string } } }).header?.config
        if (cfg?.provider && cfg?.model) models.add(cfg.provider + '/' + cfg.model)
      }
    }
    expect(models.size).toBeGreaterThanOrEqual(2)
  })
})
