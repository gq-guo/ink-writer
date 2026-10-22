import { beforeEach, describe, expect, it } from 'vitest'

import { resolveLocale, syncLocale, t, useLocaleStore } from '@/lib/i18n'

describe('i18n', () => {
  beforeEach(() => {
    syncLocale('system')
  })

  it('解析规则：system + 中文系统 → zh-CN', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('en')).toBe('en')
    // jsdom navigator.language 是 en-US → en
    expect(resolveLocale('system')).toBe('en')
  })

  it('syncLocale 更新 store 与 <html lang>', () => {
    syncLocale('zh-CN')
    expect(useLocaleStore.getState().locale).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
    syncLocale('en')
    expect(useLocaleStore.getState().locale).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('t() 按当前 locale 取文案', () => {
    syncLocale('zh-CN')
    expect(t('menu.trash')).toBe('移入废纸篓')
    syncLocale('en')
    expect(t('menu.trash')).toBe('Move to Trash')
  })

  it('t() 支持变量插值', () => {
    syncLocale('zh-CN')
    expect(t('conflict.keepMine')).toBe('保留我的版本')
  })

  it('未知 key 回退为 key 本身（便于发现漏翻）', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })
})
