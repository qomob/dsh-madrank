/**
 * reconcile-cli.ts — 真实流量对账工具。
 *
 * 输入：DSH 会话持久化日志导出的 JSONL（每行一个 SessionEvent：
 * { type, seq?, time, data }）。行的具体容器格式（逐行文件/快照数组）
 * 若与你的实例导出不同，改 readEvents() 即可——本 CLI 刻意只做最小假设。
 *
 * 输出：token-meter 参照值 vs madrankUsage 分日×模型聚合，
 * 总量不一致时 exit 1（可接 CI）。
 *
 * 用法：npm run reconcile -- path/to/session-events.jsonl
 */

import { readFileSync } from 'node:fs'
import { applyEvent, buildView, initState } from '../src/fold.ts'
import { refApply, refInit, refTotals } from './reference-token-meter.ts'
import { PRIMARY_TOKENS } from '../src/caliber.ts'
import type { SessionEventLike } from '../src/compat.ts'

function readEvents(path: string): SessionEventLike[] {
  const raw = readFileSync(path, 'utf8')
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []

  // 形态 1：JSONL 逐行事件；形态 2：单个 JSON 数组
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as SessionEventLike[]
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SessionEventLike)
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function main(): void {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: npm run reconcile -- <session-events.jsonl>')
    process.exit(2)
  }

  const events = readEvents(file)

  let ours = initState()
  const ref = refInit()
  let counted = 0
  for (const e of events) {
    ours = applyEvent(ours, e)
    refApply(ref, e)
    counted++
  }
  const view = buildView(ours)
  const r = refTotals(ref)

  console.log(`events folded: ${counted}`)
  console.log('')
  console.log('reference (dsh-token-meter semantics)')
  console.log(`  uncached-input ${fmt(r.uncachedInputTokens)} | output ${fmt(r.outputTokens)}`)
  console.log(`  cache-read     ${fmt(r.cacheReadTokens)} | cache-write ${fmt(r.cacheWriteTokens)}`)

  console.log('')
  console.log('madrankUsage per day x model (Primary Tokens)')
  const lines: Array<{ ymd: string; model: string; primary: number; cached: number; reqs: number }> = []
  for (const [ymd, day] of Object.entries(view.days)) {
    for (const [model, b] of Object.entries(day.models)) {
      lines.push({ ymd, model, primary: PRIMARY_TOKENS(b), cached: b.cacheReadTokens + b.cacheWriteTokens, reqs: b.requests })
      console.log(
        `  ${ymd}  ${model.padEnd(28)} ${fmt(PRIMARY_TOKENS(b)).padStart(8)} (+${fmt(b.cacheReadTokens + b.cacheWriteTokens)} cached)  ${b.requests} reqs`,
      )
    }
  }

  // 比对
  let inOurs = 0, outOurs = 0, crOurs = 0, cwOurs = 0
  for (const day of Object.values(view.days)) {
    for (const b of Object.values(day.models)) {
      inOurs += b.inputTokens; outOurs += b.outputTokens
      crOurs += b.cacheReadTokens; cwOurs += b.cacheWriteTokens
    }
  }

  const ok =
    inOurs === r.uncachedInputTokens &&
    outOurs === r.outputTokens &&
    crOurs === r.cacheReadTokens &&
    cwOurs === r.cacheWriteTokens

  // ── 兼容性报警器输出：人类可读框图 + --json 机器可读 diff ──
  const json = process.argv.includes('--json')
  const report = {
    tool: 'madrank-reconcile',
    generatedAt: new Date().toISOString(),
    match: ok,
    reference: {
      uncachedInputTokens: r.uncachedInputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
    },
    madrank: {
      inputTokens: inOurs,
      outputTokens: outOurs,
      cacheReadTokens: crOurs,
      cacheWriteTokens: cwOurs,
    },
    diff: {
      inputTokens: inOurs - r.uncachedInputTokens,
      outputTokens: outOurs - r.outputTokens,
      cacheReadTokens: crOurs - r.cacheReadTokens,
      cacheWriteTokens: cwOurs - r.cacheWriteTokens,
    },
    days: lines,
  }
  if (json) console.log(JSON.stringify(report, null, 2))

  const num = (n: number): string => n.toLocaleString('en-US')
  const row = (label: string, ours: number, ref: number): string => {
    const d = ours - ref
    return '│ ' + label.padEnd(13) + num(ours).padStart(12) + num(ref).padStart(13) + '  ' + (d === 0 ? '   =' : String(d).padStart(6)) + ' │'
  }
  const W = 60
  console.log('')
  console.log('┌' + '─'.repeat(W - 2) + '┐')
  console.log('│' + 'MADRank Reconciliation'.padStart((W + 21) / 2).padEnd(W - 2) + '│')
  console.log('│' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'.padEnd(W - 2 - 16) + '│')
  console.log('├' + '─'.repeat(W - 2) + '┤')
  console.log('│ ' + 'bucket'.padEnd(13) + 'madrank'.padStart(12) + 'reference'.padStart(13) + '   diff │')
  console.log(row('input', inOurs, r.uncachedInputTokens))
  console.log(row('output', outOurs, r.outputTokens))
  console.log(row('cache read', crOurs, r.cacheReadTokens))
  console.log(row('cache write', cwOurs, r.cacheWriteTokens))
  console.log('├' + '─'.repeat(W - 2) + '┤')
  console.log('│' + (ok ? 'MATCH ✓'.padStart((W + 7) / 2).padEnd(W - 2) : 'MISMATCH ✗'.padStart((W + 9) / 2).padEnd(W - 2)) + '│')
  console.log('└' + '─'.repeat(W - 2) + '┘')
  if (!ok) console.log('machine diff: ' + JSON.stringify(report.diff))
  process.exit(ok ? 0 : 1)
}

main()