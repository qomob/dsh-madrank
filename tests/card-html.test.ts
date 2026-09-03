import { describe, it, expect } from 'vitest'
import { renderCardHtml } from '../src/client/card-html.ts'
import type { CardSnapshot } from '../src/client/card-html.ts'

/** v0.1 冻结形态：Local（状态 A）+ Joined（状态 B）+ review 四项修订。 */
const base: CardSnapshot = {
  ymd: '2026-08-27',
  today: {
    primaryTokens: 1_600_000,
    inputTokens: 1_350_000,
    outputTokens: 248_000,
    cachedTokens: 23_010_000,
    requests: 194,
    activeSeconds: 3_120,
    vs7dAvgMultiple: 0.4,
  },
  topModels: [
    { provider: 'zhipu', model: 'glm-5.3-flash', primaryTokens: 1_600_000, sharePct: 100 },
  ],
  streakDays: 2,
  last7Days: [{ ymd: '2026-08-27', primaryTokens: 1_600_000 }],
  global: null,
  anonIdSuffix: 'abcd',
  generatedAt: Date.UTC(2026, 7, 27, 7, 2),
}

describe('renderCardHtml · 状态 A（Local only）', () => {
  it('pill=Local only；Join CTA 在；footer=Updated HH:MM UTC（不再重复隐私话术）', () => {
    const html = renderCardHtml(base, false)
    expect(html).toContain('Local only')
    expect(html).toContain('data-madrank-join')
    expect(html).toContain('Updated 07:02 UTC')
    expect(html).not.toContain('private by default')
    // 方案 2：off=空心点 / on=实心绿（开关语法；默认渲染不内联 CSS，单独取样式版断言）
    const styled = renderCardHtml(base, false, { style: true })
    expect(styled).toContain('.mk-tag[data-on=false] .mk-dot{background:transparent')
    expect(styled).toContain('.mk-tag[data-on=true] .mk-dot{background:var(--dsw-alias-state-success-primary)}')
  })

  it('MOST USED 标题不带计数数字（排名语义由百分比+进度条表达）', () => {
    const html = renderCardHtml(base, false)
    expect(html).toContain('<b>Most used</b></div>')
    expect(html).not.toMatch(/Most used<\/b><span>/)
  })

  it('cached 单列 N cached ⓘ，hover/focus 口径说明；primary 数字不含 cache', () => {
    const html = renderCardHtml(base, false)
    expect(html).toContain('data-tip="Cached tokens are shown separately and are not included in your primary usage score."')
    expect(html).not.toMatch(/\+\s*23\.01M cached/) // 老的 "+N cached" 形态退场
    expect(html).toContain('23.01M cached<i')
  })
})

describe('renderCardHtml · View race 链接（self-host 派生）', () => {
  const joined = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000 } }
  it('opts.raceUrl 派生 self-host 链接；缺省回退官方主站', () => {
    expect(renderCardHtml(joined, true, { raceUrl: 'http://127.0.0.1:3000/race' }))
      .toContain('href="http://127.0.0.1:3000/race"')
    expect(renderCardHtml(joined, true)).toContain('href="https://madrank.ai/race"')
  })
  it('Local 态（状态 A）不渲染 View race 链接', () => {
    const html = renderCardHtml(base, false, { style: false, raceUrl: 'http://x/race' })
    expect(html).not.toContain('<a class="mk-race"')
    expect(html).not.toContain('http://x/race')
  })
})

describe('renderCardHtml · 状态 B（Joined）', () => {
  const joined = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000 } }

  it('pill=Global ranking on；底部 Your global rank 块：#1,284 / TOP 7.4% / Ranked · 7-day uncached 8.21M', () => {
    const html = renderCardHtml(joined, true)
    expect(html).toContain('Global ranking on')
    expect(html).toContain('Your global rank')
    expect(html).toContain('#1,284')
    expect(html).toContain('TOP 7.4%')
    expect(html).toContain('Ranked · 7-day uncached')
    expect(html).toContain('8.21M')
  })

  it('大 CTA 退场：无 Join 按钮；View race 链接 + 轻量 Leave（保留 data-madrank-disable 接线）', () => {
    const html = renderCardHtml(joined, true)
    expect(html).not.toContain('data-madrank-join')
    expect(html).toContain('View race')
    expect(html).toContain('href="https://madrank.ai/race"')
    expect(html).toContain('data-madrank-disable')
  })

  it('Utility 恒在 Gamification 之上：TODAY 段先于 Your global rank', () => {
    const html = renderCardHtml(joined, true)
    expect(html.indexOf('UNCACHED TOKENS')).toBeLessThan(html.indexOf('Your global rank'))
  })

  it('Joined 但排名未出：诚实空态，不出假排名', () => {
    const html = renderCardHtml(base, true)
    expect(html).toContain('Global ranking on')
    expect(html).toContain('daily sync')
    expect(html).not.toMatch(/#\d/)
    expect(html).toContain('data-madrank-disable')
  })

  it('lg 模态变体：同一状态结构，无 .mk-cols 中段双栏残留', () => {
    const html = renderCardHtml(joined, true, { size: 'lg' })
    expect(html).toContain('madrank-card-lg')
    expect(html).not.toContain('mk-cols')
    expect(html).toContain('#1,284')
  })
})

describe('renderCardHtml · 语言跟随宿主（zh / 回退）', () => {
  const joined = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000 } }

  it('zh 状态 A：pill/CTA/footer/hero/分区标题/星期 全部中文', () => {
    const html = renderCardHtml(base, false, { locale: 'zh-CN' })
    expect(html).toContain('仅本地')
    expect(html).toContain('加入全球排名')
    expect(html).toContain('更新于 07:02 UTC')
    expect(html).toContain('今日 · 未缓存 Token')
    expect(html).toContain('常用模型')
    expect(html).toContain('最近 7 天')
    expect(html).toContain('连续 2 天')
    expect(html).toContain('缓存 Token 单独展示')
    // P0：列头=具体日期（UTC MM-DD）；hover 保留完整日期+星期
    expect(html).toContain('>08-27</div>')
    expect(html).toContain('title="2026-08-27 周四')
    expect(html).not.toContain('Local only')
    expect(html).not.toContain('Join global ranking')
    expect(html).not.toContain('Most used')
  })

  it('zh 状态 B：Your global rank 块中文；退出/查看排名赛；无英文残留', () => {
    const html = renderCardHtml(joined, true, { locale: 'zh' })
    expect(html).toContain('全球排名已开启')
    expect(html).toContain('你的全球排名')
    expect(html).toContain('#1,284')
    expect(html).toContain('前 7.4%')
    expect(html).toContain('计入全球排名 · 7 日未缓存')
    expect(html).toContain('查看排名赛')
    expect(html).toContain('>退出</button>')
    expect(html).toContain('href="https://madrank.ai/race"')
    expect(html).toContain('<b>你的全球排名</b>')
    expect(html).not.toContain('<b>Your global rank</b>')
    expect(html).not.toContain('>View race <')
    expect(html).not.toContain('>TOP 7.4%<')
  })

  it('zh 措辞：requests/active/segment 模板', () => {
    const html = renderCardHtml(base, false, { locale: 'zh-CN' })
    expect(html).toContain('194</b> 次请求')
    expect(html).toContain('活跃 <b>52分钟</b>')
    expect(html).toContain('输入 1.35M · 输出 248.0K · ')
    expect(html).toContain('缓存 23.01M<i')
  })

  it('zh Joined 未出排名：诚实空态中文', () => {
    const html = renderCardHtml(base, true, { locale: 'zh-CN' })
    expect(html).toContain('已加入')
    expect(html).toContain('首次匿名同步')
    expect(html).not.toMatch(/#\d/)
  })

  it('未知语言回退 en（官方 FALLBACK_LOCALE 语义）', () => {
    const html = renderCardHtml(base, false, { locale: 'fr-FR' })
    expect(html).toContain('Local only')
    expect(html).not.toContain('仅本地')
  })
})

describe('renderCardHtml · #1/1 信任修补（GAP-D：唯一参与者不显示 TOP 100%）', () => {
  const sole = { ...base, global: { rank: 1, topPct: 100, race7d: 472_942, participants: 1 } }

  it('participants=1：不出现 TOP 100%，改显 Only participant + 排名 #1', () => {
    const html = renderCardHtml(sole, true)
    expect(html).not.toContain('TOP 100')
    expect(html).toContain('#1')
    expect(html).toContain('Only participant')
  })

  it('participants=1 zh：当前唯一参与者，无「前 100」', () => {
    const html = renderCardHtml(sole, true, { locale: 'zh' })
    expect(html).not.toContain('前 100')
    expect(html).toContain('当前唯一参与者')
  })

  it('participants>1：正常 TOP x%，不触发唯一参与者文案', () => {
    const multi = { ...base, global: { rank: 2, topPct: 33.3, race7d: 5_000_000, participants: 3 } }
    const html = renderCardHtml(multi, true)
    expect(html).toContain('TOP 33.3%')
    expect(html).not.toContain('Only participant')
  })

  it('participants 缺席（旧快照/坏 wire）：按多人口径渲染 TOP x%', () => {
    const legacy = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000 } }
    const html = renderCardHtml(legacy, true)
    expect(html).toContain('TOP 7.4%')
    expect(html).not.toContain('Only participant')
  })
})

describe('renderCardHtml · 范围切换（7D/30D/单日）', () => {
  // 60 天真实结构：今天(2026-08-27) 1.6M，每周四 900K，其余为空（诚实零值）
  const end = Date.parse('2026-08-27T00:00:00Z')
  const HIST = Array.from({ length: 60 }, (_, i) => {
    const ymd = new Date(end - (59 - i) * 86_400_000).toISOString().slice(0, 10)
    const v = i === 59 ? 1_600_000 : i % 7 === 3 ? 900_000 : 0
    return {
      ymd,
      primaryTokens: v,
      cachedTokens: v * 10,
      requests: v > 0 ? 100 : 0,
      activeSeconds: v > 0 ? 1800 : 0,
      inputTokens: Math.round(v * 0.8),
      outputTokens: v - Math.round(v * 0.8),
      topModels: v > 0 ? [{ provider: 'zhipu', model: 'glm-5.3-flash', primaryTokens: v, sharePct: 100 }] : [],
    }
  })
  const withHistory = { ...base, ymd: '2026-08-27', history: HIST }

  it('有 history 才出分段控件；v1 快照（无 history）不出现', () => {
    expect(renderCardHtml(withHistory, false)).toContain('data-madrank-range')
    expect(renderCardHtml(base, false)).not.toContain('data-madrank-range')
  })

  it('7D：列头=MM-DD，柱可点进入单日（data-madrank-day + title 完整日期）', () => {
    const html = renderCardHtml(withHistory, false)
    expect(html).toContain('>08-27</div>')
    expect(html).toContain('data-madrank-day="2026-08-27"')
    expect(html).toContain('title="2026-08-27')
  })

  it('30D：密排 30 柱（data-cols=30）、隐藏柱内数值、每周刻度', () => {
    const html = renderCardHtml(withHistory, false, { range: '30d' })
    expect(html).toContain('data-cols="30"')
    expect(html).toContain('<div class="mk-hval"></div>')
    expect(html).not.toContain('mk-hval">1.60M')
    expect(html).toContain('Last 30 days')
  })

  it('单日：日期标题 + 明细分段 + 模型份额；选中段 aria-pressed=true', () => {
    const html = renderCardHtml(withHistory, false, { range: 'day', selectedYmd: '2026-08-27' })
    expect(html).toContain('· 2026-08-27')
    expect(html).toContain('1.60M')
    expect(html).toContain('glm-5.3-flash')
    expect(html).toContain('data-madrank-range="day" aria-pressed="true"')
  })

  it('单日缺省选中=今天（无 selectedYmd 时回退 snap.ymd）', () => {
    const html = renderCardHtml(withHistory, false, { range: 'day' })
    expect(html).toContain('· 2026-08-27')
    expect(html).toContain('1.60M')
  })

  it('zh 分段文案（7天/30天/单日）', () => {
    const html = renderCardHtml(withHistory, false, { locale: 'zh-CN' })
    expect(html).toContain('>7天</button>')
    expect(html).toContain('>30天</button>')
    expect(html).toContain('>单日</button>')
  })

  it('LG 模态：单日视图同样可用', () => {
    const html = renderCardHtml(withHistory, true, { size: 'lg', range: 'day', selectedYmd: '2026-08-27' })
    expect(html).toContain('madrank-card-lg')
    expect(html).toContain('mk-daysize')
  })
})
