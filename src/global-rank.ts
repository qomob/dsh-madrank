/**
 * global-rank.ts — 全球排名的纯类型与映射（bundle 纯净：客户端半侧可导入）。
 *
 * 数据来源：/api/usage/ingest 响应里的 race 段（read_usage_race 的 Ranking
 * Projection）。冻结契约（HANDOFF §v0.2）：榜面只有 rank / total / topPct /
 * 打码后缀四类字段；本模块只消费 me{rank,total,topPct} + participants。
 *
 * 传输缝（宿主→浏览器）：settings resolve 注入（见 src/index.ts 的 callable）——
 * 排名不写回 usage 投影、不落 settings 持久化文档，只出现在 describe 答案里。
 */

/** read_usage_race 返回的 me 结构（me === null = 尚无完整统计周期数据）。 */
export interface IngestRaceMe {
  rank: number
  total: number
  topPct: number
}

/** ingest 响应 race 段的本包消费形状。 */
export interface IngestRaceView {
  participants: number
  windowStart?: string
  windowEnd?: string
  me: IngestRaceMe | null
}

/** 持久化记录（global-rank.json；带来源端点与采集时间，换端点后旧记录失效）。 */
export interface GlobalRankRecord {
  rank: number
  total: number
  topPct: number
  participants: number
  windowStart?: string
  windowEnd?: string
  endpoint: string
  updatedAt: number
}

/** 卡片消费形状（card-html CardSnapshot.global；race7d = 服务端 7 日总量）。 */
export interface CardGlobal {
  rank: number
  topPct: number
  race7d: number
  participants?: number
  updatedAt?: number
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** 宽容解析 ingest 响应的 race 段；形状不符一律 null（展示数据缺位不阻断同步）。 */
export function parseIngestRace(raw: unknown): IngestRaceView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!num(r['participants']) || (r['participants'] as number) < 0) return null
  const participants = r['participants'] as number
  const me = r['me']
  if (me === null) return { participants, me: null }
  if (typeof me !== 'object') return null
  const m = me as Record<string, unknown>
  if (!num(m['rank']) || !num(m['total']) || !num(m['topPct'])) return null
  return {
    participants,
    me: { rank: m['rank'], total: m['total'], topPct: m['topPct'] },
    windowStart: optStr(r['windowStart']),
    windowEnd: optStr(r['windowEnd']),
  }
}

/** race 视图 → 持久化记录；me 缺位（无完整周期）返回 null。 */
export function recordFromRace(
  race: IngestRaceView,
  endpoint: string,
  nowMs: number,
): GlobalRankRecord | null {
  if (race.me === null) return null
  return {
    rank: race.me.rank,
    total: race.me.total,
    topPct: race.me.topPct,
    participants: race.participants,
    windowStart: race.windowStart,
    windowEnd: race.windowEnd,
    endpoint,
    updatedAt: nowMs,
  }
}

/** 宽容解析（settings wire 段里的 global；宿主 resolve 注入，非持久化字段）。 */
export function parseGlobalRecord(raw: unknown): GlobalRankRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!num(r['rank']) || !num(r['total']) || !num(r['topPct']) || !num(r['participants'])) return null
  if (typeof r['endpoint'] !== 'string' || !num(r['updatedAt'])) return null
  return {
    rank: r['rank'],
    total: r['total'],
    topPct: r['topPct'],
    participants: r['participants'],
    endpoint: r['endpoint'],
    updatedAt: r['updatedAt'],
    windowStart: optStr(r['windowStart']),
    windowEnd: optStr(r['windowEnd']),
  }
}

/** 记录 → 卡片形状（离线快照与客户端 decode 共用同一映射，卡片 UI 零改动）。 */
export function cardGlobalFromRecord(rec: GlobalRankRecord | null | undefined): CardGlobal | null {
  if (rec === null || rec === undefined) return null
  const parsed = parseGlobalRecord(rec as unknown)
  if (parsed === null) return null
  return {
    rank: parsed.rank,
    topPct: parsed.topPct,
    race7d: parsed.total,
    participants: parsed.participants,
    updatedAt: parsed.updatedAt,
  }
}

/** View race 链接：从 endpoint 派生 origin（self-host 支持）；任何异常回退官方主站。 */
export function raceUrlFromEndpoint(endpoint: string | undefined): string {
  try {
    if (!endpoint) return 'https://madrank.ai/race'
    return new URL(endpoint).origin + '/race'
  } catch {
    return 'https://madrank.ai/race'
  }
}

/** endpoint 同源判定（换端点后旧记录不注入，避免 A 站排名出现在 B 站卡片）。 */
export function sameOrigin(a: string | undefined, b: string | undefined): boolean {
  try {
    if (!a || !b) return false
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}
