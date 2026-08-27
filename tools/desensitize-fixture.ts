/**
 * desensitize-fixture.ts — 把适配器导出的真实 usage 事件流变成可入库的
 * 黄金回放 fixture（完全脱敏，但保留全部折叠语义）。
 *
 * 变换全部是确定性纯函数，且对 fold 只做加减的语义保持不变式：
 *   ① 时间：整体平移到中性纪元（保留时刻-of-day 与跨午夜结构）
 *   ② 数值：uniform f(t)=⌊t×3+11⌋ —— 相等关系保持 ⇒ 替换语义保持
 *   ③ 模型：按首次出现双射改名为 provider-{n}/model-{m}
 *
 * 用法：node --experimental-strip-types tools/desensitize-fixture.ts \
 *         <real-events.jsonl> <out-dir> [dshCommit]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { applyEvent, initState, buildView } from '../src/fold.ts'
import { refApply, refInit, refTotals } from './reference-token-meter.ts'
import { join } from 'node:path'

interface Ev { type: string; seq: number; time: number; data: Record<string, unknown> }

function main(): void {
  const src = process.argv[2]!
  const outDir = process.argv[3] ?? 'tests/fixtures/real-world'
  const dshCommit = process.argv[4] ?? 'unknown'

  const events = readFileSync(src, 'utf8').trim().split('\n')
    .filter(Boolean).map(l => JSON.parse(l) as Ev)
  if (events.length === 0) throw new Error('empty input')

  // ① 时间平移：最早事件落在 2020-01-05，保留一天内时刻不变
  const firstT = Math.min(...events.map(e => e.time))
  const targetDayStart = Date.UTC(2020, 0, 5)
  const deltaDays = Math.round((targetDayStart - (firstT - (firstT % 86_400_000))) / 86_400_000)

  // ③ 模型双射改名
  const modelMap = new Map<string, string>()
  let provN = 0
  let modN = 0

  const xformUsage = (u: Record<string, unknown>): Record<string, number> => ({
    inputTokens: Math.floor(((u.inputTokens as number) ?? 0) * 3 + 11),
    outputTokens: Math.floor(((u.outputTokens as number) ?? 0) * 3 + 11),
    cacheReadTokens: Math.floor(((u.cacheReadTokens as number) ?? 0) * 3 + 11),
    cacheWriteTokens: Math.floor(((u.cacheWriteTokens as number) ?? 0) * 3 + 11),
  })

  let seenModelsOld = ''
  const out: Ev[] = []
  for (const e of events) {
    if (e.type === 'request/header') {
      const cfg = (e.data.header as { config?: { provider?: string; model?: string } }).config!
      const orig = cfg.provider + '/' + cfg.model
      if (!modelMap.has(orig)) {
        const name = 'provider-' + provN++ + '/model-' + modN++
        modelMap.set(orig, name)
      }
      const [p, m] = modelMap.get(orig)!.split('/')
      seenModelsOld += orig + ';'
      out.push({
        type: e.type, seq: e.seq,
        time: e.time + deltaDays * 86_400_000,
        data: { header: { config: { provider: p, model: m } }, reason: null },
      })
    } else {
      const d = e.data as { turn?: number; step?: number; usage?: Record<string, unknown>; chunk?: { type?: string; usage?: Record<string, unknown> } }
      const usage = d.usage ?? d.chunk?.usage
      if (usage === undefined) continue
      const x = xformUsage(usage)
      const data: Record<string, unknown> = { turn: d.turn, step: d.step }
      if (d.usage !== undefined) data.usage = x
      else {
        data.chunk = { type: 'usage', usage: x }
        ;(data as never as { turn: number }).turn = d.turn!
      }
      void seenModelsOld
      out.push({ type: e.type, seq: e.seq, time: e.time + deltaDays * 86_400_000, data })
    }
  }

  mkdirSync(outDir, { recursive: true })
  const body = out.map(e => JSON.stringify(e)).join('\n') + '\n'
  const fixturePath = join(outDir, 'usage-events.jsonl')
  writeFileSync(fixturePath, body)

  // 变换后聚合（manifest 金标：本包 fold 若变更导致此值漂移即语义报警）
  let st = initState()
  const rf = refInit()
  for (const e of out) {
    st = applyEvent(st, e as never)
    refApply(rf, e as never)
  }
  const view = buildView(st)
  const rt = refTotals(rf)
  const agg = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
  for (const day of Object.values(view.days)) {
    for (const b of Object.values(day.models)) {
      agg.input += b.inputTokens; agg.output += b.outputTokens
      agg.cacheRead += b.cacheReadTokens; agg.cacheWrite += b.cacheWriteTokens
      agg.requests += b.requests
    }
  }
  if (
    agg.input !== rt.uncachedInputTokens || agg.output !== rt.outputTokens ||
    agg.cacheRead !== rt.cacheReadTokens || agg.cacheWrite !== rt.cacheWriteTokens
  ) throw new Error('fold/reference mismatch while generating golden fixture')

  const days = [...new Set(out.map(e => new Date(e.time).toISOString().slice(0, 10)))].sort()

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
    fixtureVersion: 1,
    kind: 'desensitized-real-dsh-usage',
    generatedAt: new Date().toISOString(),
    dshCommitAtGeneration: dshCommit,
    sourceEventCount: events.length,
    fixtureEventCount: out.length,
    utcDays: days,
    modelRenameCount: modelMap.size,
    transform: {
      timeShift: 'all times moved by whole days to a neutral epoch; time-of-day preserved',
      tokens: 'f(t) = floor(t*3 + 11), uniform',
      models: 'bijection to provider-{n}/model-{m}',
    },
    goldenAggregate: agg,
    sha256: createHash('sha256').update(body).digest('hex'),
  }, null, 2) + '\n')

  console.log('fixture written :', fixturePath)
  console.log('events          :', events.length, '->', out.length)
  console.log('models renamed  :', modelMap.size)
  console.log('utc days        :', days.join(','))
  console.log('sha256          :', createHash('sha256').update(body).digest('hex').slice(0, 16) + '…')
}

main()