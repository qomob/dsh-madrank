/**
 * compat.ts — dsh-madrank 与 DSH 的唯一耦合面。
 *
 * 开发者预览期的防碎化策略：不 import @deepseek-ai/*，
 * 以结构化类型镜像"本包实际依赖的最小契约"，并在此处逐条标注其权威出处。
 * 接缝升级时只需对照本文件与当时的 commit。
 *
 * 权威源码映射（截至 2026-08 checkout）：
 * - ProjectionRegistryLike.register/onChanged
 *     packages/session/session-projection/src/index.ts
 *     （register(definition) 返回 disposer；onChanged((session,key,value,seq)=>)）
 * - ProjectionDefinitionLike：key/schema(ZodType)/init/apply/view/stateVersion
 *     同上；init/apply/view 必须同步纯函数，state 必须可 JSON 化
 * - SessionEventLike：{ type, seq:number, time:number, data }
 *     packages/core/session/src/types.ts（SessionEvent）
 * - 用量事件：
 *     assistant/chunk  data:{ turn, step, chunk:{ type:'usage', usage } }
 *     assistant/message data:{ turn, step, message, usage?, ... }
 *     packages/core/session/src/types.ts L266-277、
 *     packages/llm/token-meter/src/usage-projection.ts usageOf()
 * - 模型标识事件：
 *     request/header   data:{ header:{ config:{ provider, model } }, reason }
 *     packages/core/session/src/types.ts L308、packages/llm/llm/src/call-config.ts L23
 * - 设置注册（Host 半侧）：
 *     installSettingsSection(ctx, ns, schema, current, handlers)
 *     docs/cookbook/adding-a-settings-card.zh.md
 */

export interface TokenUsageBuckets {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

export interface SessionEventLike {
  readonly type: string
  readonly seq: number
  /** epoch milliseconds */
  readonly time: number
  readonly data: unknown
}

/** registry.register 的鸭子类型签名（framework drives apply，域只交数学）。 */
export interface ProjectionRegistryLike {
  register(definition: ProjectionDefinitionLike): () => void
  onChanged(listener: (session: SessionRefLike, key: string, value: unknown, seq: number) => void): () => void
}

export interface SessionRefLike {
  readonly id: string
}

/** schema 只被宿主以 .parse / .safeParse 调用（真实 zod 对象满足此形状）。 */
export interface SchemaLike {
  parse(value: unknown): unknown
  safeParse(value: unknown): { success: boolean; data?: unknown; error?: unknown }
}

export interface ProjectionDefinitionLike {
  readonly key: string
  readonly schema: SchemaLike
  init(): unknown
  apply(state: never, event: SessionEventLike): unknown
  view(state: never): unknown
  readonly stateVersion: number
}

/** cordis ctx 上本插件触达的成员。 */
export interface CtxLike {
  sessionProjections?: ProjectionRegistryLike
  installSettingsSection?: (
    ctx: unknown,
    ns: symbol | string,
    schema: unknown,
    current: MadrankSettings,
    handlers: {
      validate?: (v: MadrankSettings) => void
      setSource?: (get: () => MadrankSettings) => void
      onChange?: () => void
    },
  ) => void
  logger?: {
    info(message: string, ...rest: unknown[]): void
    warn(message: string, ...rest: unknown[]): void
    error(message: string, ...rest: unknown[]): void
  }
}

export interface MadrankSettings {
  enabled: boolean
  endpoint: string
}