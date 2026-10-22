import { describe, expect, it } from 'vitest'
import { extractDisplayTitle } from '@/lib/title'

describe('extractDisplayTitle（R3 / spec §7.3）', () => {
  it('优先使用首个 H1', () => {
    expect(extractDisplayTitle('# 我的文章\n\n正文', 'notes.md')).toBe('我的文章')
  })

  it('没有 H1 时回落到文件名（去扩展名）', () => {
    expect(extractDisplayTitle('正文内容', 'Hello World.md')).toBe('Hello World')
  })

  it('没有 H1 且文件名为空时使用 Untitled', () => {
    expect(extractDisplayTitle('', '')).toBe('Untitled')
  })

  it('只认行首的 H1，井号在行内不算标题', () => {
    expect(extractDisplayTitle('正文 # 不是标题', 'a.md')).toBe('a')
  })

  it('H2 不算标题', () => {
    expect(extractDisplayTitle('## 二级标题', 'a.md')).toBe('a')
  })

  it('去掉行尾的 # 序列', () => {
    expect(extractDisplayTitle('# 标题 ###', 'a.md')).toBe('标题')
  })

  it('标题最多保留 80 个字符', () => {
    const long = 'x'.repeat(200)
    expect(extractDisplayTitle(`# ${long}`, 'a.md')).toHaveLength(80)
  })

  it('忽略 # 后没有空格的写法', () => {
    expect(extractDisplayTitle('#无空格', 'a.md')).toBe('a')
  })

  it('支持 .markdown / .mdown / .txt 扩展名', () => {
    expect(extractDisplayTitle('', 'note.markdown')).toBe('note')
    expect(extractDisplayTitle('', 'note.mdown')).toBe('note')
    expect(extractDisplayTitle('', 'note.txt')).toBe('note')
  })
})
