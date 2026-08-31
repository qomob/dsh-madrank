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
 * - ⚠️ rc.2 契约（npm @deepseek-ai/dsh 0.1.1-rc.2 · dsh-session-projection）：
 *     register 分双轨——带 wire = client-visible；不带 = host-only。
 *     host-only：state 照常折算/落 checkpoint，但 snapshot()/onChanged 一律跳过
 *     （lib/index.js: "if (def.wire === void 0) continue"）。
 *     stateSchema 是 restore 前置校验；缺字段不报错，只会让键静默失效。
 *     实测事故：v0.1.0 按 rc.8 形状注册（无 wire）⇒ 卡片全零、store 不落盘。
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

/** rc.2 客户端视图声明：缺席 = host-only 单元（值不出宿主、onChanged 不触发）。 */
export interface ProjectionWireLike {
  readonly viewSchema: SchemaLike
  view(state: never): unknown
}

export interface ProjectionDefinitionLike {
  readonly key: string
  /** rc.8 顶层视图 schema（保留：双版本兼容）。 */
  readonly schema?: SchemaLike
  /** rc.2：持久化状态在 seed/restore 前必须通过校验（失败则该键按缺席处理）。 */
  readonly stateSchema?: SchemaLike
  init(): unknown
  apply(state: never, event: SessionEventLike): unknown
  /** rc.8 顶层客户端视图（保留：双版本兼容）。 */
  view?(state: never): unknown
  /** rc.2：客户端视图声明。rc.2 的 snapshot()/onChanged 只认 client-visible 单元。 */
  readonly wire?: ProjectionWireLike
  readonly stateVersion: number
}

/**
 * rc.2：SettingsProvider（ctx.settings）最小镜像。
 * ⚠️ register 的 schema 按"可调用"约定消费——宿主 resolve() 里执行
 * schema(mergeLayers(base, section))（schemastery 习惯）；zod 对象不可调用，
 * 必须传 (merged) => zodSchema.parse(merged) 形状的适配器。
 * ns 须匹配 /^[a-z][a-z0-9-]*$/（settingsNamespace 的校验规则）。
 */
export interface SettingsScopeMirrorLike {
  get(): MadrankSettings
  watch(cb: () => void): () => void
}

export interface SettingsProviderLike {
  register(
    ns: string,
    schema: (merged: unknown) => MadrankSettings,
    options: { base?: MadrankSettings; validate?: (v: MadrankSettings) => void },
  ): SettingsScopeMirrorLike
}

/** cordis ctx 上本插件触达的成员。 */
export interface CtxLike {
  sessionProjections?: ProjectionRegistryLike
  /** rc.8：ctx 成员形式（rc.2 已移出 ctx，成为 dsh-settings 具名导出）。 */
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
  /** rc.2：设置服务挂 ctx.settings；懒解析走 ctx.inject(['settings'], cb)。 */
  settings?: SettingsProviderLike
  inject?(deps: readonly string[], cb: (sctx: { settings?: SettingsProviderLike }) => void): void
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