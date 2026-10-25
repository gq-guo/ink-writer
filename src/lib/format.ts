/** 展示用的格式化工具 */
import { t } from '@/lib/i18n'

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

/** 相对时间：刚刚 / 5 分钟前 / 昨天 / 3 天前 / 2024-05-01 */
export function relativeTime(mtimeSeconds: number, now = Date.now()): string {
  const diff = now / 1000 - mtimeSeconds
  if (diff < 60) return t('time.justNow')
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) })
  if (diff < 172800) return t('time.yesterday')
  if (diff < 7 * 86400) return t('time.daysAgo', { n: Math.floor(diff / 86400) })
  const date = new Date(mtimeSeconds * 1000)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y === new Date(now).getFullYear() ? `${m}-${d}` : `${y}-${m}-${d}`
}

/**
 * 文档列表右侧的短时间（一行内，时间右对齐）
 * - 分组视图（组头已经说明了哪天）：今天 / 昨天 → 10:24；更早 → 05-01 / 2024-05-01
 * - 不分组视图（Recent / Favorites）：今天 → 10:24；昨天 → 昨天；其余 → 05-01 / 2024-05-01
 */
export function listTime(mtimeSeconds: number, grouped: boolean, now = Date.now()): string {
  const date = new Date(mtimeSeconds * 1000)
  const group = groupFor(mtimeSeconds, now)
  if (group === 'today' || (grouped && group === 'yesterday')) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  if (group === 'yesterday') return t('time.yesterday')
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return date.getFullYear() === new Date(now).getFullYear() ? md : `${date.getFullYear()}-${md}`
}

/** 文档头的修改时间：Today · 11:04 / Yesterday · 18:32 / 05-01 / 2024-05-01 */
export function formatMetaTime(mtimeSeconds: number, now = Date.now()): string {
  const date = new Date(mtimeSeconds * 1000)
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const group = groupFor(mtimeSeconds, now)
  if (group === 'today') return `${t('meta.today')} · ${hm}`
  if (group === 'yesterday') return `${t('meta.yesterday')} · ${hm}`
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y === new Date(now).getFullYear() ? `${m}-${d}` : `${y}-${m}-${d}`
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
