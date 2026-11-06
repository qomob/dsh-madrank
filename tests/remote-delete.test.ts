import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteEndpointFrom, deleteRemoteData } from '../src/sync.ts'
import { readLastRemoteDeleteRequest, writeLastRemoteDeleteRequest, remoteDeleteStatePath } from '../src/remote-delete.ts'
import { UsageStore } from '../src/store.ts'
import type { UsageView } from '../src/fold.ts'

const buckets = { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 1 }
const view: UsageView = {
  version: 2,
  days: { '2026-01-01': { models: { m: buckets }, activeSeconds: 1 } },
  totalRequests: 1, totalPrimaryTokens: 5, totalCachedTokens: 0,
}

describe('远端删除（Host 侧）', () => {
  it('deleteEndpointFrom 由 ingest 同源派生', () => {
    expect(deleteEndpointFrom('https://madrank.ai/api/usage/ingest')).toBe('https://madrank.ai/api/usage/delete')
    expect(deleteEndpointFrom('http://127.0.0.1:3010/api/usage/ingest/')).toBe('http://127.0.0.1:3010/api/usage/delete')
  })

  it('deleteRemoteData POST {anonId} 到 delete 端点，按响应判定成功', async () => {
    const calls: Array<{ url: string; init: unknown }> = []
    const okFetch = (async (url: string, init: unknown) => {
      calls.push({ url, init })
      return { ok: true } as Response
    }) as unknown as typeof fetch
    expect(await deleteRemoteData('https://madrank.ai/api/usage/ingest', () => 'anon-1', okFetch)).toBe(true)
    expect(calls[0]!.url).toBe('https://madrank.ai/api/usage/delete')
    expect(String((calls[0]!.init as { body: string }).body)).toContain('anon-1')

    const failFetch = (async () => ({ ok: false } as Response)) as unknown as typeof fetch
    expect(await deleteRemoteData('https://madrank.ai/api/usage/ingest', () => 'anon-1', failFetch)).toBe(false)
  })

  it('last-handled request 持久化（重启防重放）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'madrank-rd-'))
    try {
      expect(readLastRemoteDeleteRequest(dir)).toBe('')
      writeLastRemoteDeleteRequest(dir, '1790000000000')
      expect(readLastRemoteDeleteRequest(dir)).toBe('1790000000000')
      expect(readFileSync(remoteDeleteStatePath(dir), 'utf8')).toContain('1790000000000')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('删除成功后清空 uploadedDays（下次同步按现状重传）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'madrank-rd2-'))
    try {
      const store = new UsageStore(dir, 2, 'usage-store.json', 0)
      store.replaceSession('s1', 1, view)
      store.markUploaded('2026-01-01', 'https://madrank.ai/api/usage/ingest')
      expect(store.isUploaded('2026-01-01')).toBe(true)
      store.clearUploadedDays()
      expect(store.isUploaded('2026-01-01')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
