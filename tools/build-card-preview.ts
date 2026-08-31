/**
 * build-card-preview.ts — 用本地 card-snapshot.json 渲染 Settings 卡片
 * 预览页（与客户端半侧共用 renderCardHtml，同一 markup 源）。
 *
 * 用法：npm run preview -- [card-snapshot.json] [out.html]
 * 数据真实：文件由插件 flush 时写出；不是假数。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renderCardHtml } from '../src/client/index.ts'
import type { CardSnapshot } from '../src/client/index.ts'
import { UsageStore } from '../src/store.ts'
import { dayDetail, HISTORY_WINDOW_DAYS, lastNDays, topModels } from '../src/stats.ts'

function main(): void {
  const snapPath = process.argv[2] ?? (process.env.HOME ?? '') + '/.madrank/usage/card-snapshot.json'
  const outPath = process.argv[3] ?? '../.spike/madrank-card-preview.html'

  const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as CardSnapshot & { schema?: string }
  if (snap.schema !== undefined && snap.schema !== 'madrank.card-snapshot') {
    console.error('not a madrank card snapshot:', snapPath)
    process.exit(2)
  }

  // 真实历史：优先由本机 usage-store 构建（与宿主同一聚合口径，非假数，窗口对齐 snapshot 的 ymd）；
  // store 不在（CI/他人机器）→ 用 snapshot 自带 history；再退化 last7Days（明细为零，仅柱状）。
  const refNow = snap.ymd !== undefined ? Date.parse(snap.ymd + 'T12:00:00Z') : Date.now()
  const storeDir = dirname(snapPath)
  let history: NonNullable<CardSnapshot['history']>
  if (existsSync(join(storeDir, 'usage-store.json'))) {
    const agg = new UsageStore(storeDir).aggregateDays()
    history = lastNDays(agg, refNow, HISTORY_WINDOW_DAYS).map((d) => {
      const det = dayDetail(agg, d.ymd)
      return { ...det, topModels: topModels(agg, d.ymd) }
    })
  } else if (Array.isArray(snap.history) && snap.history.length > 0) {
    history = snap.history
  } else {
    history = (snap.last7Days ?? []).map((d) => ({
      ymd: d.ymd, primaryTokens: d.primaryTokens, cachedTokens: 0, requests: 0, activeSeconds: 0,
    }))
  }
  const view: CardSnapshot = { ...snap, history }
  const lastActive = [...history].reverse().find((d) => d.primaryTokens > 0)?.ymd

  // 预览：EN / ZH 两行 × 四状态（双语对照，同一 markup 源）。
  //   SYNC OFF           —— 状态 A（Local only，Join CTA）
  //   SYNC ON · PENDING  —— Joined 但排名未出（诚实空态；真实 snapshot 的 global 恒 null）
  //   JOINED (demo rank) —— 状态 B：demo 排名仅注入预览，非真实数据
  // Node 环境无 document —— 样式必须内联进预览页
  const demoGlobal = { rank: 1284, topPct: 7.4, race7d: 8_210_000 }
  const langs: Array<{ id: 'en' | 'zh'; cap: string }> = [{ id: 'en', cap: 'EN' }, { id: 'zh', cap: '中文 (zh)' }]
  const rows = langs.map(({ id, cap }) => {
    const opts = { style: true, locale: id }
    const panes: Array<{ w: number; cap: string; body: string }> = [
      { w: 320, cap: 'SYNC OFF · 7D', body: renderCardHtml(view, false, opts) },
      { w: 320, cap: 'SYNC ON · RANK PENDING', body: renderCardHtml(view, true, opts) },
      { w: 320, cap: 'JOINED · DEMO RANK', body: renderCardHtml({ ...view, global: demoGlobal }, true, opts) },
      { w: 640, cap: 'JOINED · LG MODAL · DEMO RANK',
        body: renderCardHtml({ ...view, global: demoGlobal }, true, { ...opts, size: 'lg' }) },
      { w: 320, cap: '30D VIEW', body: renderCardHtml(view, false, { ...opts, range: '30d' }) },
      { w: 320, cap: 'DAY VIEW' + (lastActive !== undefined ? ' · ' + lastActive : ''),
        body: renderCardHtml(view, false, { ...opts, range: 'day', selectedYmd: lastActive }) },
    ]
    return [
      '<div style="width:100%"><div class="rowcap">LANGUAGE · ' + cap + '</div>',
      '<div style="display:flex;gap:24px;flex-wrap:wrap">',
      panes.map((pn) => '<div style="width:' + pn.w + 'px"><div class="cap">' + pn.cap +
        '</div><div class="card">' + pn.body + '</div></div>').join('\n'),
      '</div></div>',
    ].join('\n')
  })
  const html = [
    '<!doctype html><meta charset="utf-8">',
    '<title>MADRank Usage — Settings Card Preview</title>',
    '<body style="margin:0;background:#101014;color:#e8e8ea;',
    'font:13px/1.55 -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;gap:28px;padding:24px">',
    rows.join('\n'),
    '<style>.cap{color:#888;font-size:10px;letter-spacing:.12em;margin-bottom:6px}',
    '.rowcap{color:#aaa;font-size:12px;font-weight:600;margin-bottom:10px}',
    '.card{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:12px}',
    '.madrank-card h3{margin:0 0 4px}</style>',
    '</body>',
  ].join('\n')

  writeFileSync(outPath, html)
  console.log('preview written:', outPath)
  console.log('snapshot day     :', snap.ymd ?? '(none)')
  console.log('today primary    :', snap.today?.primaryTokens ?? 0, 'tokens ·', snap.today?.requests ?? 0, 'requests')
  console.log('history          :', history.length, 'days · source:', existsSync(join(storeDir, 'usage-store.json')) ? 'usage-store' : Array.isArray(snap.history) ? 'snapshot' : 'last7Days-fallback')
}

main()