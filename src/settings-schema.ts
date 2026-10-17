/**
 * settings-schema.ts — 插件配置（新版 Harness 的 `Config` 约定）。
 *
 * 新版 DSH（0.2.x）不再有「设置命名空间注册」：插件导出 schemastery `Config`，
 * 用户通过 Settings → 插件页编辑其中的 `.volatile()` 字段（写入 profile patch，
 * 运行中热更新，无需重启）。字段读取方式见 readSettings()：
 * volatile 字段解析为冻结引用 `{ get() }`，普通字段保持原值。
 */

import z from '@deepseek-ai/schemastery'

/** Loader entry id（与 cordis.patch.yml 的 insert.id 一致；客户端 configForms 用它取表单）。 */
export const MADRANK_ENTRY_ID = 'madrank'

/** 官方 ingest 端点（服务端做 Community Ranking 校验）。 */
export const INGEST_ENDPOINT_DEFAULT = 'https://madrank.ai/api/usage/ingest'

/** 配置字段（全部 volatile：可在设置页即时修改并热更新）。 */
export const Config = z.object({
  /** 加入全球榜必须显式开启；默认完全离线。 */
  enabled: z.boolean().default(false).volatile(),
  /** MADRank ingest 端点。 */
  endpoint: z.string().default(INGEST_ENDPOINT_DEFAULT).volatile(),
  /** 自动同步每日聚合（默认 true；enabled=false 时同步轮根本不启动）。 */
  autoSync: z.boolean().default(true).volatile(),
})

/** 解析后的配置形状（readSettings 的返回）。 */
export interface MadrankUsageSettings {
  enabled: boolean
  endpoint: string
  autoSync: boolean
}

/** volatile 字段的冻结引用（schemastery createVolatile 的对外面）。 */
interface VolatileRef<T> {
  get(): T
}

function readRef<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as VolatileRef<T>).get === 'function') {
    try {
      const current = (value as VolatileRef<T>).get()
      return current === undefined || current === null ? fallback : current
    } catch {
      return fallback
    }
  }
  return value === undefined || value === null ? fallback : value as T
}

/** 从 loader 传入的 config（可能是 volatile 引用或普通对象）读出最新设置。 */
export function readSettings(raw: unknown): MadrankUsageSettings {
  const cfg = (raw ?? {}) as Record<string, unknown>
  const enabled = readRef<boolean>(cfg['enabled'], false)
  return {
    enabled: enabled === true,
    endpoint: readRef<string>(cfg['endpoint'], INGEST_ENDPOINT_DEFAULT),
    autoSync: readRef<boolean>(cfg['autoSync'], true) !== false,
  }
}