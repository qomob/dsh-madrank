/**
 * whoami.ts — 节点自识别(分享链路的宿主半侧)。
 *
 * POST /api/usage/whoami { anonId: 原始安装 ID } → { shareToken, maskAnon }。
 * shareToken = 服务端加盐哈希后的节点 id(u+16hex):只寻址本节点在
 * 公开榜上的数据,不是凭证。原始安装 UUID 依然只出现在请求体里
 * (与 ingest 同一暴露面:仅发往用户配置的 endpoint)。
 */
export const SHARE_TOKEN_RE = /^u[0-9a-f]{16}$/;
export function whoamiUrlFrom(endpoint) {
    return endpoint.replace(/\/api\/usage\/ingest\/?$/, '/api/usage/whoami');
}
/**
 * 换取分享令牌;失败返回 null(调用方静默 —— 分享按钮只是不出现,
 * 绝不影响同步主链路)。形状不符同样 null(防错端点)。
 */
export async function fetchShareToken(endpoint, anonId, fetchImpl) {
    try {
        const res = await fetchImpl(whoamiUrlFrom(endpoint), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ anonId }),
        });
        if (!res.ok)
            return null;
        const body = (await res.json());
        return typeof body.shareToken === 'string' && SHARE_TOKEN_RE.test(body.shareToken)
            ? body.shareToken
            : null;
    }
    catch {
        return null;
    }
}
/** 兼容 ingest endpoint 或 share URL:一律取其 origin。 */
export function meUrlFrom(endpointOrOrigin, token) {
    try {
        return new URL(endpointOrOrigin).origin + '/api/usage/me?t=' + token;
    }
    catch {
        return 'https://madrank.ai/api/usage/me?t=' + token;
    }
}
/**
 * 拉取服务器权威 race(修复缓存陈旧:插件 global 曾停 2.54M 而服务器已是 4.35M)。
 * 失败/形状不符 → null,调用方静默回退本地缓存。绝不影响同步主链路。
 */
export async function fetchRaceMe(endpointOrOrigin, token, fetchImpl) {
    try {
        const res = await fetchImpl(meUrlFrom(endpointOrOrigin, token));
        if (!res.ok)
            return null;
        const b = (await res.json());
        if (typeof b.participants !== 'number')
            return null;
        const me = b.me;
        if (me !== null) {
            const nums = [me.rank, me.total, me.topPct];
            if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v)))
                return null;
        }
        return {
            participants: b.participants,
            windowStart: typeof b.windowStart === 'string' ? b.windowStart : undefined,
            windowEnd: typeof b.windowEnd === 'string' ? b.windowEnd : undefined,
            topModel: typeof b.topModel === 'string' ? b.topModel : undefined,
            me: me === null ? null : {
                rank: me.rank,
                total: me.total,
                topPct: me.topPct,
            },
        };
    }
    catch {
        return null;
    }
}
