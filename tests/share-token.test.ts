import { describe, it, expect } from 'vitest'
import {
  adoptShareToken,
  credentialsOf,
  recordForShareToken,
  saveShareToken,
  shareTokenFromRecord,
  withoutShareToken,
  SHARE_TOKEN_KEY,
} from '../src/share-token.ts'
import type { CredentialsLike } from '../src/share-token.ts'
import type { GlobalRankRecord } from '../src/global-rank.ts'

const TOKEN = 'u0123456789abcdef'
const record = (shareToken?: string): GlobalRankRecord => ({
  rank: 3, total: 12_345_678, topPct: 42.9, participants: 7,
  endpoint: 'https://madrank.ai/api/usage/ingest', updatedAt: 1,
  shareToken,
})

function makeCreds(initial?: unknown): CredentialsLike & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  if (initial !== undefined) map.set(SHARE_TOKEN_KEY, initial)
  return {
    map,
    async readRecord(key: string) { return map.get(key) },
    async modifyRecord(key: string, mutate: (current: unknown) => Promise<unknown>) {
      const next = await mutate(map.get(key))
      if (next !== undefined) map.set(key, next)
      return next
    },
  }
}

describe('shareToken 凭据托管', () => {
  it('旧文件明文 → 迁移进 credentials，并把脱敏后的记录写回', async () => {
    const creds = makeCreds()
    const persisted: GlobalRankRecord[] = []
    const r = await adoptShareToken({
      credentials: creds,
      legacy: record(TOKEN),
      persist: (rec) => { if (rec) persisted.push(rec) },
    })
    expect(r.token).toBe(TOKEN)
    expect(r.migrated).toBe(true)
    expect(r.stripped).toBe(true)
    expect(r.fallbackPlaintext).toBe(false)
    expect(creds.map.get(SHARE_TOKEN_KEY)).toEqual(recordForShareToken(TOKEN))
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.shareToken).toBeUndefined()
  })

  it('credentials 已有 token：直接使用；旧文件残留 token 时只做脱敏', async () => {
    const creds = makeCreds(recordForShareToken(TOKEN))
    const persisted: GlobalRankRecord[] = []
    const r = await adoptShareToken({
      credentials: creds,
      legacy: record(TOKEN),
      persist: (rec) => { if (rec) persisted.push(rec) },
    })
    expect(r.token).toBe(TOKEN)
    expect(r.migrated).toBe(false)
    expect(r.stripped).toBe(true)
    expect(persisted[0]!.shareToken).toBeUndefined()
  })

  it('credentials 在场但记录与旧文件都没有 token → 无 token、不改文件', async () => {
    const creds = makeCreds()
    const persisted: GlobalRankRecord[] = []
    const r = await adoptShareToken({ credentials: creds, legacy: record(), persist: (rec) => { if (rec) persisted.push(rec) } })
    expect(r.token).toBeUndefined()
    expect(r.migrated).toBe(false)
    expect(persisted).toHaveLength(0)
  })

  it('credentials 缺席 → 回退旧明文文件并标记 fallbackPlaintext', async () => {
    const r = await adoptShareToken({ credentials: undefined, legacy: record(TOKEN), persist: () => { throw new Error('must not persist') } })
    expect(r.token).toBe(TOKEN)
    expect(r.fallbackPlaintext).toBe(true)
  })

  it('record 读取宽容：payload.shareToken / 顶层 shareToken / 非法 token 被拒绝', () => {
    expect(shareTokenFromRecord(recordForShareToken(TOKEN))).toBe(TOKEN)
    expect(shareTokenFromRecord({ shareToken: TOKEN })).toBe(TOKEN)
    expect(shareTokenFromRecord({ kind: 'grant', payload: { shareToken: 'not-a-token' } })).toBeUndefined()
    expect(shareTokenFromRecord(null)).toBeUndefined()
  })

  it('withoutShareToken 返回不含 token 的副本', () => {
    const rec = record(TOKEN)
    expect(withoutShareToken(rec)!.shareToken).toBeUndefined()
    expect(rec.shareToken).toBe(TOKEN) // 原对象不被修改
  })

  it('credentialsOf：支持 ctx.get 与直接属性，缺失/坏形状返回 undefined', () => {
    const creds = makeCreds()
    expect(credentialsOf({ get: (k: string) => (k === 'credentials' ? creds : undefined) })).toBe(creds)
    expect(credentialsOf({ credentials: creds })).toBe(creds)
    expect(credentialsOf({})).toBeUndefined()
    expect(credentialsOf({ get: () => ({ readRecord: 1 }) })).toBeUndefined()
  })

  it('saveShareToken 写 GrantRecord；凭据服务抛错时返回 false 且不崩', async () => {
    const creds = makeCreds()
    expect(await saveShareToken(creds, TOKEN)).toBe(true)
    expect(creds.map.get(SHARE_TOKEN_KEY)).toEqual(recordForShareToken(TOKEN))
    const broken: CredentialsLike = {
      async readRecord() { return undefined },
      async modifyRecord() { throw new Error('denied') },
    }
    expect(await saveShareToken(broken, TOKEN)).toBe(false)
  })
})
