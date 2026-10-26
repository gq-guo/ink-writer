import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { buildDecorations, concealMarkupFacet, cursorEngagedField } from '@/editor/styledSource'
import { clickTaskSpec, TaskCheckboxWidget, toggleTaskSpec } from '@/editor/tasks'

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

  it('代码块、标题里的行不动（包括代码块里的空行）', () => {
    expect(toggle('```\n- [ ] a\n```', 6)).toBeNull()
    expect(toggle('```\n\n```', 4)).toBeNull()
    expect(toggle('# 标题', 3)).toBeNull()
  })

  it('只有框、后面没文字的任务也是切换，不再套一层框', () => {
    expect(toggle('- [ ]', 5)?.[0]).toBe('- [x]')
    expect(toggle('- [x]', 5)?.[0]).toBe('- [ ]')
  })

  it('列表项的续行：切换它所属的那一项，不另起子任务', () => {
    expect(toggle('- [ ] a\n  b', 10)?.[0]).toBe('- [x] a\n  b')
    expect(toggle('- a\n  b', 6)?.[0]).toBe('- [ ] a\n  b')
    // 选中首行和续行：同一项只切一次
    expect(toggle('- [ ] a\n  b', 0, 11)?.[0]).toBe('- [x] a\n  b')
  })

  it('列表项里的代码块：代码行上按 ⌘L 不动，也不勾所属的列表项', () => {
    const doc = '- [ ] a\n\n  ```\n  code\n  ```'
    expect(toggle(doc, doc.indexOf('code') + 1)).toBeNull()
  })

  it('全选十几万行也不会栈溢出', () => {
    const doc = Array.from({ length: 150_000 }, () => 'x').join('\n')
    const state = EditorState.create({ doc, selection: { anchor: 0, head: doc.length } })
    expect(() => toggleTaskSpec(state)).not.toThrow()
  })

  it('列表项里直接是引用：没有能挂任务框的段落，不动', () => {
    expect(toggle('- > q', 4)).toBeNull()
  })

  it('大文档里光标附近之外还没解析：先补全语法树再判断', () => {
    const doc = `${'x'.repeat(500_000)}\n\n- [ ] tail`
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length - 2 },
      extensions: [markdown({ base: markdownLanguage })],
    })
    const spec = toggleTaskSpec(state)
    expect(spec && state.update(spec).state.doc.toString().slice(-10)).toBe('- [x] tail')
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

/** 隐藏标记模式下的复选框控件：[起点文字, 是否勾选, 是否外悬] */
function checkboxes(doc: string, cursor: number): [string, boolean, boolean][] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage }), concealMarkupFacet.of(true)],
  })
  ensureSyntaxTree(state, state.doc.length)
  const result: [string, boolean, boolean][] = []
  const iter = buildDecorations(state, [{ from: 0, to: state.doc.length }]).iter()
  while (iter.value) {
    const widget = (iter.value as { spec?: { widget?: unknown } }).spec?.widget
    if (widget instanceof TaskCheckboxWidget) {
      result.push([state.doc.sliceString(iter.from, iter.to), widget.checked, widget.hanging])
    }
    iter.next()
  }
  return result
}

describe('光标外显示复选框', () => {
  it('无序列表：- [ ] 连同 - 换成外悬的复选框；光标所在行保持原文', () => {
    const doc = '- [ ] apple\n- [x] banana\n- [ ] pear'
    expect(checkboxes(doc, doc.length)).toEqual([
      ['- [ ] ', false, true],
      ['- [x] ', true, true],
    ])
  })

  it('有序列表保留序号，只换任务框', () => {
    expect(checkboxes('1. [x] a\n\n正文', 12)).toEqual([['[x] ', true, false]])
  })

  it('普通列表项、代码块里的 [ ] 不换', () => {
    expect(checkboxes('- a\n\n```\n- [ ] b\n```\n\n正文', 22)).toEqual([])
  })

  it('点复选框不算「动过光标」：光标所在行（刚打开时的第一行）不会露出标记', () => {
    const state = EditorState.create({
      doc: '- [ ] first\n- [ ] second',
      extensions: [markdown({ base: markdownLanguage }), cursorEngagedField],
    })
    ensureSyntaxTree(state, state.doc.length)
    const next = state.update(clickTaskSpec(state, 12)!).state
    expect(next.doc.toString()).toBe('- [ ] first\n- [x] second')
    expect(next.field(cursorEngagedField)).toBe(false)
  })

  it('点控件起点（- 的位置）切换这一项', () => {
    expect(click('- [ ] a', 0)).toBe('- [x] a')
    expect(click('  - [x] a', 2)).toBe('  - [ ] a')
  })
})

describe('已完成项样式', () => {
  it('[x] 后面的文字带 cm-md-task-done，未完成的没有', () => {
    expect(markedText('- [x] 买菜\n- [ ] 做饭', 'cm-md-task-done')).toEqual(['买菜'])
  })

  it('任务框带可点的 class', () => {
    expect(markedText('- [ ] a', 'cm-md-task-marker')).toEqual(['[ ]'])
  })
})
