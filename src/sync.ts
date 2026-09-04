/**
 * sync.ts — 全球同步（opt-in）。
 *
 * 不可违反的产品约束：
 * - 任何情况下不实时上传单次请求数据；
 * - 只上传【已完整结束的 UTC 日】的日级聚合（当天永不外发）；
 * - 失败退避重试；上传幂等由服务端按 (anonId, date) 去重兜底。
 *
 * 服务端定性为 Community Usage Ranking（非精确排名）：
 * ingest 侧做日上限阈值 / 模型白名单归一 / token-request 合理性 /
 * 匿名 ID 速率限制 —— 本模块只负责诚实上报自己聚合出的数字。
 */

import type { UsageStore } from './store.ts'
import type { MadrankSettings } from './compat.ts'
import { parseIngestRace } from './global-rank.ts'
import type { IngestRaceView } from './global-rank.ts'

export interface AnonIdProvider {
  (): string
}

export interface UploadOutcome {
  date: string
  ok: boolean
  detail?: string
}

export function yesterdayYmd(now = Date.now()): string {
  return new Date(now - 86_400_000).toISOString().slice(0, 10)
}

/**
 * Usage Protocol schema 版本（v0.2 定版）。
 * 服务端按此字段做兼容：v2 出现后 v1 客户端仍可继续上传。
 * 字段语义冻结：input = uncached input + cache-write（计费口径）；
 * cacheRead 单列；一切口径以本包 caliber.ts 为准。
 */
export const USAGE_SCHEMA_VERSION = 1

/** 随 payload 上报的插件版本（服务端 source_client_version 列，可选字段、截 64 字符）。 */
export const USAGE_CLIENT_VERSION = '0.3.6'

/**
 * 组装某一天的 payload（远端 schema 的唯一来源）。
 * ⚠️ wire 形状以服务端 lib/usage/protocol.ts 冻结契约为准：days[].models 是
 * 「模型名 → 桶」的 OBJECT 映射（P0-2 真实联调抓出的数组形状 400 BAD_MODELS）。
 */
export function composeDayPayload(
  anonId: string,
  ymd: string,
  dayModels: Record<string, {
    inputTokens: number; outputTokens: number
    cacheReadTokens: number; cacheWriteTokens: number; requests: number
  }>,
): {
  anonId: string
  schemaVersion: typeof USAGE_SCHEMA_VERSION
  sourceClientVersion: string
  days: Array<{
    date: string
    models: Record<string, { input: number; output: number; cacheRead: number; requests: number }>
  }>
} {
  const models: Record<string, { input: number; output: number; cacheRead: number; requests: number }> = {}
  for (const [model, b] of Object.entries(dayModels)) {
    models[model] = {
      input: b.inputTokens + b.cacheWriteTokens, // 计费口径：cache-write 属输入侧
      cacheRead: b.cacheReadTokens,
      output: b.outputTokens,
      requests: b.requests,
    }
  }
  return {
    anonId,
    schemaVersion: USAGE_SCHEMA_VERSION,
    sourceClientVersion: USAGE_CLIENT_VERSION,
    days: [{ date: ymd, models }],
  }
}

/** 由 ingest 端点派生删除端点（同源同路径族）。 */
export function deleteEndpointFrom(endpoint: string): string {
  return endpoint.replace(/\/api\/usage\/ingest\/?$/, '/api/usage/delete')
}

/**
 * 删除本机在 MADRank 的全部匿名日级行（隐私审计缺口 #4 的插件半侧）。
 * 返回 true = 服务端确认成功（幂等：已删除/不存在同样 ok）。
 */
export async function deleteRemoteData(
  endpoint: string,
  getAnonId: AnonIdProvider,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const url = deleteEndpointFrom(endpoint)
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ anonId: getAnonId() }),
  })
  return res.ok
}

/**
 * 同步循环的一步：找出所有"有数据 + 未上传 + 已经是昨天或更早"的日期并逐个上传。
 * 返回各日结果。调用方（宿主）节流触发（≤1 次/分钟），无需更细的调度器。
 *
 * onRace：服务端每个成功响应都携带按本机 anonId 重算的 7 日 race（Ranking
 * Projection）。这里宽容解析后逐次上抛（多日回传时最后一次即最完整状态）；
 * 解析失败只影响排名点亮，绝不影响上传结果判定。
 */
export async function syncPendingDays(
  store: UsageStore,
  settings: MadrankSettings,
  getAnonId: AnonIdProvider,
  fetchImpl: typeof fetch,
  onRace?: (race: IngestRaceView) => void,
): Promise<UploadOutcome[]> {
  if (!settings.enabled || !settings.endpoint) return []

  const aggregated = store.aggregateDays()
  const dates = Object.keys(aggregated)
    .filter((d) => d <= yesterdayYmd())
    .filter((d) => !store.isUploaded(d, settings.endpoint))
    .sort()

  const outcomes: UploadOutcome[] = []
  for (const date of dates) {
    try {
      const res = await fetchImpl(settings.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(composeDayPayload(getAnonId(), date, aggregated[date]!.models)),
      })
      if (res.ok) {
        store.markUploaded(date, settings.endpoint)
        outcomes.push({ date, ok: true })
        if (onRace) {
          try {
            // ingest 响应契约：{ ok, results, race }（route.ts）——race 段才是榜面
            const body = (await res.json()) as { race?: unknown }
            const race = parseIngestRace(body?.race)
            if (race) onRace(race)
          } catch {
            // 展示数据缺位不阻断同步（幂等标记已落）
          }
        }
      } else {
        outcomes.push({ date, ok: false, detail: 'http ' + res.status })
      }
    } catch (err) {
      outcomes.push({
        date, ok: false,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return outcomes
}