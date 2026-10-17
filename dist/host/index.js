/**
 * dsh-madrank — MADRank Usage 插件（Host 半侧入口，新版 Harness 插件模型）。
 *
 * 集成方式（bundle 的 cordis.patch.yml 插入行）：
 *   - insert:
 *       - id: madrank
 *         name: '@qomob/dsh-madrank'
 * 入口：dist/host/index.js（编译产物；源码 src/index.ts 仅供开发/类型检查）。
 *
 * 本插件贡献：
 * 1. madrankUsage 投影单元 —— framework 驱动的纯 fold（唯一事件语义源）
 * 2. onChanged → 带去抖的本地持久化（按会话整体替换，见 store.ts）
 * 3. opt-in 日级批量同步循环（绝不实时上传，见 sync.ts）
 * 4. Config：enabled / endpoint / autoSync（volatile，设置页可热更新）
 *
 * 新版契约要点（DSH 0.2.x）：
 * - 插件不再注册设置命名空间；配置由导出的 schemastery `Config` 描述，
 *   用户经 Settings → 插件页编辑 volatile 字段，值写入 profile patch 并热更新。
 * - 投影定义仍是 `{key, stateSchema, init, apply, wire?, stateVersion}`。
 * - 计时优先官方 timer 服务；无缝环境（单测/裸跑）回退全局计时器。
 */
import { z as zod } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PROJECTION_KEY, STATE_VERSION, applyEvent, buildView, initState, } from "./fold.js";
import { buildCardSnapshot } from "./snapshot.js";
import { UsageStore } from "./store.js";
import { syncPendingDays } from "./sync.js";
import { cardGlobalFromRecord, recordFromRace } from "./global-rank.js";
import { readGlobalRank, writeGlobalRank } from "./global-rank-file.js";
import { fetchShareToken, fetchRaceMe } from "./whoami.js";
import { Config, MADRANK_ENTRY_ID, readSettings } from "./settings-schema.js";
import { debugLog } from "./debug-log.js";
import { buildRankDefinition } from "./rank-projection.js";
export { Config };
export const name = 'dsh-madrank';
/** 相对配置的 API 兼容导出（旧版本消费方/工具可能读取）。 */
export const SETTINGS_NS = MADRANK_ENTRY_ID;
/** cordis DI：投影缝 + 官方 timer 服务。
 * ⚠️ 加载器只挂载此处声明过的服务；timer 随 dsh-base 挂载，
 * 读取经 ctx.get('timer')，无缝环境回退全局计时器。 */
export const inject = ['sessionProjections', 'timer'];
// ── 身份与存储 ──────────────────────────────────────────────
/** 匿名安装 ID：本地生成 UUID，服务端加盐哈希后才是 anonId（换机=新身份）。 */
function resolveAnonId() {
    return globalThis.crypto?.randomUUID?.() ?? 'unresolved-installation-id';
}
let cachedId = null;
function getAnonId() {
    cachedId ||= readOrCreateInstallId();
    return cachedId;
}
function dataDir() {
    return process.env.MADRANK_USAGE_DIR
        ?? join(homedir(), '.madrank', 'usage');
}
function installIdPath() {
    return join(dataDir(), 'installation-id');
}
function readOrCreateInstallId() {
    try {
        mkdirSync(dataDir(), { recursive: true });
        if (existsSync(installIdPath())) {
            return readFileSync(installIdPath(), 'utf8').trim();
        }
        const id = resolveAnonId();
        writeFileSync(installIdPath(), id);
        return id;
    }
    catch {
        return resolveAnonId();
    }
}
// ── 分享令牌懒换(whoami;节流:每进程每小时至多一次) ──────────
let whoamiInFlight = false;
let whoamiLastAttempt = 0;
async function ensureShareToken(endpoint) {
    const rec = storeHolder.globalRank;
    if (!rec || rec.shareToken)
        return;
    if (whoamiInFlight || Date.now() - whoamiLastAttempt < 3_600_000)
        return;
    whoamiInFlight = true;
    whoamiLastAttempt = Date.now();
    try {
        const token = await fetchShareToken(endpoint, getAnonId(), globalThis.fetch.bind(globalThis));
        if (token && storeHolder.globalRank) {
            const next = { ...storeHolder.globalRank, shareToken: token };
            setGlobalRank(next);
            try {
                writeGlobalRank(dataDir(), next);
            }
            catch { /* 展示数据,尽力而为 */ }
        }
    }
    finally {
        whoamiInFlight = false;
    }
}
// 服务器权威 race 刷新(15 分钟节流):修复缓存陈旧。失败静默,不影响同步主链路。
let lastRaceRefresh = 0;
async function refreshRaceThrottled(endpoint) {
    const rec = storeHolder.globalRank;
    if (!rec?.shareToken)
        return;
    if (Date.now() - lastRaceRefresh < 15 * 60_000)
        return;
    lastRaceRefresh = Date.now();
    try {
        const v = await fetchRaceMe(endpoint, rec.shareToken, globalThis.fetch.bind(globalThis));
        if (!v?.me)
            return;
        const next = {
            ...rec,
            rank: v.me.rank, total: v.me.total, topPct: v.me.topPct,
            participants: v.participants,
            windowStart: v.windowStart, windowEnd: v.windowEnd,
            updatedAt: Date.now(),
        };
        setGlobalRank(next);
        const unchanged = next.rank === rec.rank && next.total === rec.total && next.participants === rec.participants;
        if (!unchanged) {
            try {
                writeGlobalRank(dataDir(), next);
            }
            catch { /* 尽力而为 */ }
        }
    }
    catch { /* 静默 */ }
}
// ── 插件主体 ────────────────────────────────────────────────
const storeHolder = {
    globalRank: null,
    globalView: null,
};
/** 统一更新排名镜像 + 客户端投影引用（同源同引用）。 */
function setGlobalRank(rec) {
    const prev = storeHolder.globalRank;
    storeHolder.globalRank = rec;
    storeHolder.globalView = rec === null ? null : cardGlobalFromRecord(rec);
    if (rec?.rank !== prev?.rank || rec?.total !== prev?.total || rec?.shareToken !== prev?.shareToken) {
        debugLog(dataDir(), `rank mirror updated rank=${rec?.rank ?? 'none'} total=${rec?.total ?? 0}`);
    }
}
/**
 * 投影定义：官方 ProjectionDefinition 形状（stateSchema 为 zod ZodType +
 * wire 客户端视图）。无 rc.8 遗留字段。stateSchema 校验持久化折叠种子；
 * wire.viewSchema 校验出宿主值 —— 官方类型来自 'zod'。
 */
function buildViewSchema() {
    const daySchema = zod.object({
        models: zod.record(zod.string(), zod.object({
            inputTokens: zod.number().int().nonnegative(),
            outputTokens: zod.number().int().nonnegative(),
            cacheReadTokens: zod.number().int().nonnegative(),
            cacheWriteTokens: zod.number().int().nonnegative(),
            requests: zod.number().int().nonnegative(),
        })),
        activeSeconds: zod.number().int().nonnegative(),
    });
    return zod.object({
        version: zod.literal(STATE_VERSION),
        days: zod.record(zod.string(), daySchema),
        totalRequests: zod.number().int().nonnegative(),
        totalPrimaryTokens: zod.number().int().nonnegative(),
        totalCachedTokens: zod.number().int().nonnegative(),
        // 排名镜像随 usage 视图一起下发（客户端列表已证明可达的通道）
        global: zod.object({
            rank: zod.number(),
            topPct: zod.number(),
            race7d: zod.number(),
            participants: zod.number().optional(),
            updatedAt: zod.number().optional(),
            shareToken: zod.string().optional(),
        }).nullable(),
    });
}
/** 持久化状态（MadrankState）在 seed/restore 前必须通过 stateSchema（zod）。 */
function buildStateSchema() {
    const buckets = zod.object({
        inputTokens: zod.number(),
        outputTokens: zod.number(),
        cacheReadTokens: zod.number(),
        cacheWriteTokens: zod.number(),
        requests: zod.number(),
    });
    return zod.object({
        currentModelKey: zod.string().nullable(),
        days: zod.record(zod.string(), zod.record(zod.string(), buckets)),
        activity: zod.record(zod.string(), zod.array(zod.tuple([zod.number(), zod.number()]))),
        last: zod.object({
            turn: zod.number(),
            step: zod.number(),
            ymd: zod.string(),
            modelKey: zod.string(),
            buckets,
        }).nullable(),
    });
}
function buildDefinition() {
    const viewSchema = buildViewSchema();
    const stateSchema = buildStateSchema();
    return {
        key: PROJECTION_KEY,
        stateSchema: stateSchema,
        init: () => initState(),
        apply: ((state, event) => applyEvent(state, event)),
        wire: {
            viewSchema: viewSchema,
            view: ((state) => ({ ...buildView(state), global: storeHolder.globalView })),
        },
        stateVersion: STATE_VERSION,
    };
}
export function apply(ctx, config) {
    debugLog(dataDir(), `apply v0.5.3 config=${JSON.stringify(readSettings(config))}`);
    const log = ctx.logger ?? {
        info: (m) => console.info('[madrank]', m),
        warn: (m, ...rest) => console.warn('[madrank]', m, ...rest),
        error: (m, ...rest) => console.error('[madrank]', m, ...rest),
    };
    // 投影缝获取：直取（大多数 boot 时序下可用）→ 缺席时降级 ctx.inject 等待。
    const registry = ctx
        .sessionProjections;
    if (registry && typeof registry.register === 'function') {
        try {
            start(registry, ctx, log, config);
        }
        catch (e) {
            log.error('start threw — host half partially applied', e);
            throw e;
        }
        return;
    }
    if (typeof ctx.inject === 'function') {
        ctx.inject(['sessionProjections'], (sctx) => {
            const reg = sctx
                ?.sessionProjections;
            if (reg && typeof reg.register === 'function') {
                start(reg, ctx, log, config);
            }
            else {
                log.warn('sessionProjections service unusable even via inject — plugin idle');
            }
        });
    }
    else {
        // 无缝环境（单元测试 / 工具链裸跑）：功能不可用但绝不让宿主崩溃
        log.warn('sessionProjections seam absent — plugin idle');
    }
}
/** 官方 timer 服务优先；无缝环境（测试/裸跑）回退全局计时器（disposer 同形）。 */
function timerOf(ctx) {
    const get = ctx.get;
    const t = (typeof get === 'function' ? get('timer') : undefined);
    const timer = t ?? ctx.timer;
    if (timer && typeof timer.timeout === 'function' && typeof timer.interval === 'function') {
        return { timeout: (cb, d) => timer.timeout(cb, d), interval: (cb, d) => timer.interval(cb, d) };
    }
    return {
        timeout(cb, delay) {
            const handle = setTimeout(cb, delay);
            handle.unref?.();
            return () => clearTimeout(handle);
        },
        interval(cb, delay) {
            const handle = setInterval(cb, delay);
            handle.unref?.();
            return () => clearInterval(handle);
        },
    };
}
function start(registry, ctx, log, config) {
    const store = new UsageStore(dataDir(), STATE_VERSION);
    storeHolder.store = store;
    // 排名记录是跨进程持久化的（上次同步的采集结果）——启动即载入内存镜像
    setGlobalRank(readGlobalRank(dataDir()));
    // 1) 注册 madrankUsage 单元（framework 拥有订阅与驱动，我们只交数学）。
    const definition = buildDefinition();
    const disposeRegister = registry.register(definition);
    // 排名镜像 → 客户端可见投影（独立 key；view 读缓存引用）
    let rankViewCalls = 0;
    const disposeRankRegister = registry.register(buildRankDefinition(() => {
        rankViewCalls += 1;
        if (rankViewCalls === 1) {
            debugLog(dataDir(), `rank projection view first call -> ${storeHolder.globalView ? '#' + storeHolder.globalView.rank : 'null'}`);
        }
        return storeHolder.globalView;
    }));
    log.info('madrankUsage + madrankRank projections registered');
    debugLog(dataDir(), 'start: projection registered, store loaded');
    // 2) 变更流 → 去抖落盘（节流 2s；只做"整体替换该会话份额"这一件事）
    const timer = timerOf(ctx);
    let pending = false;
    const flushSoon = () => {
        if (pending)
            return;
        pending = true;
        const handle = setTimeout(() => {
            pending = false;
            try {
                store.flush();
                writeFileSync(join(dataDir(), 'card-snapshot.json'), JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), cardGlobalFromRecord(storeHolder.globalRank))));
                debugLog(dataDir(), 'flush ok');
            }
            catch (e) {
                log.warn('flush failed', String(e));
                debugLog(dataDir(), `flush failed ${String(e)}`);
            }
        }, 2000);
        handle.unref?.();
    };
    let changeSeen = 0;
    const disposeListener = registry.onChanged((session, key, value, seq) => {
        changeSeen += 1;
        if (changeSeen === 1 || changeSeen % 25 === 0) {
            debugLog(dataDir(), `onChanged #${changeSeen} key=${String(key)} seq=${String(seq)}`);
        }
        if (key !== PROJECTION_KEY || !value)
            return;
        try {
            store.replaceSession(session.id, seq, value);
            flushSoon();
        }
        catch (e) {
            log.warn('replaceSession failed', String(e));
            debugLog(dataDir(), `replaceSession failed ${String(e)}`);
        }
    });
    // 2b) 会话播种：会话实例创建/恢复时把完整投影视图写进 store。
    // 只靠 onChanged 会漏掉「没有新事件的历史会话」→ 历史日期永远不入 store、
    // 同步漏日（2026-10 实锤：store 停在旧日期）。snapshot() 是官方读面。
    const seedSession = (session) => {
        try {
            const snap = registry.snapshot(session, [PROJECTION_KEY]);
            const view = snap?.values?.[PROJECTION_KEY];
            const id = session?.id;
            if (view === undefined || id === undefined)
                return;
            store.replaceSession(id, snap?.asOfSeq ?? 0, view);
            debugLog(dataDir(), `seed session=${String(id)} asOf=${String(snap?.asOfSeq)}`);
            flushSoon();
        }
        catch (e) {
            debugLog(dataDir(), `seed failed ${String(e)}`);
        }
    };
    const onCreated = ctx.on;
    if (typeof onCreated === 'function') {
        onCreated.call(ctx, 'session/created', seedSession);
    }
    // 3) opt-in 日级批量同步检查（≤1 次/分钟；只碰已结束的 UTC 日）
    //    配置通过 volatile 引用热更新 → 每轮读取最新值。
    const tick = () => {
        const s = readSettings(config);
        debugLog(dataDir(), `tick enabled=${s.enabled} autoSync=${s.autoSync} endpoint=${s.endpoint} rank=${storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'none'}`);
        // 同步轮门控：参与排名（enabled）+ 自动同步（autoSync）双开关，缺一不发。
        if (!s.enabled || s.autoSync === false || !s.endpoint || !storeHolder.store)
            return;
        void ensureShareToken(s.endpoint);
        void refreshRaceThrottled(s.endpoint);
        void syncPendingDays(store, s, getAnonId, globalThis.fetch.bind(globalThis), (race) => {
            // ingest 响应携带按本机 anonId 重算的 7 日名次：持久化 + 内存镜像。
            const rec = recordFromRace(race, s.endpoint, Date.now());
            if (!rec)
                return;
            const prev = storeHolder.globalRank;
            if (prev?.shareToken)
                rec.shareToken = prev.shareToken;
            if (prev !== null
                && prev.rank === rec.rank && prev.total === rec.total
                && prev.participants === rec.participants && prev.endpoint === rec.endpoint) {
                return;
            }
            setGlobalRank(rec);
            try {
                writeGlobalRank(dataDir(), rec);
            }
            catch (e) {
                log.warn('global-rank write failed — keep in-memory mirror', String(e));
            }
            void ensureShareToken(s.endpoint);
        })
            .then((outcomes) => {
            if (outcomes.length > 0) {
                store.flush();
                debugLog(dataDir(), `sync uploaded days=${outcomes.map((o) => JSON.stringify(o)).join(',')}`);
            }
        })
            .catch(() => undefined); // 同步永不影响宿主
    };
    const disposeTick = timer.interval(tick, 60_000);
    log.info('host half applied — projection on, sync tick 60s, global mirror ' + (storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'empty'));
    // 清理：挂宿主生命周期事件；cordis 卸载插件时自动触发
    const onDispose = ctx.on;
    if (typeof onDispose === 'function') {
        onDispose.call(ctx, 'dispose', () => {
            disposeTick();
            disposeListener();
            disposeRankRegister();
            disposeRegister();
            try {
                store.flush();
            }
            catch { /* ignore */ }
        });
    }
}
