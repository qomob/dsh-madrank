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
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const optStr = (v) => (typeof v === 'string' ? v : undefined);
/** 宽容解析 ingest 响应的 race 段；形状不符一律 null（展示数据缺位不阻断同步）。 */
export function parseIngestRace(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const r = raw;
    if (!num(r['participants']) || r['participants'] < 0)
        return null;
    const participants = r['participants'];
    const me = r['me'];
    if (me === null)
        return { participants, me: null };
    if (typeof me !== 'object')
        return null;
    const m = me;
    if (!num(m['rank']) || !num(m['total']) || !num(m['topPct']))
        return null;
    return {
        participants,
        me: { rank: m['rank'], total: m['total'], topPct: m['topPct'] },
        windowStart: optStr(r['windowStart']),
        windowEnd: optStr(r['windowEnd']),
    };
}
/** race 视图 → 持久化记录；me 缺位（无完整周期）返回 null。 */
export function recordFromRace(race, endpoint, nowMs) {
    if (race.me === null)
        return null;
    return {
        rank: race.me.rank,
        total: race.me.total,
        topPct: race.me.topPct,
        participants: race.participants,
        windowStart: race.windowStart,
        windowEnd: race.windowEnd,
        endpoint,
        updatedAt: nowMs,
    };
}
/** 宽容解析（settings wire 段里的 global；宿主 resolve 注入，非持久化字段）。 */
export function parseGlobalRecord(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const r = raw;
    if (!num(r['rank']) || !num(r['total']) || !num(r['topPct']) || !num(r['participants']))
        return null;
    if (typeof r['endpoint'] !== 'string' || !num(r['updatedAt']))
        return null;
    return {
        rank: r['rank'],
        total: r['total'],
        topPct: r['topPct'],
        participants: r['participants'],
        endpoint: r['endpoint'],
        updatedAt: r['updatedAt'],
        windowStart: optStr(r['windowStart']),
        windowEnd: optStr(r['windowEnd']),
        shareToken: optStr(r['shareToken']),
    };
}
/** 记录 → 卡片形状（离线快照与客户端 decode 共用同一映射，卡片 UI 零改动）。 */
export function cardGlobalFromRecord(rec) {
    if (rec === null || rec === undefined)
        return null;
    const parsed = parseGlobalRecord(rec);
    if (parsed === null)
        return null;
    return {
        rank: parsed.rank,
        topPct: parsed.topPct,
        race7d: parsed.total,
        participants: parsed.participants,
        updatedAt: parsed.updatedAt,
        shareToken: parsed.shareToken,
    };
}
/** View race 链接：从 endpoint 派生 origin（self-host 支持）；任何异常回退官方主站。 */
export function raceUrlFromEndpoint(endpoint) {
    try {
        if (!endpoint)
            return 'https://madrank.ai/race';
        return new URL(endpoint).origin + '/race';
    }
    catch {
        return 'https://madrank.ai/race';
    }
}
/** endpoint 同源判定（换端点后旧记录不注入，避免 A 站排名出现在 B 站卡片）。 */
export function sameOrigin(a, b) {
    try {
        if (!a || !b)
            return false;
        return new URL(a).origin === new URL(b).origin;
    }
    catch {
        return false;
    }
}
