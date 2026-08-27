/**
 * dsh-log-adapter.ts — 把真实 DSH 会话持久化日志（session.jsonl[.zstd]）
 * 转成 reconcile CLI 的输入 JSONL。
 *
 * 设计原则：
 * - 解码/解析 100% 复用 DSH 自己的实现（zstd 帧 + scanLog + packed rows），
 *   绝不复制持久化语义 —— 只做"抽取与裁剪"。
 * - 隐私裁剪：输出只保留三类事件的必要字段
 *   （request/header 的 provider/model、assistant/* 的 turn/step/usage）。
 *   prompts/responses/tool 参数永远不出适配器。
 *
 * 用法：
 *   npm run adapt -- <session.jsonl.zstd> [out.jsonl]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { scanLog } from '/Users/jonki/deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts'
import { decompressZstdFrame, scanZstdFrames } from '/Users/jonki/deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts'

interface FilteredEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

function decodeLog(path: string): { buffer: Buffer; frames: number; tornTail: boolean } {
  const buf = readFileSync(path)
  const scan = scanZstdFrames(buf)
  const parts: Buffer[] = []
  for (const f of scan.frames) {
    parts.push(zstdDecompressSync(buf.subarray(f.start, f.end)))
  }
  // 帧解码产物按原样拼接（容器是连续字节流，禁止注入换行）
  return {
    buffer: Buffer.concat(parts),
    frames: scan.frames.length,
    tornTail: scan.tornStart !== undefined,
  }
}

function main(): void {
  const src = process.argv[2]
  if (!src) {
    console.error('usage: npm run adapt -- <session.jsonl.zstd> [out.jsonl]')
    process.exit(2)
  }
  const outPath = process.argv[3] ?? '../.spike/real-events.jsonl'

  const { buffer, frames, tornTail } = decodeLog(src)

  const parsed = scanLog(buffer)
  const events = parsed.events

  const histogram = new Map<string, number>()
  for (const e of events) histogram.set(e.type, (histogram.get(e.type) ?? 0) + 1)

  const keep: FilteredEvent[] = []
  for (const e of events) {
    const d = e.data as Record<string, unknown>
    if (e.type === 'request/header') {
      const cfg = (d?.header as { config?: { provider?: string; model?: string } } | undefined)?.config
      keep.push({
        type: e.type, seq: e.seq, time: e.time,
        data: { header: { config: { provider: cfg?.provider, model: cfg?.model } }, reason: null },
      })
    } else if (e.type === 'assistant/chunk') {
      const chunk = d?.chunk as { type?: string; usage?: Record<string, number> } | undefined
      if (chunk?.type === 'usage' && chunk.usage) {
        keep.push({
          type: e.type, seq: e.seq, time: e.time,
          data: { turn: d.turn, step: d.step, chunk: { type: 'usage', usage: chunk.usage } },
        })
      }
    } else if (e.type === 'assistant/message') {
      if (d?.usage) {
        keep.push({
          type: e.type, seq: e.seq, time: e.time,
          data: { turn: d.turn, step: d.step, usage: d.usage },
        })
      }
    }
  }

  writeFileSync(outPath, keep.map(e => JSON.stringify(e)).join('\n') + '\n')

  console.log('source           ' + src)
  console.log('zstd frames      ' + frames + (tornTail ? ' (+torn tail skipped)' : ''))
  console.log('events in log    ' + events.length)
  console.log('kept for fold    ' + keep.length + '  -> ' + outPath)
  console.log('event types      ' + [...histogram.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([t, n]) => t + ':' + n).join('  '))
}

main()