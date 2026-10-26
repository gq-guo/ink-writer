import { describe, expect, it } from 'vitest'

import { formatMetaTime, listTime, relativeTime } from '@/lib/format'
import { syncLocale } from '@/lib/i18n'

// 2026-10-21（周三）12:00 本地时间
const NOW = new Date(2026, 9, 21, 12, 0).getTime()
const at = (...args: [number, number, number, number, number]) => new Date(...args).getTime() / 1000

describe('listTime（侧栏右侧短时间）', () => {
  it('分组视图：今天与昨天都显示时刻', () => {
    expect(listTime(at(2026, 9, 21, 9, 5), true, NOW)).toBe('09:05')
    expect(listTime(at(2026, 9, 20, 18, 32), true, NOW)).toBe('18:32')
  })

  it('不分组视图：昨天显示「昨天 / yesterday」', () => {
    syncLocale('en')
    expect(listTime(at(2026, 9, 20, 18, 32), false, NOW)).toBe('yesterday')
    syncLocale('zh-CN')
    expect(listTime(at(2026, 9, 20, 18, 32), false, NOW)).toBe('昨天')
  })

  it('更早：按界面语言写日期，同年省略年份', () => {
    syncLocale('zh-CN')
    expect(listTime(at(2026, 9, 18, 8, 0), true, NOW)).toBe('10月18日')
    expect(listTime(at(2026, 4, 1, 8, 0), true, NOW)).toBe('5月1日')
    expect(listTime(at(2024, 4, 1, 8, 0), true, NOW)).toBe('2024年5月1日')
    syncLocale('en')
    expect(listTime(at(2026, 9, 18, 8, 0), true, NOW)).toBe('Oct 18')
    expect(listTime(at(2024, 4, 1, 8, 0), true, NOW)).toBe('May 1, 2024')
  })

  it('Quick Open 的相对时间与文档头在一周以前也用同一种日期写法', () => {
    syncLocale('zh-CN')
    expect(relativeTime(at(2026, 4, 1, 8, 0), NOW)).toBe('5月1日')
    expect(formatMetaTime(at(2024, 4, 1, 8, 0), NOW)).toBe('2024年5月1日')
  })
})
