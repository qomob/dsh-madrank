/**
 * verify-compat.ts — DSH 升级兼容性守门（一条命令出报告）。
 *
 * 步骤：
 *   1) 读取 DSH checkout commit（git -C $DSH_PATH）
 *   2) 黄金回放：vitest tests/golden-replay.test.ts（token-meter 语义报警器）
 *   3) reconcile CLI 跑同一 fixture（人类可读框图，二次确认）
 *   4) 真实 loader spike（env RUN_SPIKE=0 可跳过；需要 .spike/ 复现场景）
 *   5) tsc + 全量 vitest
 *
 * 输出：COMPATIBILITY REPORT（人读）+ --json（机器可读），任一步失败 exit 1。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PLUGIN = new URL('..', import.meta.url).pathname
const DSH = process.env.DSH_PATH ?? '/Users/jonki/deepseek-harness'
const wantJson = process.argv.includes('--json')

function sh(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? PLUGIN,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
  })
  return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function main(): void {
  const checks: Array<{ id: string; ok: boolean; detail: string }> = []
  const fail = (msg: string): never => {
    console.error('VERIFY-DSH FAIL ✗ —', msg)
    process.exit(1)
  }

  // 1) DSH commit
  let commit = 'unknown'
  if (existsSync(join(DSH, '.git'))) {
    const r = sh('git', ['-C', DSH, 'rev-parse', '--short', 'HEAD'])
    if (r.code === 0) commit = r.out.trim()
    else fail('cannot read DSH commit')
  } else {
    console.log('[skip] no DSH checkout at', DSH, '— set DSH_PATH to enable')
  }
  checks.push({ id: 'dsh-commit', ok: true, detail: commit })

  // 2) 黄金回放
  const g = sh('npx', ['vitest', 'run', 'tests/golden-replay.test.ts'], { env: { HOME: join(PLUGIN, '../.toolhome') } })
  checks.push({ id: 'golden-replay', ok: g.code === 0, detail: g.code === 0 ? 'fold ≡ reference ≡ manifest' : g.out.slice(-400) })
  if (g.code !== 0) return report()

  // 3) reconcile 框图
  const rc = sh('node', ['--experimental-strip-types', 'tools/reconcile-cli.ts', 'tests/fixtures/real-world/usage-events.jsonl'])
  const passLine = rc.out.includes('MATCH ✓')
  checks.push({ id: 'reconcile-fixture', ok: passLine, detail: passLine ? 'RECONCILE PASS' : rc.out.slice(-400) })

  // 4) loader spike（可选门）
  const spikeYml = join(PLUGIN, '../.spike/cordis.yml')
  if (process.env.RUN_SPIKE !== '0' && existsSync(spikeYml)) {
    const s = sh('node', [join(DSH, 'vendor/cordis/bin.js')], { cwd: join(PLUGIN, '../.spike') })
    // 优雅降级退出码 0 即通过（seam 缺席警告属正常）
    checks.push({ id: 'loader-spike', ok: s.code === 0, detail: s.code === 0 ? 'boot clean' : s.out.slice(-300) })
  } else {
    checks.push({ id: 'loader-spike', ok: true, detail: '[skipped]' })
  }

  // 5) tsc + 全测
  const t = sh('npx', ['tsc', '--noEmit'])
  checks.push({ id: 'typecheck', ok: t.code === 0, detail: t.code === 0 ? 'clean' : t.out.slice(-300) })
  const v = sh('npx', ['vitest', 'run'], { env: { HOME: join(PLUGIN, '../.toolhome') } })
  const vTail = v.out.split('\n').filter(l => l.includes('Tests ')).pop() ?? ''
  checks.push({ id: 'tests', ok: v.code === 0, detail: vTail.trim() || String(v.code) })

  function report(): void {
    const okAll = checks.every(c => c.ok)
    const row = checks.map(c => (c.ok ? ' ✓ ' : ' ✗ ') + c.id.padEnd(18) + c.detail.replace(/\n/g, ' | ').slice(0, 90))
    const reportObj = {
      tool: 'madrank-verify-dsh',
      madrankVersion: JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8')).version,
      dshCommit: commit,
      passed: okAll,
      checks,
    }
    if (wantJson) console.log(JSON.stringify(reportObj, null, 2))
    else {
      console.log('')
      console.log('=== MADRank × DSH COMPATIBILITY REPORT ===')
      for (const l of row) console.log(l)
      console.log('')
      console.log(okAll
        ? 'VERDICT: PASS ✓'
        : 'VERDICT: FAIL ✗  → token-meter / projection 契约可能已变更')
    }
    process.exit(okAll ? 0 : 1)
  }
  void fail
  report()
}

main()