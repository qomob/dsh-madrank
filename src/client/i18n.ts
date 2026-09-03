/**
 * i18n.ts — 卡片与设置面板文案词典（en/zh 双语，单一来源）。
 *
 * 语言跟随宿主 ctx.locale（dsh-client-locale LocaleRuntime）：
 * - 只消费 getSnapshot().active + subscribe（不注册 namespace —— 单一 markup 源
 *   自持词典，规避 (ns, locale) 单一占用规则与客户端模块重放冲突）；
 * - active LocaleId 为 'zh' | 'en'；未知/缺席一律回退 en（官方 FALLBACK_LOCALE 语义）；
 * - zh/en 键集必须一致（双语平衡，对齐官方 register 契约），新增文案两份同步补。
 * 键值为含内联标记（<b> 等）的完整片段；{name} 占位符经 tr() 插值。
 *
 * v0.2 交互规范（Quick View = 看数据 / Settings = 改配置）：
 * - 卡片标题回归 "MADRank" + 副标题；关闭态 pill=「全球排名已关闭」（真实状态）；
 * - Join CTA 更名「开启全球排名」；退出/删除等配置动作全部移入设置面板（s* 键）。
 */

export type Lang = 'en' | 'zh'

/** zh 系（zh / zh-CN / zh-TW…）→ zh；其余 → en。 */
export function resolveLang(raw?: string): Lang {
  return typeof raw === 'string' && raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const en = {
  pillLocal: 'Global ranking off',
  pillOn: 'Global ranking on',
  cardTitle: 'MADRank',
  cardSubtitle: 'Your AI usage',
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
  joinCta: 'Turn on global ranking',
  notJoined: 'Not participating',
  yourRank: 'Your global rank',
  topChip: 'TOP {x}%',
  onlyParticipant: 'Only participant',
  race7dLabel: 'Ranked · 7-day uncached',
  race7dShort: '7-day uncached {v}',
  activeDays7: '{n}/7 days',
  deleteBtn: 'Delete synced data',
  deleteConfirmBtn: 'Confirm delete',
  deletePending: 'Deleting…',
  deleteDone: 'Synced data deleted from MADRank.',
  shareFine: 'One anonymous daily number; a random code stands for you; chats never leave your device.',
  joinedPending: 'Joined! Your global rank appears after the first daily sync tonight.',
  viewRace: 'View race',
  leave: 'Leave',
  footerUpdated: 'Updated {t} UTC',
  // ── 设置面板（Settings → MADRank = Configuration）──
  sRanking: 'Global ranking',
  sRankingToggle: 'Participate in MADRank global ranking',
  sRankingDesc: 'When on, DSH anonymously syncs daily aggregated token usage to MADRank to generate your global ranking. Local statistics are unaffected, and you can turn it off anytime.',
  sSync: 'Data sync',
  sSyncToggle: 'Auto-sync daily usage',
  sSyncDesc: 'Once a day finishes (UTC), its aggregate data is synced automatically.',
  sSyncOffHint: 'Available when global ranking is on',
  sLastSync: 'Last sync',
  sNeverSynced: 'Not synced yet',
  sPrivacy: 'Privacy',
  sPrivacyIntro: 'MADRank only receives the aggregates required for ranking. Everything else never leaves this device.',
  sSyncedHead: 'Synced',
  sNeverHead: 'Never synced',
  sItemTokens: 'Token counts',
  sItemDates: 'Usage dates',
  sItemModels: 'Model names',
  sItemChats: 'Chats',
  sItemPrompts: 'Prompts',
  sItemResponses: 'Responses',
  sItemFiles: 'Files',
  sItemKeys: 'API keys',
  sItemTools: 'Tool arguments',
  sPrivacyMore: 'Privacy policy',
  sDeleteNote: 'Removes ranking data already submitted to MADRank. Local statistics on this device are not affected.',
  sData: 'Local data',
  sDataRecords: 'Local records',
  sDaysCount: '{n} days',
  sDataNote: 'Usage statistics are stored only on this device and power the trends and the daily sync payload.',
  sClearBtn: 'Clear local data',
  sClearConfirmBtn: 'Confirm clear',
  sClearPending: 'Clearing…',
  sClearDone: 'Local records cleared.',
  sClearNote: 'Clears the local statistics on this device only. Ranking data already submitted to MADRank is not removed; active sessions accumulate again.',
  sPlugin: 'Plugin',
  sPluginName: 'MADRank DSH Plugin',
  sStatus: 'Status',
  sPluginEnabled: 'Enabled',
  sInstallGuide: 'Install guide',
} as const

export type DictKey = keyof typeof en

/** zh 词典：键集与 en 完全一致（双语平衡）。 */
const zh: Record<DictKey, string> = {
  pillLocal: '全球排名已关闭',
  pillOn: '全球排名已开启',
  cardTitle: 'MADRank',
  cardSubtitle: 'AI 用量与排名',
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
  joinCta: '开启全球排名',
  notJoined: '尚未参与',
  yourRank: '你的全球排名',
  topChip: '前 {x}%',
  onlyParticipant: '当前唯一参与者',
  race7dLabel: '计入全球排名 · 7 日未缓存',
  race7dShort: '7 日未缓存 {v}',
  activeDays7: '{n}/7 天',
  deleteBtn: '删除已同步数据',
  deleteConfirmBtn: '确认删除',
  deletePending: '删除中…',
  deleteDone: '已从 MADRank 删除已同步数据。',
  shareFine: '每天只上报一条匿名汇总数字；身份只是随机代号，不关联任何账号；聊天内容永不上传。',
  joinedPending: '已加入！今晚数据的首次匿名同步完成后，这里会显示你的全球排名。',
  viewRace: '查看排名赛',
  leave: '退出',
  footerUpdated: '更新于 {t} UTC',
  // ── 设置面板 ──
  sRanking: '全球排名',
  sRankingToggle: '参与 MADRank 全球排名',
  sRankingDesc: '开启后，DSH 会将每日聚合 Token 用量匿名同步至 MADRank，用于生成全球排名。本地统计不受影响，可随时关闭。',
  sSync: '数据同步',
  sSyncToggle: '自动同步每日用量',
  sSyncDesc: '每个 UTC 日结束后，自动同步当日聚合数据。',
  sSyncOffHint: '参与全球排名后可用',
  sLastSync: '最近同步',
  sNeverSynced: '尚未同步',
  sPrivacy: '隐私',
  sPrivacyIntro: 'MADRank 仅同步排名所需的聚合数据，其余数据永远不会离开这台设备。',
  sSyncedHead: '仅同步',
  sNeverHead: '绝不同步',
  sItemTokens: 'Token 用量',
  sItemDates: '使用日期',
  sItemModels: '模型标识',
  sItemChats: '对话内容',
  sItemPrompts: '提示词（Prompt）',
  sItemResponses: '回复（Response）',
  sItemFiles: '文件',
  sItemKeys: 'API Key',
  sItemTools: '工具参数',
  sPrivacyMore: '查看隐私说明',
  sDeleteNote: '只删除已提交到 MADRank 的历史排名数据，不影响此设备上的本地统计。',
  sData: '本地数据',
  sDataRecords: '本地记录',
  sDaysCount: '{n} 天',
  sDataNote: '用量统计只保存在这台设备上，用于展示趋势和生成每日同步数据。',
  sClearBtn: '清除本地数据',
  sClearConfirmBtn: '确认清除',
  sClearPending: '清除中…',
  sClearDone: '本地统计记录已清除。',
  sClearNote: '只清空此设备上的本地统计记录，不会删除已提交到 MADRank 的历史排名数据；进行中的会话会重新累计。',
  sPlugin: '插件',
  sPluginName: 'MADRank DSH Plugin',
  sStatus: '状态',
  sPluginEnabled: '已启用',
  sInstallGuide: '安装说明',
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
