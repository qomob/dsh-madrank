/**
 * global-rank-file.ts — 全球排名记录的宿主侧持久化（仅 Host 半侧导入；
 * 浏览器 bundle 门禁禁止宿主模块进入 client 图）。
 *
 * 文件：~/.madrank/usage/global-rank.json。展示数据、尽力而为：
 * 读失败/坏形状一律 null（回到诚实空态），写失败静默（同步永不受影响）。
 */
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseGlobalRecord } from "./global-rank.js";
export function globalRankPath(dir) {
    return join(dir, 'global-rank.json');
}
export function readGlobalRank(dir) {
    try {
        const p = globalRankPath(dir);
        if (!existsSync(p))
            return null;
        return parseGlobalRecord(JSON.parse(readFileSync(p, 'utf8')));
    }
    catch {
        return null;
    }
}
export function writeGlobalRank(dir, rec) {
    try {
        writeFileSync(globalRankPath(dir), JSON.stringify(rec, null, 2));
    }
    catch {
        // 尽力而为：丢一次排名采集只影响点亮时机，不影响任何账目
    }
}
