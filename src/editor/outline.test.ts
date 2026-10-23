import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { activeHeadingIndex, extractHeadings } from '@/editor/outline'

function headingsOf(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length)
  return extractHeadings(state)
}

describe('目录：提取标题', () => {
  it('提取 ATX / Setext 标题，去掉 # 标记与结尾的 #', () => {
    const doc = ['# 标题一', '', '正文', '', '## 标题二 ##', '', '标题三', '---', '', '###### 六级'].join('\n')
    expect(headingsOf(doc).map((h) => [h.level, h.text])).toEqual([
      [1, '标题一'],
      [2, '标题二'],
      [2, '标题三'],
      [6, '六级'],
    ])
  })

  it('代码块里的 # 不算标题；空标题跳过', () => {
    const doc = ['# 有效', '', '```', '# 代码里的注释', '```', '', '#', '', '## 也有效'].join('\n')
    expect(headingsOf(doc).map((h) => h.text)).toEqual(['有效', '也有效'])
  })

  it('记录标题在文档中的起点（跳转用）', () => {
    const doc = '正文\n\n# A\n\n## B'
    const [a, b] = headingsOf(doc)
    expect(doc.slice(a!.pos, a!.pos + 3)).toBe('# A')
    expect(doc.slice(b!.pos, b!.pos + 4)).toBe('## B')
  })
})

describe('目录：当前章节', () => {
  const headings = [
    { level: 1, text: 'A', pos: 10 },
    { level: 2, text: 'B', pos: 50 },
    { level: 2, text: 'C', pos: 90 },
  ]

  it('阅读位置所在的那一节', () => {
    expect(activeHeadingIndex(headings, 10)).toBe(0)
    expect(activeHeadingIndex(headings, 70)).toBe(1)
    expect(activeHeadingIndex(headings, 500)).toBe(2)
  })

  it('还在第一个标题之前时没有当前章节', () => {
    expect(activeHeadingIndex(headings, 0)).toBe(-1)
  })
})
