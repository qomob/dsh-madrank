/** 诊断日志（~/.madrank/usage/debug.log）：排查宿主落盘/同步链路用，运行时开销极小。 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
/** 单文件上限：超过即轮转为 debug.log.1（只保留一份历史，避免无限膨胀）。 */
const MAX_BYTES = 2 * 1024 * 1024;
export function debugLog(dir, line) {
    try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, 'debug.log');
        try {
            if (statSync(file).size >= MAX_BYTES)
                renameSync(file, join(dir, 'debug.log.1'));
        }
        catch {
            // 文件不存在/无权限：继续按普通 append 处理
        }
        appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    }
    catch { /* diagnostics must never break the plugin */ }
}
