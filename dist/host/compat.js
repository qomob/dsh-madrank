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
export {};
