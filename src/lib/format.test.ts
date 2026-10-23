import { describe, expect, it } from 'vitest'

import { listTime } from '@/lib/format'
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

  it('更早：同年显示月-日，跨年只显示年份', () => {
    expect(listTime(at(2026, 4, 1, 8, 0), true, NOW)).toBe('05-01')
    expect(listTime(at(2024, 4, 1, 8, 0), true, NOW)).toBe('2024')
  })
})
