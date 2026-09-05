/**
 * caliber.ts — MADRank Usage 的数据口径（产品级锁定，v0.1）。
 *
 * Primary Tokens（本地展示主数字）：
 *     uncached input + output
 * Secondary（单独展示，绝不混入本地主数字）：
 *     cacheRead / cacheWrite —— 显示为 "+N cached"
 *
 * 理由：各厂商缓存口径差异大，混算的 "Total Tokens" 无法跨模型比较，
 * 也会让 7-Day Token Race 的数字失去解释力。
 *
 * 全球榜真实性说明（2026-09 复核）：
 *     上传字段 input = uncached input + cacheWrite（sync.ts 计费口径），
 *     服务端竞速 total = input + output（即 uncached input + cacheWrite + output）。
 *     cacheRead 单列，绝不进入竞速。因此「竞速 total」与「本地 primary」
 *     口径不同：前者含 cacheWrite、后者不含；卡片已用来源标注（本地=LOCAL·LIVE、
 *     服务端=SERVER + 同步时间）区分两者（见 card-html mk-src）。
 *     RACE_METRIC_NAME 为历史标识符，不再作为对外措辞使用。
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
