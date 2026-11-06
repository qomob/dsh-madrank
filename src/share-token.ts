/**
 * share-token.ts — shareToken 的凭据托管（Host 半侧）。
 *
 * 背景：`shareToken`（u+16hex）只是匿名分享码，但此前明文落在
 * `~/.madrank/usage/global-rank.json`，并随卡片快照复制。审计要求"落盘去明文"。
 *
 * 设计：
 * - 优先用官方 `ctx.credentials.modifyRecord()` 存在 `<owner>/<id>` 记录里
 *   （GrantRecord: { kind: 'grant', payload: unknown }）；
 * - 启动时把旧文件里的明文 token 迁移进 credentials，并重写脱敏后的文件；
 * - credentials 服务缺席时回退旧行为（明文文件）并返回 fallbackPlaintext 供上层告警；
 * - 浏览器投影仍携带 token：分享 URL / `/api/usage/me` 刷新需要它，本模块只负责磁盘。
 */

import type { GlobalRankRecord } from './global-rank.ts'

/** 记录地址：`<scope>/<id>`（scope 用插件名，id 固定 share-token）。 */
export const SHARE_TOKEN_KEY = 'dsh-madrank/share-token'

export interface CredentialsLike {
  readRecord(key: string): Promise<unknown>
  modifyRecord(key: string, mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
  deleteRecord?(key: string): Promise<void>
}

function asCredentials(value: unknown): CredentialsLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const v = value as Partial<CredentialsLike>
  if (typeof v.readRecord !== 'function' || typeof v.modifyRecord !== 'function') return undefined
  return v as CredentialsLike
}

/** 从宿主 ctx 上可选地取 credentials 服务（不硬依赖；缺席时回退明文文件）。 */
export function credentialsOf(ctx: unknown): CredentialsLike | undefined {
  try {
    const get = (ctx as { get?: (key: string) => unknown } | null | undefined)?.get
    if (typeof get === 'function') {
      const viaGet = asCredentials(get.call(ctx, 'credentials'))
      if (viaGet !== undefined) return viaGet
    }
    return asCredentials((ctx as { credentials?: unknown } | null | undefined)?.credentials)
  } catch {
    return undefined
  }
}

/** 兼容读取记录内的 token：我们写 `payload.shareToken`，也宽容顶层/`payload.token`。 */
export function shareTokenFromRecord(record: unknown): string | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const payload = (record as { payload?: unknown }).payload
  const candidates = [payload, record]
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') continue
    const token = (candidate as { shareToken?: unknown; token?: unknown }).shareToken
      ?? (candidate as { token?: unknown }).token
    if (typeof token === 'string' && /^u[0-9a-f]{16}$/.test(token)) return token
  }
  return undefined
}

export function recordForShareToken(token: string): { kind: 'grant'; payload: { shareToken: string } } {
  return { kind: 'grant', payload: { shareToken: token } }
}

export async function loadShareToken(credentials: CredentialsLike): Promise<string | undefined> {
  try {
    return shareTokenFromRecord(await credentials.readRecord(SHARE_TOKEN_KEY))
  } catch {
    return undefined
  }
}

export async function saveShareToken(credentials: CredentialsLike, token: string): Promise<boolean> {
  try {
    await credentials.modifyRecord(SHARE_TOKEN_KEY, async () => recordForShareToken(token))
    return true
  } catch {
    return false
  }
}

/** 持久化前脱敏：移除 shareToken（调用方决定是否启用）。 */
export function withoutShareToken(rec: GlobalRankRecord | null): GlobalRankRecord | null {
  if (rec === null) return null
  const { shareToken: _ignored, ...rest } = rec
  return rest
}

export interface AdoptShareTokenResult {
  /** 当前可用的 shareToken（内存用）。 */
  token?: string
  /** 本次把旧文件明文迁移进了 credentials。 */
  migrated: boolean
  /** 本次重写了脱敏后的文件（记录里原本带明文）。 */
  stripped: boolean
  /** credentials 缺席且旧文件仍有明文 → 上层应告警。 */
  fallbackPlaintext: boolean
}

/**
 * 启动时解析 shareToken 归属：
 * 1. credentials 可用：读记录；没有则把旧文件明文迁移进去并重写脱敏文件；
 * 2. credentials 缺席：沿用旧文件明文（fallbackPlaintext = true，由上层 warn）。
 */
export async function adoptShareToken(opts: {
  credentials: CredentialsLike | undefined
  legacy: GlobalRankRecord | null
  persist(record: GlobalRankRecord | null): void
  log?(message: string): void
}): Promise<AdoptShareTokenResult> {
  const { credentials, legacy, persist, log } = opts
  const legacyToken = legacy?.shareToken

  if (credentials === undefined) {
    return {
      token: legacyToken,
      migrated: false,
      stripped: false,
      fallbackPlaintext: legacyToken !== undefined,
    }
  }

  const stored = await loadShareToken(credentials)
  if (stored !== undefined) {
    if (legacyToken !== undefined) {
      persist(withoutShareToken(legacy))
      return { token: stored, migrated: false, stripped: true, fallbackPlaintext: false }
    }
    return { token: stored, migrated: false, stripped: false, fallbackPlaintext: false }
  }

  if (legacyToken === undefined) {
    return { token: undefined, migrated: false, stripped: false, fallbackPlaintext: false }
  }

  const saved = await saveShareToken(credentials, legacyToken)
  if (!saved) {
    return { token: legacyToken, migrated: false, stripped: false, fallbackPlaintext: true }
  }
  persist(withoutShareToken(legacy))
  log?.('share token migrated to credentials')
  return { token: legacyToken, migrated: true, stripped: true, fallbackPlaintext: false }
}
