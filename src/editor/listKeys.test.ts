import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { deleteListMarkerSpec, exitEmptyItemSpec } from '@/editor/listKeys'

/** 在 cursor 处按一次退格，返回 [新文本, 光标位置]；不处理时返回 null */
function backspace(doc: string, cursor: number): [string, number] | null {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, state.doc.length)
  const spec = deleteListMarkerSpec(state)
  if (!spec) return null
  const next = state.update(spec).state
  return [next.doc.toString(), next.selection.main.head]
}

describe('列表项退格', () => {
  it('空的有序列表项：一次退格删掉序号，光标回到行首', () => {
    const doc = '能力提供\n\n1. 快速支援\n2. '
    expect(backspace(doc, doc.length)).toEqual(['能力提供\n\n1. 快速支援\n', doc.length - 3])
  })

  it('无序列表与任务列表同样处理', () => {
    expect(backspace('- a\n- ', 6)).toEqual(['- a\n', 4])
    expect(backspace('- [ ] a\n- [ ] ', 14)).toEqual(['- [ ] a\n', 8])
  })

  it('标记后面有文字时：删掉标记，文字留在行首', () => {
    expect(backspace('1. 快速支援', 3)).toEqual(['快速支援', 0])
  })

  it('嵌套列表项也一次回到行首', () => {
    expect(backspace('- a\n  - ', 8)).toEqual(['- a\n', 4])
  })

  it('光标不在标记之后、或不是列表时交给默认退格', () => {
    expect(backspace('1. 快速支援', 5)).toBeNull()
    expect(backspace('```\n1. x\n```', 7)).toBeNull()
    expect(backspace('普通段落', 2)).toBeNull()
  })
})

/** 在 cursor 处按一次回车（只测 Ink 的「空项退出」）；不处理时返回 null */
function enter(doc: string, cursor: number): [string, number] | null {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, state.doc.length)
  const spec = exitEmptyItemSpec(state)
  if (!spec) return null
  const next = state.update(spec).state
  return [next.doc.toString(), next.selection.main.head]
}

describe('空列表项 / 空引用行回车', () => {
  it('空的列表项回车直接退出列表（不插空行、不留标记）', () => {
    expect(enter('- a\n- ', 6)).toEqual(['- a\n', 4])
    expect(enter('1. a\n2. ', 8)).toEqual(['1. a\n', 5])
    expect(enter('- [ ] a\n- [ ] ', 14)).toEqual(['- [ ] a\n', 8])
    expect(enter('- a\n  - ', 8)).toEqual(['- a\n', 4])
  })

  it('空引用行回车退出引用', () => {
    expect(enter('> a\n> ', 6)).toEqual(['> a\n', 4])
    expect(enter('> a\n> > ', 8)).toEqual(['> a\n', 4])
  })

  it('有内容的项、代码块、普通段落交给默认回车（续列表 / 换行）', () => {
    expect(enter('- a', 3)).toBeNull()
    expect(enter('> a', 3)).toBeNull()
    expect(enter('```\n- \n```', 6)).toBeNull()
    expect(enter('正文', 2)).toBeNull()
  })
})
