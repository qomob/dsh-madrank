/**
 * caliber.ts — MADRank Usage 的数据口径（产品级锁定，v0.1）。
 *
 * Primary Tokens（一切排名与展示的主数字）：
 *     uncached input + output
 * Secondary（单独展示，绝不混入主数字）：
 *     cacheRead / cacheWrite —— 显示为 "+N cached"
 *
 * 理由：各厂商缓存口径差异大，混算的 "Total Tokens" 无法跨模型比较，
 * 也会让 7-Day Token Race 的数字失去解释力。
 *
 * 全球榜竞赛指标（P1-C/P2 采用）：
 *     RACE_METRIC = 最近 7 个 UTC 日 Primary Tokens 之和
 *                   （7-Day Uncached Tokens）
 */

export const PRIMARY_TOKENS = (b: {
  inputTokens: number; outputTokens: number
}): number => b.inputTokens + b.outputTokens

export const CACHED_TOKENS = (b: {
  cacheReadTokens: number; cacheWriteTokens: number
}): number => b.cacheReadTokens + b.cacheWriteTokens

export const TOTAL_BILLED_TOKENS = (b: {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number
}): number => PRIMARY_TOKENS(b) + CACHED_TOKENS(b)

/** 活跃时长：相邻样本间隔 ≤ GAP 则合并为同一段。 */
export const ACTIVITY_GAP_MS = 5 * 60_000

/** 排名/百分位的对外统一表述是 "top X%"；竞赛指标名固定为 7-Day Token Race。 */
export const RACE_METRIC_NAME = '7-Day Uncached Tokens' as const
