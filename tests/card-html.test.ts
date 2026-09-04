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

describe('renderCardHtml · 状态 A（Global ranking off）', () => {
  it('pill=真实关闭态；「你的全球排名 + 尚未参与」空态；开启 CTA；footer=Updated（v0.2 交互规范）', () => {
    const html = renderCardHtml(base, false)
    expect(html).toContain('Global ranking off')
    expect(html).toContain('Your global rank')
    expect(html).toContain('data-madrank-not-joined')
    expect(html).toContain('Not participating')
    expect(html).toContain('data-madrank-join')
    expect(html).toContain('Turn on global ranking')
    expect(html).toContain('Updated 07:02 UTC')
    // Quick View 不含配置动作（退出/删除归 Settings → MADRank）
    expect(html).not.toContain('data-madrank-disable')
    expect(html).not.toContain('data-madrank-delete')
    expect(html).not.toContain('private by default')
    // 方案 2：off=空心点 / on=实心绿（开关语法；默认渲染不内联 CSS，单独取样式版断言）
    const styled = renderCardHtml(base, false, { style: true })
    expect(styled).toContain('.mk-tag[data-on=false] .mk-dot{background:transparent')
    expect(styled).toContain('.mk-tag[data-on=true] .mk-dot{background:var(--dsw-alias-state-success-primary)}')
  })

  it('标题=MADRank + 定位副标题（v0.2：卡片=看用量）', () => {
    const html = renderCardHtml(base, false)
    expect(html).toContain('<h3>MADRank</h3>')
    expect(html).toContain('Your AI usage')
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

  it('v0.2：无 Join/Leave/删除按钮 —— 配置动作全部收进 Settings；仅保留 View race 链接', () => {
    const html = renderCardHtml(joined, true)
    expect(html).not.toContain('data-madrank-join')
    expect(html).not.toContain('data-madrank-disable')
    expect(html).not.toContain('data-madrank-delete')
    expect(html).toContain('View race')
    expect(html).toContain('href="https://madrank.ai/race"')
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

  it('zh 状态 A：真实关闭态 pill + 尚未参与 + 开启全球排名；其余全中文', () => {
    const html = renderCardHtml(base, false, { locale: 'zh-CN' })
    expect(html).toContain('全球排名已关闭')
    expect(html).toContain('你的全球排名')
    expect(html).toContain('尚未参与')
    expect(html).toContain('开启全球排名')
    expect(html).toContain('AI 用量与排名')
    expect(html).toContain('更新于 07:02 UTC')
    expect(html).toContain('今日 · 未缓存 Token')
    expect(html).toContain('常用模型')
    expect(html).toContain('最近 7 天')
    expect(html).toContain('连续 2 天')
    expect(html).toContain('缓存 Token 单独展示')
    // P0：列头=具体日期（UTC MM-DD）；hover 保留完整日期+星期
    expect(html).toContain('>08-27</div>')
    expect(html).toContain('title="2026-08-27 周四')
    expect(html).not.toContain('Global ranking off')
    expect(html).not.toContain('Turn on global ranking')
    expect(html).not.toContain('Most used')
  })

  it('zh 状态 B：Your global rank 块中文；无退出/删除按钮（配置归设置）；无英文残留', () => {
    const html = renderCardHtml(joined, true, { locale: 'zh' })
    expect(html).toContain('全球排名已开启')
    expect(html).toContain('你的全球排名')
    expect(html).toContain('#1,284')
    expect(html).toContain('前 7.4%')
    expect(html).toContain('计入全球排名 · 7 日未缓存')
    expect(html).toContain('查看排名赛')
    // v0.2：退出/删除是配置动作，Quick View 不再提供
    expect(html).not.toContain('>退出</button>')
    expect(html).not.toContain('删除已同步数据')
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
    expect(html).toContain('Global ranking off')
    expect(html).not.toContain('全球排名已关闭')
  })
})

describe('renderCardHtml · 来源标注与守卫注脚（信任修补：口径澄清，不泛化）', () => {
  it('今日主数字带「本机 · 实时」来源标注（Local 态亦然）', () => {
    expect(renderCardHtml(base, false)).toContain('LOCAL · LIVE')
    expect(renderCardHtml(base, true)).toContain('LOCAL · LIVE')
    expect(renderCardHtml(base, false, { locale: 'zh-CN' })).toContain('本机 · 实时')
  })

  it('Joined 且 updatedAt 存在：7 日数字带「服务器 · 更新于 X 前」', () => {
    const joined = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000, updatedAt: Date.now() - 12 * 60_000 } }
    const html = renderCardHtml(joined, true)
    expect(html).toContain('SERVER · 12m ago')
    const zh = renderCardHtml(joined, true, { locale: 'zh-CN' })
    expect(zh).toContain('服务器 · 12 分钟前')
  })

  it('Joined 且 updatedAt 缺席：不渲染来源时间（旧镜像兼容）', () => {
    const joined = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000 } }
    expect(renderCardHtml(joined, true)).not.toContain('SERVER ·')
    expect(renderCardHtml(joined, true)).not.toContain('服务器 ·')
  })

  it('守卫注脚：仅当 今日 primary > 服务器 7 日 时出现（窗口/口径澄清）', () => {
    // 正常关系：today(1.6M) < race7d(8.21M) → 无注脚
    const calm = { ...base, global: { rank: 1284, topPct: 7.4, race7d: 8_210_000, updatedAt: Date.now() - 60_000 } }
    const calmEn = renderCardHtml(calm, true, { style: false })
    const calmZh = renderCardHtml(calm, true, { style: false, locale: 'zh-CN' })
    expect(calmEn).not.toContain('The 7-day rank window covers finished UTC days only')
    expect(calmZh).not.toContain('榜单 7 日窗口只统计已结束的 UTC 日')
    // 矛盾关系：today(4.91M) > race7d(4.35M) → 注脚解释窗口不含今天
    const anomaly = { ...base, today: { ...base.today!, primaryTokens: 4_910_000 }, global: { rank: 1284, topPct: 7.4, race7d: 4_350_000 } }
    expect(renderCardHtml(anomaly, true, { style: false })).toContain('The 7-day rank window covers finished UTC days only')
    expect(renderCardHtml(anomaly, true, { style: false, locale: 'zh-CN' })).toContain('榜单 7 日窗口只统计已结束的 UTC 日')
  })

  it('守卫注脚不改变排名数字本身（只澄清口径，不篡改权威值）', () => {
    const anomaly = { ...base, today: { ...base.today!, primaryTokens: 4_910_000 }, global: { rank: 1284, topPct: 7.4, race7d: 4_350_000 } }
    const html = renderCardHtml(anomaly, true)
    expect(html).toContain('#1,284')
    expect(html).toContain('4.35M')
    expect(html).toContain('LOCAL · LIVE')
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
