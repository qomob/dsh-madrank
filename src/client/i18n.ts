/**
 * i18n.ts — 卡片文案词典（en/zh 双语，单一来源）。
 *
 * 语言跟随宿主 ctx.locale（dsh-client-locale LocaleRuntime）：
 * - 只消费 getSnapshot().active + subscribe（不注册 namespace —— 单一 markup 源
 *   自持词典，规避 (ns, locale) 单一占用规则与客户端模块重放冲突）；
 * - active LocaleId 为 'zh' | 'en'；未知/缺席一律回退 en（官方 FALLBACK_LOCALE 语义）；
 * - zh/en 键集必须一致（双语平衡，对齐官方 register 契约），新增文案两份同步补。
 * 键值为含内联标记（<b> 等）的完整片段；{name} 占位符经 tr() 插值。
 */

export type Lang = 'en' | 'zh'

/** zh 系（zh / zh-CN / zh-TW…）→ zh；其余 → en。 */
export function resolveLang(raw?: string): Lang {
  return typeof raw === 'string' && raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const en = {
  pillLocal: 'Local only',
  pillOn: 'Global ranking on',
  cardTitle: 'MADRank Usage',
  todayLabel: 'TODAY · UNCACHED TOKENS',
  todayEmpty: 'TODAY',
  noUsage: 'No usage recorded yet. Numbers appear after your next AI turn.',
  heroRequests: '<b>{n}</b> requests',
  heroActive: '<b>{n}</b> active',
  segIn: '{v} in',
  segOut: '{v} out',
  segCached: '{v} cached',
  cachedTip: 'Cached tokens are shown separately and are not included in your primary usage score.',
  chipVs: 'vs 7d avg',
  chipStreak: '{n}-day streak',
  mostUsed: 'Most used',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  seg7d: '7D',
  seg30d: '30D',
  segDay: 'Day',
  dayHeading: '{w} · {d}',
  joinFine: 'Optional: share <b>daily aggregates only</b> (token counts, model names). Never prompts, responses, or files. Off by default.',
  joinCta: 'Join global ranking',
  yourRank: 'Your global rank',
  topChip: 'TOP {x}%',
  onlyParticipant: 'Only participant',
  race7dLabel: 'Ranked · 7-day uncached',
  shareFine: 'One anonymous daily number; a random code stands for you; chats never leave your device.',
  joinedPending: 'Joined! Your global rank appears after the first daily sync tonight.',
  viewRace: 'View race',
  leave: 'Leave',
  footerUpdated: 'Updated {t} UTC',
} as const

export type DictKey = keyof typeof en

/** zh 词典：键集与 en 完全一致（双语平衡）。 */
const zh: Record<DictKey, string> = {
  pillLocal: '仅本地',
  pillOn: '全球排名已开启',
  cardTitle: 'MADRank 用量',
  todayLabel: '今日 · 未缓存 Token',
  todayEmpty: '今日',
  noUsage: '还没有用量记录，下一次 AI 对话后就会出现数字。',
  heroRequests: '<b>{n}</b> 次请求',
  heroActive: '活跃 <b>{n}</b>',
  segIn: '输入 {v}',
  segOut: '输出 {v}',
  segCached: '缓存 {v}',
  cachedTip: '缓存 Token 单独展示，不计入你的主用量口径。',
  chipVs: 'vs 7日均值',
  chipStreak: '连续 {n} 天',
  mostUsed: '常用模型',
  last7: '最近 7 天',
  last30: '最近 30 天',
  seg7d: '7天',
  seg30d: '30天',
  segDay: '单日',
  dayHeading: '{w} · {d}',
  joinFine: '可选：仅共享<b>每日聚合数字</b>（Token 数与模型名）。绝不上传提示词、回复或文件。默认关闭。',
  joinCta: '加入全球排名',
  yourRank: '你的全球排名',
  topChip: '前 {x}%',
  onlyParticipant: '当前唯一参与者',
  race7dLabel: '计入全球排名 · 7 日未缓存',
  shareFine: '每天只上报一条匿名汇总数字；身份只是随机代号，不关联任何账号；聊天内容永不上传。',
  joinedPending: '已加入！今晚数据的首次匿名同步完成后，这里会显示你的全球排名。',
  viewRace: '查看排名赛',
  leave: '退出',
  footerUpdated: '更新于 {t} UTC',
}

const DICTS: Record<Lang, Record<DictKey, string>> = { en, zh }

/** 取词 + {name} 插值；缺键回退 en，再缺回显 key（fail loud，对齐官方 lookup 链）。 */
export function tr(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = DICTS[lang][key] ?? DICTS.en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v))
  }
  return s
}

/** 星期短标（直方列头；zh 两字宽与 9px 列头适配）。 */
export const WEEKDAYS: Record<Lang, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
}

/** 活跃时长：en “1h 05m / 52m”；zh “1小时05分 / 52分钟”。 */
export function fmtActive(seconds: number, lang: Lang): string {
  if (seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (lang === 'zh') return h > 0 ? (h + '小时' + String(m).padStart(2, '0') + '分') : (m + '分钟')
  return h > 0 ? (h + 'h ' + String(m).padStart(2, '0') + 'm') : (m + 'm')
}
