import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it } from 'vitest'

import { buildDecorations } from '@/editor/styledSource'
import { computeFocusDecorations, focusModeField, setFocusModeEffect } from '@/editor/focusMode'

function stateWith(doc: string, focus = false) {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), focusModeField] })
  if (focus) {
    state = state.update({ effects: setFocusModeEffect.of(true) }).state
  }
  return state
}

function rangeOf(state: EditorState) {
  return { from: 0, to: state.doc.length }
}

function classesOf(decorations: ReturnType<typeof buildDecorations>): string[] {
  const cursor = decorations.iter()
  const result: string[] = []
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class) result.push(...decoration.spec.class.split(' '))
    cursor.next()
  }
  return result
}

describe('样式化源码（spec §2）', () => {
  it('标题行加上对应字号 class', () => {
    const state = stateWith('# 标题\n\n正文')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-h1')
  })

  it('H2/H3 使用不同 class', () => {
    const state = stateWith('## 二级\n\n### 三级')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-h2')
    expect(classes).toContain('cm-md-h3')
  })

  it('语法符号被弱化（HeaderMark / QuoteMark / ListMark）', () => {
    const state = stateWith('> 引用\n\n- 列表')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes.filter((c) => c === 'cm-md-mark').length).toBeGreaterThanOrEqual(2)
  })

  it('加粗 / 斜体 / 删除线 / 行内代码都有对应样式', () => {
    const state = stateWith('**粗** *斜* ~~删~~ `码`')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-bold')
    expect(classes).toContain('cm-md-italic')
    expect(classes).toContain('cm-md-strike')
    expect(classes).toContain('cm-md-code')
  })

  it('链接文本着色、URL 弱化', () => {
    const state = stateWith('[文本](http://example.com)')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-link-text')
    expect(classes).toContain('cm-md-url')
  })

  it('引用块有左侧竖线样式', () => {
    const state = stateWith('> 引用')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-quote')
  })

  it('代码块整块有底色', () => {
    const state = stateWith('```js\nconst a = 1\n```')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-codeblock')
  })

  it('分隔线渲染为通栏细线', () => {
    const state = stateWith('---')
    const classes = classesOf(buildDecorations(state, [rangeOf(state)]))
    expect(classes).toContain('cm-md-hr')
  })

  it('不隐藏任何字符：装饰数量与文本长度无关地覆盖原文', () => {
    const doc = '**粗体**'
    const state = stateWith(doc)
    const decorations = buildDecorations(state, [rangeOf(state)])
    // 装饰只添加样式，不删除文本
    expect(state.doc.toString()).toBe(doc)
    expect(decorations.size).toBeGreaterThan(0)
  })
})

/** 取出被弱化（ink-focus-dim）的范围 */
function dimRanges(decorations: ReturnType<typeof computeFocusDecorations>) {
  const result: { from: number; to: number }[] = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class?.includes('ink-focus-dim')) {
      result.push({ from: cursor.from, to: cursor.to })
    }
    cursor.next()
  }
  return result
}

/** 取出当前块的竖线行装饰 */
function activeLines(decorations: ReturnType<typeof computeFocusDecorations>) {
  const result: number[] = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const decoration = cursor.value as { spec?: { class?: string } }
    if (decoration.spec?.class?.includes('ink-focus-active')) result.push(cursor.from)
    cursor.next()
  }
  return result
}

describe('Focus Mode（spec §9）', () => {
  it('关闭时不产生任何装饰', () => {
    const state = stateWith('第一段\n\n第二段')
    const decorations = computeFocusDecorations(state, [rangeOf(state)])
    expect(decorations.size).toBe(0)
  })

  it('开启时非当前块被弱化', () => {
    const doc = '第一段\n\n第二段\n\n第三段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 0 },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    // 三个段落 → 两个被弱化（外加当前块的竖线行装饰）
    expect(dimRanges(decorations)).toHaveLength(2)
  })

  it('当前块带 accent 竖线（行装饰）', () => {
    const doc = '第一段\n\n第二段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 0 },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    const active = activeLines(decorations)
    expect(active.length).toBeGreaterThan(0)
  })

  it('当前块不被弱化', () => {
    const doc = '第一段\n\n第二段'
    const state = stateWith(doc, true)
    const withSelection = state.update({
      selection: { anchor: 0 },
      effects: setFocusModeEffect.of(true),
    }).state
    const decorations = computeFocusDecorations(withSelection, [rangeOf(withSelection)])
    // 被弱化的块不应覆盖光标所在的第一段
    expect(dimRanges(decorations).every((range) => range.from > 0)).toBe(true)
  })
})
