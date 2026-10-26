import { describe, expect, it } from 'vitest'

import { pickStartupDocument } from '@/lib/startupDocument'
import type { DocumentMeta } from '@/lib/types'

const doc = (path: string): DocumentMeta => ({
  path,
  fileName: path.split('/').pop()!,
  dirPrefix: '',
  mtime: 0,
  size: 0,
  displayTitle: path,
})

// 列表按修改时间倒序：get.md 最新
const documents = [doc('/lib/get.md'), doc('/lib/中台测试.md'), doc('/lib/old.md')]

describe('pickStartupDocument（刷新 / 重启后打开哪一篇）', () => {
  it('回到上次打开的文档，而不是最新的第一篇', () => {
    expect(pickStartupDocument(documents, '/lib/中台测试.md')).toBe('/lib/中台测试.md')
  })

  it('上次的文档已被删 / 改名，或是库外文件：退回第一篇', () => {
    expect(pickStartupDocument(documents, '/lib/deleted.md')).toBe('/lib/get.md')
    expect(pickStartupDocument(documents, '/Users/me/Desktop/outside.md')).toBe('/lib/get.md')
  })

  it('没有记录时打开第一篇；库是空的返回 null', () => {
    expect(pickStartupDocument(documents, null)).toBe('/lib/get.md')
    expect(pickStartupDocument(documents, undefined)).toBe('/lib/get.md')
    expect(pickStartupDocument([], '/lib/get.md')).toBeNull()
  })
})
