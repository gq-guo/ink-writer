import { describe, expect, it } from 'vitest'
import { fuzzyScore, fuzzyScorePath } from '@/lib/fuzzy'
import { dedupeFileName, ensureMarkdownExtension, sanitizeFileName, uniqueUntitledName } from '@/lib/naming'

describe('模糊评分（spec §14.1）', () => {
  it('空查询返回 0 分', () => {
    expect(fuzzyScore('', 'hello')).toEqual({ score: 0, positions: [] })
  })

  it('连续子序列匹配得分更高', () => {
    const continuous = fuzzyScore('abc', 'abcdef')!
    const scattered = fuzzyScore('abc', 'axbxc')!
    expect(continuous.score).toBeGreaterThan(scattered.score)
  })

  it('词首匹配有额外加分', () => {
    const atWordStart = fuzzyScore('note', 'my note')!
    const inMiddle = fuzzyScore('note', 'mynotes')!
    expect(atWordStart.score).toBeGreaterThan(inMiddle.score)
  })

  it('不匹配的查询返回 null', () => {
    expect(fuzzyScore('zzz', 'hello')).toBeNull()
  })

  it('按 / 分段可以命中路径', () => {
    const hit = fuzzyScorePath('pro/read', 'README', 'Project/README.md')
    expect(hit).not.toBeNull()
  })

  it('路径分段全部命中才算命中', () => {
    expect(fuzzyScorePath('pro/xxx', 'README', 'Project/README.md')).toBeNull()
  })
})

describe('命名规则（spec §7.2）', () => {
  it('非法字符替换为 -', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('补全 .md 扩展名', () => {
    expect(ensureMarkdownExtension('note')).toBe('note.md')
    expect(ensureMarkdownExtension('note.md')).toBe('note.md')
    expect(ensureMarkdownExtension('note.txt')).toBe('note.txt')
  })

  it('新建文档取最小未占用序号', () => {
    expect(uniqueUntitledName([])).toBe('Untitled.md')
    expect(uniqueUntitledName(['Untitled.md'])).toBe('Untitled 2.md')
    expect(uniqueUntitledName(['Untitled.md', 'Untitled 2.md'])).toBe('Untitled 3.md')
  })

  it('重名自动加 -2', () => {
    expect(dedupeFileName([], 'a.md')).toBe('a.md')
    expect(dedupeFileName(['a.md'], 'a.md')).toBe('a-2.md')
    expect(dedupeFileName(['a.md', 'a-2.md'], 'a.md')).toBe('a-3.md')
  })
})
