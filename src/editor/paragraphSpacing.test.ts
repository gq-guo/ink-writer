import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'

import { buildDecorations, transientBlankLineField } from '@/editor/styledSource'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState as EditorStateType } from '@codemirror/state'
import { inkThemeSpec } from '@/editor/theme'

function stateWith(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
}

/** 取某个文档行上的 line decoration class 列表 */
function classesOnLine(
  decorations: ReturnType<typeof buildDecorations>,
  lineStart: number,
): string[] {
  const result: string[] = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class && cursor.from === lineStart) {
      result.push(...decoration.spec.class.split(' '))
    }
    cursor.next()
  }
  return result
}

describe('段落间距（点击定位正确性的前提）', () => {
  it('段间距加在段落后的分隔空行上；文末没有空行时加在段落最后一行', () => {
    const doc = '第一段\n\n第二段\n\n第三段'
    const state = stateWith(doc)
    const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }])

    // 第一、二段后面都有空行 → 间距在空行（第 2、4 行）上
    expect(classesOnLine(decorations, state.doc.line(2).from)).toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(4).from)).toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(1).from)).not.toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(3).from)).not.toContain('cm-md-para')
    // 第三段在文末、后面没有空行 → 加在它自己身上
    expect(classesOnLine(decorations, state.doc.line(5).from)).toContain('cm-md-para')
  })

  it('换行的段落内部不会被撑开（间距只在段落之后）', () => {
    const doc = '这是一段很长很长很长很长很长很长很长很长很长很长很长很长\n会被换行的文字\n\n第二段'
    const state = stateWith(doc)
    const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }])

    expect(classesOnLine(decorations, state.doc.line(1).from)).not.toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(2).from)).not.toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(3).from)).toContain('cm-md-para')
  })

  it('段末按回车、还没输入时：新空行紧贴段落；输入后间距位置不变，光标不跳', () => {
    // 按回车后：「ks」后面是新空行 → 间距在新空行上（在光标下方），「ks」本身没有间距
    const before = stateWith('可以吗\nks\n')
    const beforeDecorations = buildDecorations(before, [{ from: 0, to: before.doc.length }])
    expect(classesOnLine(beforeDecorations, before.doc.line(2).from)).not.toContain('cm-md-para')
    expect(classesOnLine(beforeDecorations, before.doc.line(3).from)).toContain('cm-md-para')

    // 打字后：新行并入段落、成为最后一行 → 间距仍在第 3 行，第 2 行仍没有
    const after = stateWith('可以吗\nks\n新')
    const afterDecorations = buildDecorations(after, [{ from: 0, to: after.doc.length }])
    expect(classesOnLine(afterDecorations, after.doc.line(2).from)).not.toContain('cm-md-para')
    expect(classesOnLine(afterDecorations, after.doc.line(3).from)).toContain('cm-md-para')
  })

  it('段落中间按回车、还没输入时：新空行是临时空行，不把段落拆开加间距', () => {
    const state = pressEnterAtEndOf(stateWithTransient('asdf\nlaid1\nbu\nniu'), 2)
    expect(state.field(transientBlankLineField)).toBe(state.doc.line(3).from)
    const lines = paraLines(state)
    // 上下两半之间没有段间距（只有文末那一段的末行有）
    expect(lines).toEqual([5])
  })

  it('连按两次回车：第一个空行成为段落分隔；第二个（临时）空行提前按新段落留好间距', () => {
    let state = pressEnterAtEndOf(stateWithTransient('asdf\nks\n\nnext'), 2)
    state = pressEnter(state)
    // 行：1 asdf / 2 ks / 3 空（分隔） / 4 空（临时，光标） / 5 空 / 6 next
    expect(paraLines(state)).toEqual([3, 5, 6])
    // 打字后：第 4 行成为新段落，间距仍在 3、5 行 → 下面的 next 不跳
    const typed = state.update({ changes: { from: state.doc.line(4).from, insert: '新' }, userEvent: 'input.type' }).state
    ensureSyntaxTree(typed, typed.doc.length)
    expect(paraLines(typed)).toEqual([3, 5, 6])
  })

  it('光标离开临时空行后，它就是真正的段落分隔，间距照常出现', () => {
    const entered = pressEnterAtEndOf(stateWithTransient('asdf\nlaid1\nbu'), 2)
    const moved = entered.update({ selection: { anchor: 0 } }).state
    expect(moved.field(transientBlankLineField)).toBeNull()
    expect(paraLines(moved)).toEqual([3, 4])
  })

  it('行首按回车（光标落在有字的行上）不算临时空行', () => {
    const state = stateWithTransient('asdf\nbu')
    const lineStart = state.doc.line(2).from
    const next = state.update({
      changes: { from: lineStart, insert: '\n' },
      selection: { anchor: lineStart + 1 },
      userEvent: 'input',
    }).state
    expect(next.field(transientBlankLineField)).toBeNull()
  })

  it('样式化源码的规则不使用 margin（margin 不在 CM6 的行高模型里，会导致点击位置逐行漂移）', () => {
    const offenders: string[] = []
    for (const [selector, rules] of Object.entries(inkThemeSpec)) {
      if (!selector.startsWith('.cm-md-')) continue
      const style = rules as Record<string, unknown>
      for (const key of Object.keys(style)) {
        if (key.toLowerCase().includes('margin')) offenders.push(`${selector}: ${key}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('段间距用 padding 实现（属于行盒，CM6 能正确测量）', () => {
    const para = inkThemeSpec['.cm-md-para'] as Record<string, unknown>
    expect(para.paddingBottom).toBe('0.3em')
    expect(para.marginBottom).toBeUndefined()
  })
})

function stateWithTransient(doc: string): EditorStateType {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), transientBlankLineField],
  })
  ensureSyntaxTree(state, state.doc.length)
  return state
}

/** 模拟在第 lineNumber 行末尾按回车（Markdown 的回车命令发出 userEvent: 'input'） */
function pressEnterAtEndOf(state: EditorStateType, lineNumber: number): EditorStateType {
  const pos = state.doc.line(lineNumber).to
  return pressEnter(state.update({ selection: { anchor: pos } }).state)
}

function pressEnter(state: EditorStateType): EditorStateType {
  const pos = state.selection.main.head
  const next = state.update({
    changes: { from: pos, insert: '\n' },
    selection: { anchor: pos + 1 },
    userEvent: 'input',
  }).state
  ensureSyntaxTree(next, next.doc.length)
  return next
}

/** 带段间距（cm-md-para）的行号 */
function paraLines(state: EditorStateType): number[] {
  const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }])
  const result = new Set<number>()
  const cursor = decorations.iter()
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class?.split(' ').includes('cm-md-para')) {
      result.add(state.doc.lineAt(cursor.from).number)
    }
    cursor.next()
  }
  return [...result].sort((a, b) => a - b)
}
