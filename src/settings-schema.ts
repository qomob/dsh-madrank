/**
 * settings-schema.ts — madrank-usage 命名空间的官方 schemastery 契约。
 *
 * 依据官方 cookbook docs/cookbook/adding-a-settings-card.md 的最佳实践：
 * - 命名空间是 Host 与浏览器半侧的接合键，只拼一次、两边同写一份；
 * - schema 必须是 schemastery `z<T>`（可调用 + 自带 toJSON），
 *   宿主 resolve/describe 都以该对象为唯一来源 —— 不再需要 zod 可调用
 *   适配器与手写 toJSON 图（旧实现 uid/refs 双面 hack）。
 *
 * 命令字段（deleteRequested / clearLocalRequested）按官方 mutate/update 语义建模：
 * 宿主 tick 消费后回写 0；客户端只读 value 中字段的「存在与否 + 值」。
 */

import z from '@deepseek-ai/schemastery'

export const SETTINGS_NAMESPACE = 'madrank-usage'

/** 官方 ingest 端点（服务端做 Community Ranking 校验）。 */
export const INGEST_ENDPOINT_DEFAULT = 'https://madrank.ai/api/usage/ingest'

/** 解析后配置形状（不含宿主 resolve 注入的镜像字段 global/epochs）。 */
export interface MadrankUsageSettings {
  /** 加入全球榜必须显式开启；默认完全离线。 */
  enabled: boolean
  /** MADRank ingest 端点。 */
  endpoint: string
  /** 自动同步每日聚合（默认 true；enabled=false 时宿主根本不启动同步轮）。 */
  autoSync: boolean
  /** 删除通道命令字段（设置面板两步确认后写入；宿主 tick 执行后回写 0）。 */
  deleteRequested?: number
  /** 清除本地数据命令字段（只清本机统计；宿主 tick 执行后回写 0）。 */
  clearLocalRequested?: number
}

/**
 * 命名空间 schema：schemastery `z.object`，官方可调用约定原样满足
 * （`schema(merged)` 解析、`schema.toJSON()` 序列化）。字段缺省自动
 * 补默认值；未知字段被剥离（与旧 zod strip 语义一致）。
 */
export const MadrankUsageSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().default(INGEST_ENDPOINT_DEFAULT),
  autoSync: z.boolean().default(true),
  deleteRequested: z.natural().default(0),
  clearLocalRequested: z.natural().default(0),
}) as z<MadrankUsageSettings>

/** resolve 镜像注入后的完整 wire 形状（宿主 resolve 出口；客户端 decode 宽容）。 */
export interface MadrankResolvedSettings extends MadrankUsageSettings {
  global: unknown
  deletedEpoch: number
  clearedEpoch: number
}