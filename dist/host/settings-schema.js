/**
 * settings-schema.ts — 插件配置（新版 Harness 的 `Config` 约定）。
 *
 * 新版 DSH（0.2.x）不再有「设置命名空间注册」：插件导出 schemastery `Config`，
 * 用户通过 Settings → 插件页编辑其中的 `.volatile()` 字段（写入 profile patch，
 * 运行中热更新，无需重启）。字段读取方式见 readSettings()：
 * volatile 字段解析为冻结引用 `{ get() }`，普通字段保持原值。
 */
import z from '@deepseek-ai/schemastery';
/** Loader entry id（与 cordis.patch.yml 的 insert.id 一致；客户端 configForms 用它取表单）。 */
export const MADRANK_ENTRY_ID = 'madrank';
/** 官方 ingest 端点（服务端做 Community Ranking 校验）。 */
export const INGEST_ENDPOINT_DEFAULT = 'https://madrank.ai/api/usage/ingest';
/** 配置字段（全部 volatile：可在设置页即时修改并热更新）。 */
export const Config = z.object({
    /** 加入全球榜必须显式开启；默认完全离线。 */
    enabled: z.boolean().default(false).volatile()
        .description('参与 MADRank 全球排名（只上传每日聚合，默认关闭）。插件本身的启用/停用请用插件页顶部的开关。'),
    /** MADRank ingest 端点。 */
    endpoint: z.string().default(INGEST_ENDPOINT_DEFAULT).volatile()
        .description('MADRank API 地址，默认官方站点；自建/代理时修改。'),
    /** 自动同步每日聚合（默认 true；enabled=false 时同步轮根本不启动）。 */
    autoSync: z.boolean().default(true).volatile()
        .description('参与排名后，自动同步已结束的 UTC 日聚合数据。'),
    /** 本地数据清除时间戳（ms）：早于该 UTC 日的历史不再显示/不再上传。 */
    clearedAt: z.number().default(0).volatile()
        .description('本地数据清除时间戳；设置后早于该 UTC 日的历史不再显示、也不再上传。'),
    /** 远端删除命令（Host 消费一次；值为触发时间戳，处理后清空）。 */
    remoteDeleteRequest: z.string().default('').volatile()
        .description('内部命令字段：请求删除已上传到 MADRank 的匿名数据（由设置页按钮写入）。'),
    /** 远端删除结果（Host 回写；JSON 字符串 {at, ok}）。 */
    remoteDeleteResult: z.string().default('').volatile()
        .description('内部状态字段：最近一次远端删除的结果（JSON: {at, ok}）。'),
});
function readRef(value, fallback) {
    if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
        try {
            const current = value.get();
            return current === undefined || current === null ? fallback : current;
        }
        catch {
            return fallback;
        }
    }
    return value === undefined || value === null ? fallback : value;
}
/** 从 loader 传入的 config（可能是 volatile 引用或普通对象）读出最新设置。 */
export function readSettings(raw) {
    const cfg = (raw ?? {});
    const enabled = readRef(cfg['enabled'], false);
    return {
        enabled: enabled === true,
        endpoint: readRef(cfg['endpoint'], INGEST_ENDPOINT_DEFAULT),
        autoSync: readRef(cfg['autoSync'], true) !== false,
        clearedAt: Math.max(0, Math.floor(readRef(cfg['clearedAt'], 0))),
        remoteDeleteRequest: readRef(cfg['remoteDeleteRequest'], ''),
        remoteDeleteResult: readRef(cfg['remoteDeleteResult'], ''),
    };
}
