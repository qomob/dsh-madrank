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
import { deleteRemoteData, syncPendingDays } from "./sync.js";
import { cardGlobalFromRecord, recordFromRace } from "./global-rank.js";
import { readGlobalRank, writeGlobalRank } from "./global-rank-file.js";
import { readLastRemoteDeleteRequest, writeLastRemoteDeleteRequest } from "./remote-delete.js";
import { adoptShareToken, credentialsOf, saveShareToken, withoutShareToken } from "./share-token.js";
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
// ── 分享令牌托管（credentials 可选；缺席时回退旧明文文件） ──────
let credentialsService;
// ── 分享令牌懒换(whoami;节流:每进程每小时至多一次) ──────────
let whoamiInFlight = false;
let whoamiLastAttempt = 0;
async function ensureShareToken(endpoint) {
    if (storeHolder.shareToken !== undefined)
        return;
    if (whoamiInFlight || Date.now() - whoamiLastAttempt < 3_600_000)
        return;
    whoamiInFlight = true;
    whoamiLastAttempt = Date.now();
    try {
        const token = await fetchShareToken(endpoint, getAnonId(), globalThis.fetch.bind(globalThis));
        if (!token)
            return;
        storeHolder.shareToken = token;
        if (credentialsService !== undefined) {
            const saved = await saveShareToken(credentialsService, token);
            debugLog(dataDir(), `share token saved to credentials=${saved}`);
        }
        if (storeHolder.globalRank !== null) {
            const next = { ...storeHolder.globalRank, shareToken: token };
            setGlobalRank(next);
            persistGlobalRank(next);
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
    const token = storeHolder.shareToken;
    if (!rec || token === undefined)
        return;
    if (Date.now() - lastRaceRefresh < 15 * 60_000)
        return;
    lastRaceRefresh = Date.now();
    try {
        const v = await fetchRaceMe(endpoint, token, globalThis.fetch.bind(globalThis));
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
        if (!unchanged)
            persistGlobalRank(next);
    }
    catch { /* 静默 */ }
}
// ── 插件主体 ────────────────────────────────────────────────
const storeHolder = {
    globalRank: null,
    globalView: null,
    shareToken: undefined,
};
/** 统一更新排名镜像 + 客户端投影引用（同源同引用）。 */
function setGlobalRank(rec) {
    const prev = storeHolder.globalRank;
    if (rec?.shareToken !== undefined)
        storeHolder.shareToken = rec.shareToken;
    storeHolder.globalRank = rec;
    const base = rec === null ? null : cardGlobalFromRecord(rec);
    // 投影必须带 token（分享 URL / 刷新需要），但持久化记录可能已脱敏。
    storeHolder.globalView = base !== null && storeHolder.shareToken !== undefined
        ? { ...base, shareToken: storeHolder.shareToken }
        : base;
    if (rec?.rank !== prev?.rank || rec?.total !== prev?.total || rec?.shareToken !== prev?.shareToken) {
        debugLog(dataDir(), `rank mirror updated rank=${rec?.rank ?? 'none'} total=${rec?.total ?? 0}`);
    }
}
/** 持久化排名记录：credentials 可用时去明文；否则保持旧行为（fallback）。 */
function persistGlobalRank(rec) {
    if (rec === null)
        return;
    const safe = credentialsService !== undefined ? withoutShareToken(rec) : rec;
    try {
        writeGlobalRank(dataDir(), safe);
    }
    catch { /* 尽力而为 */ }
}
/** 写给 card-snapshot 的 global：无论凭据是否可用都不落 token（快照是调试/兼容文件）。 */
function persistableCardGlobal() {
    return cardGlobalFromRecord(withoutShareToken(storeHolder.globalRank));
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
    // view 缓存：framework 只在 state 引用变化时调用 view；这里再按 (state, global) 复用同一
    // 引用，避免同样的数据因 global 重新包装而重复发布。排名镜像变化才换引用。
    let lastState = null;
    let lastGlobal = null;
    let lastView = null;
    const view = (state) => {
        const global = storeHolder.globalView;
        if (state === lastState && global === lastGlobal)
            return lastView;
        lastState = state;
        lastGlobal = global;
        lastView = { ...buildView(state), global };
        return lastView;
    };
    return {
        key: PROJECTION_KEY,
        stateSchema: stateSchema,
        init: () => initState(),
        apply: ((state, event) => applyEvent(state, event)),
        wire: {
            viewSchema: viewSchema,
            // wire.summary 保持默认 true：客户端当前只能经 session 列表的 projectionValues 读取
            // （slot 标准 props 只提供 useSessions）；关闭 summary 会切断唯一读通道，
            // 若要改成按需 snapshot 读面，届时再切 false。
            view: view,
        },
        stateVersion: STATE_VERSION,
    };
}
export function apply(ctx, config) {
    debugLog(dataDir(), `apply v0.6.0 config=${JSON.stringify(readSettings(config))}`);
    const log = ctx.logger ?? {
        info: (m) => console.info('[madrank]', m),
        warn: (m, ...rest) => console.warn('[madrank]', m, ...rest),
        error: (m, ...rest) => console.error('[madrank]', m, ...rest),
    };
    // 投影缝获取：直取（大多数 boot 时序下可用）→ 缺席时降级 ctx.inject 等待。
    const registry = ctx
        .sessionProjections;
    if (registry && typeof registry.register === 'function') {
        // 0.2.x 契约：register 是异步的，必须 await 后才发布消费者（onChanged / timer / 落盘）。
        void start(registry, ctx, log, config).catch((e) => {
            log.error('start failed — host half partially applied', e);
        });
        return;
    }
    if (typeof ctx.inject === 'function') {
        ctx.inject(['sessionProjections'], (sctx) => {
            const reg = sctx
                ?.sessionProjections;
            if (reg && typeof reg.register === 'function') {
                void start(reg, ctx, log, config).catch((e) => {
                    log.error('start failed after inject — host half partially applied', e);
                });
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
function isThenable(value) {
    return typeof value?.then === 'function';
}
/**
 * 适配两种 register 契约并返回**真正的释放函数**：
 * - 0.2.x：返回可调用 thenable → await 得到 `ProjectionHandle`，释放走 `handle.dispose()`；
 * - 0.1.x：返回 disposer 函数 → 直接使用。
 * 注册失败（Promise reject）会向上抛，由调用方按“宿主半边未就绪”记录，不再静默。
 */
async function adoptRegistration(registry, definition, log) {
    const result = registry.register(definition);
    if (isThenable(result)) {
        const handle = (await result);
        if (handle && typeof handle.dispose === 'function') {
            return () => handle.dispose();
        }
        if (typeof handle === 'function')
            return handle;
        log.warn('projection registration resolved without a handle; cleanup is a no-op');
        return () => undefined;
    }
    if (typeof result === 'function')
        return result;
    if (result && typeof result.dispose === 'function') {
        return () => result.dispose();
    }
    log.warn('projection registration returned no handle; cleanup is a no-op');
    return () => undefined;
}
async function start(registry, ctx, log, config) {
    const initialSettings = readSettings(config);
    const store = new UsageStore(dataDir(), STATE_VERSION, 'usage-store.json', initialSettings.clearedAt);
    let lastClearedAt = initialSettings.clearedAt;
    // 冷启动就按清除点裁剪一次，并落盘（旧历史不再保留）
    if (initialSettings.clearedAt > 0) {
        try {
            store.flush();
        }
        catch { /* best effort */ }
    }
    storeHolder.store = store;
    // 卸载钩子先挂上：await 注册期间若插件被卸载，已创建的资源仍会被回收。
    const disposers = [];
    const onDispose = ctx.on;
    if (typeof onDispose === 'function') {
        onDispose.call(ctx, 'dispose', () => {
            for (const dispose of disposers.splice(0)) {
                try {
                    void Promise.resolve(dispose()).catch(() => undefined);
                }
                catch { /* ignore */ }
            }
            try {
                store.flush();
            }
            catch { /* ignore */ }
        });
    }
    // 排名记录是跨进程持久化的（上次同步的采集结果）——启动即载入内存镜像
    setGlobalRank(readGlobalRank(dataDir()));
    // shareToken 归属：优先 credentials；旧文件明文自动迁移并脱敏。
    credentialsService = credentialsOf(ctx);
    const adopted = await adoptShareToken({
        credentials: credentialsService,
        legacy: storeHolder.globalRank,
        persist: (record) => { if (record !== null)
            writeGlobalRank(dataDir(), record); },
        log: (message) => debugLog(dataDir(), message),
    });
    if (adopted.token !== undefined) {
        storeHolder.shareToken = adopted.token;
        if (storeHolder.globalRank !== null)
            setGlobalRank(storeHolder.globalRank);
    }
    if (adopted.migrated)
        debugLog(dataDir(), 'share token migration: plaintext → credentials');
    if (adopted.fallbackPlaintext) {
        log.warn('credentials service unavailable — share token remains plaintext in global-rank.json');
    }
    debugLog(dataDir(), `share token source=${credentialsService === undefined ? 'file-fallback' : adopted.migrated ? 'migrated' : adopted.token !== undefined ? 'credentials' : 'none'}`);
    // 1) 注册 madrankUsage 单元（framework 拥有订阅与驱动，我们只交数学）。
    const definition = buildDefinition();
    const disposeRegister = await adoptRegistration(registry, definition, log);
    disposers.push(disposeRegister);
    // 排名镜像 → 客户端可见投影（独立 key；view 读缓存引用）
    let rankViewCalls = 0;
    const rankDefinition = buildRankDefinition(() => {
        rankViewCalls += 1;
        if (rankViewCalls === 1) {
            debugLog(dataDir(), `rank projection view first call -> ${storeHolder.globalView ? '#' + storeHolder.globalView.rank : 'null'}`);
        }
        return storeHolder.globalView;
    });
    const disposeRankRegister = await adoptRegistration(registry, rankDefinition, log);
    disposers.push(disposeRankRegister);
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
                writeFileSync(join(dataDir(), 'card-snapshot.json'), JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), persistableCardGlobal())));
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
    disposers.push(disposeListener);
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
    let lastRemoteDeleteRequest = readLastRemoteDeleteRequest(dataDir());
    /** 把远端删除结果写回 volatile Config（并清空命令字段）；configEditor 缺席时仅记录日志。 */
    const persistRemoteDeleteResult = async (ok) => {
        const get = ctx.get;
        const service = (typeof get === 'function' ? get.call(ctx, 'configEditor') : undefined);
        const entry = ctx.fiber?.entry;
        if (typeof service?.edit !== 'function' || entry === undefined) {
            log.warn('configEditor unavailable — remote delete result not persisted');
            return;
        }
        try {
            await service.edit(entry, (current) => ({
                ...current,
                remoteDeleteRequest: '',
                remoteDeleteResult: JSON.stringify({ at: Date.now(), ok }),
            }));
        }
        catch (e) {
            log.warn('persist remote delete result failed', String(e));
        }
    };
    const tick = () => {
        const s = readSettings(config);
        debugLog(dataDir(), `tick enabled=${s.enabled} autoSync=${s.autoSync} endpoint=${s.endpoint} rank=${storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'none'} clearedAt=${s.clearedAt}`);
        // 本地数据清除（设置页写 clearedAt）：裁剪已存历史并立即落盘/刷新快照。
        // 远端删除命令：由设置页写入时间戳；消费一次，结果写回 Config。
        if (s.remoteDeleteRequest !== '' && s.remoteDeleteRequest !== lastRemoteDeleteRequest) {
            lastRemoteDeleteRequest = s.remoteDeleteRequest;
            writeLastRemoteDeleteRequest(dataDir(), lastRemoteDeleteRequest);
            debugLog(dataDir(), `remote delete requested at=${lastRemoteDeleteRequest}`);
            void deleteRemoteData(s.endpoint, getAnonId, globalThis.fetch.bind(globalThis))
                .then(async (ok) => {
                if (ok) {
                    try {
                        store.clearUploadedDays();
                    }
                    catch { /* ignore */ }
                }
                debugLog(dataDir(), `remote delete result ok=${ok}`);
                await persistRemoteDeleteResult(ok);
            })
                .catch(async (e) => {
                debugLog(dataDir(), `remote delete failed ${String(e)}`);
                await persistRemoteDeleteResult(false);
            });
        }
        if (s.clearedAt !== lastClearedAt) {
            lastClearedAt = s.clearedAt;
            try {
                store.setClearedAt(s.clearedAt);
                store.flush();
                writeFileSync(join(dataDir(), 'card-snapshot.json'), JSON.stringify(buildCardSnapshot(store, getAnonId, Date.now(), persistableCardGlobal())));
                debugLog(dataDir(), `clearedAt applied=${s.clearedAt}`);
            }
            catch (e) {
                log.warn('clear local stats failed', String(e));
            }
        }
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
            if (storeHolder.shareToken !== undefined)
                rec.shareToken = storeHolder.shareToken;
            if (prev !== null
                && prev.rank === rec.rank && prev.total === rec.total
                && prev.participants === rec.participants && prev.endpoint === rec.endpoint) {
                return;
            }
            setGlobalRank(rec);
            persistGlobalRank(rec);
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
    disposers.push(disposeTick);
    log.info('host half applied — projection on, sync tick 60s, global mirror ' + (storeHolder.globalRank ? '#' + storeHolder.globalRank.rank : 'empty'));
}
