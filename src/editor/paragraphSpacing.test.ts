import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'

import { buildDecorations } from '@/editor/styledSource'
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
  it('段间距加在段落的最后一行', () => {
    const doc = '第一段\n\n第二段\n\n第三段'
    const state = stateWith(doc)
    const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }])

    // 三个段落各占两行（文本行 + 空行），段间距加在文本行上
    expect(classesOnLine(decorations, state.doc.line(1).from)).toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(3).from)).toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(5).from)).toContain('cm-md-para')
    // 空行不加
    expect(classesOnLine(decorations, state.doc.line(2).from)).not.toContain('cm-md-para')
  })

  it('换行的段落内部不会被撑开（只有最后一行有段间距）', () => {
    const doc = '这是一段很长很长很长很长很长很长很长很长很长很长很长很长\n会被换行的文字\n\n第二段'
    const state = stateWith(doc)
    const decorations = buildDecorations(state, [{ from: 0, to: state.doc.length }])

    expect(classesOnLine(decorations, state.doc.line(1).from)).not.toContain('cm-md-para')
    expect(classesOnLine(decorations, state.doc.line(2).from)).toContain('cm-md-para')
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
    expect(para.paddingBottom).toBe('0.9em')
  })
})
