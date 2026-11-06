/**
 * store.ts — 本机持久化（Derived Projection cache，非 Source of Truth）。
 *
 * 防漂移设计：每个会话的份额永远是"最新 view 整体替换"，
 * 任何重放/重启/崩溃都收敛到正确值。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UsageView } from './fold.ts'
import type { ModelBuckets } from './fold.ts'

export interface SessionSlice {
  /** 最后入账事件 seq（仅诊断用）。 */
  seq: number
  days: Record<string, { models: Record<string, ModelBuckets>; activeSeconds?: number }>
}

export interface StoreShape {
  stateVersion: number
  sessions: Record<string, SessionSlice>
  /** 已成功上传的 UTC 日（防重复上报；对端按 (anonId,date) 兜底去重）。 */
  uploadedDays: Record<string, { at: number; endpoint: string }>
}

export function emptyStore(): StoreShape {
  return { stateVersion: 2, sessions: {}, uploadedDays: {} }
}

export class UsageStore {
  private readonly file: string
  private readonly stateVersion: number
  private data: StoreShape
  /** 本地数据清除时间戳（ms）；0 = 未清除。早于该 UTC 日的历史不入账、不上传。 */
  private clearedAtMs = 0

  // 不用 TS 参数属性 —— Node 原生 strip-types 不支持，插件必须可零转译加载
  constructor(dataDir: string, stateVersion = 2, fileName = 'usage-store.json', clearedAtMs = 0) {
    this.stateVersion = stateVersion
    this.file = join(dataDir, fileName)
    this.data = this.load()
    if (clearedAtMs > 0) this.setClearedAt(clearedAtMs)
  }

  private load(): StoreShape {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as StoreShape
        if (raw.stateVersion === this.stateVersion) return raw
      }
    } catch {
      // 损坏即重建：本文件不是事实源
    }
    return emptyStore()
  }

  /** 清除阈值：早于这一 UTC 日（ymd < cutoff）的历史一律丢弃。 */
  private cutoffYmd(): string | null {
    return this.clearedAtMs > 0 ? new Date(this.clearedAtMs).toISOString().slice(0, 10) : null
  }

  /** 设置/更新本地数据清除点，并就地裁剪已存历史。返回是否有数据被清掉。 */
  setClearedAt(ms: number): boolean {
    const next = Math.max(0, Math.floor(ms))
    if (next === this.clearedAtMs) return false
    this.clearedAtMs = next
    const cutoff = this.cutoffYmd()
    if (cutoff === null) return false
    let dropped = false
    for (const [sid, slice] of Object.entries(this.data.sessions)) {
      const kept: SessionSlice['days'] = {}
      for (const [ymd, day] of Object.entries(slice.days)) {
        if (ymd >= cutoff) kept[ymd] = day
        else dropped = true
      }
      if (Object.keys(kept).length === 0) delete this.data.sessions[sid]
      else slice.days = kept
    }
    return dropped
  }

  flush(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }

  replaceSession(sessionId: string, seq: number, view: UsageView): void {
    const cutoff = this.cutoffYmd()
    const days: SessionSlice['days'] = {}
    for (const [ymd, day] of Object.entries(view.days)) {
      if (cutoff === null || ymd >= cutoff) days[ymd] = structuredCloneish(day)
    }
    if (Object.keys(days).length === 0) {
      delete this.data.sessions[sessionId]
      return
    }
    this.data.sessions[sessionId] = { seq, days }
  }

  markUploaded(ymd: string, endpoint: string): void {
    this.data.uploadedDays[ymd] = { at: Date.now(), endpoint }
  }

  isUploaded(ymd: string, endpoint?: string): boolean {
    const rec = this.data.uploadedDays[ymd]
    if (!rec) return false
    // ⚠️ 必须比对端点：换端点（如 127.0.0.1:3010 → madrank.ai）后，对旧端点上报过
    // 的日子必须重新上报，否则同步循环判定「无事可做」、卡片永远等待
    // （2026-09-01 生产切端点当日实锤）。
    return endpoint === undefined || rec.endpoint === endpoint
  }

  /** 机器级聚合（按日）。跨会话重叠不扣减。 */
  aggregateDays(): Record<string, { models: Record<string, ModelBuckets>; activeSeconds: number }> {
    const out: Record<string, { models: Record<string, ModelBuckets>; activeSeconds: number }> = {}
    const cutoff = this.cutoffYmd()
    for (const s of Object.values(this.data.sessions)) {
      for (const [ymd, day] of Object.entries(s.days)) {
        if (cutoff !== null && ymd < cutoff) continue
        const dst = (out[ymd] ??= { models: {}, activeSeconds: 0 })
        for (const [modelKey, b] of Object.entries(day.models)) {
          const acc = (dst.models[modelKey] ??= {
            inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0,
          })
          acc.inputTokens += b.inputTokens
          acc.outputTokens += b.outputTokens
          acc.cacheReadTokens += b.cacheReadTokens
          acc.cacheWriteTokens += b.cacheWriteTokens
          acc.requests += b.requests
        }
        // 多会话同日：取最大者为保守显示口径（重叠无法离线精确扣减）
        const sec = day.activeSeconds ?? 0
        if (sec > dst.activeSeconds) dst.activeSeconds = sec
      }
    }
    return out
  }

  exportAll(): StoreShape {
    return JSON.parse(JSON.stringify(this.data)) as StoreShape
  }

  wipe(): void {
    this.data = emptyStore()
    this.flush()
  }

  /**
   * 只清本机统计份额（v0.2 设置面板「清除本地数据」）。
   * 与 wipe 的区别：保留 uploadedDays —— 已上传的日子不因本地清除而重传
   * （「清本地」≠「撤回远端」；远端删除走 deleteRequested 命令通道）。
   * 活跃会话的下一次 onChanged 会重新入账（语义见设置面板提示文案）。
   */
  clearLocalStats(): void {
    this.data.sessions = {}
    this.flush()
  }
}

function structuredCloneish<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
