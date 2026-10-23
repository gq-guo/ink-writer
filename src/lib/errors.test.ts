import { describe, expect, it } from 'vitest'

import { errorMessage } from '@/lib/errors'
import { syncLocale } from '@/lib/i18n'

const rustError = (code: string, detail: string) => ({ kind: 'error', data: { code, detail } })

describe('errorMessage', () => {
  it('Rust 错误码按当前语言翻译，detail 原样保留', () => {
    syncLocale('zh-CN')
    expect(errorMessage(rustError('notFound', '/lib/a.md'))).toBe('文件不存在：/lib/a.md')
    syncLocale('en')
    expect(errorMessage(rustError('notFound', '/lib/a.md'))).toBe('File not found: /lib/a.md')
  })

  it('未知错误码退回 detail 原文，而不是显示 [object Object]', () => {
    expect(errorMessage(rustError('somethingNew', 'raw detail'))).toBe('raw detail')
  })

  it('字符串与 Error 直接显示', () => {
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
})
