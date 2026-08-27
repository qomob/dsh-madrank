/**
 * build-card-preview.ts — 用本地 card-snapshot.json 渲染 Settings 卡片
 * 预览页（与客户端半侧共用 renderCardHtml，同一 markup 源）。
 *
 * 用法：npm run preview -- [card-snapshot.json] [out.html]
 * 数据真实：文件由插件 flush 时写出；不是假数。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { renderCardHtml } from '../src/client/index.ts'
import type { CardSnapshot } from '../src/client/index.ts'

function main(): void {
  const snapPath = process.argv[2] ?? (process.env.HOME ?? '') + '/.madrank/usage/card-snapshot.json'
  const outPath = process.argv[3] ?? '../.spike/madrank-card-preview.html'

  const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as CardSnapshot & { schema?: string }
  if (snap.schema !== undefined && snap.schema !== 'madrank.card-snapshot') {
    console.error('not a madrank card snapshot:', snapPath)
    process.exit(2)
  }

  // 预览两种状态：sync off（本地视角）/ on（占位排名为 null → 不显示全球块）
  // Node 环境无 document —— 样式必须内联进预览页
  const body = renderCardHtml(snap, false, { style: true })
  const bodyOn = renderCardHtml(snap, true, { style: true })
  const html = [
    '<!doctype html><meta charset="utf-8">',
    '<title>MADRank Usage — Settings Card Preview</title>',
    '<body style="margin:0;background:#101014;color:#e8e8ea;',
    'font:13px/1.55 -apple-system,system-ui,sans-serif;display:flex;gap:24px;padding:24px;flex-wrap:wrap">',
    '<div style="width:320px"><div class="cap">SYNC OFF</div><div class="card">' + body + '</div></div>',
    '<div style="width:320px"><div class="cap">SYNC ON</div><div class="card">' + bodyOn + '</div></div>',
    '<style>.cap{color:#888;font-size:10px;letter-spacing:.12em;margin-bottom:6px}',
    '.card{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:12px}',
    '.madrank-card h3{margin:0 0 4px}</style>',
    '</body>',
  ].join('\n')

  writeFileSync(outPath, html)
  console.log('preview written:', outPath)
  console.log('snapshot day     :', snap.ymd ?? '(none)')
  console.log('today primary    :', snap.today?.primaryTokens ?? 0, 'tokens ·', snap.today?.requests ?? 0, 'requests')
}

main()