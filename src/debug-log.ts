/** 诊断日志（~/.madrank/usage/debug.log）：排查宿主落盘/同步链路用，运行时开销极小。 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function debugLog(dir: string, line: string): void {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'debug.log'), `${new Date().toISOString()} ${line}\n`)
  } catch { /* diagnostics must never break the plugin */ }
}
