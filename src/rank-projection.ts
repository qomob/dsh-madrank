/**
 * rank-projection.ts — 把宿主内存里的排名镜像变成「客户端可见投影」。
 *
 * 新版（0.2.x）没有设置注入/自定义 RPC 通道；投影是唯一官方的
 * Host → Client 值通道。排名是安装级数据（与具体会话无关），这里注册一个
 * 独立 key 的投影单元：state 恒为 {}，wire.view 直接读宿主内存镜像。
 * 每个会话 cell 携带同一份值——客户端从任一会话的 projectionValues 取用。
 * 值只在排名记录变化时换引用（缓存），因此不会每次事件都触发客户端重渲染。
 */

import { z as zod } from 'zod'
import type { ProjectionDefinitionLike } from './compat.ts'
import type { CardGlobal } from './global-rank.ts'

export const RANK_PROJECTION_KEY = 'madrankRank'

export function buildRankDefinition(provider: () => CardGlobal | null): ProjectionDefinitionLike {
  const stateSchema = zod.object({})
  const viewSchema = zod.object({
    rank: zod.number(),
    topPct: zod.number(),
    race7d: zod.number(),
    participants: zod.number().optional(),
    updatedAt: zod.number().optional(),
    shareToken: zod.string().optional(),
  }).nullable()
  return {
    key: RANK_PROJECTION_KEY,
    stateSchema: stateSchema as unknown as ProjectionDefinitionLike['stateSchema'],
    init: () => ({}),
    apply: ((state: unknown) => state) as never,
    wire: {
      viewSchema: viewSchema as unknown as NonNullable<ProjectionDefinitionLike['wire']>['viewSchema'],
      view: (() => provider()) as never,
    },
    stateVersion: 1,
  }
}
