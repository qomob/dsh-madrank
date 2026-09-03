/**
 * settings-schema.ts — Host/浏览器两半共用的命名空间契约。
 * （同构文件：浏览器半侧同样从这里 import schema 保证 key 一致。）
 */
import { z } from 'zod'

export const SETTINGS_NAMESPACE = 'madrank-usage'

export const MadrankUsageSettingsSchema = z.object({
  /** 加入全球榜必须显式开启；默认完全离线。 */
  enabled: z.boolean().default(false),
  /** MADRank ingest 端点（服务端做 Community Ranking 校验）。 */
  endpoint: z.string().default('https://madrank.ai/api/usage/ingest'),
  /** 自动同步每日聚合（默认 true；enabled=false 时宿主根本不启动同步轮）。 */
  autoSync: z.boolean().default(true),
})

export type MadrankUsageSettings = z.infer<typeof MadrankUsageSettingsSchema>
