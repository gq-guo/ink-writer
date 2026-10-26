import { describe, expect, it } from 'vitest'

import { isInFolder, listFolders } from '@/lib/folders'
import type { DocumentMeta } from '@/lib/types'

const doc = (dirPrefix: string, fileName = 'a.md'): DocumentMeta => ({
  path: `/library/${dirPrefix}${fileName}`,
  fileName,
  dirPrefix,
  mtime: 0,
  size: 0,
  displayTitle: fileName,
})

describe('文件夹列表', () => {
  it('从 dirPrefix 推出文件夹：子文件夹排在父文件夹下面，数量含子文件夹', () => {
    const folders = listFolders([doc(''), doc('Work/'), doc('Work/2026/'), doc('Work/2026/', 'b.md'), doc('Blog/')])
    expect(folders).toEqual([
      { prefix: 'Blog/', name: 'Blog', depth: 0, count: 1 },
      { prefix: 'Work/', name: 'Work', depth: 0, count: 3 },
      { prefix: 'Work/2026/', name: '2026', depth: 1, count: 2 },
    ])
  })

  it('只有中间层级有文档时也列出父文件夹；数字按数值排序', () => {
    expect(listFolders([doc('A/10/'), doc('A/9/')]).map((folder) => folder.prefix)).toEqual(['A/', 'A/9/', 'A/10/'])
  })

  it('只差大小写 / 重音的同名文件夹各自带着自己的子文件夹', () => {
    const prefixes = listFolders([doc('Notes/'), doc('notes/'), doc('notes/x/'), doc('Notes/y/')]).map(
      (folder) => folder.prefix,
    )
    expect(prefixes).toEqual(['Notes/', 'Notes/y/', 'notes/', 'notes/x/'])
  })

  it('没有子文件夹时为空', () => {
    expect(listFolders([doc(''), doc('')])).toEqual([])
  })

  it('isInFolder 含子文件夹，不把同名前缀的兄弟文件夹算进来', () => {
    expect(isInFolder(doc('Work/2026/'), 'Work/')).toBe(true)
    expect(isInFolder(doc('Workshop/'), 'Work/')).toBe(false)
    expect(isInFolder(doc(''), 'Work/')).toBe(false)
  })
})
