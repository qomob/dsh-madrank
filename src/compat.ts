/**
 * compat.ts — dsh-madrank 与 DSH 的唯一耦合面。
 *
 * 防碎化策略（开发者预览期延续）：不 import @deepseek-ai/*，
 * 以结构化类型镜像「本包实际依赖的最小契约」，并在此处逐条标注其权威出处。
 * 接缝升级时只需对照本文件与当时的官方包。官方文档路径：
 *   https://github.com/deepseek-ai/deepseek-harness （docs/ + package README）
 *
 * 权威源码映射（2026-09 对齐 npm @deepseek-ai/* 0.1.1-rc.2 系）：
 * - ProjectionDefinition：key/stateSchema(ZodType)/init/apply/wire?/stateVersion
 *     packages/session/session-projection/README.zh.md ——
 *     wire 缺席 = host-only；register/onChanged 均返回 effect 绑定的 disposer；
 *     apply 对无关事件必须返回同一引用（Object.is 守卫零下游工作）。
 * - ProjectionRegistry.register/onChanged
 *     packages/session/session-projection/README.zh.md（同 README 第 7-16 行）
 * - SessionEvent：{ type, seq:number, time:number, data }
 *     packages/core/session/src/types.ts（SessionEvent）
 * - 用量事件：
 *     assistant/chunk  data:{ turn, step, chunk:{ type:'usage', usage } }
 *     assistant/message data:{ turn, step, message, usage?, ... }
 * - 模型标识事件：request/header  data:{ header:{ config:{ provider, model } } }
 * - 设置注册（Host 半侧）：
 *     ctx.settings.register(ns, schema, { base }) —— schemastery schema
 *     （可调用 + toJSON；官方 cookbook adding-a-settings-card.md 的
 *     installSettingsSection 语义 = register + setSource + watch + onChange）。
 * - timer 服务：ctx.timer（timeout/interval/throttle/debounce，fiber-bound）；
 *     packages/.../cordis-plugin-timer（官方计时器，替代裸 setTimeout/setInterval）。
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

/** schema 只被宿主以 .parse / .safeParse / 可调用方式消费（真实 zod 满足）。 */
export interface SchemaLike {
  parse(value: unknown): unknown
  safeParse(value: unknown): { success: boolean; data?: unknown; error?: unknown }
}

/** 客户端视图声明（wire 缺席 = host-only 单元：值不出宿主、onChanged 不触发）。 */
export interface ProjectionWireLike {
  readonly viewSchema: SchemaLike
  view(state: never): unknown
}

/**
 * 与官方 ProjectionDefinition 同构的最小契约：
 * `{ key, stateSchema, init(), apply(state, event), wire?, stateVersion }`。
 * ⚠️ 官方状态必须可 JSON 化；apply 对无关事件返回同一引用。
 */
export interface ProjectionDefinitionLike {
  readonly key: string
  /** 持久化状态在 seed/restore 前必须通过校验（失败则该键按缺席处理）。 */
  readonly stateSchema?: SchemaLike
  init(): unknown
  apply(state: never, event: SessionEventLike): unknown
  /** 客户端视图声明：缺席 = host-only 单元。 */
  readonly wire?: ProjectionWireLike
  readonly stateVersion: number
}

/** 官方 SettingsScope 的最小镜像（get/watch/update/replace 是写路径）。 */
export interface SettingsScopeMirrorLike<T> {
  get(): T
  watch(cb: (next?: T, prev?: T) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
  replace?(section: object): Promise<void>
}

/**
 * ctx.settings 的最小镜像。register 的 schema 按官方 schemastery 约定消费：
 * 宿主 resolve() 里执行 schema(mergeLayers(base, section))（可调用），
 * describe() 序列化 schema.toJSON() —— schemastery `z<T>` 原样满足两者。
 */
import type z from '@deepseek-ai/schemastery'

export interface SettingsProviderLike {
  register<T>(
    ns: string,
    schema: z<T>,
    options: { base?: Partial<T>; applies?: 'live' | 'restart'; validate?: (v: T) => void },
  ): SettingsScopeMirrorLike<T>
}

/** 官方 timer 服务的可调用面（fiber 结束时自动 dispose）。 */
export interface TimerLike {
  timeout(callback: () => void, delay: number): () => void
  interval(callback: () => void, delay: number): () => void
}

/** cordis ctx 上本插件触达的成员。 */
export interface CtxLike {
  sessionProjections?: ProjectionRegistryLike
  /** rc.2：设置服务挂 ctx.settings；官方消费 = register + setSource + watch。 */
  settings?: SettingsProviderLike
  /** 官方 timer 服务（timeout/interval 等；缺席时插件回退全局计时器）。 */
  timer?: TimerLike
  /** 服务缺席时经 inject 等待（可选能力消费，官方约定）。 */
  inject?(deps: readonly string[], cb: (sctx: Record<string, unknown>) => void): void
  on?(ev: string, cb: () => void): void
  logger?: {
    info(message: string, ...rest: unknown[]): void
    warn(message: string, ...rest: unknown[]): void
    error(message: string, ...rest: unknown[]): void
  }
}

/** sync 链路消费的最小设置面（enabled/endpoint 即全部依赖）。 */
export interface MadrankSettings {
  enabled: boolean
  endpoint: string
}