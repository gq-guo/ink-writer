import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { buildDecorations } from '@/editor/styledSource'
import { clickTaskSpec, toggleTaskSpec } from '@/editor/tasks'

function stateOf(doc: string, anchor: number, head = anchor) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, state.doc.length)
  return state
}

/** 按一次 ⌘L，返回 [新文本, 光标位置]；不处理时返回 null */
function toggle(doc: string, anchor: number, head = anchor): [string, number] | null {
  const state = stateOf(doc, anchor, head)
  const spec = toggleTaskSpec(state)
  if (!spec) return null
  const next = state.update(spec).state
  return [next.doc.toString(), next.selection.main.head]
}

/** 点 pos 处，返回新文本；不是任务框返回 null */
function click(doc: string, pos: number): string | null {
  const state = stateOf(doc, 0)
  const spec = clickTaskSpec(state, pos)
  return spec ? state.update(spec).state.doc.toString() : null
}

/** 带某个 class 的 mark 覆盖的文字 */
function markedText(doc: string, cls: string): string[] {
  const state = stateOf(doc, 0)
  const result: string[] = []
  const cursor = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
  while (cursor.value) {
    const spec = (cursor.value as { spec?: { class?: string } }).spec
    if (spec?.class?.split(' ').includes(cls)) result.push(state.doc.sliceString(cursor.from, cursor.to))
    cursor.next()
  }
  return result
}

describe('⌘L 切换任务', () => {
  it('[ ] 与 [x] 互相切换，光标不动', () => {
    expect(toggle('- [ ] 买菜', 8)).toEqual(['- [x] 买菜', 8])
    expect(toggle('- [x] 买菜', 8)).toEqual(['- [ ] 买菜', 8])
    expect(toggle('- [X] 买菜', 8)).toEqual(['- [ ] 买菜', 8])
  })

  it('普通列表项补上任务框', () => {
    expect(toggle('- 买菜', 3)).toEqual(['- [ ] 买菜', 7])
    expect(toggle('1. 买菜', 4)).toEqual(['1. [ ] 买菜', 8])
    expect(toggle('  - 嵌套', 5)).toEqual(['  - [ ] 嵌套', 9])
  })

  it('普通段落变成任务；空行起一个任务，光标在框后', () => {
    expect(toggle('买菜', 0)).toEqual(['- [ ] 买菜', 6])
    expect(toggle('', 0)).toEqual(['- [ ] ', 6])
    expect(toggle('> 引用里的话', 4)).toEqual(['> - [ ] 引用里的话', 10])
  })

  it('选中多行：每行各切一次，空行跳过', () => {
    const doc = '- [ ] a\n- [x] b\n\nc'
    expect(toggle(doc, 0, doc.length)?.[0]).toBe('- [x] a\n- [ ] b\n\n- [ ] c')
  })

  it('选区结束在下一行行首时不算那一行', () => {
    expect(toggle('a\nb', 0, 2)?.[0]).toBe('- [ ] a\nb')
  })

  it('代码块、标题里的行不动', () => {
    expect(toggle('```\n- [ ] a\n```', 6)).toBeNull()
    expect(toggle('# 标题', 3)).toBeNull()
  })
})

describe('点击任务框', () => {
  it('点 [ ] 内任意位置都切换', () => {
    expect(click('- [ ] a', 2)).toBe('- [x] a')
    expect(click('- [ ] a', 3)).toBe('- [x] a')
    expect(click('- [x] a', 4)).toBe('- [ ] a')
  })

  it('不在任务框上、或代码块里长得像的文字不处理', () => {
    expect(click('- [ ] a', 6)).toBeNull()
    expect(click('```\n- [ ] a\n```', 7)).toBeNull()
  })
})

describe('已完成项样式', () => {
  it('[x] 后面的文字带 cm-md-task-done，未完成的没有', () => {
    expect(markedText('- [x] 买菜\n- [ ] 做饭', 'cm-md-task-done')).toEqual([' 买菜'])
  })

  it('任务框带可点的 class', () => {
    expect(markedText('- [ ] a', 'cm-md-task-marker')).toEqual(['[ ]'])
  })
})
