/**
 * snapshot.ts — 把 store 聚合变成 Settings 卡片的 CardSnapshot。
 * 单一生产者：index.ts 每次落盘时同步写出；消费者：客户端半侧 / 预览工具。
 * 口径经 caliber.ts/stats.ts，本模块只做形状装配。
 */

import { lastNDays, streakDays, todayCard, topModels } from './stats.ts'
import type { UsageStore } from './store.ts'

export interface CardModelRow {
  provider: string
  model: string
  primaryTokens: number
  sharePct: number
}

/** 与 src/client/index.ts 的 CardSnapshot 保持同构（host 侧权威定义）。 */
export interface MadrankCardSnapshot {
  schema: 'madrank.card-snapshot'
  version: 1
  ymd: string
  today: {
    primaryTokens: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    requests: number
    activeSeconds: number
    vs7dAvgMultiple: number | null
  }
  topModels: CardModelRow[]
  streakDays: number
  last7Days: Array<{ ymd: string; primaryTokens: number }>
  /** sync 尚未接入云端排名 —— 本地版恒 null（诚实空态）。 */
  global: null
  anonIdSuffix: string
  generatedAt: number
}

export function buildCardSnapshot(
  store: UsageStore,
  getAnonId: () => string,
  nowMs: number,
): MadrankCardSnapshot {
  const aggregate = store.aggregateDays()
  const t = todayCard(aggregate, nowMs)

  return {
    schema: 'madrank.card-snapshot',
    version: 1,
    ymd: t.ymd,
    today: {
      primaryTokens: t.primaryTokens,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cachedTokens: t.cachedTokens,
      requests: t.requests,
      activeSeconds: t.activeSeconds,
      vs7dAvgMultiple: t.vs7dAvgMultiple,
    },
    topModels: topModels(aggregate, t.ymd),
    streakDays: streakDays(aggregate, nowMs),
    last7Days: lastNDays(aggregate, nowMs, 7)
      .map(d => ({ ymd: d.ymd, primaryTokens: d.primaryTokens })),
    global: null,
    anonIdSuffix: getAnonId().slice(-4),
    generatedAt: nowMs,
  }
}
