import { describe, expect, it } from 'vitest'
import { displayNameOf, followsFirstLine, isUntitledName, nameFromFirstLine, sameName } from '@/lib/title'

describe('displayNameOf：文件名就是文档名（R3 / spec §7.3）', () => {
  it('取文件名去扩展名，不看正文', () => {
    expect(displayNameOf('Hello World.md')).toBe('Hello World')
  })

  it('支持 .markdown / .mdown / .txt 扩展名', () => {
    expect(displayNameOf('note.markdown')).toBe('note')
    expect(displayNameOf('note.mdown')).toBe('note')
    expect(displayNameOf('note.txt')).toBe('note')
  })

  it('文件名为空时用 Untitled', () => {
    expect(displayNameOf('')).toBe('Untitled')
  })
})

describe('nameFromFirstLine：新文档按第一行起名', () => {
  it('取第一个非空行，去掉 # 标题标记和行尾 #', () => {
    expect(nameFromFirstLine('\n\n# 我的文章 ##\n正文')).toBe('我的文章')
  })

  it('去掉引用、列表、任务框与粗斜体 / 代码 / 删除线符号', () => {
    expect(nameFromFirstLine('> 一句话')).toBe('一句话')
    expect(nameFromFirstLine('- [ ] 买菜')).toBe('买菜')
    expect(nameFromFirstLine('1. **重点** `代码` ~~删~~')).toBe('重点 代码 删')
  })

  it('保留单词里的下划线', () => {
    expect(nameFromFirstLine('snake_case 笔记')).toBe('snake_case 笔记')
  })

  it('文件名里的非法字符换成 -，最长 60 个字', () => {
    expect(nameFromFirstLine('a/b: c')).toBe('a-b- c')
    expect(nameFromFirstLine('字'.repeat(80))).toBe('字'.repeat(60))
  })

  it('第一行没有可用文字时返回 null', () => {
    expect(nameFromFirstLine('')).toBeNull()
    expect(nameFromFirstLine('\n  \n')).toBeNull()
    expect(nameFromFirstLine('#')).toBeNull()
  })
})

describe('自动命名的判定', () => {
  it('Untitled / Untitled N 视为还没起名', () => {
    expect(isUntitledName('Untitled')).toBe(true)
    expect(isUntitledName('Untitled 3')).toBe(true)
    expect(isUntitledName('Untitled notes')).toBe(false)
  })

  it('撞名时被追加 -2 也算同名', () => {
    expect(sameName('周报-2', '周报')).toBe(true)
    expect(sameName('周报', '周报')).toBe(true)
    expect(sameName('周报汇总', '周报')).toBe(false)
  })

  it('还叫 Untitled，或者文件名正好是第一行生成的名字：跟着第一行走', () => {
    expect(followsFirstLine('Untitled.md', '# 随便')).toBe(true)
    expect(followsFirstLine('读书笔记.md', '# 读书笔记\n')).toBe(true)
    expect(followsFirstLine('读书笔记.md', '# 别的\n')).toBe(false)
  })
})
