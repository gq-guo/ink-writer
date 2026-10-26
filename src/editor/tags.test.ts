import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { buildDecorations } from '@/editor/styledSource'
import { tagAt, tagsInLine } from '@/editor/tags'

const tags = (line: string) => tagsInLine(line).map((tag) => tag.tag)

/** 编辑器里着色为标签的文字 */
function highlighted(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length)
  const result: string[] = []
  const iter = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
  while (iter.value) {
    const cls = (iter.value as { spec?: { class?: string } }).spec?.class
    if (cls === 'cm-md-tag') result.push(state.doc.sliceString(iter.from, iter.to))
    iter.next()
  }
  return result
}

// 与 src-tauri/src/tags.rs 的单测保持同样的用例
describe('标签规则', () => {
  it('行首或空白之后的 #', () => {
    expect(tags('#写作 今天 #work/2026 和 #a_b-c')).toEqual(['写作', 'work/2026', 'a_b-c'])
  })

  it('遇到标点结束，末尾的 - / 不算', () => {
    expect(tags('记一下 #读书，明天 #plan. 还有 #x- #y/')).toEqual(['读书', 'plan', 'x', 'y'])
  })

  it('标题、锚点、转义、纯数字都不算', () => {
    expect(tags('# 标题')).toEqual([])
    expect(tags('## 二级')).toEqual([])
    expect(tags('见 https://a.com/#top 与 [链接](#sec)')).toEqual([])
    expect(tags('\\#不是 中文#不是 #1 #2024')).toEqual([])
    expect(tags('## 计划 #work')).toEqual(['work'])
  })

  it('字符类与 Rust 一致：带元音符号的文字整段算标签，空白按 White_Space', () => {
    expect(tags('#हिंदी #สวัสดี #Ⓐbc')).toEqual(['हिंदी', 'สวัสดี', 'Ⓐbc'])
    expect(tags('a\u0085#nel')).toEqual(['nel'])
    expect(tags('a\ufeff#bom')).toEqual([])
  })

  it('位置是行内的 UTF-16 偏移，含 #', () => {
    const line = '😀 中文 #标签'
    const [tag] = tagsInLine(line)
    expect(line.slice(tag!.start, tag!.end)).toBe('#标签')
  })
})

describe('编辑器里的标签着色', () => {
  it('正文、标题、列表里的标签着色', () => {
    expect(highlighted('## 计划 #work\n\n- 买菜 #生活\n\n今天 #写作')).toEqual(['#work', '#生活', '#写作'])
  })

  it('代码、链接地址、HTML 注释里的不着色', () => {
    const doc = '`#code` 和 [a](https://x.com/#no)\n\n```\n#inside\n```\n\n    #indented\n\n<!-- #comment -->\n\n正文 #yes'
    expect(highlighted(doc)).toEqual(['#yes'])
  })
})

describe('⌘Click 用的 tagAt', () => {
  const state = EditorState.create({ doc: '今天 #写作/草稿 和 `#code`', extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, state.doc.length)

  it('点在标签任意位置都取到整个标签', () => {
    expect(tagAt(state, 3)).toBe('写作/草稿')
    expect(tagAt(state, 7)).toBe('写作/草稿')
  })

  it('不在标签上、或在代码里返回 null', () => {
    expect(tagAt(state, 1)).toBeNull()
    expect(tagAt(state, state.doc.length - 3)).toBeNull()
  })
})
