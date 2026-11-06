/**
 * remote-delete.ts — 「删除已上传的 MADRank 数据」的本地状态（Host 半侧）。
 *
 * 命令通道：设置页把 `remoteDeleteRequest` 写成时间戳；Host 消费一次后清空该字段。
 * 本模块只持久化"最后消费过的 request"，保证插件重启不会重复执行同一次删除。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function remoteDeleteStatePath(dir) {
    return join(dir, 'remote-delete.json');
}
export function readLastRemoteDeleteRequest(dir) {
    try {
        const p = remoteDeleteStatePath(dir);
        if (!existsSync(p))
            return '';
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        return typeof raw.request === 'string' ? raw.request : '';
    }
    catch {
        return '';
    }
}
export function writeLastRemoteDeleteRequest(dir, request) {
    try {
        const state = { request, at: Date.now() };
        writeFileSync(remoteDeleteStatePath(dir), JSON.stringify(state, null, 2));
    }
    catch {
        // 尽力而为：只是重启防重放的 sidecar
    }
}
