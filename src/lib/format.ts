/** 展示用的格式化工具 */
import { t, useLocaleStore } from '@/lib/i18n'

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * 日期（不含时刻），按界面语言写成读得出来的样子，而不是 10-21 这种编号：
 * 中文 10月21日 / 2024年5月1日；英文 Oct 21 / May 1, 2024。同年省略年份。
 */
export function formatDay(mtimeSeconds: number, now = Date.now()): string {
  const date = new Date(mtimeSeconds * 1000)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  if (useLocaleStore.getState().locale === 'zh-CN') {
    const md = `${date.getMonth() + 1}月${date.getDate()}日`
    return sameYear ? md : `${date.getFullYear()}年${md}`
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** 相对时间：刚刚 / 5 分钟前 / 昨天 / 3 天前 / 5月1日 */
export function relativeTime(mtimeSeconds: number, now = Date.now()): string {
  const diff = now / 1000 - mtimeSeconds
  if (diff < 60) return t('time.justNow')
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) })
  if (diff < 172800) return t('time.yesterday')
  if (diff < 7 * 86400) return t('time.daysAgo', { n: Math.floor(diff / 86400) })
  return formatDay(mtimeSeconds, now)
}

/**
 * 文档列表右侧的短时间（一行内，时间右对齐）
 * - 分组视图（组头已经说明了哪天）：今天 / 昨天 → 10:24；更早 → 5月1日 / 2024年5月1日
 * - 不分组视图（Recent / Favorites）：今天 → 10:24；昨天 → 昨天；其余 → 5月1日 / 2024年5月1日
 */
export function listTime(mtimeSeconds: number, grouped: boolean, now = Date.now()): string {
  const date = new Date(mtimeSeconds * 1000)
  const group = groupFor(mtimeSeconds, now)
  if (group === 'today' || (grouped && group === 'yesterday')) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  if (group === 'yesterday') return t('time.yesterday')
  return formatDay(mtimeSeconds, now)
}

/** 文档头的修改时间：Today · 11:04 / Yesterday · 18:32 / 5月1日 / 2024年5月1日 */
export function formatMetaTime(mtimeSeconds: number, now = Date.now()): string {
  const date = new Date(mtimeSeconds * 1000)
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const group = groupFor(mtimeSeconds, now)
  if (group === 'today') return `${t('meta.today')} · ${hm}`
  if (group === 'yesterday') return `${t('meta.yesterday')} · ${hm}`
  return formatDay(mtimeSeconds, now)
}

export type DateGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export function groupFor(mtimeSeconds: number, now = Date.now()): DateGroup {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTodaySec = startOfToday.getTime() / 1000

  if (mtimeSeconds >= startOfTodaySec) return 'today'
  if (mtimeSeconds >= startOfTodaySec - 86400) return 'yesterday'
  if (mtimeSeconds >= startOfTodaySec - 7 * 86400) return 'thisWeek'
  return 'earlier'
}

export const GROUP_LABELS: Record<DateGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'Last 7 Days',
  earlier: 'Earlier',
}

export const GROUP_ORDER: DateGroup[] = ['today', 'yesterday', 'thisWeek', 'earlier']

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
