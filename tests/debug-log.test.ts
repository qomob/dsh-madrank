import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { debugLog } from '../src/debug-log.ts'

describe('debug.log 轮转（生产防膨胀）', () => {
  it('超过 2MiB 时轮转为 debug.log.1，并继续写新文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'madrank-log-'))
    try {
      const file = join(dir, 'debug.log')
      // 造一个超限文件（2 MiB + 1）
      writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))
      debugLog(dir, 'after-rotate')
      expect(existsSync(join(dir, 'debug.log.1'))).toBe(true)
      expect(statSync(file).size).toBeLessThan(1024)
      expect(readFileSync(file, 'utf8')).toContain('after-rotate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
